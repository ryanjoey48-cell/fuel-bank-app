/**
 * Isolated PGlite: full staging installation order + verify + rollback.
 * Uses prepared review-only SQL files. Does not touch cloud staging/production.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

const root = path.resolve(__dirname, "..");
const readSql = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const OFFICE = "10000000-0000-4000-8000-000000000001";
const CALCOMP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; // synthetic staging id (not production)

const SQL = {
  prerequisites: "docs/ees-fleet-operations-v20-2-staging-prerequisites-review-only.sql",
  locations: "supabase/migrations/20261019100000_ees_locations_directory.sql",
  bookingStub: "docs/ees-fleet-operations-v20-2-staging-booking-diary-stub-review-only.sql",
  v20: "docs/ees-fleet-operations-v20-review-only.sql",
  forth: "docs/ees-forth-locations-import-v20-review-only.sql",
  v202: "docs/ees-fleet-operations-v20-2-review-only.sql",
  v20Verify: "docs/ees-fleet-operations-v20-verification-read-only.sql",
  v202Verify: "docs/ees-fleet-operations-v20-2-verification-read-only.sql",
  v202Rollback: "docs/ees-fleet-operations-v20-2-rollback-review-only.sql",
  forthRollback: "docs/ees-forth-locations-import-v20-rollback-review-only.sql",
  v20Rollback: "docs/ees-fleet-operations-v20-rollback-review-only.sql"
};

/** Staging-compatible map-pin foundation matching app/monitor column needs (full auditor SQL is Dashboard/CREATEROLE). */
const MAP_PINS_STAGING_FOUNDATION = `
begin;
create table if not exists public.ees_location_map_pins (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.ees_locations(id) on delete cascade,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  pin_status text not null default 'manual_confirmed' check (pin_status = 'manual_confirmed'),
  coordinate_source text not null check (length(btrim(coordinate_source)) between 1 and 500),
  source_reference text check (source_reference is null or length(source_reference) <= 2048),
  created_by uuid,
  created_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint ees_location_map_pins_location_type_key unique (location_id, pin_type)
);
create table if not exists public.ees_location_map_pin_history (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null,
  location_id uuid not null,
  pin_type text not null,
  action text not null,
  changed_at timestamptz not null default now()
);
alter table public.ees_location_map_pins enable row level security;
alter table public.ees_location_map_pin_history enable row level security;
drop policy if exists ees_location_map_pins_office_read on public.ees_location_map_pins;
create policy ees_location_map_pins_office_read on public.ees_location_map_pins
  for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
grant select, insert, update on public.ees_location_map_pins to authenticated, service_role;
grant select on public.ees_location_map_pin_history to authenticated;
commit;
`;

async function asRole(db, role, userId, action) {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const value = await action();
    await db.query("commit");
    return value;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function bootstrap(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select current_setting('request.jwt.claim.role', true) $$;
    insert into auth.users values ('${OFFICE}');
    grant usage on schema public, auth to authenticated, service_role;
    grant execute on function auth.uid(), auth.role() to authenticated, service_role;
  `);
}

test("FIXTURE: booking_diary stub satisfies V20 FK and review booking lookup", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(readSql(SQL.prerequisites));
    await db.exec(readSql(SQL.locations));
    await db.exec("grant select, insert, update, delete on public.ees_locations, public.ees_location_user_activity to service_role;");
    await db.exec(MAP_PINS_STAGING_FOUNDATION);
    await db.exec(readSql(SQL.bookingStub));
    await db.exec(readSql(SQL.v20));

    const bookingId = "40000000-0000-4000-8000-000000000099";
    await db.query("insert into public.booking_diary(id) values ($1)", [bookingId]);
    await db.query(`
      insert into public.ees_locations(id, company_name, address, verification_status, verified_at, is_active)
      values ($1,'CAL-COMP','138 Moo 4 Khao Yoi','verified', now(), true)
    `, [CALCOMP]);
    await db.query(`
      insert into public.ees_location_map_pins(
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source, confirmed_at, confirmed_by, created_by, updated_by
      ) values ($1,'destination',13.234431,99.806063,'manual_confirmed','Forth location ID 2742427', now(), $2, $2, $2)
    `, [CALCOMP, OFFICE]);

    await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,true,$2::uuid,$3)`,
      [CALCOMP, OFFICE, "CAL-COMP Pilot 001 provisional 150m"]
    ));

    const eventKey = "forth:demo:calcomp:arrival";
    await asRole(db, "service_role", OFFICE, () => db.query(
      `insert into public.ees_fleet_visit_events(
        event_key, visit_key, event_type, vehicle_key, location_id,
        occurred_at, confirmed_source_at, confirmed_latitude, confirmed_longitude,
        detected_at, evidence
      ) values ($1,'visit-1','arrival','forth:demo',$2, now(), now(), 13.234431, 99.806063, now(), 'verified_forth_gps')`,
      [eventKey, CALCOMP]
    ));

    await db.exec(readSql(SQL.v202));
    const matched = await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.commit_ees_fleet_event_review($1,'match_booking',$2::uuid,$3,$4::uuid,$5::uuid,$6) as result`,
      [eventKey, OFFICE, "Link synthetic booking", "50000000-0000-4000-8000-000000000001", bookingId, null]
    ));
    assert.equal(matched.rows[0].result.booking_match_status, "confirmed");

    await assert.rejects(() => asRole(db, "service_role", OFFICE, () => db.query(
      `select public.commit_ees_fleet_event_review($1,'match_booking',$2::uuid,$3,$4::uuid,$5::uuid,$6)`,
      [eventKey, OFFICE, "Missing booking should fail", "50000000-0000-4000-8000-000000000002",
        "40000000-0000-4000-8000-000000000066", null]
    )));
  } finally {
    await db.close();
  }
});

test("FIXTURE: full staging order install, RLS/service grants, verify, rollback", async () => {
  const db = new PGlite();
  const report = {
    steps: [],
    rls: [],
    rpcs: [],
    rollback: [],
    calcompSynthetic: null
  };
  try {
    await bootstrap(db);
    report.steps.push("bootstrap_auth_roles");

    await db.exec(readSql(SQL.prerequisites));
    report.steps.push("staging_prerequisites");

    await db.exec(readSql(SQL.locations));
    // Supabase service_role normally has broad table rights; PGlite needs an explicit grant.
    await db.exec("grant select, insert, update, delete on public.ees_locations, public.ees_location_user_activity to service_role;");
    report.steps.push("locations_directory");

    await db.exec(MAP_PINS_STAGING_FOUNDATION);
    report.steps.push("map_pins_staging_foundation");

    await db.exec(readSql(SQL.bookingStub));
    report.steps.push("booking_diary_stub");

    await db.exec(readSql(SQL.v20));
    report.steps.push("v20");

    await db.exec(readSql(SQL.forth));
    report.steps.push("forth_import");

    await db.exec(readSql(SQL.v202));
    report.steps.push("v20_2");

    // verification scripts are SELECT-heavy; run key assertions explicitly
    const rls = await db.query(`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in (
          'ees_locations','ees_location_map_pins','ees_fleet_geofence_zones',
          'ees_fleet_visit_events','ees_fleet_notification_outbox','booking_diary',
          'account_access'
        )
      order by c.relname
    `);
    report.rls = rls.rows;
    assert.ok(rls.rows.every((row) =>
      row.relname === "booking_diary" ? true : row.relrowsecurity === true
    ));

    for (const fn of [
      "set_ees_fleet_geofence_zone",
      "commit_ees_fleet_geofence_transition",
      "commit_ees_fleet_event_review",
      "enqueue_ees_fleet_notification_outbox",
      "acquire_ees_fleet_monitor_lease"
    ]) {
      const found = await db.query(
        `select 1 as ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=$1`,
        [fn]
      );
      assert.equal(found.rows.length > 0, true, `missing ${fn}`);
      report.rpcs.push(fn);
    }

    // service_role execute grants (invoker RPCs require role)
    const grants = await db.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'set_ees_fleet_geofence_zone','commit_ees_fleet_geofence_transition',
          'commit_ees_fleet_event_review','enqueue_ees_fleet_notification_outbox'
        )
        and has_function_privilege('service_role', p.oid, 'EXECUTE')
    `);
    assert.equal(grants.rows.length, 4);

    // authenticated can read locations; service_role can manage fleet tables
    await db.query("insert into public.account_access(user_id, role, status) values ($1,'admin','active')", [OFFICE]);
    const locInsert = await asRole(db, "authenticated", OFFICE, () => db.query(`
      insert into public.ees_locations(id, company_name, address, verification_status)
      values ($1,'CAL-COMP','138 Moo 4, Sa Phang, Khao Yoi, Phetchaburi 76140','needs_check')
      returning id, company_name, verification_status
    `, [CALCOMP]));
    assert.equal(locInsert.rows[0].company_name, "CAL-COMP");

    await asRole(db, "service_role", OFFICE, () => db.query(`
      update public.ees_locations
      set source_info = $2, verification_status = 'verified', verified_at = now(), is_active = true
      where id = $1
    `, [CALCOMP, "Forth location ID: 2742427\nForth pin: 13.234431,99.806063\nPilot: CAL-COMP KHAO YOI\nDiameter raw: 100 (unverified)\nPublic-map warning: ~458 m OSM offset retained"]));

    await asRole(db, "service_role", OFFICE, () => db.query(`
      insert into public.ees_location_map_pins(
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source, source_reference,
        confirmed_at, confirmed_by, created_by, updated_by
      ) values (
        $1,'destination',13.234431,99.806063,'manual_confirmed',
        'Forth saved location 2742427','Locations Forth Pinned.csv',
        now(), $2, $2, $2
      )
    `, [CALCOMP, OFFICE]));

    await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,false,$2::uuid,$3)`,
      [CALCOMP, OFFICE, "Configure provisional 150m inactive"]
    ));
    await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,true,$2::uuid,$3)`,
      [CALCOMP, OFFICE, "Enable CAL-COMP Pilot 001 zone"]
    ));

    const zone = await db.query(
      "select active, radius_meters from public.ees_fleet_geofence_zones where location_id=$1",
      [CALCOMP]
    );
    assert.equal(zone.rows[0].active, true);
    assert.equal(zone.rows[0].radius_meters, 150);

    const eventKey = "forth:pilot001:calcomp:arrival";
    await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.commit_ees_fleet_geofence_transition($1,0,$2::jsonb,$3::jsonb) as ok`,
      [
        "forth:pilot001",
        JSON.stringify({
          vehicleKey: "forth:pilot001",
          phase: "INSIDE",
          stable: "INSIDE",
          locationId: CALCOMP,
          candidateSince: null,
          arrivalAt: "2026-11-01T00:00:00Z",
          visitKey: "forth:pilot001:calcomp",
          lastSourceAt: "2026-11-01T00:01:00Z",
          lastDetectedAt: "2026-11-01T00:01:05Z",
          uncertainReason: null
        }),
        JSON.stringify({
          eventKey,
          visitKey: "forth:pilot001:calcomp",
          type: "arrival",
          vehicleKey: "forth:pilot001",
          registration: "TEST-001",
          locationId: CALCOMP,
          occurredAt: "2026-11-01T00:00:00Z",
          confirmedSourceAt: "2026-11-01T00:01:00Z",
          confirmedLatitude: 13.234431,
          confirmedLongitude: 99.806063,
          detectedAt: "2026-11-01T00:01:05Z",
          durationSeconds: null,
          evidence: "verified_forth_gps"
        })
      ]
    ));

    const outbox = await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.enqueue_ees_fleet_notification_outbox($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`,
      [
        `visit:${eventKey}:arrival`, eventKey, "arrival", "action_required",
        "Vehicle arrival", "รถถึงสถานที่", "TEST-001 arrived CAL-COMP", "รถถึง CAL-COMP",
        "/fleet-events#pilot001", false
      ]
    ));
    const outbox2 = await asRole(db, "service_role", OFFICE, () => db.query(
      `select public.enqueue_ees_fleet_notification_outbox($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`,
      [
        `visit:${eventKey}:arrival`, eventKey, "arrival", "action_required",
        "Vehicle arrival", "รถถึงสถานที่", "TEST-001 arrived CAL-COMP", "รถถึง CAL-COMP",
        "/fleet-events#pilot001", false
      ]
    ));
    assert.equal(outbox.rows[0].id, outbox2.rows[0].id);
    const outboxRow = await db.query(
      "select status from public.ees_fleet_notification_outbox where event_key=$1",
      [eventKey]
    );
    assert.equal(outboxRow.rows[0].status, "push_disabled");

    report.calcompSynthetic = {
      eesLocationId: CALCOMP,
      forthId: "2742427",
      latitude: 13.234431,
      longitude: 99.806063,
      radiusMeters: 150,
      note: "Synthetic staging fixture only — not a live truck arrival"
    };

    // Run verification SQL files (read-only selects)
    await db.exec(readSql(SQL.v20Verify));
    await db.exec(readSql(SQL.v202Verify));
    report.steps.push("verification_sql_ok");

    // Rollback in reverse order
    await db.exec(readSql(SQL.v202Rollback));
    report.rollback.push("v20_2");
    await db.exec(readSql(SQL.forthRollback));
    report.rollback.push("forth");
    await db.exec(readSql(SQL.v20Rollback));
    report.rollback.push("v20");

    assert.equal(
      (await db.query("select to_regclass('public.ees_fleet_geofence_zones') as r")).rows[0].r,
      null
    );
    assert.equal(
      (await db.query("select to_regclass('public.ees_fleet_notification_outbox') as r")).rows[0].r,
      null
    );
    // Directory + stub + pins foundation remain after fleet rollback
    assert.ok(
      (await db.query("select to_regclass('public.ees_locations') as r")).rows[0].r
    );
    assert.ok(
      (await db.query("select to_regclass('public.booking_diary') as r")).rows[0].r
    );
    const stillCal = await db.query(
      "select company_name, source_info from public.ees_locations where id=$1",
      [CALCOMP]
    );
    assert.equal(stillCal.rows[0].company_name, "CAL-COMP");
    assert.match(stillCal.rows[0].source_info || "", /2742427/);

    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "output", "v20-2-staging-installation-safety-gate-test.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...report, passed: true }, null, 2)
    );
  } finally {
    await db.close();
  }
});

test("guard: staging env points to wpmnjfncaoogssgpqxek and refuses production", () => {
  const env = fs.readFileSync(path.join(root, ".env.staging.local"), "utf8");
  assert.match(env, /wpmnjfncaoogssgpqxek\.supabase\.co/);
  assert.doesNotMatch(env, /hafoaurzfgkkwpvzedvd\.supabase\.co/);
  const { spawnSync } = require("node:child_process");
  const ok = spawnSync(process.execPath, [
    path.join(root, "scripts/assert-staging-sql-target.cjs"),
    "--env-file=.env.staging.local"
  ], { encoding: "utf8", cwd: root });
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const bad = spawnSync(process.execPath, [
    path.join(root, "scripts/assert-staging-sql-target.cjs"),
    "--env-file=.env.local"
  ], { encoding: "utf8", cwd: root });
  assert.notEqual(bad.status, 0);
});
