import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import {
  AdminApiError,
  createServerSupabaseAdmin,
  requireVerifiedUser,
  resolveAccountAccess
} from "@/lib/admin-user-management-server";
import { buildForthGpsMapPayloadFromCsv } from "@/lib/forth-gps-map-locations";
import {
  FORTH_PINNED_LOCATIONS_CSV_RELATIVE_PATH,
  loadBundledForthPinnedLocationsCsv
} from "@/lib/forth-locations-import-server";
import { extractForthLocationIdFromSourceInfo } from "@/lib/forth-locations-import";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

/**
 * Read-only Forth GPS saved locations from the bundled CSV.
 * Does not write Directory, map pins, geofences or Forth devices.
 */
export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:read")) {
      throw new AdminApiError(403, "EES office access is required.");
    }

    const csvText = await loadBundledForthPinnedLocationsCsv();

    // Optional soft-match hints against Directory Forth IDs — never mutates Directory.
    const matchByForthId = new Map<string, { eesLocationId: string; confidence: string | null }>();
    let directoryCount = 0;
    try {
      const { data, error } = await admin
        .from("ees_locations")
        .select("id,source_info")
        .limit(5000);
      if (!error && Array.isArray(data)) {
        directoryCount = data.length;
        for (const row of data) {
          const forthId = extractForthLocationIdFromSourceInfo(
            row && typeof row === "object" ? (row as { source_info?: string | null }).source_info : null
          );
          const locationId = row && typeof row === "object" ? String((row as { id?: unknown }).id ?? "") : "";
          if (forthId && locationId && !matchByForthId.has(forthId)) {
            matchByForthId.set(forthId, { eesLocationId: locationId, confidence: "strong" });
          }
        }
      }
    } catch {
      // Directory probe is optional for the CSV map layer.
    }

    const payload = buildForthGpsMapPayloadFromCsv(csvText, {
      sourcePath: FORTH_PINNED_LOCATIONS_CSV_RELATIVE_PATH,
      matchByForthId
    });

    if (payload.validation.status !== "ready") {
      return NextResponse.json({
        ...payload,
        directoryRecordCount: directoryCount,
        error: payload.validation.message
      }, { status: 422, headers: privateNoStoreHeaders });
    }

    return NextResponse.json({
      ...payload,
      directoryRecordCount: directoryCount,
      geofencesEnabled: false,
      arrivalsDeparturesEnabled: false
    }, { headers: privateNoStoreHeaders });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const message = error instanceof AdminApiError ? error.message : "Forth saved locations are unavailable.";
    return NextResponse.json({ error: message }, { status, headers: privateNoStoreHeaders });
  }
}
