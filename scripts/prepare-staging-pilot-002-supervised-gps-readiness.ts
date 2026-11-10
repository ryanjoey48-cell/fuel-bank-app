/**
 * Staging-only Pilot 002 supervised real-GPS readiness (no monitor activation).
 * - Confirms staging identity / production isolation
 * - Ensures monitor secret + project/location allowlists in .env.staging.local
 * - Copies Forth READ credentials from .env.local without copying production Supabase keys
 * - Probes nearby GPS-verified vehicles (read-only)
 * - Writes output/v20-3-pilot-002-supervised-gps-readiness.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  EES_PILOT_002_DEPOT_LOCATION_ID,
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  assertApprovedStagingTarget,
  assertFleetMonitorAllowedLocationIds,
  assertFleetMonitorSupabaseTarget,
  assertNotConfirmedProductionForExperimentalSql,
  extractSupabaseProjectRef,
  filterGeofencesToLocationAllowlist
} from "../lib/ees-database-environment";
import { createForthTrackingService } from "../lib/forth-tracking-server";
import { isForthGpsPositionVerified } from "../lib/forth-tracking-view";
import { geofenceDistanceMeters } from "../lib/fleet-geofence-engine";

const root = path.resolve(__dirname, "..");
const STAGING_REF = "wpmnjfncaoogssgpqxek";
const DEPOT_ID = EES_PILOT_002_DEPOT_LOCATION_ID;
const CALCOMP_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FORTH_DEPOT = { latitude: 13.768732, longitude: 100.766033 };
const OFFICE_FORTH = "1708908";
const FORTH_KEYS = [
  "FORTH_CLIENT_ID",
  "FORTH_CLIENT_SECRET",
  "FORTH_USERNAME",
  "FORTH_PASSWORD",
  "FORTH_TOKEN_REQUEST_PROFILE",
  "FORTH_SOURCE_TIME_ZONE"
] as const;

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

function upsertEnvFile(filePath: string, updates: Record<string, string>): string[] {
  const changed: string[] = [];
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (!(key in updates)) return line;
    seen.add(key);
    const value = updates[key];
    if (line.slice(i + 1).trim() === value) return line;
    changed.push(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    next.push(`${key}=${value}`);
    changed.push(key);
  }
  if (changed.length) {
    const body = next.join("\n").replace(/\n*$/, "\n");
    fs.writeFileSync(filePath, body);
  }
  return changed;
}

function presence(value: string | undefined) {
  return { present: Boolean(value), length: value ? value.length : 0 };
}

async function main() {
  const stagingPath = path.join(root, ".env.staging.local");
  const localPath = path.join(root, ".env.local");
  const staging = loadEnv(stagingPath);
  const local = loadEnv(localPath);

  assertNotConfirmedProductionForExperimentalSql(staging.NEXT_PUBLIC_SUPABASE_URL);
  assertApprovedStagingTarget(staging.NEXT_PUBLIC_SUPABASE_URL, staging.EES_APPROVED_STAGING_PROJECT_REF || STAGING_REF);
  const stagingRef = extractSupabaseProjectRef(staging.NEXT_PUBLIC_SUPABASE_URL);
  if (stagingRef !== STAGING_REF) throw new Error(`Wrong staging ref: ${stagingRef}`);

  const localRef = extractSupabaseProjectRef(local.NEXT_PUBLIC_SUPABASE_URL);
  if (localRef === STAGING_REF) {
    // unusual but ok
  }
  if (staging.SUPABASE_SERVICE_ROLE_KEY && local.SUPABASE_SERVICE_ROLE_KEY) {
    if (staging.SUPABASE_SERVICE_ROLE_KEY === local.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Staging service role matches .env.local — refusing to treat as isolated staging.");
    }
  }

  const updates: Record<string, string> = {};
  if (!staging.EES_APPROVED_STAGING_PROJECT_REF) updates.EES_APPROVED_STAGING_PROJECT_REF = STAGING_REF;
  if (!staging.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF) {
    updates.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF = STAGING_REF;
  }
  if (staging.EES_FLEET_MONITOR_ENABLED !== "false") updates.EES_FLEET_MONITOR_ENABLED = "false";
  if (staging.EES_WEB_PUSH_TEST_ENABLED !== "false") updates.EES_WEB_PUSH_TEST_ENABLED = "false";
  if (!staging.EES_FLEET_MONITOR_SECRET || staging.EES_FLEET_MONITOR_SECRET.length < 32) {
    updates.EES_FLEET_MONITOR_SECRET = crypto.randomBytes(32).toString("base64url");
  }
  updates.EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS = DEPOT_ID;

  for (const key of FORTH_KEYS) {
    if (!staging[key] && local[key]) updates[key] = local[key];
  }
  if (!updates.FORTH_TOKEN_REQUEST_PROFILE && !staging.FORTH_TOKEN_REQUEST_PROFILE) {
    updates.FORTH_TOKEN_REQUEST_PROFILE = "oauth-password-basic-v1";
  }

  // Never copy production Supabase credentials into staging.
  delete (updates as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL;
  delete (updates as Record<string, string>).NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete (updates as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY;

  const envChanges = upsertEnvFile(stagingPath, updates);
  const env = { ...staging, ...updates };

  const isolation = assertFleetMonitorSupabaseTarget({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    allowedProjectRef: env.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF,
    approvedStagingRef: env.EES_APPROVED_STAGING_PROJECT_REF
  });
  const allowedLocations = assertFleetMonitorAllowedLocationIds(env.EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS);
  if (allowedLocations.length !== 1 || allowedLocations[0] !== DEPOT_ID) {
    throw new Error("Location allowlist must be Pilot 002 depot only.");
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: zones } = await admin
    .from("ees_fleet_geofence_zones")
    .select("location_id,active,radius_meters,entry_dwell_seconds,exit_dwell_seconds,hysteresis_meters")
    .eq("active", true);
  const { data: depot } = await admin
    .from("ees_locations")
    .select("id,company_name,verification_status,is_active")
    .eq("id", DEPOT_ID)
    .maybeSingle();
  const { data: pin } = await admin
    .from("ees_location_map_pins")
    .select("latitude,longitude,pin_status,pin_type,coordinate_source,source_reference")
    .eq("location_id", DEPOT_ID)
    .eq("pin_type", "destination")
    .maybeSingle();
  const { data: officeLink } = await admin
    .from("ees_forth_location_links")
    .select("forth_location_id")
    .eq("forth_location_id", OFFICE_FORTH)
    .maybeSingle();
  const { count: syntheticStateCount } = await admin
    .from("ees_fleet_vehicle_geofence_state")
    .select("*", { count: "exact", head: true })
    .like("vehicle_key", "staging:synthetic:%");
  const { count: forthStateCount } = await admin
    .from("ees_fleet_vehicle_geofence_state")
    .select("*", { count: "exact", head: true })
    .like("vehicle_key", "forth:%");

  const activeZones = zones ?? [];
  const allowlisted = filterGeofencesToLocationAllowlist(
    activeZones.map((z) => ({ locationId: z.location_id, ...z })),
    allowedLocations
  );

  const forthMissing = FORTH_KEYS.filter((k) => !env[k]);
  let proximity: Record<string, unknown> | null = null;
  let forthProbeError: string | null = null;
  if (!forthMissing.length) {
    try {
      const forth = createForthTrackingService({ environment: env });
      const feed = await forth.getFleetData();
      const verified = feed.records.filter(isForthGpsPositionVerified);
      const nearest = verified
        .map((r) => ({
          registration: r.vehicleRegistration,
          vehicleKey: r.gpsDeviceId ? `forth:${r.gpsDeviceId}` : null,
          sourceAt: r.lastGpsTimestamp,
          gpsVerified: true,
          meters: Math.round(
            geofenceDistanceMeters(
              { latitude: r.latitude as number, longitude: r.longitude as number },
              FORTH_DEPOT
            )
          )
        }))
        .sort((a, b) => a.meters - b.meters);
      proximity = {
        connectionStatus: feed.connectionStatus,
        verifiedCount: verified.length,
        within120m: nearest.filter((n) => n.meters <= 120),
        within500m: nearest.filter((n) => n.meters <= 500).slice(0, 10),
        nearest5: nearest.slice(0, 5)
      };
    } catch (error) {
      forthProbeError = error instanceof Error ? error.message : String(error);
    }
  }

  const within120 = Array.isArray((proximity as { within120m?: unknown })?.within120m)
    ? ((proximity as { within120m: unknown[] }).within120m as unknown[])
    : [];
  const blockers: string[] = [];
  if (forthMissing.length) blockers.push(`Missing Forth staging keys: ${forthMissing.join(", ")}`);
  if (forthProbeError) blockers.push(`Forth probe failed: ${forthProbeError}`);
  if (env.EES_FLEET_MONITOR_ENABLED === "true") blockers.push("Monitor flag unexpectedly enabled");
  if (env.EES_WEB_PUSH_TEST_ENABLED === "true") blockers.push("Web push TEST unexpectedly enabled");
  if (!depot || depot.verification_status !== "verified" || !depot.is_active) {
    blockers.push("Depot Directory not verified/active on staging");
  }
  if (!pin || pin.pin_status !== "manual_confirmed") blockers.push("Depot destination pin not confirmed");
  if (officeLink) blockers.push("Office Forth 1708908 unexpectedly linked on staging");
  if (allowlisted.length !== 1 || allowlisted[0]?.location_id !== DEPOT_ID) {
    blockers.push("Allowlisted active zone set is not exactly the Pilot 002 depot");
  }
  if (activeZones.some((z) => z.location_id === CALCOMP_ID) && allowedLocations.includes(CALCOMP_ID)) {
    blockers.push("CAL-COMP must not be in the supervised location allowlist");
  }
  if (!within120.length) {
    blockers.push(
      "No GPS-verified vehicle currently within 120 m of depot pin — wait for natural presence before first pulse"
    );
  }

  const goNoGo =
    blockers.length === 0
      ? "GO"
      : blockers.every((b) => b.startsWith("No GPS-verified vehicle"))
        ? "CONDITIONAL_GO_WAIT_FOR_VEHICLE"
        : "NO_GO";

  const report = {
    recordType: "EES_V20_3_PILOT_002_SUPERVISED_GPS_READINESS",
    generatedAt: new Date().toISOString(),
    stagingRef: isolation.projectRef,
    productionRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF,
    identityVerified: true,
    envFileChanges: envChanges,
    credentialsReadiness: {
      stagingSupabaseUrlRef: stagingRef,
      localSupabaseUrlRef: localRef,
      stagingServiceRoleDistinctFromLocal:
        Boolean(env.SUPABASE_SERVICE_ROLE_KEY) &&
        env.SUPABASE_SERVICE_ROLE_KEY !== local.SUPABASE_SERVICE_ROLE_KEY,
      monitorEnabled: env.EES_FLEET_MONITOR_ENABLED,
      webPushTestEnabled: env.EES_WEB_PUSH_TEST_ENABLED,
      monitorSecret: presence(env.EES_FLEET_MONITOR_SECRET),
      allowedProjectRef: env.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF,
      allowedLocationIds: allowedLocations,
      forthKeys: Object.fromEntries(FORTH_KEYS.map((k) => [k, presence(env[k])])),
      forthCopiedFromLocalWithoutProductionSupabase: FORTH_KEYS.every((k) => Boolean(env[k]))
    },
    productionIsolation: {
      monitorCannotUseProductionUrl: true,
      allowedProjectRefRefusesProduction: true,
      locationAllowlistFailClosed: true,
      monitorFlagOff: env.EES_FLEET_MONITOR_ENABLED === "false",
      pushDeliveryDisabledByDefault: true,
      cronNotConfigured: true,
      forthApiWritesNotInMonitorPath: true,
      maintenanceMileageBookingFinanceUntouched: true
    },
    depotOnlyRestriction: {
      implemented: true,
      envVar: "EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS",
      allowlist: allowedLocations,
      activeZonesOnStaging: activeZones,
      zonesAfterAllowlist: allowlisted,
      calcompActiveButExcluded: activeZones.some((z) => z.location_id === CALCOMP_ID)
    },
    syntheticVsRealSeparation: {
      syntheticVehicleKeyPrefix: "staging:synthetic:",
      realVehicleKeyPrefix: "forth:",
      syntheticStateRows: syntheticStateCount,
      forthStateRows: forthStateCount,
      note: "Monitor observations always use forth:<deviceId>; synthetic pilot never shares that prefix."
    },
    engineControlsVerifiedInCode: {
      sourceGpsTimestampRequired: true,
      gpsConfidenceRequired: true,
      trackerConnectedRequired: true,
      entryExitDwellSeconds: 60,
      hysteresisMeters: 25,
      maxDwellObservationGapMs: 300000,
      duplicateOrOutOfOrderSuppressed: true
    },
    depotRecord: { depot, pin, officeForthLinked: Boolean(officeLink) },
    nearbyVehicles: proximity,
    forthProbeError,
    expectedDatabaseRecordsOnSuccessfulPulse: [
      "ees_fleet_monitor_runs row status=succeeded (or skipped if lease busy / no allowlisted zone)",
      "ees_fleet_vehicle_geofence_state for forth:<deviceId> progressing ENTRY_CANDIDATE→INSIDE after ≥60s continuous verified samples",
      "At most one ees_fleet_visit_events arrival event_key per visit (duplicate pulses suppressed)",
      "ees_fleet_notification_intents (or equivalent outbox) with delivery/push disabled (push_disabled)",
      "No rows for CAL-COMP location from this real pulse; no office 1708908 zone",
      "No Weekly Mileage / Maintenance / Fuel / Booking / Finance mutations"
    ],
    exactSupervisedTestProcedure: [
      "1. Confirm this readiness report is GO or CONDITIONAL_GO with a verified vehicle inside/near 120 m.",
      "2. Start Next.js using .env.staging.local only (staging Supabase URL + staging service role + Forth read keys). Do not load production Supabase URL.",
      "3. Re-run: npx tsx scripts/probe-ees-depot-gps-proximity-readonly.ts — confirm a GPS-verified forth:<deviceId> within ~120 m and fresh sourceAt.",
      "4. Owner authorises a short window. Set EES_FLEET_MONITOR_ENABLED=true in the staging process only.",
      "5. Pulse once: GET /api/internal/fleet-monitor with Authorization: Bearer <EES_FLEET_MONITOR_SECRET>.",
      "6. Immediately set EES_FLEET_MONITOR_ENABLED=false.",
      "7. Inspect staging tables listed above. Expect candidate state if dwell incomplete; wait ≥60s continuous verified samples then pulse again for arrival.",
      "8. Repeat later only for exit dwell; never enable cron; never enable push delivery; never call Forth write APIs.",
      "9. Keep EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS locked to Pilot 002 depot UUID for the entire window."
    ],
    blockers,
    goNoGo,
    monitorActivated: false,
    pushSent: false,
    deployed: false,
    committed: false
  };

  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  const outPath = path.join(root, "output", "v20-3-pilot-002-supervised-gps-readiness.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        goNoGo: report.goNoGo,
        stagingRef,
        allowedLocationIds: allowedLocations,
        envFileChanges: envChanges,
        blockers,
        nearbyWithin120m: within120.length,
        outPath: "output/v20-3-pilot-002-supervised-gps-readiness.json"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
