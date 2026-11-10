/**
 * Staging-only CAL-COMP synthetic pilot (owner-approved).
 * Target: wpmnjfncaoogssgpqxek only. No Forth writes, no live monitor, no push delivery.
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
import {
  evaluateVehicleGeofences,
  initialVehicleGeofenceState,
  type ApprovedGeofence,
  type GeofenceObservation,
  type GeofenceVisitEvent,
  type VehicleGeofenceState
} from "../lib/fleet-geofence-engine";

const root = path.resolve(__dirname, "..");
const CALCOMP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FORTH_ID = "2742427";
const LAT = 13.234431;
const LNG = 99.806063;
const RADIUS = 150;
const VEHICLE = "staging:synthetic:calcomp:truck1";
const VEHICLE_GAP = "staging:synthetic:calcomp:truck2-gap";
const REG = "STG-SYN-001";
const OFFICE_EMAIL = "staging-fleet-pilot@ees-development.invalid";
const BOOKING_STUB = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function loadEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function restoredState(vehicleKey: string, row: Record<string, unknown> | null): VehicleGeofenceState {
  if (!row) return initialVehicleGeofenceState(vehicleKey);
  return {
    vehicleKey,
    phase: row.phase as VehicleGeofenceState["phase"],
    stable: row.stable as VehicleGeofenceState["stable"],
    locationId: (row.location_id as string | null) ?? null,
    candidateSince: (row.candidate_since as string | null) ?? null,
    arrivalAt: (row.arrival_at as string | null) ?? null,
    visitKey: (row.visit_key as string | null) ?? null,
    lastSourceAt: (row.last_source_at as string | null) ?? null,
    lastDetectedAt: (row.last_detected_at as string | null) ?? null,
    uncertainReason: (row.uncertain_reason as string | null) ?? null
  };
}

async function main() {
  const env = loadEnv(path.join(root, ".env.staging.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assert(env.EES_FLEET_MONITOR_ENABLED === "false", "Monitor must stay disabled");
  assert(env.EES_WEB_PUSH_TEST_ENABLED === "false", "Push test must stay disabled");
  assertNotConfirmedProductionForExperimentalSql(url);
  assertApprovedStagingTarget(url, env.EES_APPROVED_STAGING_PROJECT_REF);
  const ref = extractSupabaseProjectRef(url);
  assert(ref === "wpmnjfncaoogssgpqxek", `Wrong staging ref: ${ref}`);
  assert(ref !== (EES_PRODUCTION_SUPABASE_PROJECT_REF as string), "Production refused");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const report: Record<string, unknown> = {
    recordType: "EES_V20_2_STAGING_CALCOMP_SYNTHETIC_PILOT_REPORT",
    generatedAt: new Date().toISOString(),
    stagingRef: ref,
    productionRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF,
    monitorEnabled: false,
    pushDeliveryEnabled: false,
    steps: [] as string[],
    tests: [] as Array<Record<string, unknown>>,
    defects: [] as string[],
    verdict: "FAIL"
  };
  const steps = report.steps as string[];
  const tests = report.tests as Array<Record<string, unknown>>;
  const pushTest = (name: string, pass: boolean, extra: Record<string, unknown> = {}) => {
    tests.push({ name, pass, ...extra });
    if (!pass) throw new Error(`TEST FAILED: ${name}`);
  };

  for (const table of [
    "ees_locations",
    "ees_location_map_pins",
    "ees_fleet_geofence_zones",
    "ees_fleet_visit_events",
    "ees_fleet_notification_outbox",
    "ees_forth_location_links",
    "booking_diary",
    "account_access"
  ]) {
    const { error } = await admin.from(table).select("*", { count: "exact", head: true });
    assert(!error, `Missing/unreachable table ${table}: ${error?.message}`);
  }
  steps.push("schema_tables_reachable");

  let officeId: string;
  {
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = (listed?.users ?? []).find((u) => u.email === OFFICE_EMAIL);
    if (existing) {
      officeId = existing.id;
      steps.push("reuse_staging_test_identity");
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: OFFICE_EMAIL,
        email_confirm: true,
        password: `StgPilot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        user_metadata: {
          display_name: "STAGING Fleet Pilot (synthetic)",
          synthetic: true,
          purpose: "CAL-COMP Pilot 001 staging only — not a real employee"
        }
      });
      assert(!error && created?.user?.id, `Create staging user failed: ${error?.message}`);
      officeId = created.user.id;
      steps.push("created_staging_test_identity");
    }
    report.officeUserId = officeId;
    report.officeEmail = OFFICE_EMAIL;
    const { error: aaErr } = await admin.from("account_access").upsert({
      user_id: officeId,
      role: "admin",
      status: "active"
    });
    assert(!aaErr, `account_access upsert failed: ${aaErr?.message}`);
    steps.push("account_access_seeded");
  }

  const sourceInfo = [
    "SYNTHETIC STAGING FIXTURE — NOT OPERATIONAL HISTORY",
    `Forth location ID: ${FORTH_ID}`,
    `Forth pin: ${LAT},${LNG}`,
    "Address: CAL-COMP KHAO YOI",
    "Diameter raw: 100 (unverified)",
    "Public-map warning: ~458 m OSM offset retained",
    "Pilot: CAL-COMP Pilot 001 staging synthetic",
    `Synthetic EES id: ${CALCOMP}`
  ].join("\n");

  {
    const { error } = await admin.from("ees_locations").upsert({
      id: CALCOMP,
      company_name: "CAL-COMP",
      address: "138 Moo 4, Sa Phang, Khao Yoi, Phetchaburi 76140 [SYNTHETIC STAGING]",
      verification_status: "needs_check",
      is_active: false,
      source_info: sourceInfo,
      notes: "SYNTHETIC STAGING ONLY — CAL-COMP Pilot 001 test fixture; not live operations"
    });
    assert(!error, `location upsert failed: ${error?.message}`);
    steps.push("location_draft_created");
  }

  {
    const { error } = await admin.from("ees_forth_location_links").upsert({
      forth_location_id: FORTH_ID,
      ees_location_id: CALCOMP,
      link_status: "matched",
      forth_name: "CAL-COMP",
      forth_group_layer: "MASS",
      forth_latitude: LAT,
      forth_longitude: LNG,
      forth_address: "CAL-COMP KHAO YOI",
      forth_location_type: "general",
      forth_diameter_raw: "100",
      diameter_unit_note: "unverified",
      source_export_label: "SYNTHETIC STAGING — Forth CSV fixture (no Forth API write)",
      created_by: officeId,
      updated_by: officeId
    });
    assert(!error, `forth link failed: ${error?.message}`);
    const { error: auditErr } = await admin.from("ees_forth_location_import_audit").insert({
      forth_location_id: FORTH_ID,
      ees_location_id: CALCOMP,
      action: "linked_existing",
      classification: "MATCHED",
      details: { synthetic: true, stagingOnly: true, note: "CAL-COMP Pilot 001 synthetic staging link" },
      actor_user_id: officeId
    });
    assert(!auditErr, `forth audit failed: ${auditErr?.message}`);
    steps.push("forth_link_and_audit");
  }

  {
    const { data: existingPin } = await admin
      .from("ees_location_map_pins")
      .select("id")
      .eq("location_id", CALCOMP)
      .eq("pin_type", "destination")
      .maybeSingle();
    if (existingPin?.id) {
      const { error } = await admin
        .from("ees_location_map_pins")
        .update({
          latitude: LAT,
          longitude: LNG,
          pin_status: "manual_confirmed",
          coordinate_source: "SYNTHETIC STAGING — Forth saved location 2742427",
          source_reference: "SYNTHETIC — Locations Forth Pinned.csv",
          confirmed_at: new Date().toISOString(),
          confirmed_by: officeId,
          updated_by: officeId
        })
        .eq("id", existingPin.id);
      assert(!error, `pin update failed: ${error?.message}`);
    } else {
      const { error } = await admin.from("ees_location_map_pins").insert({
        location_id: CALCOMP,
        pin_type: "destination",
        latitude: LAT,
        longitude: LNG,
        pin_status: "manual_confirmed",
        coordinate_source: "SYNTHETIC STAGING — Forth saved location 2742427",
        source_reference: "SYNTHETIC — Locations Forth Pinned.csv",
        confirmed_at: new Date().toISOString(),
        confirmed_by: officeId,
        created_by: officeId,
        updated_by: officeId
      });
      assert(!error, `pin insert failed: ${error?.message}`);
    }
    steps.push("destination_pin_confirmed");
  }

  {
    const { error } = await admin
      .from("ees_locations")
      .update({
        verification_status: "verified",
        verified_at: new Date().toISOString(),
        is_active: true,
        notes: "SYNTHETIC STAGING ONLY — verified for CAL-COMP Pilot 001 geofence test"
      })
      .eq("id", CALCOMP);
    assert(!error, `verify location failed: ${error?.message}`);
    steps.push("location_verified_active");
  }

  {
    const { error: cfgErr } = await admin.rpc("set_ees_fleet_geofence_zone", {
      p_location_id: CALCOMP,
      p_radius_meters: RADIUS,
      p_entry_dwell_seconds: 60,
      p_exit_dwell_seconds: 60,
      p_hysteresis_meters: 25,
      p_active: false,
      p_actor_user_id: officeId,
      p_reason: "SYNTHETIC staging configure provisional 150m inactive"
    });
    assert(!cfgErr, `configure zone failed: ${cfgErr?.message}`);
    const { error: enErr } = await admin.rpc("set_ees_fleet_geofence_zone", {
      p_location_id: CALCOMP,
      p_radius_meters: RADIUS,
      p_entry_dwell_seconds: 60,
      p_exit_dwell_seconds: 60,
      p_hysteresis_meters: 25,
      p_active: true,
      p_actor_user_id: officeId,
      p_reason: "SYNTHETIC staging enable CAL-COMP Pilot 001 150m test geofence"
    });
    assert(!enErr, `enable zone failed: ${enErr?.message}`);
    const { data: zoneRow, error: zErr } = await admin
      .from("ees_fleet_geofence_zones")
      .select("active,radius_meters,entry_dwell_seconds,exit_dwell_seconds,hysteresis_meters")
      .eq("location_id", CALCOMP)
      .single();
    assert(!zErr && zoneRow?.active === true && zoneRow.radius_meters === 150, "zone not active at 150m");
    report.geofence = zoneRow;
    await admin.from("ees_fleet_geofence_pilot_sites").upsert({
      location_id: CALCOMP,
      selected: true,
      reviewer_user_id: officeId,
      notes: "SYNTHETIC STAGING — CAL-COMP Pilot 001"
    });
    steps.push("geofence_enabled_150m");
  }

  const zone: ApprovedGeofence = {
    locationId: CALCOMP,
    latitude: LAT,
    longitude: LNG,
    radiusMeters: RADIUS,
    entryDwellMs: 60_000,
    exitDwellMs: 60_000,
    hysteresisMeters: 25,
    active: true
  };

  async function readState(vehicleKey: string) {
    const { data } = await admin
      .from("ees_fleet_vehicle_geofence_state")
      .select("*")
      .eq("vehicle_key", vehicleKey)
      .maybeSingle();
    return data as Record<string, unknown> | null;
  }

  async function commitObs(vehicleKey: string, observation: GeofenceObservation) {
    const row = await readState(vehicleKey);
    const previous = restoredState(vehicleKey, row);
    const transition = evaluateVehicleGeofences(previous, observation, [zone]);
    if (transition.ignored) {
      return { accepted: true as boolean, ignored: transition.ignored, transition };
    }
    const { data: accepted, error } = await admin.rpc("commit_ees_fleet_geofence_transition", {
      p_vehicle_key: vehicleKey,
      p_expected_version: (row?.version as number | undefined) ?? 0,
      p_state: transition.state,
      p_event: transition.events[0] ?? null
    });
    assert(!error, `transition commit failed: ${error?.message}`);
    assert(accepted === true, "transition version conflict");
    return { accepted: true as boolean, ignored: null, transition };
  }

  // Cleanup prior synthetic vehicle rows for re-runs
  for (const vk of [VEHICLE, VEHICLE_GAP]) {
    const { data: evts } = await admin.from("ees_fleet_visit_events").select("event_key").eq("vehicle_key", vk);
    const keys = (evts ?? []).map((e) => e.event_key);
    if (keys.length) {
      await admin.from("ees_fleet_notification_outbox").delete().in("event_key", keys);
      await admin.from("ees_fleet_event_review_history").delete().in("event_key", keys);
      await admin.from("ees_fleet_visit_events").delete().eq("vehicle_key", vk);
    }
    await admin.from("ees_fleet_vehicle_geofence_state").delete().eq("vehicle_key", vk);
  }

  const t0 = Date.parse("2026-11-01T01:00:00.000Z");
  const outside = { latitude: LAT + 0.01, longitude: LNG };
  const inside = { latitude: LAT, longitude: LNG };

  let r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0),
    detectedAt: iso(t0 + 1000),
    ...outside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("outside_observation", r.transition.state.phase === "OUTSIDE", { phase: r.transition.state.phase });

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 60_000),
    detectedAt: iso(t0 + 61_000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("entry_candidate", r.transition.state.phase === "ENTRY_CANDIDATE", { phase: r.transition.state.phase });

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 90_000),
    detectedAt: iso(t0 + 91_000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("repeated_gps_during_entry_dwell", r.transition.state.phase === "ENTRY_CANDIDATE");

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 90_000),
    detectedAt: iso(t0 + 92_000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("duplicate_observation_ignored", r.ignored === "duplicate_or_out_of_order");

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 130_000),
    detectedAt: iso(t0 + 131_000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  const arrivalEvent = r.transition.events[0] as GeofenceVisitEvent | undefined;
  pushTest("arrival_after_dwell", arrivalEvent?.type === "arrival", { eventKey: arrivalEvent?.eventKey });
  report.arrival = arrivalEvent;

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 160_000),
    detectedAt: iso(t0 + 161_000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest(
    "active_visit_persists",
    r.transition.events.length === 0 && r.transition.state.stable === "INSIDE"
  );

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 160_000 + 20 * 60_000),
    detectedAt: iso(t0 + 160_000 + 20 * 60_000 + 1000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest(
    "long_gap_inside_no_false_departure",
    r.transition.state.stable === "INSIDE" && r.transition.events.length === 0,
    { phase: r.transition.state.phase }
  );

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 160_000 + 21 * 60_000),
    detectedAt: iso(t0 + 160_000 + 21 * 60_000 + 1000),
    ...inside,
    gpsVerified: false,
    trackerConnected: true
  });
  pushTest(
    "unverified_gps_uncertain",
    r.transition.state.phase === "UNCERTAIN" && r.transition.state.uncertainReason === "gps_unverified",
    { reason: r.transition.state.uncertainReason }
  );

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 160_000 + 22 * 60_000),
    detectedAt: iso(t0 + 160_000 + 22 * 60_000 + 1000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("recover_after_unverified", r.transition.state.stable === "INSIDE", {
    phase: r.transition.state.phase
  });

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(t0 + 160_000 + 23 * 60_000),
    detectedAt: iso(t0 + 160_000 + 23 * 60_000 + 1000),
    ...inside,
    gpsVerified: true,
    trackerConnected: false
  });
  pushTest(
    "gps_outage_tracker_offline",
    r.transition.state.phase === "UNCERTAIN" && r.transition.state.uncertainReason === "tracker_offline"
  );

  const exitBase = t0 + 160_000 + 24 * 60_000;
  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(exitBase),
    detectedAt: iso(exitBase + 1000),
    ...inside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("inside_before_exit", r.transition.state.stable === "INSIDE");

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(exitBase + 30_000),
    detectedAt: iso(exitBase + 31_000),
    ...outside,
    gpsVerified: true,
    trackerConnected: true
  });
  pushTest("exit_candidate", r.transition.state.phase === "EXIT_CANDIDATE");

  r = await commitObs(VEHICLE, {
    vehicleKey: VEHICLE,
    registration: REG,
    sourceAt: iso(exitBase + 100_000),
    detectedAt: iso(exitBase + 101_000),
    ...outside,
    gpsVerified: true,
    trackerConnected: true
  });
  const departureEvent = r.transition.events[0] as GeofenceVisitEvent | undefined;
  pushTest("departure_after_exit_dwell", departureEvent?.type === "departure", {
    durationSeconds: departureEvent?.durationSeconds
  });
  report.departure = departureEvent;
  report.onSiteDurationSeconds = departureEvent?.durationSeconds ?? null;

  {
    const { data: events, error } = await admin
      .from("ees_fleet_visit_events")
      .select(
        "event_key,event_type,occurred_at,confirmed_source_at,confirmed_latitude,confirmed_longitude,duration_seconds,evidence,vehicle_key"
      )
      .eq("vehicle_key", VEHICLE)
      .order("occurred_at");
    assert(!error && (events?.length ?? 0) >= 2, `visit events missing: ${error?.message}`);
    const arr = events!.find((e) => e.event_type === "arrival");
    const dep = events!.find((e) => e.event_type === "departure");
    pushTest(
      "gps_evidence_persisted",
      Boolean(
        arr &&
          dep &&
          arr.evidence === "verified_forth_gps" &&
          dep.evidence === "verified_forth_gps" &&
          arr.confirmed_latitude === LAT &&
          arr.confirmed_longitude === LNG &&
          dep.duration_seconds === departureEvent?.durationSeconds
      )
    );
    report.persistedEvents = events;
  }

  {
    const arrivalKey = arrivalEvent!.eventKey;
    const { data: id1, error: e1 } = await admin.rpc("enqueue_ees_fleet_notification_outbox", {
      p_intent_key: `visit:${arrivalKey}:arrival`,
      p_event_key: arrivalKey,
      p_category: "arrival",
      p_severity: "action_required",
      p_title_en: "SYNTHETIC staging arrival",
      p_title_th: "ทดสอบเข้าสถานที่",
      p_body_en: `${REG} SYNTHETIC arrived CAL-COMP staging`,
      p_body_th: `${REG} ทดสอบถึง CAL-COMP`,
      p_href: "/fleet-events#staging-synthetic-calcomp",
      p_delivery_enabled: false
    });
    assert(!e1, `outbox enqueue failed: ${e1?.message}`);
    const { data: id2, error: e2 } = await admin.rpc("enqueue_ees_fleet_notification_outbox", {
      p_intent_key: `visit:${arrivalKey}:arrival`,
      p_event_key: arrivalKey,
      p_category: "arrival",
      p_severity: "action_required",
      p_title_en: "SYNTHETIC staging arrival",
      p_title_th: "ทดสอบเข้าสถานที่",
      p_body_en: `${REG} SYNTHETIC arrived CAL-COMP staging`,
      p_body_th: `${REG} ทดสอบถึง CAL-COMP`,
      p_href: "/fleet-events#staging-synthetic-calcomp",
      p_delivery_enabled: false
    });
    assert(!e2 && id1 === id2, "outbox dedupe failed");
    const depKey = departureEvent!.eventKey;
    const { error: e3 } = await admin.rpc("enqueue_ees_fleet_notification_outbox", {
      p_intent_key: `visit:${depKey}:departure`,
      p_event_key: depKey,
      p_category: "departure",
      p_severity: "info",
      p_title_en: "SYNTHETIC staging departure",
      p_title_th: "ทดสอบออกสถานที่",
      p_body_en: `${REG} SYNTHETIC departed CAL-COMP staging`,
      p_body_th: `${REG} ทดสอบออก CAL-COMP`,
      p_href: "/fleet-events#staging-synthetic-calcomp",
      p_delivery_enabled: false
    });
    assert(!e3, `departure outbox failed: ${e3?.message}`);
    const { data: outbox } = await admin
      .from("ees_fleet_notification_outbox")
      .select("intent_key,event_key,category,status,delivery_enabled")
      .in("event_key", [arrivalKey, depKey]);
    pushTest(
      "outbox_push_disabled_and_deduped",
      Boolean(
        outbox?.length === 2 &&
          outbox.every((o) => o.status === "push_disabled" && o.delivery_enabled === false)
      ),
      { outbox }
    );
    report.outbox = outbox;
  }

  {
    await admin.from("booking_diary").upsert({ id: BOOKING_STUB });
    const req1 = "cccccccc-dddd-4eee-8fff-000000000001";
    const { data: rev1, error: r1 } = await admin.rpc("commit_ees_fleet_event_review", {
      p_event_key: arrivalEvent!.eventKey,
      p_action: "confirm",
      p_actor_user_id: officeId,
      p_reason: "SYNTHETIC staging confirm arrival review",
      p_request_id: req1,
      p_booking_id: null,
      p_idempotency_key: "synthetic-calcomp-arrival-confirm-1"
    });
    assert(!r1 && rev1?.review_status === "confirmed" && rev1?.replayed === false, `review failed: ${r1?.message}`);
    const { data: rev2, error: r2 } = await admin.rpc("commit_ees_fleet_event_review", {
      p_event_key: arrivalEvent!.eventKey,
      p_action: "confirm",
      p_actor_user_id: officeId,
      p_reason: "SYNTHETIC staging confirm arrival review",
      p_request_id: req1,
      p_booking_id: null,
      p_idempotency_key: "synthetic-calcomp-arrival-confirm-1"
    });
    assert(!r2 && rev2?.replayed === true, "review replay should be idempotent");
    const { data: hist } = await admin
      .from("ees_fleet_event_review_history")
      .select("id,action,reason,request_id")
      .eq("event_key", arrivalEvent!.eventKey);
    report.review = { first: rev1, replay: rev2, historyCount: hist?.length ?? 0 };
    pushTest("atomic_review_idempotent", true, { historyCount: hist?.length });
  }

  {
    const g0 = t0 + 3_600_000;
    await commitObs(VEHICLE_GAP, {
      vehicleKey: VEHICLE_GAP,
      registration: "STG-SYN-002",
      sourceAt: iso(g0),
      detectedAt: iso(g0 + 1000),
      ...inside,
      gpsVerified: true,
      trackerConnected: true
    });
    const mid = await commitObs(VEHICLE_GAP, {
      vehicleKey: VEHICLE_GAP,
      registration: "STG-SYN-002",
      sourceAt: iso(g0 + 10 * 60_000),
      detectedAt: iso(g0 + 10 * 60_000 + 1000),
      ...inside,
      gpsVerified: true,
      trackerConnected: true
    });
    pushTest(
      "entry_dwell_gap_restarts_candidate",
      mid.transition.state.phase === "ENTRY_CANDIDATE" && mid.transition.events.length === 0,
      { candidateSince: mid.transition.state.candidateSince }
    );
  }

  {
    const { data: loc } = await admin
      .from("ees_locations")
      .select("id,company_name,verification_status,is_active,source_info,notes")
      .eq("id", CALCOMP)
      .single();
    const { data: pin } = await admin
      .from("ees_location_map_pins")
      .select("latitude,longitude,pin_status,coordinate_source")
      .eq("location_id", CALCOMP)
      .eq("pin_type", "destination")
      .single();
    const { data: zoneRow } = await admin.from("ees_fleet_geofence_zones").select("*").eq("location_id", CALCOMP).single();
    const { count: histCount } = await admin
      .from("ees_fleet_geofence_zone_history")
      .select("*", { count: "exact", head: true })
      .eq("location_id", CALCOMP);
    report.final = { location: loc, pin, zone: zoneRow, zoneHistoryCount: histCount };
    pushTest(
      "synthetic_markers_present",
      Boolean(loc?.source_info?.includes("SYNTHETIC STAGING") && pin?.coordinate_source?.includes("SYNTHETIC"))
    );
  }

  report.verdict = "PASS";
  report.nextSupervisedRealForthGpsRequirements = [
    "Use a real Forth vehicle with GPS-verified snapshots and trustworthy sourceAt",
    "Keep EES_FLEET_MONITOR_ENABLED=false until a supervised single-run is approved",
    "Run one protected /api/internal/fleet-monitor call with staging secret only",
    "Expect candidate → continuous dwell → one arrival event; repeat poll must not duplicate event_key",
    "Outbox intent status must remain push_disabled unless delivery is separately approved",
    "Do not write to Forth; do not use production project hafoaurzfgkkwpvzedvd",
    "Confirm CAL-COMP staging zone still active at 150 m provisional before the run"
  ];

  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  const outPath = path.join(root, "output", "v20-2-staging-calcomp-synthetic-pilot-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        stagingRef: ref,
        outPath: "output/v20-2-staging-calcomp-synthetic-pilot-report.json",
        tests: tests.length,
        onSiteDurationSeconds: report.onSiteDurationSeconds,
        arrivalEventKey: arrivalEvent?.eventKey,
        departureEventKey: departureEvent?.eventKey
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
