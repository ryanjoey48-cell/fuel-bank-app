/**
 * Isolated PGlite checks for CAL-COMP Pilot 001 migration dependencies.
 * Mimics live staging: Directory without is_active, map pins present, no fleet tables.
 * Does not talk to Supabase. Does not apply anything remotely.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

const v20 = fs.readFileSync(path.resolve(__dirname, "../docs/ees-fleet-operations-v20-review-only.sql"), "utf8");
const forth = fs.readFileSync(path.resolve(__dirname, "../docs/ees-forth-locations-import-v20-review-only.sql"), "utf8");
const v202 = fs.readFileSync(path.resolve(__dirname, "../docs/ees-fleet-operations-v20-2-review-only.sql"), "utf8");

const CALCOMP = "74ac5276-292b-5d30-a409-d9bf65e3e98c";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OFFICE = "10000000-0000-4000-8000-000000000001";
const BOOKING = "40000000-0000-4000-8000-000000000001";

async function fingerprintLocations(db) {
  const result = await db.query(`
    select id, company_name, address, google_maps_url, verification_status, verified_at,
           notes, source_info, destination_type, province, thai_name
    from public.ees_locations
    order by company_name
  `);
  return result.rows;
}

test("FIXTURE: V20→Forth→V20.2 on staging-shaped schema adds fleet objects without rewriting Directory rows", async () => {
  const db = new PGlite();
  try {
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
      create function public.is_account_active() returns boolean language sql stable as $$ select true $$;
      create function public.current_account_role() returns text language sql stable as $$ select 'admin'::text $$;

      -- Live Directory shape: verification_status exists; is_active does NOT.
      create table public.ees_locations (
        id uuid primary key,
        company_name text not null,
        thai_name text,
        alternative_names text[] not null default '{}',
        address text not null,
        province text,
        destination_type text not null default 'Other',
        google_maps_url text,
        truck_entrance_url text,
        verification_status text not null default 'needs_check',
        verified_at timestamptz,
        notes text,
        source_info text,
        created_by uuid,
        updated_by uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      -- Live map-pin shape (already installed remotely).
      create table public.ees_location_map_pins (
        id uuid primary key default gen_random_uuid(),
        location_id uuid not null references public.ees_locations(id),
        pin_type text not null,
        latitude double precision not null,
        longitude double precision not null,
        pin_status text not null,
        coordinate_source text not null,
        source_reference text,
        created_by uuid,
        created_at timestamptz not null default now(),
        confirmed_by uuid,
        confirmed_at timestamptz,
        updated_by uuid,
        updated_at timestamptz not null default now()
      );

      -- Unrelated operational table that must remain untouched.
      create table public.booking_diary (
        id uuid primary key,
        note text not null default 'keep-me'
      );

      insert into auth.users values ('${OFFICE}');
      insert into public.booking_diary values ('${BOOKING}', 'operational-row');
      insert into public.ees_locations (
        id, company_name, address, google_maps_url, verification_status, notes, source_info, destination_type
      ) values
        ('${CALCOMP}', 'CAL-COMP',
         '138 Moo 4, Sa Phang, Khao Yoi, Phetchaburi 76140',
         'https://www.google.com/maps/search/?api=1&query=CAL-COMP',
         'needs_check',
         'Workbook status: Requires location confirmation',
         'Historical workbook row 51',
         'Other'),
        ('${OTHER}', 'OTHER CUSTOMER',
         '1 Example Road, Bangkok',
         null,
         'verified',
         'Must not change',
         'Unrelated directory evidence',
         'Customer');
      update public.ees_locations set verified_at = now() where id = '${OTHER}';

      grant usage on schema public, auth to authenticated, service_role;
      grant select, insert, update, delete on public.ees_locations, public.ees_location_map_pins, public.booking_diary to service_role, authenticated;
      grant execute on function auth.uid(), auth.role() to authenticated, service_role;
      grant execute on function public.is_account_active(), public.current_account_role() to authenticated, service_role;
    `);

    const before = await fingerprintLocations(db);
    const bookingBefore = await db.query("select * from public.booking_diary order by id");

    await db.exec(v20);
    await db.exec(forth);
    await db.exec(v202);

    const after = await fingerprintLocations(db);
    assert.deepEqual(after, before, "Directory business fields must be unchanged by fleet migrations");

    const bookingAfter = await db.query("select * from public.booking_diary order by id");
    assert.deepEqual(bookingAfter.rows, bookingBefore.rows, "Unrelated booking_diary rows must be untouched");

    const active = await db.query("select id, is_active from public.ees_locations order by company_name");
    assert.equal(active.rows.length, 2);
    assert.ok(active.rows.every((row) => row.is_active === true), "is_active defaults true; no soft-disable implied");

    const cal = active.rows.find((row) => row.id === CALCOMP);
    assert.ok(cal);
    const calFull = await db.query(
      "select company_name, address, verification_status, source_info from public.ees_locations where id=$1",
      [CALCOMP]
    );
    assert.equal(calFull.rows[0].company_name, "CAL-COMP");
    assert.equal(calFull.rows[0].verification_status, "needs_check");
    assert.match(calFull.rows[0].source_info, /Historical workbook/);

    for (const table of [
      "ees_fleet_geofence_zones",
      "ees_fleet_visit_events",
      "ees_fleet_notification_outbox",
      "ees_forth_location_links",
      "ees_fleet_geofence_pilot_sites"
    ]) {
      const exists = await db.query("select to_regclass($1) as reg", [`public.${table}`]);
      assert.ok(exists.rows[0].reg, `${table} must exist after ordered apply`);
    }

    for (const fn of [
      "set_ees_fleet_geofence_zone",
      "commit_ees_fleet_geofence_transition",
      "commit_ees_fleet_event_review",
      "enqueue_ees_fleet_notification_outbox",
      "acquire_ees_fleet_monitor_lease"
    ]) {
      const row = await db.query(
        `select 1 as ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=$1`,
        [fn]
      );
      assert.equal(row.rows.length > 0, true, `${fn} missing`);
    }

    // Soft-disable is distinct from verification: verified+inactive cannot activate zone.
    await db.query(`
      insert into public.ees_location_map_pins (
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source, confirmed_at
      ) values ('${OTHER}', 'destination', 13.7, 100.6, 'manual_confirmed', 'fixture', now())
    `);
    await db.query("update public.ees_locations set is_active=false where id=$1", [OTHER]);
    await db.query("begin");
    await db.query("set local role service_role");
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await assert.rejects(() => db.query(
      `select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,true,$2::uuid,$3)`,
      [OTHER, OFFICE, "Try enable while inactive"]
    ));
    await db.query("rollback");

    await db.query("update public.ees_locations set is_active=true where id=$1", [OTHER]);
    await db.query("begin");
    await db.query("set local role service_role");
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query(
      `select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,true,$2::uuid,$3)`,
      [OTHER, OFFICE, "Enable verified active location"]
    );
    await db.query("commit");

    const zone = await db.query("select active, radius_meters from public.ees_fleet_geofence_zones where location_id=$1", [OTHER]);
    assert.equal(zone.rows[0].active, true);
    assert.equal(zone.rows[0].radius_meters, 150);

    // CAL-COMP remains needs_check / unpinned — cannot enable.
    await db.query("begin");
    await db.query("set local role service_role");
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await assert.rejects(() => db.query(
      `select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,true,$2::uuid,$3)`,
      [CALCOMP, OFFICE, "Pilot enable without pin"]
    ));
    await db.query("rollback");

    const calAfterEnableAttempt = await db.query(
      "select verification_status, address from public.ees_locations where id=$1",
      [CALCOMP]
    );
    assert.equal(calAfterEnableAttempt.rows[0].verification_status, "needs_check");
    assert.match(calAfterEnableAttempt.rows[0].address, /Khao Yoi/);
  } finally {
    await db.close();
  }
});

test("FIXTURE: is_active is not equivalent to verification_status", async () => {
  // Documentation assertion via schema semantics after V20 stub apply.
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
        verification_status text not null default 'needs_check'
      );
      create table public.ees_location_map_pins(
        location_id uuid not null,
        pin_type text not null,
        pin_status text not null
      );
      create table public.booking_diary(id uuid primary key);
      insert into auth.users values ('${OFFICE}');
      insert into public.ees_locations values ('${OTHER}', 'verified');
      insert into public.ees_location_map_pins values ('${OTHER}','destination','manual_confirmed');
      grant usage on schema public, auth to authenticated, service_role;
      grant select on public.ees_locations, public.ees_location_map_pins, public.booking_diary to service_role;
      grant execute on function auth.uid(), auth.role(), public.is_account_active(), public.current_account_role() to service_role;
    `);
    await db.exec(v20);
    const cols = await db.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='ees_locations'
        and column_name in ('is_active','verification_status')
      order by column_name
    `);
    assert.deepEqual(cols.rows.map((r) => r.column_name), ["is_active", "verification_status"]);
  } finally {
    await db.close();
  }
});
