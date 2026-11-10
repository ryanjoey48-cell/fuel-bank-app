/**
 * READ ONLY. Forth GPS readiness for first supervised real pilot.
 * Does not enable monitor, does not write fleet events, does not call Forth write APIs.
 *
 * Loads Forth credentials from .env.local (Forth is external).
 * Loads staging Supabase from .env.staging.local for zone readiness checks only.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  assertApprovedStagingTarget,
  assertNotConfirmedProductionForExperimentalSql,
  extractSupabaseProjectRef
} from "../lib/ees-database-environment";
import { createForthTrackingService } from "../lib/forth-tracking-server";
import { isForthGpsPositionVerified } from "../lib/forth-tracking-view";
import { prepareForthGeofenceObservations } from "../lib/fleet-geofence-source";
import { geofenceDistanceMeters } from "../lib/fleet-geofence-engine";

const root = path.resolve(__dirname, "..");
const CALCOMP = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  forthId: "2742427",
  name: "CAL-COMP",
  latitude: 13.234431,
  longitude: 99.806063,
  radiusMeters: 150
};

/** Practical search bands for “near” without inventing presence inside the zone. */
const NEAR_BANDS_M = [150, 500, 2000, 5000, 15000, 50000] as const;

function loadEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function ageMinutes(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.round((nowMs - ms) / 60_000);
}

async function main() {
  const localEnv = loadEnv(path.join(root, ".env.local"));
  const stagingEnv = loadEnv(path.join(root, ".env.staging.local"));

  const localRef = extractSupabaseProjectRef(localEnv.NEXT_PUBLIC_SUPABASE_URL);
  const stagingRef = extractSupabaseProjectRef(stagingEnv.NEXT_PUBLIC_SUPABASE_URL);
  assertNotConfirmedProductionForExperimentalSql(stagingEnv.NEXT_PUBLIC_SUPABASE_URL);
  assertApprovedStagingTarget(stagingEnv.NEXT_PUBLIC_SUPABASE_URL, stagingEnv.EES_APPROVED_STAGING_PROJECT_REF);

  const forthEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of [
    "FORTH_CLIENT_ID",
    "FORTH_CLIENT_SECRET",
    "FORTH_USERNAME",
    "FORTH_PASSWORD",
    "FORTH_TOKEN_REQUEST_PROFILE",
    "FORTH_SOURCE_TIME_ZONE"
  ]) {
    if (localEnv[key]) forthEnv[key] = localEnv[key];
  }

  const forth = createForthTrackingService({ environment: forthEnv });
  const feed = await forth.getFleetData();
  const diagnostic = await forth.diagnoseStatus();
  const nowMs = Date.now();
  const prepared = prepareForthGeofenceObservations(feed.records, feed.fetchedAt ?? new Date().toISOString());

  const gpsVerified = feed.records.filter((r) => isForthGpsPositionVerified(r));
  const withTrustworthySource = gpsVerified.filter((r) => {
    const sourceMs = Date.parse(r.lastGpsTimestamp ?? "");
    return Number.isFinite(sourceMs) && sourceMs <= nowMs + 60_000 && nowMs - sourceMs <= 15 * 60_000;
  });

  type NearRow = {
    vehicleKey: string;
    registration: string | null;
    gpsDeviceId: string | null;
    latitude: number;
    longitude: number;
    sourceAt: string | null;
    sourceAgeMinutes: number | null;
    distanceMeters: number;
    within150m: boolean;
    within500m: boolean;
    within5km: boolean;
    within15km: boolean;
    within50km: boolean;
    gpsVerified: true;
    trackerConnected: boolean;
  };

  const nearCalComp: NearRow[] = [];
  for (const record of withTrustworthySource) {
    if (typeof record.latitude !== "number" || typeof record.longitude !== "number") continue;
    const id = record.gpsDeviceId?.trim();
    if (!id) continue;
    const distanceMeters = Math.round(
      geofenceDistanceMeters(
        { latitude: record.latitude, longitude: record.longitude },
        { latitude: CALCOMP.latitude, longitude: CALCOMP.longitude }
      )
    );
    nearCalComp.push({
      vehicleKey: `forth:${id}`,
      registration: record.vehicleRegistration,
      gpsDeviceId: id,
      latitude: record.latitude,
      longitude: record.longitude,
      sourceAt: record.lastGpsTimestamp,
      sourceAgeMinutes: ageMinutes(record.lastGpsTimestamp, nowMs),
      distanceMeters,
      within150m: distanceMeters <= 150,
      within500m: distanceMeters <= 500,
      within5km: distanceMeters <= 5_000,
      within15km: distanceMeters <= 15_000,
      within50km: distanceMeters <= 50_000,
      gpsVerified: true,
      trackerConnected: record.gpsConnectivity === "connected"
    });
  }
  nearCalComp.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const bandCounts: Record<string, number> = {};
  for (const band of NEAR_BANDS_M) {
    bandCounts[`within_${band}m`] = nearCalComp.filter((r) => r.distanceMeters <= band).length;
  }

  const sourceTimestamps = withTrustworthySource
    .map((r) => r.lastGpsTimestamp)
    .filter((v): v is string => Boolean(v))
    .sort();
  const uniqueSourceAts = [...new Set(sourceTimestamps)];

  // Staging zone readiness (read-only)
  const stagingAdmin = createClient(
    stagingEnv.NEXT_PUBLIC_SUPABASE_URL,
    stagingEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: loc } = await stagingAdmin
    .from("ees_locations")
    .select("id,company_name,verification_status,is_active,source_info,notes")
    .eq("id", CALCOMP.id)
    .maybeSingle();
  const { data: pin } = await stagingAdmin
    .from("ees_location_map_pins")
    .select("latitude,longitude,pin_status,coordinate_source")
    .eq("location_id", CALCOMP.id)
    .eq("pin_type", "destination")
    .maybeSingle();
  const { data: zone } = await stagingAdmin
    .from("ees_fleet_geofence_zones")
    .select("active,radius_meters,entry_dwell_seconds,exit_dwell_seconds,hysteresis_meters,updated_at")
    .eq("location_id", CALCOMP.id)
    .maybeSingle();
  const { data: link } = await stagingAdmin
    .from("ees_forth_location_links")
    .select("forth_location_id,ees_location_id,link_status")
    .eq("forth_location_id", CALCOMP.forthId)
    .maybeSingle();
  const { count: syntheticVisitCount } = await stagingAdmin
    .from("ees_fleet_visit_events")
    .select("*", { count: "exact", head: true })
    .like("vehicle_key", "staging:synthetic:%");
  const { count: realishVisitCount } = await stagingAdmin
    .from("ees_fleet_visit_events")
    .select("*", { count: "exact", head: true })
    .like("vehicle_key", "forth:%");

  const monitorSecret = stagingEnv.EES_FLEET_MONITOR_SECRET ?? "";
  const monitorSecretReady = monitorSecret.length >= 32;

  const insideNow = nearCalComp.filter((r) => r.within150m);
  const approaching = nearCalComp.filter((r) => !r.within150m && r.within5km);

  const blockers: string[] = [];
  if (localRef === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    blockers.push(
      "Default .env.local points at production Supabase — supervised monitor must load .env.staging.local for DB writes; never run monitor against production."
    );
  }
  if (!stagingEnv.FORTH_CLIENT_ID && !localEnv.FORTH_CLIENT_ID) {
    blockers.push("Forth credentials missing.");
  } else if (!stagingEnv.FORTH_CLIENT_ID) {
    blockers.push(
      ".env.staging.local has no FORTH_* keys — supervised staging run must merge Forth credentials from vault/.env.local without switching Supabase URL to production."
    );
  }
  if (stagingEnv.EES_FLEET_MONITOR_ENABLED === "true") {
    blockers.push("EES_FLEET_MONITOR_ENABLED is unexpectedly true on staging env file.");
  }
  if (!monitorSecretReady) {
    blockers.push("EES_FLEET_MONITOR_SECRET missing or shorter than 32 characters in .env.staging.local.");
  }
  if (!(zone?.active && zone.radius_meters === 150 && loc?.verification_status === "verified" && pin?.pin_status === "manual_confirmed")) {
    blockers.push("CAL-COMP staging zone/pin/verify not fully ready.");
  }
  if (insideNow.length === 0) {
    blockers.push(
      "No GPS-verified vehicle currently within 150 m of CAL-COMP — do not invent a visit; wait for natural presence or choose another pilot site."
    );
  }

  const recommendation =
    insideNow.length > 0
      ? {
          firstLiveLocation: "CAL-COMP",
          reason: "At least one GPS-verified vehicle is inside the provisional 150 m zone right now."
        }
      : approaching.length > 0
        ? {
            firstLiveLocation: "CAL-COMP (wait)",
            reason: `${approaching.length} verified vehicle(s) within 5 km — keep CAL-COMP as first site and wait for natural entry; do not force coordinates.`
          }
        : nearCalComp[0] && nearCalComp[0].distanceMeters <= 50_000
          ? {
              firstLiveLocation: "CAL-COMP (opportunistic later)",
              reason: `Nearest verified vehicle is ${nearCalComp[0].distanceMeters} m away (${nearCalComp[0].registration ?? "unknown"}). CAL-COMP remains the owner-approved first pilot; schedule when a truck is expected on site.`
            }
          : {
              firstLiveLocation: "CAL-COMP remains preferred owner pilot; no nearby verified traffic now",
              reason:
                "No verified vehicle within 50 km of CAL-COMP in this snapshot. Do not invent presence. Consider waiting for a known CAL-COMP dispatch, or owner may nominate another verified+pinned staging location if operational priority changes."
            };

  const report = {
    recordType: "EES_V20_2_FIRST_REAL_FORTH_GPS_PILOT_READINESS",
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    forth: {
      connectionStatus: feed.connectionStatus,
      fetchedAt: feed.fetchedAt,
      totalRecords: feed.records.length,
      gpsVerifiedCount: gpsVerified.length,
      gpsVerifiedWithTrustworthySourceAtCount: withTrustworthySource.length,
      preparedObservationCount: prepared.observations.length,
      skippedDeviceIdIssues: prepared.skipped.length,
      diagnosticError: diagnostic.error,
      trustworthySourceAtRange:
        uniqueSourceAts.length > 0
          ? { earliest: uniqueSourceAts[0], latest: uniqueSourceAts[uniqueSourceAts.length - 1], uniqueCount: uniqueSourceAts.length }
          : null
    },
    calComp: {
      stagingLocationId: CALCOMP.id,
      forthId: CALCOMP.forthId,
      pin: { latitude: CALCOMP.latitude, longitude: CALCOMP.longitude },
      radiusMeters: CALCOMP.radiusMeters,
      bandCounts,
      vehiclesInside150m: insideNow.map(summarizeVehicle),
      vehiclesWithin5km: nearCalComp.filter((r) => r.within5km).map(summarizeVehicle),
      nearestVerifiedVehicles: nearCalComp.slice(0, 8).map(summarizeVehicle)
    },
    stagingReadiness: {
      projectRef: stagingRef,
      productionRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF,
      localEnvProjectRef: localRef,
      monitorEnabledFlag: stagingEnv.EES_FLEET_MONITOR_ENABLED,
      pushTestEnabledFlag: stagingEnv.EES_WEB_PUSH_TEST_ENABLED,
      monitorSecretLengthOk: monitorSecretReady,
      location: loc,
      pin,
      zone,
      forthLink: link,
      syntheticVisitEventCount: syntheticVisitCount ?? 0,
      forthPrefixedVisitEventCount: realishVisitCount ?? 0,
      syntheticSeparation:
        "Synthetic vehicle_keys use staging:synthetic:* prefix; real Forth keys use forth:<deviceId>. Keep both in staging only; never copy to production."
    },
    monitorApi: {
      route: "GET /api/internal/fleet-monitor",
      file: "app/api/internal/fleet-monitor/route.ts",
      requires: [
        "EES_FLEET_MONITOR_ENABLED=true",
        "Authorization: Bearer <EES_FLEET_MONITOR_SECRET> (≥32 chars)",
        "createServerSupabaseAdmin() → process.env Supabase URL/service role (MUST be staging)",
        "acquire_ees_fleet_monitor_lease 180s",
        "active zones bound ≤1000",
        "Forth snapshot via getForthTrackingFleetData (read-only)",
        "outbox enqueue with deliveryEnabled=false"
      ],
      maxDurationSeconds: 60,
      intentionallyUnscheduled: true,
      productionAccidentRisk:
        "High if Next server loads .env.local (production Supabase). Supervised run must bind staging env exclusively."
    },
    recommendation,
    blockers,
    supervisedProcedurePrepared: true,
    activationAuthorised: false
  };

  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  const outPath = path.join(root, "output", "v20-2-first-real-forth-gps-pilot-readiness.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        outPath: "output/v20-2-first-real-forth-gps-pilot-readiness.json",
        forthConnected: feed.connectionStatus,
        totalRecords: feed.records.length,
        gpsVerified: gpsVerified.length,
        trustworthySource: withTrustworthySource.length,
        inside150m: insideNow.length,
        within5km: nearCalComp.filter((r) => r.within5km).length,
        nearestM: nearCalComp[0]?.distanceMeters ?? null,
        nearestReg: nearCalComp[0]?.registration ?? null,
        blockers: blockers.length,
        recommendation: recommendation.firstLiveLocation
      },
      null,
      2
    )
  );
}

function summarizeVehicle(row: {
  vehicleKey: string;
  registration: string | null;
  distanceMeters: number;
  sourceAt: string | null;
  sourceAgeMinutes: number | null;
  within150m: boolean;
}) {
  return {
    vehicleKey: row.vehicleKey,
    registration: row.registration,
    distanceMeters: row.distanceMeters,
    sourceAt: row.sourceAt,
    sourceAgeMinutes: row.sourceAgeMinutes,
    within150m: row.within150m
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
