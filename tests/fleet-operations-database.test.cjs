const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const migration = fs.readFileSync(path.resolve(__dirname, "../docs/ees-fleet-operations-v20-review-only.sql"), "utf8");
const migrationV202 = fs.readFileSync(path.resolve(__dirname, "../docs/ees-fleet-operations-v20-2-review-only.sql"), "utf8");
const office = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const location = "20000000-0000-4000-8000-000000000001";
const booking = "40000000-0000-4000-8000-000000000001";
const requestA = "50000000-0000-4000-8000-000000000001";
const requestB = "50000000-0000-4000-8000-000000000002";

async function asRole(db, role, userId, action) {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const value = await action();
    await db.query("commit");
    return value;
  } catch (error) { await db.query("rollback"); throw error; }
}

test("review-only persistence SQL has RLS and one atomic idempotent transition", async () => {
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
      create function public.current_account_role() returns text language sql stable as $$ select 'office_staff'::text $$;
      create table public.ees_locations(id uuid primary key, verification_status text not null default 'needs_check');
      create table public.ees_location_map_pins(location_id uuid not null, pin_type text not null, pin_status text not null);
      create table public.booking_diary(id uuid primary key);
      insert into auth.users values ('${office}'), ('${other}');
      insert into public.ees_locations values ('${location}');
      insert into public.booking_diary values ('${booking}');
      grant usage on schema public, auth to authenticated, service_role;
      grant select on public.ees_locations, public.ees_location_map_pins, public.booking_diary to service_role;
      grant execute on function auth.uid(), auth.role() to authenticated, service_role;
      grant execute on function public.is_account_active(), public.current_account_role() to authenticated, service_role;
    `);
    await db.exec(migration);
    await db.exec(migrationV202);
    const rls = await db.query("select relname, relrowsecurity from pg_class where relname like 'ees_fleet_%' and relkind='r'");
    assert.equal(rls.rows.length, 13);
    assert.ok(rls.rows.every((row) => row.relrowsecurity));
    const tokenA = "30000000-0000-4000-8000-000000000001";
    const tokenB = "30000000-0000-4000-8000-000000000002";
    const acquire = (token) => asRole(db, "service_role", office, () => db.query(
      "select public.acquire_ees_fleet_monitor_lease($1::uuid,180) as acquired", [token]));
    assert.equal((await acquire(tokenA)).rows[0].acquired, true);
    assert.equal((await acquire(tokenB)).rows[0].acquired, false);
    await asRole(db, "service_role", office, () => db.query(
      "select public.release_ees_fleet_monitor_lease($1::uuid)", [tokenA]));
    assert.equal((await acquire(tokenB)).rows[0].acquired, true);
    const saveZone = (active, reason = "Office review") => asRole(db, "service_role", office, () => db.query(
      "select public.set_ees_fleet_geofence_zone($1::uuid,150,60,60,25,$2,$3::uuid,$4)",
      [location, active, office, reason]));
    await saveZone(false);
    await assert.rejects(saveZone(true));
    await db.query("update public.ees_locations set verification_status='verified' where id=$1", [location]);
    await db.query("insert into public.ees_location_map_pins values ($1,'destination','manual_confirmed')", [location]);
    await saveZone(true, "Approved location and pin");
    assert.equal((await db.query("select active from public.ees_fleet_geofence_zones where location_id=$1", [location])).rows[0].active, true);
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_geofence_zone_history")).rows[0].n, 2);
    const state = { vehicleKey: "forth:42", phase: "INSIDE", stable: "INSIDE", locationId: location,
      candidateSince: null, arrivalAt: "2026-10-31T00:00:00Z", visitKey: "forth:42:loc:0",
      lastSourceAt: "2026-10-31T00:01:00Z", lastDetectedAt: "2026-10-31T00:01:08Z", uncertainReason: null };
    const event = { eventKey: "forth:42:loc:0:arrival", visitKey: state.visitKey, type: "arrival",
      vehicleKey: "forth:42", registration: "78-6996", locationId: location,
      occurredAt: state.arrivalAt, confirmedSourceAt: state.lastSourceAt,
      confirmedLatitude: 13.7, confirmedLongitude: 100.6,
      detectedAt: state.lastDetectedAt, durationSeconds: null, evidence: "verified_forth_gps" };
    const commit = () => db.query("select public.commit_ees_fleet_geofence_transition($1,$2,$3::jsonb,$4::jsonb) as accepted",
      ["forth:42", 0, JSON.stringify(state), JSON.stringify(event)]);
    const first = await asRole(db, "service_role", office, commit);
    assert.equal(first.rows[0].accepted, true);
    const again = await asRole(db, "service_role", office, commit);
    assert.equal(again.rows[0].accepted, false);
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_visit_events")).rows[0].n, 1);

    const review = (requestId) => asRole(db, "service_role", office, () => db.query(
      `select public.commit_ees_fleet_event_review($1,$2,$3::uuid,$4,$5::uuid,$6::uuid,$7) as result`,
      [event.eventKey, "confirm", office, "Confirmed after office check", requestId, null, "idem-confirm-1"]
    ));
    const reviewed = await review(requestA);
    assert.equal(reviewed.rows[0].result.review_status, "confirmed");
    assert.equal(reviewed.rows[0].result.replayed, false);
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_event_review_history")).rows[0].n, 1);
    const replay = await review(requestA);
    assert.equal(replay.rows[0].result.replayed, true);
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_event_review_history")).rows[0].n, 1);

    const bookingMatch = await asRole(db, "service_role", office, () => db.query(
      `select public.commit_ees_fleet_event_review($1,$2,$3::uuid,$4,$5::uuid,$6::uuid,$7) as result`,
      [event.eventKey, "match_booking", office, "Unique booking candidate accepted", requestB, booking, null]
    ));
    assert.equal(bookingMatch.rows[0].result.booking_match_status, "confirmed");
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_event_review_history")).rows[0].n, 2);

    const outboxFirst = await asRole(db, "service_role", office, () => db.query(
      `select public.enqueue_ees_fleet_notification_outbox($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`,
      [`visit:${event.eventKey}:arrival`, event.eventKey, "arrival", "action_required",
        "Vehicle arrival", "รถถึงสถานที่", "78-6996 arrived", "รถถึงแล้ว", "/fleet-events#x", false]
    ));
    const outboxSecond = await asRole(db, "service_role", office, () => db.query(
      `select public.enqueue_ees_fleet_notification_outbox($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`,
      [`visit:${event.eventKey}:arrival`, event.eventKey, "arrival", "action_required",
        "Vehicle arrival", "รถถึงสถานที่", "78-6996 arrived", "รถถึงแล้ว", "/fleet-events#x", false]
    ));
    assert.equal(outboxFirst.rows[0].id, outboxSecond.rows[0].id);
    assert.equal((await db.query("select count(*)::integer as n from public.ees_fleet_notification_outbox")).rows[0].n, 1);
    assert.equal((await db.query("select status from public.ees_fleet_notification_outbox")).rows[0].status, "push_disabled");

    await assert.rejects(asRole(db, "authenticated", office, commit));
    const own = await asRole(db, "authenticated", office, () => db.query("select * from public.ees_fleet_notification_inbox"));
    assert.equal(own.rows.length, 0);
    await assert.rejects(asRole(db, "authenticated", office, () => db.query("select * from public.ees_fleet_push_subscriptions")));
    await assert.rejects(asRole(db, "authenticated", office, () => db.query("select * from public.ees_fleet_notification_outbox")));
  } finally { await db.close(); }
});
