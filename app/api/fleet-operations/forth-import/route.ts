import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import {
  buildForthImportApprovalPayload,
  extractForthLocationIdFromSourceInfo,
  FORTH_LOCATION_ID_MARKER,
  type ForthLocationClassification
} from "@/lib/forth-locations-import";
import { loadEesDirectoryForForthImport } from "@/lib/forth-locations-import-directory";
import { reconcileBundledForthPinnedLocationsAgainstDirectory } from "@/lib/forth-locations-import-server";
import { hasPermission } from "@/lib/authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { admin } = await requireFleetOfficeAccess(request);
    const { locations, pins, pinStorageReady } = await loadEesDirectoryForForthImport(admin);
    const result = await reconcileBundledForthPinnedLocationsAgainstDirectory(locations, pins);
    const url = new URL(request.url);
    const classification = url.searchParams.get("classification");
    const group = (url.searchParams.get("group") ?? "").trim().toLocaleLowerCase();
    const search = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
    const confidence = url.searchParams.get("confidence");
    const category = (url.searchParams.get("category") ?? "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const importedByForthId = new Map(
      locations
        .map((location) => {
          const forthId = extractForthLocationIdFromSourceInfo(location.source_info);
          return forthId ? [forthId, location] as const : null;
        })
        .filter((value): value is readonly [string, (typeof locations)[number]] => Boolean(value))
    );
    const enriched = result.items.map((item) => {
      const directory = importedByForthId.get(item.record.forthLocationId) ?? null;
      return {
        item,
        alreadyImported: Boolean(directory),
        directoryVerificationStatus: directory?.verification_status ?? null,
        directoryLocationId: directory?.id ?? null
      };
    });
    const filtered = enriched.filter(({ item, alreadyImported, directoryVerificationStatus }) => {
      if (classification === "APPROVED") return alreadyImported;
      if (classification === "AWAITING_DIRECTORY_VERIFY") {
        return alreadyImported && directoryVerificationStatus !== "verified";
      }
      if (classification && classification !== "ALL" && item.classification !== (classification as ForthLocationClassification)) {
        return false;
      }
      if (group && normalize(item.record.groupLayer) !== group) return false;
      if (confidence && item.bestMatchConfidence !== confidence) return false;
      if (category && item.suggestedCategory !== category) return false;
      if (!search) return true;
      return [
        item.record.forthLocationId,
        item.record.name,
        item.record.groupLayer,
        item.record.address,
        item.classification,
        item.suggestedCategory,
        item.bestMatchConfidence,
        ...item.matchCandidates.map((candidate) => candidate.companyName)
      ].some((value) => value?.toLocaleLowerCase().includes(search));
    });
    const groups = [...new Set(result.items.map((item) => item.record.groupLayer).filter(Boolean) as string[])]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    const offset = (page - 1) * limit;
    const pageItems = filtered.slice(offset, offset + limit);
    return NextResponse.json({
      csvPath: result.csvPath,
      diameterNote: result.diameterNote,
      pinStorageReady,
      summary: {
        ...result.summary,
        bulkEligible: result.items.filter((item) => item.bulkEligible && !importedByForthId.has(item.record.forthLocationId)).length,
        strongMatches: result.items.filter((item) => item.bestMatchConfidence === "strong").length,
        possibleMatches: result.items.filter((item) => item.bestMatchConfidence === "possible").length,
        uncertainMatches: result.items.filter((item) => item.bestMatchConfidence === "uncertain").length
      },
      groups,
      page,
      limit,
      totalFiltered: filtered.length,
      truncated: filtered.length > offset + limit,
      items: pageItems.map(({ item, alreadyImported, directoryVerificationStatus, directoryLocationId }) => ({
        forthLocationId: item.record.forthLocationId,
        name: item.record.name,
        groupLayer: item.record.groupLayer,
        latitude: item.record.latitude,
        longitude: item.record.longitude,
        address: item.record.address,
        locationType: item.record.locationType,
        diameterRaw: item.record.diameterRaw,
        classification: item.classification,
        suggestedCategory: item.suggestedCategory,
        matchedEesLocationId: item.matchedEesLocationId || directoryLocationId,
        bestMatchConfidence: item.bestMatchConfidence,
        bulkEligible: item.bulkEligible && !alreadyImported,
        alreadyImported,
        directoryVerificationStatus,
        awaitingDirectoryVerify: alreadyImported && directoryVerificationStatus !== "verified",
        matchCandidates: item.matchCandidates.slice(0, 5),
        notes: item.notes,
        canApproveAsNew: Boolean(item.proposedDirectory)
          && !alreadyImported
          && (item.classification === "NEW_LOCATION" || item.classification === "REQUIRES_REVIEW"
            || item.classification === "POSSIBLE_DUPLICATE")
      }))
    }, { headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof AdminApiError ? error.message : "Unable to reconcile the Forth locations export."
    }, { status: error instanceof AdminApiError ? error.status : 500, headers });
  }
}

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/** Approve a Forth candidate into the existing EES Locations Directory as needs_check. Never confirms pins. */
export async function POST(request: Request) {
  try {
    const { user, admin, access } = await requireFleetOfficeAccess(request, true);
    if (!hasPermission(access, "business:write")) {
      throw new AdminApiError(403, "Write access is required to approve Forth location imports.");
    }
    const body = await request.json() as {
      forthLocationId?: string;
      action?: "create_directory_draft" | "link_existing";
      eesLocationId?: string;
      forceDuplicate?: boolean;
    };
    const forthLocationId = String(body.forthLocationId ?? "").trim();
    if (!/^\d+$/.test(forthLocationId)) throw new AdminApiError(400, "Provide a valid Forth location ID.");
    const { locations, pins } = await loadEesDirectoryForForthImport(admin);
    const result = await reconcileBundledForthPinnedLocationsAgainstDirectory(locations, pins);
    const item = result.items.find((candidate) => candidate.record.forthLocationId === forthLocationId);
    if (!item) throw new AdminApiError(404, "That Forth location ID was not found in the bundled export.");

    if (body.action === "link_existing") {
      const eesLocationId = String(body.eesLocationId ?? item.matchedEesLocationId ?? "").trim();
      if (!eesLocationId) throw new AdminApiError(400, "Choose an EES location to link.");
      const existing = locations.find((location) => location.id === eesLocationId);
      if (!existing) throw new AdminApiError(404, "EES location not found.");
      const already = extractForthLocationIdFromSourceInfo(existing.source_info);
      if (already && already !== forthLocationId) {
        throw new AdminApiError(409, "That EES location is already linked to a different Forth ID.");
      }
      const sourceInfo = [
        existing.source_info?.trim() || null,
        already === forthLocationId ? null : `${FORTH_LOCATION_ID_MARKER} ${forthLocationId}`,
        `Forth link audit: linked by office user on ${new Date().toISOString()}`
      ].filter(Boolean).join("\n");
      const { data, error } = await admin.from("ees_locations").update({
        source_info: sourceInfo,
        updated_by: user.id
      }).eq("id", eesLocationId).select("id,company_name,source_info").single();
      if (error) throw error;
      return NextResponse.json({
        action: "link_existing",
        location: data,
        note: "Forth ID linked in source_info. Existing coordinates and verification were not overwritten."
      }, { headers });
    }

    if (item.classification === "MATCHED") {
      throw new AdminApiError(409, "This Forth location is already matched. Use link_existing only if repairing source_info.");
    }
    if (item.classification === "POSSIBLE_DUPLICATE" && body.forceDuplicate !== true) {
      throw new AdminApiError(409, "Possible duplicate. Set forceDuplicate=true only after office review.");
    }
    if (item.classification === "MISSING_COORDINATES" || item.classification === "INVALID_COORDINATES") {
      throw new AdminApiError(400, "Cannot import a Forth record without valid coordinates.");
    }
    const linkedAlready = locations.some((location) =>
      extractForthLocationIdFromSourceInfo(location.source_info) === forthLocationId);
    if (linkedAlready) throw new AdminApiError(409, "An EES location already stores this Forth location ID.");

    const payload = buildForthImportApprovalPayload(item);
    const { data, error } = await admin.from("ees_locations").insert({
      company_name: payload.company_name,
      thai_name: payload.thai_name,
      alternative_names: payload.alternative_names,
      address: payload.address,
      province: payload.province,
      destination_type: payload.destination_type,
      google_maps_url: null,
      truck_entrance_url: null,
      verification_status: "needs_check",
      verified_at: null,
      notes: payload.notes,
      source_info: payload.source_info,
      created_by: user.id,
      updated_by: user.id
    }).select("id,company_name,thai_name,address,destination_type,verification_status,source_info").single();
    if (error) throw error;
    return NextResponse.json({
      action: "create_directory_draft",
      location: data,
      forthCoordinates: {
        latitude: payload.forth_latitude,
        longitude: payload.forth_longitude,
        diameterRaw: payload.forth_diameter_raw
      },
      note: "Directory draft created as needs_check. No destination pin was confirmed. Confirm pins in Locations before geofence activation."
    }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof AdminApiError ? error.message : "Unable to approve the Forth location import."
    }, { status: error instanceof AdminApiError ? error.status : 500, headers });
  }
}
