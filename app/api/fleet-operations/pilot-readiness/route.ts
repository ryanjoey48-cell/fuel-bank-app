import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { extractForthLocationIdFromSourceInfo } from "@/lib/forth-locations-import";
import { loadEesDirectoryForForthImport, missingTable } from "@/lib/forth-locations-import-directory";
import { reconcileBundledForthPinnedLocationsAgainstDirectory } from "@/lib/forth-locations-import-server";
import { buildFleetPilotReadiness, resolveFleetEnvironmentLabel } from "@/lib/fleet-pilot-readiness";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { admin } = await requireFleetOfficeAccess(request);
    const { locations, pins, pinStorageReady } = await loadEesDirectoryForForthImport(admin);
    const reconciled = await reconcileBundledForthPinnedLocationsAgainstDirectory(locations, pins);
    const importedIds = new Set(
      locations
        .map((location) => extractForthLocationIdFromSourceInfo(location.source_info))
        .filter((value): value is string => Boolean(value))
    );
    const draftsWithForthId = locations.filter((location) =>
      Boolean(extractForthLocationIdFromSourceInfo(location.source_info))
      && location.verification_status !== "verified").length;
    const awaitingConfirmation = locations.filter((location) =>
      Boolean(extractForthLocationIdFromSourceInfo(location.source_info))
      && !pins.some((pin) => pin.location_id === location.id)).length;

    let visitStorageReady = true;
    let geofencesEnabled = 0;
    const { count: zoneCount, error: zoneError } = await admin.from("ees_fleet_geofence_zones")
      .select("location_id", { count: "exact", head: true }).eq("active", true);
    if (zoneError) {
      if (!missingTable(zoneError)) throw zoneError;
      visitStorageReady = false;
    } else {
      geofencesEnabled = zoneCount ?? 0;
    }

    let forthAuditStorageReady = true;
    const { error: auditError } = await admin.from("ees_forth_location_import_audit")
      .select("id", { count: "exact", head: true });
    if (auditError) {
      if (!missingTable(auditError)) throw auditError;
      forthAuditStorageReady = false;
    }

    let pilotLocationsSelected = 0;
    const { count: pilotCount, error: pilotError } = await admin.from("ees_fleet_geofence_pilot_sites")
      .select("location_id", { count: "exact", head: true }).eq("selected", true);
    if (!pilotError) pilotLocationsSelected = pilotCount ?? 0;

    const secret = process.env.EES_FLEET_MONITOR_SECRET ?? "";
    const readiness = buildFleetPilotReadiness({
      environmentLabel: resolveFleetEnvironmentLabel(process.env.EES_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV),
      forthSourceRecords: reconciled.summary.forthSourceRecords,
      draftsWithForthId,
      awaitingConfirmation,
      confirmedDestinations: pins.length,
      geofencesEnabled,
      pilotLocationsSelected: pilotLocationsSelected || Math.min(pins.length, geofencesEnabled),
      visitStorageReady,
      forthAuditStorageReady,
      mapPinStorageReady: pinStorageReady,
      monitorEnabled: process.env.EES_FLEET_MONITOR_ENABLED === "true",
      monitorSecretConfigured: secret.length >= 32,
      vapidConfigured: Boolean(process.env.EES_WEB_PUSH_VAPID_PUBLIC_KEY && process.env.EES_WEB_PUSH_VAPID_PRIVATE_KEY && process.env.EES_WEB_PUSH_VAPID_SUBJECT),
      webPushTestEnabled: process.env.EES_WEB_PUSH_TEST_ENABLED === "true",
      activePushDevices: 0
    });

    return NextResponse.json({
      ...readiness,
      reconciliation: {
        classifications: reconciled.summary.classifications,
        approvedImports: importedIds.size,
        bulkEligible: reconciled.items.filter((item) => item.bulkEligible && !importedIds.has(item.record.forthLocationId)).length,
        eesDirectoryRecords: reconciled.summary.eesDirectoryRecords,
        diameterNote: reconciled.diameterNote
      },
      activationChecklist: [
        { step: 1, en: "Bulk-import safe NEW Forth candidates as Directory drafts", th: "นำเข้าร่างสถานที่ใหม่จาก Forth แบบกลุ่ม", done: draftsWithForthId > 0 },
        { step: 2, en: "Individually review POSSIBLE_DUPLICATE / REQUIRES_REVIEW rows", th: "ตรวจรายการที่อาจซ้ำหรือต้องทบทวนทีละรายการ", done: false },
        { step: 3, en: "Confirm destination pins in Locations (manual)", th: "ยืนยันหมุดปลายทางในไดเรกทอรี", done: pins.length > 0 },
        { step: 4, en: "Enable 5–10 pilot geofences with audit reason", th: "เปิดโซนนำร่อง 5–10 แห่งพร้อมเหตุผล", done: geofencesEnabled > 0 },
        { step: 5, en: "Approve and install V20 storage SQL", th: "อนุมัติและติดตั้ง SQL ของ V20", done: visitStorageReady },
        { step: 6, en: "Configure monitor secret (do not schedule yet without staged proof)", th: "ตั้งค่าความลับมอนิเตอร์ (ยังไม่ตั้งตารางจนกว่าจะทดสอบ)", done: secret.length >= 32 }
      ]
    }, { headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof AdminApiError ? error.message : "Unable to load pilot readiness."
    }, { status: error instanceof AdminApiError ? error.status : 500, headers });
  }
}
