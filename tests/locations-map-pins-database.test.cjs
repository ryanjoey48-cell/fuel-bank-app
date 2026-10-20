const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

const migration = fs.readFileSync(path.resolve("docs/ees-locations-map-pins-review-only.sql"), "utf8");
const productionPreflight = fs.readFileSync(path.resolve("docs/ees-locations-map-pins-production-preflight-read-only.sql"), "utf8");
const remainingPreflight = fs.readFileSync(path.resolve("docs/ees-locations-map-pins-remaining-preflight-read-only.sql"), "utf8");
const postInstallDiagnostic = fs.readFileSync(path.resolve("docs/ees-locations-map-pins-post-install-verification-read-only.sql"), "utf8");
const officeA = "10000000-0000-4000-8000-000000000001";
const officeB = "10000000-0000-4000-8000-000000000002";
const readOnly = "10000000-0000-4000-8000-000000000003";
const driver = "10000000-0000-4000-8000-000000000004";
const locA = "20000000-0000-4000-8000-000000000001";
const locB = "20000000-0000-4000-8000-000000000002";
const locC = "20000000-0000-4000-8000-000000000003";

async function asRole(db, role, userId, action) {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    if (userId) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await action();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

test("map-pin RLS, actor stamping, repeat install and delete-cascade audit work in isolated PGlite", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create table public.account_access(user_id uuid primary key, role text not null, status text not null);
      create table public.driver_accounts(auth_user_id uuid primary key, active boolean not null);
      create table public.ees_locations(id uuid primary key default gen_random_uuid(), company_name text not null);
      alter table public.ees_locations enable row level security;
      create function public.is_office_account() returns boolean language sql stable security definer set search_path = '' as $$
        select exists(select 1 from public.account_access a where a.user_id = auth.uid() and a.status = 'active')
          and not exists(select 1 from public.driver_accounts d where d.auth_user_id = auth.uid() and d.active)
      $$;
      create function public.is_account_active() returns boolean language sql stable security definer set search_path = '' as $$
        select exists(select 1 from public.account_access a where a.user_id = auth.uid() and a.status = 'active')
      $$;
      create function public.current_account_role() returns text language sql stable security definer set search_path = '' as $$
        select a.role from public.account_access a where a.user_id = auth.uid() and a.status = 'active'
      $$;
      grant execute on function public.is_office_account(), public.is_account_active(), public.current_account_role() to authenticated;
      create policy ees_locations_delete_test on public.ees_locations for delete to authenticated
        using (public.is_office_account() and public.is_account_active() and public.current_account_role() in ('admin','office_staff'));
      create policy ees_locations_read_test on public.ees_locations for select to authenticated
        using (public.is_office_account() and public.is_account_active());
      grant select, delete on public.ees_locations to authenticated, service_role;
      grant select on public.account_access, public.driver_accounts to service_role;
      insert into public.account_access values
        ('${officeA}', 'office_staff', 'active'),
        ('${officeB}', 'admin', 'active'),
        ('${readOnly}', 'read_only', 'active'),
        ('${driver}', 'office_staff', 'active');
      insert into public.driver_accounts values ('${driver}', true);
      insert into public.ees_locations(id, company_name) values
        ('${locA}', 'Pacific Knitting Factory Co., Ltd.'),
        ('${locB}', 'Pacific Dyeing & Finishing'),
        ('${locC}', 'Test Destination');
      create role migration_executor nologin createrole;
      grant usage on schema auth to migration_executor;
      grant usage, create on schema public to migration_executor;
      grant references, trigger on public.ees_locations to migration_executor;
      do $$ begin
        execute format('grant create on database %I to migration_executor', current_database());
      end $$;
      alter table public.ees_locations owner to migration_executor;
      -- Test-only membership lets this single isolated session impersonate the
      -- PostgREST roles after the migration executor is selected.
      grant authenticated, service_role to migration_executor;
    `);

    await db.exec("set session authorization migration_executor");
    const executorRole = (await db.query("select rolsuper, rolcreaterole from pg_roles where rolname = current_user")).rows[0];
    assert.deepEqual(executorRole, { rolsuper: false, rolcreaterole: true });
    const firstInstallPreflight = await db.query(remainingPreflight);
    assert.equal(firstInstallPreflight.rows.find((row) => row.check_name === "Migration executor can create or administer the restricted auditor role")?.result, "PASS");
    assert.equal(firstInstallPreflight.rows.find((row) => row.check_name === "Migration executor can create the internal schema and install the triggers")?.result, "PASS");
    await db.exec(migration);
    await db.exec(migration); // Reapplying should replace only the expected policies/triggers/functions.
    await db.exec("reset session authorization");

    assert.match(postInstallDiagnostic, /^-- EES Locations map pins: post-install verification \(READ ONLY\)/);
    assert.doesNotMatch(postInstallDiagnostic, /^\s*(?:begin|commit|insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/im);
    const postInstall = await db.query(postInstallDiagnostic);
    assert.equal(postInstall.rows.length, 14, "the complete post-install SQL statement should return all fourteen checks");
    const postInstallChecks = new Map(postInstall.rows.map((row) => [row.check_name, row.result]));
    for (const checkName of [
      "Map pins RLS enabled",
      "Map pin history RLS enabled",
      "Expected map-pin office policies and conditions",
      "No unexpected map-pin policies",
      "Service-role map-pin API privileges",
      "Restricted map-pin auditor role",
      "Audit function owner, SECURITY DEFINER and execution boundary",
      "History is append-only for application roles",
      "Pin write guard and audit triggers enabled",
      "Location-delete audit context trigger enabled",
      "Actor-aware delete RPC execution permissions and guard",
      "Pacific destinations remain separate"
    ]) {
      assert.equal(postInstallChecks.get(checkName), "PASS", JSON.stringify(postInstall.rows.find((row) => row.check_name === checkName)));
    }

    const original = await asRole(db, "authenticated", officeA, async () => {
      await db.query("select set_config('ees.map_pin_audit_actor', $1, true)", [officeB]);
      await db.query("select set_config('ees.map_pin_audit_context', 'trusted_service_role', true)");
      return db.query(`
        insert into public.ees_location_map_pins (
          location_id, pin_type, latitude, longitude, pin_status, coordinate_source,
          confirmed_by, confirmed_at, updated_by, updated_at
        ) values ($1, 'destination', 13.7, 100.5, 'manual_confirmed', 'field confirmation', $2, '2099-01-01', $2, '2099-01-01')
        returning id, created_by, created_at, confirmed_by, confirmed_at, updated_by, updated_at
      `, [locA, officeB]);
    });
    const inserted = original.rows[0];
    assert.equal(inserted.created_by, officeA);
    assert.equal(inserted.confirmed_by, officeA);
    assert.equal(inserted.updated_by, officeA);
    assert.notEqual(inserted.confirmed_at, "2099-01-01T00:00:00+00:00");
    const initialAudit = (await db.query(`
      select changed_by, changed_by_context from public.ees_location_map_pin_history
      where location_id = $1 and action = 'insert'
    `, [locA])).rows[0];
    assert.equal(initialAudit.changed_by, officeA);
    assert.equal(initialAudit.changed_by_context, "authenticated_user");

    await asRole(db, "authenticated", officeB, () => db.query(`
      insert into public.ees_location_map_pins (
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source,
        confirmed_by, confirmed_at, updated_by, updated_at
      ) values ($1, 'destination', 13.8, 100.6, 'manual_confirmed', 'corrected at gate', $2, '2099-01-01', $2, '2099-01-01')
      on conflict (location_id, pin_type) do update set
        latitude = excluded.latitude, longitude = excluded.longitude,
        coordinate_source = excluded.coordinate_source,
        confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `, [locA, officeA]));

    const corrected = (await db.query("select * from public.ees_location_map_pins where location_id = $1", [locA])).rows[0];
    assert.equal(corrected.created_by, officeA);
    assert.equal(corrected.created_at.toISOString(), inserted.created_at.toISOString());
    assert.equal(corrected.confirmed_by, officeA);
    assert.equal(corrected.confirmed_at.toISOString(), inserted.confirmed_at.toISOString());
    assert.equal(corrected.updated_by, officeB);
    assert.notEqual(corrected.updated_at.toISOString(), "2099-01-01T00:00:00.000Z");
    assert.equal(corrected.latitude, 13.8);

    await assert.rejects(asRole(db, "authenticated", officeB, () => db.query(
      "update public.ees_location_map_pins set location_id = $1 where id = $2", [locB, corrected.id]
    )), /EES_MAP_PIN_IDENTITY_IMMUTABLE/);
    await assert.rejects(asRole(db, "authenticated", officeB, () => db.query(
      "update public.ees_location_map_pins set pin_type = 'truck_entrance' where id = $1", [corrected.id]
    )), /EES_MAP_PIN_IDENTITY_IMMUTABLE/);
    await assert.rejects(asRole(db, "authenticated", officeB, () => db.query(
      "update public.ees_location_map_pins set created_at = '2099-01-01' where id = $1", [corrected.id]
    )), /EES_MAP_PIN_IDENTITY_IMMUTABLE/);
    await assert.rejects(asRole(db, "authenticated", readOnly, () => db.query(`
      insert into public.ees_location_map_pins (
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source,
        confirmed_by, confirmed_at, updated_by, updated_at
      ) values ($1, 'destination', 1, 1, 'manual_confirmed', 'bad actor', $2, now(), $2, now())
    `, [locB, readOnly])), /EES_MAP_PIN_FORBIDDEN|row-level security/);

    await asRole(db, "service_role", null, () => db.query(`
      insert into public.ees_location_map_pins (
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source,
        confirmed_by, confirmed_at, updated_by, updated_at
      ) values ($1, 'truck_entrance', 13.9, 100.7, 'manual_confirmed', 'verified office API actor', $2, now(), $2, now())
    `, [locB, officeB]));
    await assert.rejects(asRole(db, "service_role", null, () => db.query(`
      insert into public.ees_location_map_pins (
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source,
        confirmed_by, confirmed_at, updated_by, updated_at
      ) values ($1, 'destination', 13.9, 100.7, 'manual_confirmed', 'inactive actor', $2, now(), $2, now())
    `, [locC, readOnly])), /EES_MAP_PIN_FORBIDDEN/);

    await asRole(db, "service_role", null, () => db.query(
      "select public.delete_ees_location_with_map_pin_audit_actor($1, $2)", [locB, officeB]
    ));
    const serviceCascade = (await db.query(`
      select changed_by, changed_by_context from public.ees_location_map_pin_history
      where location_id = $1 and action = 'delete'
    `, [locB])).rows[0];
    assert.ok(serviceCascade, JSON.stringify((await db.query(`
      select (select count(*)::int from public.ees_locations where id = $1) as location_still_exists,
             (select count(*)::int from public.ees_location_map_pins where location_id = $1) as pin_still_exists,
             (select count(*)::int from public.ees_location_map_pin_history where location_id = $1) as history_count
    `, [locB])).rows[0]));
    assert.equal(serviceCascade.changed_by, officeB);
    assert.equal(serviceCascade.changed_by_context, "trusted_service_role");

    await asRole(db, "service_role", null, () => db.query(`
      insert into public.ees_location_map_pins (
        location_id, pin_type, latitude, longitude, pin_status, coordinate_source,
        confirmed_by, confirmed_at, updated_by, updated_at
      ) values ($1, 'destination', 13.7, 100.5, 'manual_confirmed', 'cascade test', $2, now(), $2, now())
    `, [locC, officeB]));
    await assert.rejects(asRole(db, "service_role", null, () => db.query(
      "delete from public.ees_locations where id = $1", [locC]
    )), /EES_LOCATION_DELETE_FORBIDDEN/);
    await asRole(db, "authenticated", officeA, async () => {
      await db.query("select set_config('ees.map_pin_audit_actor', $1, true)", [officeB]);
      await db.query("select set_config('ees.map_pin_audit_context', 'trusted_service_role', true)");
      return db.query("delete from public.ees_locations where id = $1", [locC]);
    });
    const authenticatedCascade = (await db.query(`
      select changed_by, changed_by_context from public.ees_location_map_pin_history
      where location_id = $1 and action = 'delete'
    `, [locC])).rows[0];
    assert.ok(authenticatedCascade, JSON.stringify((await db.query(`
      select (select count(*)::int from public.ees_locations where id = $1) as location_still_exists,
             (select count(*)::int from public.ees_location_map_pins where location_id = $1) as pin_still_exists,
             (select count(*)::int from public.ees_location_map_pin_history where location_id = $1) as history_count
    `, [locC])).rows[0]));
    assert.equal(authenticatedCascade.changed_by, officeA);
    assert.equal(authenticatedCascade.changed_by_context, "authenticated_user");

    const grants = (await db.query(`
      select has_table_privilege('authenticated', 'public.ees_location_map_pins', 'delete') as pin_delete,
             has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'insert') as history_insert,
             has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'update') as history_update,
             has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'delete') as history_delete,
             has_table_privilege('service_role', 'public.ees_location_map_pin_history', 'insert') as service_history_insert,
             has_table_privilege('ees_locations_map_pin_auditor', 'public.ees_location_map_pin_history', 'insert') as auditor_history_insert,
             has_table_privilege('ees_locations_map_pin_auditor', 'public.ees_location_map_pin_history', 'update') as auditor_history_update,
             has_table_privilege('ees_locations_map_pin_auditor', 'public.ees_location_map_pin_history', 'delete') as auditor_history_delete,
             has_function_privilege('authenticated', 'ees_locations_internal.audit_ees_location_map_pin()', 'execute') as auth_audit_execute,
             has_function_privilege('service_role', 'ees_locations_internal.audit_ees_location_map_pin()', 'execute') as service_audit_execute,
             has_function_privilege('authenticated', 'public.delete_ees_location_with_map_pin_audit_actor(uuid,uuid)', 'execute') as rpc_auth_execute
    `)).rows[0];
    assert.deepEqual(grants, {
      pin_delete: false, history_insert: false, history_update: false, history_delete: false,
      service_history_insert: false, auditor_history_insert: true, auditor_history_update: false,
      auditor_history_delete: false, auth_audit_execute: false, service_audit_execute: false,
      rpc_auth_execute: false
    });
    assert.equal((await db.query(`
      select pg_has_role('authenticated', 'ees_locations_map_pin_auditor', 'member') as auth_can_assume_auditor,
             pg_has_role('service_role', 'ees_locations_map_pin_auditor', 'member') as service_can_assume_auditor
    `)).rows[0].auth_can_assume_auditor, false);
    assert.equal((await db.query(`
      select pg_has_role('service_role', 'ees_locations_map_pin_auditor', 'member') as service_can_assume_auditor
    `)).rows[0].service_can_assume_auditor, false);
    await assert.rejects(asRole(db, "authenticated", officeA, () => db.query(`
      insert into public.ees_location_map_pin_history (
        pin_id, location_id, pin_type, action, new_latitude, new_longitude,
        new_pin_status, new_coordinate_source, original_created_by, original_created_at,
        original_confirmed_by, original_confirmed_at, changed_by, changed_by_context, changed_at
      ) select id, location_id, pin_type, 'insert', latitude, longitude, pin_status,
               coordinate_source, created_by, created_at, confirmed_by, confirmed_at,
               updated_by, 'authenticated_user', now()
        from public.ees_location_map_pins where location_id = $1
    `, [locA])), /permission denied|row-level security/i);
    await assert.rejects(asRole(db, "service_role", null, () => db.query(`
      insert into public.ees_location_map_pin_history (
        pin_id, location_id, pin_type, action, new_latitude, new_longitude,
        new_pin_status, new_coordinate_source, original_created_by, original_created_at,
        original_confirmed_by, original_confirmed_at, changed_by, changed_by_context, changed_at
      ) select id, location_id, pin_type, 'insert', latitude, longitude, pin_status,
               coordinate_source, created_by, created_at, confirmed_by, confirmed_at,
               updated_by, 'trusted_service_role', now()
        from public.ees_location_map_pins where location_id = $1
    `, [locA])), /permission denied|row-level security/i);
    assert.equal((await db.query("select count(*)::int as count from public.ees_location_map_pin_history where action = 'insert'")).rows[0].count, 3);
    assert.equal((await db.query("select count(*)::int as count from public.ees_location_map_pin_history where action = 'update'")).rows[0].count, 1);

    const auditor = (await db.query(`
      select role.rolcanlogin, role.rolsuper, role.rolbypassrls, role.rolinherit,
             history_owner.rolname as history_owner, function_owner.rolname as function_owner,
             member.rolname as sole_member
      from pg_roles role
      join pg_class history on history.relname = 'ees_location_map_pin_history'
      join pg_roles history_owner on history_owner.oid = history.relowner
      join pg_proc audit_function on audit_function.oid = 'ees_locations_internal.audit_ees_location_map_pin()'::regprocedure
      join pg_roles function_owner on function_owner.oid = audit_function.proowner
      join pg_auth_members membership on membership.roleid = role.oid
      join pg_roles member on member.oid = membership.member
      where role.rolname = 'ees_locations_map_pin_auditor'
    `)).rows[0];
    assert.deepEqual(auditor, {
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      history_owner: "migration_executor",
      function_owner: "ees_locations_map_pin_auditor",
      sole_member: "migration_executor"
    });
    assert.doesNotMatch(productionPreflight, /^\s*(?:begin|commit|insert|update|delete|alter|create|drop|grant|revoke)\b/im);
    await db.exec(productionPreflight);
    const preflightRows = await db.query(remainingPreflight);
    assert.ok(preflightRows.rows.length >= 8, "the read-only production preflight should return its critical PASS/FAIL rows");
    assert.equal(preflightRows.rows.find((row) => row.check_name === "Migration executor can create or administer the restricted auditor role")?.result, "PASS");
    assert.equal(preflightRows.rows.find((row) => row.check_name === "Migration executor can create the internal schema and install the triggers")?.result, "PASS");
  } finally {
    await db.close();
  }
});
