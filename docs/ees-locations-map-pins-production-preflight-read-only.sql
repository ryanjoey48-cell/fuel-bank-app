-- READ ONLY production preflight for docs/ees-locations-map-pins-review-only.sql.
-- Run in Supabase SQL Editor before the migration. Every statement is SELECT-only.

-- Connection identity and required Supabase roles.
select current_database() as database_name, current_user, session_user, version();

select rolname, rolsuper, rolbypassrls, rolcanlogin,
       rolcreatedb, rolcreaterole, rolinherit, rolreplication
from pg_roles
where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator', 'ees_locations_map_pin_auditor')
order by rolname;

-- Exact non-superuser prerequisites for the corrected migration. A PASS path
-- is CREATEROLE (only when the auditor role is absent), CREATE on database and
-- public, USAGE on public/auth, ownership plus REFERENCES/TRIGGER on
-- ees_locations, and either public USAGE grantability or existing auditor
-- USAGE. No SUPERUSER-only ALTER ROLE or object-owner transfer is used.
select current_user = session_user as direct_migration_session,
       has_database_privilege(current_user, current_database(), 'CREATE') as can_create_private_schema,
       has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public_objects,
       has_schema_privilege(current_user, 'public', 'USAGE') as can_use_public,
       has_schema_privilege(current_user, 'auth', 'USAGE') as can_use_auth,
       (select rolsuper or rolcreaterole from pg_roles where rolname = current_user) as can_create_auditor_if_absent,
       exists (select 1 from pg_roles where rolname = 'ees_locations_map_pin_auditor') as auditor_role_exists,
       (has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION')
        or exists (
          select 1 from pg_namespace namespace
          cross join lateral aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
          where namespace.nspname = 'public'
            and acl.grantee = 0
            and acl.privilege_type = 'USAGE'
        )
        or (exists (select 1 from pg_roles where rolname = 'ees_locations_map_pin_auditor')
            and has_schema_privilege('ees_locations_map_pin_auditor', 'public', 'USAGE'))) as auditor_can_use_public,
       has_table_privilege(current_user, 'public.ees_locations', 'REFERENCES') as can_reference_locations,
       has_table_privilege(current_user, 'public.ees_locations', 'TRIGGER') as can_create_location_trigger,
       exists (select 1 from pg_class where oid = to_regclass('public.ees_locations')
               and relowner = (select oid from pg_roles where rolname = current_user)) as owns_locations,
       has_schema_privilege('authenticated', 'public', 'USAGE') as authenticated_can_use_public,
       has_schema_privilege('authenticated', 'auth', 'USAGE') as authenticated_can_use_auth,
       has_schema_privilege('service_role', 'public', 'USAGE') as service_role_can_use_public;

select granted.rolname as granted_role, member.rolname as member_role,
       membership.admin_option,
       membership.grantor::regrole as grantor
from pg_auth_members membership
join pg_roles granted on granted.oid = membership.roleid
join pg_roles member on member.oid = membership.member
where granted.rolname = 'ees_locations_map_pin_auditor'
   or member.rolname = 'ees_locations_map_pin_auditor';

-- Required grants on the audit table and trigger function after installation.
-- Before installation these objects can be absent and the query returns no rows.
select table_privilege.rolname,
       case when to_regclass('public.ees_location_map_pin_history') is not null
            then has_table_privilege(table_privilege.rolname, to_regclass('public.ees_location_map_pin_history'), 'INSERT') end as can_insert,
       case when to_regclass('public.ees_location_map_pin_history') is not null
            then has_table_privilege(table_privilege.rolname, to_regclass('public.ees_location_map_pin_history'), 'UPDATE') end as can_update,
       case when to_regclass('public.ees_location_map_pin_history') is not null
            then has_table_privilege(table_privilege.rolname, to_regclass('public.ees_location_map_pin_history'), 'DELETE') end as can_delete
from pg_roles table_privilege
where table_privilege.rolname in ('anon', 'authenticated', 'service_role', 'ees_locations_map_pin_auditor')
  and to_regclass('public.ees_location_map_pin_history') is not null
order by table_privilege.rolname;

select schema.nspname as schema_name, owner.rolname as schema_owner,
       pg_catalog.obj_description(schema.oid, 'pg_namespace') as schema_marker,
       procedure.oid::regprocedure as function_name,
       function_owner.rolname as function_owner,
       procedure.prosecdef as security_definer,
       procedure.proconfig as function_settings
from pg_namespace schema
join pg_roles owner on owner.oid = schema.nspowner
left join pg_proc procedure on procedure.pronamespace = schema.oid
                           and procedure.proname = 'audit_ees_location_map_pin'
left join pg_roles function_owner on function_owner.oid = procedure.proowner
where schema.nspname = 'ees_locations_internal';

-- Required EES relations, owners, RLS flags, and row counts.
select n.nspname as schema_name, c.relname as table_name, owner.rolname as owner,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
       pg_catalog.obj_description(c.oid, 'pg_class') as table_comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_roles owner on owner.oid = c.relowner
where n.nspname = 'public'
  and c.relname in (
    'ees_locations', 'account_access', 'driver_accounts',
    'ees_location_map_pins', 'ees_location_map_pin_history'
  )
order by c.relname;

select count(*) as existing_location_count from public.ees_locations;

-- Required columns and data types for migration triggers and API integration.
select c.relname as table_name, a.attname as column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
       a.attnotnull as not_null
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ees_locations', 'account_access', 'driver_accounts')
  and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attnum;

-- Access-table privileges required by the trusted service_role write and
-- deletion-cascade paths. The API must keep the service key server-side.
select
  has_table_privilege('service_role', 'public.account_access', 'select') as service_can_read_account_access,
  has_table_privilege('service_role', 'public.driver_accounts', 'select') as service_can_read_driver_accounts,
  has_table_privilege('service_role', 'public.ees_locations', 'delete') as service_can_delete_locations,
  has_table_privilege('authenticated', 'public.ees_locations', 'delete') as authenticated_has_location_delete_grant;

-- EES permission helpers: confirm signatures, owners, SECURITY DEFINER status,
-- fixed search paths, and grants before trusting policy evaluation.
select p.oid::regprocedure as function_name, owner.rolname as owner,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles owner on owner.oid = p.proowner
where (n.nspname = 'auth' and p.proname = 'uid' and pg_catalog.pg_get_function_identity_arguments(p.oid) = '')
   or (n.nspname = 'public' and p.proname in ('is_office_account', 'is_account_active', 'current_account_role'))
order by n.nspname, p.proname;

-- Existing policies on the Locations and optional map-pin tables. Unexpected
-- permissive policies can widen access even when expected policies are strict.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'ees_locations', 'ees_location_user_activity',
    'ees_location_map_pins', 'ees_location_map_pin_history'
  )
order by tablename, policyname;

-- Current pin-table grants, if the map-pin tables already exist.
select c.relname as table_name,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'insert') as authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'update') as authenticated_update,
       has_table_privilege('authenticated', c.oid, 'delete') as authenticated_delete,
       has_table_privilege('service_role', c.oid, 'select') as service_select,
       has_table_privilege('service_role', c.oid, 'insert') as service_insert,
       has_table_privilege('service_role', c.oid, 'update') as service_update,
       has_table_privilege('service_role', c.oid, 'delete') as service_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ees_location_map_pins', 'ees_location_map_pin_history')
order by c.relname;

-- Pins-table constraints and FK delete action. Expect unique(location_id,
-- pin_type), coordinate checks, and ON DELETE CASCADE to ees_locations.
select c.relname as table_name, con.conname, con.contype,
       pg_catalog.pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ees_location_map_pins', 'ees_location_map_pin_history')
order by c.relname, con.conname;

-- Trigger existence, timing, enabled state, function owner, definer flag and
-- function settings. Before applying, the two pin tables/triggers may be absent.
select c.relname as table_name, t.tgname as trigger_name,
       pg_catalog.pg_get_triggerdef(t.oid) as trigger_definition,
       t.tgenabled as enabled_state,
       p.oid::regprocedure as trigger_function,
       owner.rolname as function_owner, p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_roles owner on owner.oid = p.proowner
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname in ('ees_location_map_pins', 'ees_locations')
order by c.relname, t.tgname;

-- Expected API-facing delete RPC, if a previous controlled install exists.
select p.oid::regprocedure as function_name, owner.rolname as owner,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles owner on owner.oid = p.proowner
where n.nspname = 'public'
  and p.proname = 'delete_ees_location_with_map_pin_audit_actor';

-- No writes are performed by this file. Review missing prerequisites, extra
-- policies, forced RLS, stale map schema markers, and insufficient grants
-- before deciding whether to apply the separate review-only migration.
