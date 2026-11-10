/**
 * Fixture-labelled first pilot activation path.
 * Does not write to live Supabase, Forth, or send push.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");

const root = path.resolve(__dirname, "..");
function loadTs(relativePath) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (request.startsWith("@/lib/")) return loadTs(`lib/${request.slice("@/lib/".length)}.ts`);
    return require(request);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return loaded.exports;
}

const {
  parseForthPinnedLocationsCsv,
  reconcileForthPinnedLocations,
  buildForthImportApprovalPayload,
  extractForthLocationIdFromSourceInfo
} = loadTs("lib/forth-locations-import.ts");
const {
  evaluateVehicleGeofences,
  initialVehicleGeofenceState
} = loadTs("lib/fleet-geofence-engine.ts");
const { buildVisitNotificationIntent } = loadTs("lib/fleet-notification-outbox.ts");
const { buildFleetPilotReadiness } = loadTs("lib/fleet-pilot-readiness.ts");

const candidates = JSON.parse(fs.readFileSync(path.join(root, "output/v20-2-pilot-candidates.json"), "utf8"));
const migration = fs.readFileSync(path.join(root, "docs/ees-fleet-operations-v20-review-only.sql"), "utf8");
const migrationV202 = fs.readFileSync(path.join(root, "docs/ees-fleet-operations-v20-2-review-only.sql"), "utf8");

const office = "10000000-0000-4000-8000-000000000001";
const locationId = "20000000-0000-4000-8000-000000000099";

async function asService(db, action) {
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [office]);
    const value = await action();
    await db.query("commit");
    return value;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

test("FIXTURE: proposed pilot list uses real Forth IDs and does not invent visits", () => {
  assert.ok(candidates.proposed.length >= 8);
  for (const site of candidates.proposed.slice(0, 10)) {
    assert.match(site.forthId, /^\d+$/);
    assert.ok(site.name);
    assert.ok(Number.isFinite(site.lat) && Number.isFinite(site.lon));
    assert.ok(["NEW_LOCATION", "POSSIBLE_DUPLICATE"].includes(site.classification));
    if (site.classification === "POSSIBLE_DUPLICATE") {
      assert.equal(site.confidence, "strong");
      assert.ok(site.match?.eesId);
      assert.equal(site.bulkEligible, false);
    }
  }
});

test("FIXTURE: draft import payload for a NEW pilot candidate never confirms a pin", () => {
  const records = parseForthPinnedLocationsCsv(fs.readFileSync(path.join(root, "data/forth-locations/Locations Forth Pinned.csv"), "utf8"));
  const target = records.find((row) => row.forthLocationId === "2590097"); // APL3 คลองส่งน้ำ
  assert.ok(target);
  const item = reconcileForthPinnedLocations([target], []).items[0];
  assert.equal(item.classification, "NEW_LOCATION");
  const payload = buildForthImportApprovalPayload(item);
  assert.equal(payload.create_confirmed_pin, false);
  assert.equal(payload.verification_status, "needs_check");
  assert.equal(extractForthLocationIdFromSourceInfo(payload.source_info), "2590097");
  assert.match(payload.source_info, /diameter raw: 100/i);
  assert.match(payload.notes, /not an office-confirmed destination pin/i);
});

test("FIXTURE: full staging-shaped path draft→verified pin→active zone→arrival→one outbox intent", async () => {
  const site = candidates.proposed.find((row) => row.forthId === "2742427"); // CAL-COMP strong match
  assert.ok(site);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select current_setting('request.jwt.claim.role', true) $$;
      create function public.is_account_active() returns boolean language sql stable as $$ select true $$;
      create function public.current_account_role() returns text language sql stable as $$ select 'admin'::text $$;
      create table public.ees_locations(
        id uuid primary key,
        verification_status text not null default 'needs_check',
        company_name text,
        source_info text
      );
      create table public.ees_location_map_pins(
        id uuid primary key default gen_random_uuid(),
        location_id uuid not null,
        pin_type text not null,
        pin_status text not null,
        latitude double precision,
        longitude double precision
      );
      create table public.booking_diary(id uuid primary key);
      insert into auth.users values ('${office}');
      insert into public.ees_locations(id, verification_status, company_name, source_info)
        values ('${locationId}', 'needs_check', '${site.name.replace(/'/g, "''")}', 'Forth location ID: ${site.forthId}');
      grant usage on schema public, auth to authenticated, service_role;
      grant select, insert, update on public.ees_locations, public.ees_location_map_pins to service_role;
      grant execute on function auth.uid(), auth.role(), public.is_account_active(), public.current_account_role() to authenticated, service_role;
    `);
    await db.exec(migration);
    await db.exec(migrationV202);

    // Confirm destination pin (manual office step) then verify Directory record.
    await db.query(
      `insert into public.ees_location_map_pins(location_id, pin_type, pin_status, latitude, longitude)
       values ($1,'destination','manual_confirmed',$2,$3)`,
      [locationId, site.lat, site.lon]
    );
    await db.query(`update public.ees_locations set verification_status='verified' where id=$1`, [locationId]);

    // Enable geofence with office radius (not Forth diameter).
    await asService(db, () => db.query(
      "select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,true,$2::uuid,$3)",
      [locationId, office, "Pilot activation for CAL-COMP after pin confirmation"]
    ));
    assert.equal((await db.query("select active, radius_meters from public.ees_fleet_geofence_zones where location_id=$1", [locationId])).rows[0].active, true);
    assert.equal((await db.query("select radius_meters from public.ees_fleet_geofence_zones where location_id=$1", [locationId])).rows[0].radius_meters, 150);

    const zone = {
      locationId, latitude: site.lat, longitude: site.lon, radiusMeters: 150,
      entryDwellMs: 60_000, exitDwellMs: 60_000, hysteresisMeters: 25, active: true
    };
    const start = Date.parse("2026-10-31T02:00:00Z");
    const observation = (minute, inside = true) => ({
      vehicleKey: "forth:pilot-1",
      registration: "78-6996",
      sourceAt: new Date(start + minute * 60_000).toISOString(),
      detectedAt: new Date(start + minute * 60_000 + 8_000).toISOString(),
      latitude: inside ? site.lat : site.lat + 0.01,
      longitude: site.lon,
      gpsVerified: true,
      trackerConnected: true
    });

    let state = initialVehicleGeofenceState("forth:pilot-1");
    let transition = evaluateVehicleGeofences(state, observation(0, true), [zone]);
    assert.equal(transition.state.phase, "ENTRY_CANDIDATE");
    assert.deepEqual(transition.events, []);
    // Long unsupported gap must not confirm.
    transition = evaluateVehicleGeofences(transition.state, observation(90, true), [zone]);
    assert.equal(transition.state.phase, "ENTRY_CANDIDATE");
    assert.deepEqual(transition.events, []);
    // Continuous dwell confirms arrival.
    transition = evaluateVehicleGeofences(transition.state, observation(91, true), [zone]);
    assert.equal(transition.events.length, 1);
    assert.equal(transition.events[0].type, "arrival");
    assert.equal(transition.events[0].confirmedLatitude, site.lat);
    assert.equal(transition.events[0].evidence, "verified_forth_gps");
    const arrival = transition.events[0];
    state = transition.state;

    const commit = () => db.query(
      "select public.commit_ees_fleet_geofence_transition($1,$2,$3::jsonb,$4::jsonb) as accepted",
      ["forth:pilot-1", 0, JSON.stringify(state), JSON.stringify(arrival)]
    );
    assert.equal((await asService(db, commit)).rows[0].accepted, true);
    assert.equal((await asService(db, commit)).rows[0].accepted, false);
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_visit_events")).rows[0].n, 1);

    const intent = buildVisitNotificationIntent({
      eventKey: arrival.eventKey,
      visitKey: arrival.visitKey,
      type: "arrival",
      registration: arrival.registration,
      locationNameEn: site.name,
      locationNameTh: site.name,
      occurredAt: arrival.occurredAt,
      deliveryEnabled: false
    });
    const firstOutbox = await asService(db, () => db.query(
      `select public.enqueue_ees_fleet_notification_outbox($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`,
      [intent.intentKey, intent.eventKey, intent.category, intent.severity, intent.titleEn, intent.titleTh,
        intent.bodyEn, intent.bodyTh, intent.href, false]
    ));
    const secondOutbox = await asService(db, () => db.query(
      `select public.enqueue_ees_fleet_notification_outbox($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`,
      [intent.intentKey, intent.eventKey, intent.category, intent.severity, intent.titleEn, intent.titleTh,
        intent.bodyEn, intent.bodyTh, intent.href, false]
    ));
    assert.equal(firstOutbox.rows[0].id, secondOutbox.rows[0].id);
    assert.equal((await db.query("select count(*)::integer as n, max(status) as status from public.ees_fleet_notification_outbox")).rows[0].n, 1);
    assert.equal((await db.query("select status from public.ees_fleet_notification_outbox")).rows[0].status, "push_disabled");

    // Departure with continuous outside samples.
    transition = evaluateVehicleGeofences(state, observation(92, false), [zone]);
    assert.equal(transition.state.phase, "EXIT_CANDIDATE");
    transition = evaluateVehicleGeofences(transition.state, observation(93, false), [zone]);
    assert.equal(transition.events[0].type, "departure");
    assert.ok(transition.events[0].durationSeconds >= 60);

    const readiness = buildFleetPilotReadiness({
      environmentLabel: "STAGING",
      forthSourceRecords: 466,
      draftsWithForthId: 1,
      awaitingConfirmation: 0,
      confirmedDestinations: 1,
      geofencesEnabled: 1,
      pilotLocationsSelected: 1,
      visitStorageReady: true,
      forthAuditStorageReady: true,
      mapPinStorageReady: true,
      monitorEnabled: false,
      monitorSecretConfigured: false,
      vapidConfigured: false,
      webPushTestEnabled: false,
      activePushDevices: 0
    });
    assert.equal(readiness.liveNotificationsEnabled, false);
    assert.equal(readiness.pilotReady, false); // monitor secret still required
  } finally {
    await db.close();
  }
});
