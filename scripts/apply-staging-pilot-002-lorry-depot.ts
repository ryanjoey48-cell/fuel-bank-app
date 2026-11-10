/**
 * Staging-only Pilot 002 apply. Requires owner approval of five actions.
 * Target: wpmnjfncaoogssgpqxek. Never production. No monitor/push/Forth API writes.
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

const root = path.resolve(__dirname, "..");
const DEPOT_ID = "cccccccc-dddd-4eee-8fff-000000000002";
const FORTH_ID = "1977073";
const FORTH_LAT = 13.768732;
const FORTH_LNG = 100.766033;
const MAPS_LAT = 13.7688008;
const MAPS_LNG = 100.7657385;
const OFFICE_FORTH = "1708908";
const MAPS_URL =
  "https://www.google.com/maps/place/Expert+Express+Sender+co.,+ltd./@13.7688008,100.7631636,17z/data=!3m1!4b1!4m6!3m5!1s0x311d670018e7f5f1:0xe1174646470a0e61!8m2!3d13.7688008!4d100.7657385!16s%2Fg%2F11yqyp22pg";
const ENABLE_REASON =
  "Owner-approved EES Lorry Depot Pilot 002 — provisional 120 m geofence for controlled staging testing.";

function loadEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type StepResult = { step: number; name: string; status: "PASS" | "FAIL"; detail?: unknown; error?: string };

async function main() {
  const env = loadEnv(path.join(root, ".env.staging.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  assertNotConfirmedProductionForExperimentalSql(url);
  assertApprovedStagingTarget(url, env.EES_APPROVED_STAGING_PROJECT_REF);
  const ref = extractSupabaseProjectRef(url);
  assert(ref === "wpmnjfncaoogssgpqxek", `Wrong staging ref: ${ref}`);
  assert(ref !== (EES_PRODUCTION_SUPABASE_PROJECT_REF as string), "Production refused");
  assert(env.EES_FLEET_MONITOR_ENABLED === "false", "Monitor must stay disabled");
  assert(env.EES_WEB_PUSH_TEST_ENABLED === "false", "Push test must stay disabled");

  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const report: Record<string, unknown> = {
    recordType: "EES_V20_3_PILOT_002_STAGING_APPLY_REPORT",
    generatedAt: new Date().toISOString(),
    stagingRef: ref,
    productionRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF,
    identityVerified: true,
    steps: [] as StepResult[],
    officeExcluded: null,
    productionIsolation: {
      stagingRef: ref,
      productionUntouched: true,
      monitorNotRun: true,
      pushNotSent: true,
      forthApiNotWritten: true
    }
  };
  const steps = report.steps as StepResult[];

  function fail(step: number, name: string, error: string, detail?: unknown): never {
    steps.push({ step, name, status: "FAIL", error, detail });
    writeReport(report);
    console.error(JSON.stringify({ failedStep: step, name, error }, null, 2));
    process.exit(1);
  }

  // Preflight: synthetic UUID free or already this depot
  {
    const { data: existing, error } = await admin
      .from("ees_locations")
      .select("id,company_name")
      .eq("id", DEPOT_ID)
      .maybeSingle();
    if (error) fail(0, "preflight_uuid", error.message);
    if (
      existing &&
      !String(existing.company_name).includes("EES") &&
      !String(existing.company_name).toLowerCase().includes("depot")
    ) {
      fail(0, "preflight_uuid", "Staging UUID occupied by unrelated record", existing);
    }
    const { data: forthTaken } = await admin
      .from("ees_forth_location_links")
      .select("forth_location_id,ees_location_id")
      .eq("forth_location_id", FORTH_ID)
      .maybeSingle();
    if (forthTaken && forthTaken.ees_location_id !== DEPOT_ID) {
      fail(0, "preflight_forth_link", "Forth 1977073 already linked to another location", forthTaken);
    }
  }

  // Resolve office actor (reuse staging pilot user if present)
  let officeId: string;
  {
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = (listed?.users ?? []).find((u) => u.email === "staging-fleet-pilot@ees-development.invalid");
    if (existing) officeId = existing.id;
    else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: "staging-fleet-pilot@ees-development.invalid",
        email_confirm: true,
        password: `StgPilot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        user_metadata: { synthetic: true, purpose: "STAGING Pilot ops — not a real employee" }
      });
      if (error || !created?.user?.id) fail(0, "office_identity", error?.message ?? "create user failed");
      officeId = created.user.id;
    }
    await admin.from("account_access").upsert({ user_id: officeId, role: "admin", status: "active" });
    report.officeUserId = officeId;
  }

  const sourceInfo = [
    "STAGING PILOT 002 — LORRY DEPOT (not office)",
    `Forth location ID: ${FORTH_ID}`,
    "Forth name: ลานจอดรถ",
    `Forth pin: ${FORTH_LAT},${FORTH_LNG}`,
    `Owner Google Maps: ${MAPS_LAT},${MAPS_LNG}`,
    "Owner Maps URL retained as corroborating evidence",
    "Forth↔Maps offset: ~33 m",
    `Office Forth ${OFFICE_FORTH} excluded from this pilot`,
    "Diameter raw: 100 (unverified)",
    "Provisional monitoring radius: 120 m (subject to real GPS validation)",
    "Production Directory evidence id: 4e2d87d2-9a59-5b7e-a7ce-61d09b097f75"
  ].join("\n");

  // === ACTION 1: Directory + Forth link ===
  try {
    const { error: locErr } = await admin.from("ees_locations").upsert({
      id: DEPOT_ID,
      company_name: "Expert Express Sender — EES Lorry Depot",
      address: "88 Happy Place, Khlong Sam Prawet, Lat Krabang, Bangkok 10520, Thailand",
      google_maps_url: MAPS_URL,
      verification_status: "needs_check",
      is_active: false,
      source_info: sourceInfo,
      notes:
        "STAGING Pilot 002 — owner-confirmed lorry depot (Forth satellite). Not office 1708908. Google Maps corroboration retained."
    });
    assert(!locErr, locErr?.message ?? "location upsert failed");

    const { error: linkErr } = await admin.from("ees_forth_location_links").upsert({
      forth_location_id: FORTH_ID,
      ees_location_id: DEPOT_ID,
      link_status: "matched",
      forth_name: "ลานจอดรถ",
      forth_group_layer: "EES",
      forth_latitude: FORTH_LAT,
      forth_longitude: FORTH_LNG,
      forth_diameter_raw: "100",
      diameter_unit_note: "unverified",
      source_export_label: "STAGING Pilot 002 — Locations Forth Pinned.csv (no Forth API write)",
      created_by: officeId,
      updated_by: officeId
    });
    assert(!linkErr, linkErr?.message ?? "forth link failed");

    const { error: auditErr } = await admin.from("ees_forth_location_import_audit").insert({
      forth_location_id: FORTH_ID,
      ees_location_id: DEPOT_ID,
      action: "linked_existing",
      classification: "MATCHED",
      details: {
        pilot: "002",
        ownerConfirmedSatellite: true,
        officeExcludedForthId: OFFICE_FORTH,
        mapsCorroboration: { latitude: MAPS_LAT, longitude: MAPS_LNG }
      },
      actor_user_id: officeId
    });
    assert(!auditErr, auditErr?.message ?? "audit failed");

    const { data: loc } = await admin
      .from("ees_locations")
      .select("id,company_name,google_maps_url,source_info,verification_status")
      .eq("id", DEPOT_ID)
      .single();
    const { data: link } = await admin
      .from("ees_forth_location_links")
      .select("forth_location_id,ees_location_id,forth_latitude,forth_longitude,link_status")
      .eq("forth_location_id", FORTH_ID)
      .single();
    const { count: depotNameCount } = await admin
      .from("ees_locations")
      .select("*", { count: "exact", head: true })
      .ilike("company_name", "%Lorry Depot%");

    assert(loc?.id === DEPOT_ID, "depot id mismatch");
    assert(link?.forth_location_id === FORTH_ID && link.ees_location_id === DEPOT_ID, "link mismatch");
    assert(link?.forth_latitude === FORTH_LAT && link?.forth_longitude === FORTH_LNG, "forth coords not preserved");
    assert(loc?.google_maps_url?.includes("google.com/maps"), "maps url missing");
    assert(loc?.source_info?.includes("1977073") && loc?.source_info?.includes(String(MAPS_LAT)), "source evidence incomplete");
    assert((depotNameCount ?? 0) === 1, `expected one lorry depot directory row, got ${depotNameCount}`);

    steps.push({
      step: 1,
      name: "CREATE_OR_UPSERT_DIRECTORY_AND_FORTH_LINK",
      status: "PASS",
      detail: { location: loc, link, depotNameCount }
    });
  } catch (error) {
    fail(1, "CREATE_OR_UPSERT_DIRECTORY_AND_FORTH_LINK", error instanceof Error ? error.message : String(error));
  }

  // === ACTION 2: Confirm destination pin ===
  try {
    const { data: existingPin } = await admin
      .from("ees_location_map_pins")
      .select("id")
      .eq("location_id", DEPOT_ID)
      .eq("pin_type", "destination")
      .maybeSingle();

    if (existingPin?.id) {
      const { error } = await admin
        .from("ees_location_map_pins")
        .update({
          latitude: FORTH_LAT,
          longitude: FORTH_LNG,
          pin_status: "manual_confirmed",
          coordinate_source: "Forth saved location 1977073 (owner satellite-confirmed lorry depot)",
          source_reference: `Owner Google Maps corroboration ${MAPS_LAT},${MAPS_LNG}; Locations Forth Pinned.csv`,
          confirmed_at: new Date().toISOString(),
          confirmed_by: officeId,
          updated_by: officeId
        })
        .eq("id", existingPin.id);
      assert(!error, error?.message ?? "pin update failed");
    } else {
      const { error } = await admin.from("ees_location_map_pins").insert({
        location_id: DEPOT_ID,
        pin_type: "destination",
        latitude: FORTH_LAT,
        longitude: FORTH_LNG,
        pin_status: "manual_confirmed",
        coordinate_source: "Forth saved location 1977073 (owner satellite-confirmed lorry depot)",
        source_reference: `Owner Google Maps corroboration ${MAPS_LAT},${MAPS_LNG}; Locations Forth Pinned.csv`,
        confirmed_at: new Date().toISOString(),
        confirmed_by: officeId,
        created_by: officeId,
        updated_by: officeId
      });
      assert(!error, error?.message ?? "pin insert failed");
    }

    const { data: pin } = await admin
      .from("ees_location_map_pins")
      .select("latitude,longitude,pin_status,coordinate_source,source_reference,pin_type")
      .eq("location_id", DEPOT_ID)
      .eq("pin_type", "destination")
      .single();
    const { count: pinCount } = await admin
      .from("ees_location_map_pins")
      .select("*", { count: "exact", head: true })
      .eq("location_id", DEPOT_ID)
      .eq("pin_type", "destination");

    assert(pin?.pin_status === "manual_confirmed", "pin not confirmed");
    assert(pin?.latitude === FORTH_LAT && pin?.longitude === FORTH_LNG, "pin coords wrong");
    assert(pinCount === 1, "duplicate destination pins");

    steps.push({ step: 2, name: "CONFIRM_DESTINATION_PIN", status: "PASS", detail: { pin, pinCount } });
  } catch (error) {
    fail(2, "CONFIRM_DESTINATION_PIN", error instanceof Error ? error.message : String(error));
  }

  // === ACTION 3: Verify Directory ===
  try {
    const { error } = await admin
      .from("ees_locations")
      .update({
        verification_status: "verified",
        verified_at: new Date().toISOString(),
        is_active: true,
        notes:
          "STAGING Pilot 002 — verified for provisional 120 m depot geofence. Not office. Owner satellite + Maps evidence."
      })
      .eq("id", DEPOT_ID);
    assert(!error, error?.message ?? "verify failed");

    const { data: loc } = await admin
      .from("ees_locations")
      .select("id,verification_status,verified_at,is_active,google_maps_url,source_info")
      .eq("id", DEPOT_ID)
      .single();
    assert(loc?.verification_status === "verified" && loc.is_active === true && loc.verified_at, "not verified/active");

    steps.push({ step: 3, name: "VERIFY_DIRECTORY_RECORD", status: "PASS", detail: { location: loc } });
  } catch (error) {
    fail(3, "VERIFY_DIRECTORY_RECORD", error instanceof Error ? error.message : String(error));
  }

  // === ACTION 4: Configure inactive 120 m ===
  try {
    const { error } = await admin.rpc("set_ees_fleet_geofence_zone", {
      p_location_id: DEPOT_ID,
      p_radius_meters: 120,
      p_entry_dwell_seconds: 60,
      p_exit_dwell_seconds: 60,
      p_hysteresis_meters: 25,
      p_active: false,
      p_actor_user_id: officeId,
      p_reason: "Pilot 002 staging configure provisional 120m inactive"
    });
    assert(!error, error?.message ?? "configure zone failed");

    const { data: zone } = await admin
      .from("ees_fleet_geofence_zones")
      .select("*")
      .eq("location_id", DEPOT_ID)
      .single();
    assert(zone?.active === false && zone.radius_meters === 120, "inactive 120m not set");

    steps.push({
      step: 4,
      name: "CONFIGURE_INACTIVE_120M_ZONE",
      status: "PASS",
      detail: { zone }
    });
  } catch (error) {
    fail(4, "CONFIGURE_INACTIVE_120M_ZONE", error instanceof Error ? error.message : String(error));
  }

  // === ACTION 5: Enable zone ===
  try {
    const { data: priorHistory } = await admin
      .from("ees_fleet_geofence_zone_history")
      .select("id,reason,actor_user_id,changed_at,new_configuration")
      .eq("location_id", DEPOT_ID)
      .order("changed_at", { ascending: false })
      .limit(10);
    const { data: priorZone } = await admin
      .from("ees_fleet_geofence_zones")
      .select("*")
      .eq("location_id", DEPOT_ID)
      .maybeSingle();
    const alreadyEnabled =
      priorZone?.active === true &&
      priorZone.radius_meters === 120 &&
      (priorHistory ?? []).some((h) => h.reason === ENABLE_REASON);

    if (!alreadyEnabled) {
      const { error } = await admin.rpc("set_ees_fleet_geofence_zone", {
        p_location_id: DEPOT_ID,
        p_radius_meters: 120,
        p_entry_dwell_seconds: 60,
        p_exit_dwell_seconds: 60,
        p_hysteresis_meters: 25,
        p_active: true,
        p_actor_user_id: officeId,
        p_reason: ENABLE_REASON
      });
      assert(!error, error?.message ?? "enable zone failed");
    }

    const { error: pilotErr } = await admin.from("ees_fleet_geofence_pilot_sites").upsert({
      location_id: DEPOT_ID,
      selected: true,
      reviewer_user_id: officeId,
      notes: "Pilot 002 lorry depot — not office 1708908"
    });
    assert(!pilotErr, pilotErr?.message ?? "pilot site upsert failed");

    const { data: zone } = await admin
      .from("ees_fleet_geofence_zones")
      .select("*")
      .eq("location_id", DEPOT_ID)
      .single();
    assert(zone?.active === true && zone.radius_meters === 120, "active 120m failed");

    const { count: active120 } = await admin
      .from("ees_fleet_geofence_zones")
      .select("*", { count: "exact", head: true })
      .eq("active", true)
      .eq("radius_meters", 120)
      .eq("location_id", DEPOT_ID);

    const { data: history } = await admin
      .from("ees_fleet_geofence_zone_history")
      .select("id,reason,actor_user_id,changed_at,new_configuration")
      .eq("location_id", DEPOT_ID)
      .order("changed_at", { ascending: false })
      .limit(5);

    assert(active120 === 1, "expected exactly one active 120m zone for depot");
    assert(history?.some((h) => h.reason === ENABLE_REASON), "enable audit reason missing");

    steps.push({
      step: 5,
      name: "ENABLE_ACTIVE_120M_ZONE",
      status: "PASS",
      detail: { zone, history, active120, alreadyEnabled }
    });
    report.activeGeofence = zone;
    report.zoneHistory = history;
  } catch (error) {
    fail(5, "ENABLE_ACTIVE_120M_ZONE", error instanceof Error ? error.message : String(error));
  }

  // Office exclusion verification
  {
    const { data: officeLink } = await admin
      .from("ees_forth_location_links")
      .select("*")
      .eq("forth_location_id", OFFICE_FORTH)
      .maybeSingle();
    const { data: activeZones } = await admin
      .from("ees_fleet_geofence_zones")
      .select("location_id,active,radius_meters")
      .eq("active", true);
    const { data: allLinks } = await admin
      .from("ees_forth_location_links")
      .select("forth_location_id,ees_location_id");

    const calcompId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const unexpectedActive = (activeZones ?? []).filter(
      (z) => z.location_id !== DEPOT_ID && z.location_id !== calcompId
    );
    report.officeExcluded = {
      officeForthLinkPresent: Boolean(officeLink),
      officeForthId: OFFICE_FORTH,
      activeZones: activeZones ?? [],
      forthLinks: allLinks ?? [],
      unexpectedActiveZones: unexpectedActive,
      note: "Office Forth 1708908 has no staging link/zone created by Pilot 002"
    };
    assert(!officeLink, "unexpected office forth link on staging");
    assert(unexpectedActive.length === 0, "unexpected active zones besides depot/CAL-COMP");
  }

  // Final inventory
  {
    const { data: loc } = await admin.from("ees_locations").select("*").eq("id", DEPOT_ID).single();
    const { data: pin } = await admin
      .from("ees_location_map_pins")
      .select("*")
      .eq("location_id", DEPOT_ID)
      .eq("pin_type", "destination")
      .single();
    const { data: link } = await admin.from("ees_forth_location_links").select("*").eq("forth_location_id", FORTH_ID).single();
    const { count: activeDepotZones } = await admin
      .from("ees_fleet_geofence_zones")
      .select("*", { count: "exact", head: true })
      .eq("location_id", DEPOT_ID)
      .eq("active", true);

    report.final = {
      depotDirectoryId: DEPOT_ID,
      location: {
        id: loc?.id,
        company_name: loc?.company_name,
        verification_status: loc?.verification_status,
        is_active: loc?.is_active,
        google_maps_url: loc?.google_maps_url,
        source_info: loc?.source_info
      },
      pin: {
        latitude: pin?.latitude,
        longitude: pin?.longitude,
        pin_status: pin?.pin_status,
        coordinate_source: pin?.coordinate_source,
        source_reference: pin?.source_reference
      },
      forthLink: {
        forth_location_id: link?.forth_location_id,
        ees_location_id: link?.ees_location_id,
        forth_latitude: link?.forth_latitude,
        forth_longitude: link?.forth_longitude,
        link_status: link?.link_status
      },
      activeDepotZoneCount: activeDepotZones
    };

    assert(activeDepotZones === 1, "final active zone count");
  }

  report.verdict = "PASS";
  report.remainingBeforeSupervisedRealGps = [
    "Fill staging Forth read credentials + EES_FLEET_MONITOR_SECRET ≥ 32 + EES_FLEET_MONITOR_ALLOWED_PROJECT_REF",
    "Run Next against staging env only (never production URL)",
    "Re-probe GPS near depot; wait for verified vehicle presence if needed",
    "Owner authorises supervised monitor pulse(s) with monitor flag on only during pulses",
    "Expect forth:<deviceId> arrival/departure + push_disabled outbox; keep push/cron off",
    "Office 1708908 remains out of depot workflow"
  ];

  writeReport(report);
  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        stagingRef: ref,
        depotDirectoryId: DEPOT_ID,
        steps: steps.map((s) => ({ step: s.step, name: s.name, status: s.status })),
        outPath: "output/v20-3-pilot-002-staging-apply-report.json"
      },
      null,
      2
    )
  );
}

function writeReport(report: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "output", "v20-3-pilot-002-staging-apply-report.json"),
    JSON.stringify(report, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
