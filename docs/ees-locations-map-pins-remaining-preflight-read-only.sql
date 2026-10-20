-- READ ONLY: run in Supabase SQL Editor before considering the map-pin migration.
-- Returns one PASS/FAIL row per critical prerequisite. This script changes nothing.

with
executor as (
  select current_user::text as role_name,
         coalesce(role.rolsuper, false) as is_superuser,
         coalesce(role.rolcreaterole, false) as can_create_role,
         current_user::text <> session_user::text as switched_role,
         has_database_privilege(current_user, current_database(), 'CREATE') as can_create_schema,
         has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public,
         has_schema_privilege(current_user, 'public', 'USAGE') as can_use_public,
         coalesce(to_regnamespace('auth') is not null
                  and has_schema_privilege(current_user, to_regnamespace('auth'), 'USAGE'), false) as can_use_auth,
         (has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION')
          or exists (
            select 1 from pg_namespace namespace
            cross join lateral aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
            where namespace.nspname = 'public'
              and acl.grantee = 0
              and acl.privilege_type = 'USAGE'
          )
          or case when exists (select 1 from pg_roles where rolname = 'ees_locations_map_pin_auditor')
                  then has_schema_privilege('ees_locations_map_pin_auditor', 'public', 'USAGE')
                  else false end) as can_grant_auditor_public_usage,
         exists (select 1 from pg_roles where rolname = 'ees_locations_map_pin_auditor') as auditor_exists,
         exists (
           select 1 from pg_auth_members membership
           join pg_roles auditor on auditor.oid = membership.roleid
           where auditor.rolname = 'ees_locations_map_pin_auditor'
             and membership.member = (select oid from pg_roles where rolname = current_user)
             and membership.admin_option
         ) as administers_existing_auditor,
         case when to_regclass('public.ees_locations') is not null then
           has_table_privilege(current_user, to_regclass('public.ees_locations'), 'REFERENCES')
           and has_table_privilege(current_user, to_regclass('public.ees_locations'), 'TRIGGER')
           and exists (select 1 from pg_class where oid = to_regclass('public.ees_locations')
                       and relowner = (select oid from pg_roles where rolname = current_user))
         else false end as can_install_location_trigger
  from pg_roles role
  where role.rolname = current_user
),
required_columns(schema_name, table_name, column_name, expected_type) as (
  values
    ('public', 'ees_locations', 'id', 'uuid'),
    ('public', 'account_access', 'user_id', 'uuid'),
    ('public', 'account_access', 'role', 'text'),
    ('public', 'account_access', 'status', 'text'),
    ('public', 'driver_accounts', 'auth_user_id', 'uuid'),
    ('public', 'driver_accounts', 'active', 'boolean')
),
column_state as (
  select required.schema_name, required.table_name, required.column_name,
         attribute.attname is not null
         and case required.expected_type
           when 'uuid' then attribute.atttypid = 'uuid'::regtype
           when 'boolean' then attribute.atttypid = 'boolean'::regtype
           when 'text' then attribute.atttypid in ('text'::regtype, 'character varying'::regtype)
           else false
         end as is_valid
  from required_columns required
  left join pg_namespace namespace on namespace.nspname = required.schema_name
  left join pg_class relation on relation.relnamespace = namespace.oid
                              and relation.relname = required.table_name
  left join pg_attribute attribute on attribute.attrelid = relation.oid
                                   and attribute.attname = required.column_name
                                   and not attribute.attisdropped
),
expected_policies(table_name, policy_name, command, qual_tokens, check_tokens) as (
  values
    ('ees_locations', 'ees_locations_office_read', 'SELECT',
      array['is_office_account', 'is_account_active', 'current_account_role', 'admin', 'office_staff', 'read_only']::text[],
      array[]::text[]),
    ('ees_locations', 'ees_locations_office_insert', 'INSERT',
      array[]::text[],
      array['is_office_account', 'is_account_active', 'current_account_role', 'admin', 'office_staff']::text[]),
    ('ees_locations', 'ees_locations_office_update', 'UPDATE',
      array['is_office_account', 'is_account_active', 'current_account_role', 'admin', 'office_staff']::text[],
      array['is_office_account', 'is_account_active', 'current_account_role', 'admin', 'office_staff']::text[]),
    ('ees_locations', 'ees_locations_office_delete', 'DELETE',
      array['is_office_account', 'is_account_active', 'current_account_role', 'admin', 'office_staff']::text[],
      array[]::text[]),
    ('ees_location_user_activity', 'ees_location_activity_own', 'ALL',
      array['auth.uid', 'user_id', 'is_account_active', 'is_office_account']::text[],
      array['auth.uid', 'user_id', 'is_account_active', 'is_office_account']::text[])
),
policy_state as (
  select expected.table_name, expected.policy_name,
         actual.policyname is not null
         and actual.cmd = expected.command
         and actual.permissive = 'PERMISSIVE'
         and 'authenticated'::name = any(actual.roles)
         and lower(coalesce(actual.qual, '')) !~ '(^|[^a-z_])(or|not)([^a-z_]|$)'
         and lower(coalesce(actual.with_check, '')) !~ '(^|[^a-z_])(or|not)([^a-z_]|$)'
         and not exists (
           select 1 from unnest(expected.qual_tokens) as token(value)
           where position(token.value in lower(coalesce(actual.qual, ''))) = 0
         )
         and not exists (
           select 1 from unnest(expected.check_tokens) as token(value)
           where position(token.value in lower(coalesce(actual.with_check, ''))) = 0
         ) as is_valid
  from expected_policies expected
  left join pg_policies actual
    on actual.schemaname = 'public'
   and actual.tablename = expected.table_name
   and actual.policyname = expected.policy_name
),
checks(check_name, ok, detail) as (
  select 'Migration executor can create or administer the restricted auditor role',
         coalesce(bool_or(
           not switched_role
           and ((not auditor_exists and (is_superuser or can_create_role))
                or (auditor_exists and administers_existing_auditor))
         ), false),
         coalesce(string_agg(format('%s: rolsuper=%s, rolcreaterole=%s, auditor_exists=%s, admin_option=%s',
                                    role_name, is_superuser, can_create_role, auditor_exists,
                                    administers_existing_auditor), '; '),
                  'current role was not found in pg_roles')
  from executor

  union all
  select 'Migration executor can create the internal schema and install the triggers',
         coalesce(bool_and(
           not switched_role
           and can_create_schema
           and can_create_in_public
           and can_use_public
           and can_use_auth
           and can_grant_auditor_public_usage
           and can_install_location_trigger
         ), false),
         coalesce(string_agg(format('%s: direct-session=%s, CREATE database/public=%s/%s, USAGE public/auth=%s/%s, auditor public USAGE grantable=%s, owns locations and has REFERENCES/TRIGGER=%s',
                                    role_name, not switched_role, can_create_schema, can_create_in_public,
                                    can_use_public, can_use_auth, can_grant_auditor_public_usage,
                                    can_install_location_trigger), '; '),
                  'current role was not found in pg_roles')
  from executor

  union all
  select 'Supabase API roles and reserved auditor role are safe',
         exists (select 1 from pg_roles where rolname = 'anon' and not rolbypassrls)
         and exists (select 1 from pg_roles where rolname = 'authenticated' and not rolbypassrls)
         and exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls)
         and (
           not exists (select 1 from pg_roles where rolname = 'ees_locations_map_pin_auditor')
           or (
             exists (
               select 1 from pg_roles
               where rolname = 'ees_locations_map_pin_auditor'
                 and not (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole
                          or rolreplication or rolbypassrls or rolinherit)
             )
             and not exists (
               select 1 from pg_auth_members membership
               join pg_roles auditor on auditor.oid = membership.roleid
               where auditor.rolname = 'ees_locations_map_pin_auditor'
                 and membership.member <> (select oid from pg_roles where rolname = current_user)
             )
             and not exists (
               select 1 from pg_auth_members membership
               join pg_roles auditor on auditor.oid = membership.member
               where auditor.rolname = 'ees_locations_map_pin_auditor'
             )
             and exists (
               select 1 from pg_auth_members membership
               join pg_roles auditor on auditor.oid = membership.roleid
               where auditor.rolname = 'ees_locations_map_pin_auditor'
                 and membership.member = (select oid from pg_roles where rolname = current_user)
                 and membership.admin_option
             )
             and not exists (
               select 1 from pg_shdepend dependency
               join pg_roles auditor on auditor.oid = dependency.refobjid
               where auditor.rolname = 'ees_locations_map_pin_auditor'
                 and dependency.refclassid = 'pg_authid'::regclass
                 and dependency.deptype = 'o'
                 and not (dependency.classid = 'pg_proc'::regclass
                          and dependency.objid = coalesce(to_regprocedure(
                            'ees_locations_internal.audit_ees_location_map_pin()')::oid, 0::oid))
             )
             and (
               to_regprocedure('ees_locations_internal.audit_ees_location_map_pin()') is null
               or exists (
                 select 1 from pg_proc procedure
                 join pg_roles auditor on auditor.oid = procedure.proowner
                 where procedure.oid = to_regprocedure('ees_locations_internal.audit_ees_location_map_pin()')
                   and auditor.rolname = 'ees_locations_map_pin_auditor'
               )
             )
           )
         ),
         'Requires anon/authenticated without BYPASSRLS, service_role with BYPASSRLS; if auditor exists it must be non-login, non-inheriting, unprivileged, administered only by this executor, and own only the audit function'

  union all
  select 'Private audit schema is absent or owned by this executor',
         to_regnamespace('ees_locations_internal') is null
         or exists (
           select 1 from pg_namespace schema
           where schema.nspname = 'ees_locations_internal'
             and schema.nspowner = (select oid from pg_roles where rolname = current_user)
             and obj_description(schema.oid, 'pg_namespace') =
               'EES Locations private trigger-function schema v1.'
         ),
         coalesce((select format('owner=%s; marker=%s', owner.rolname,
                                 obj_description(schema.oid, 'pg_namespace'))
                   from pg_namespace schema join pg_roles owner on owner.oid = schema.nspowner
                   where schema.nspname = 'ees_locations_internal'), 'schema absent; migration will create it')

  union all
  select 'Required account and driver columns have compatible types',
         coalesce(bool_and(is_valid), false),
         coalesce(string_agg(format('%s.%s.%s %s', schema_name, table_name, column_name,
                                    case when is_valid then 'OK' else 'MISSING OR WRONG TYPE' end), '; '),
                  'required columns were not checked')
  from column_state

  union all
  select 'EES helper functions exist and authenticated can execute them',
           case when exists (select 1 from pg_roles where rolname = 'authenticated')
                    and to_regprocedure('auth.uid()') is not null
                    and to_regprocedure('public.is_office_account()') is not null
                    and to_regprocedure('public.is_account_active()') is not null
                    and to_regprocedure('public.current_account_role()') is not null
              then has_schema_privilege('authenticated', 'public', 'USAGE')
                   and has_schema_privilege('authenticated', 'auth', 'USAGE')
                   and has_function_privilege('authenticated', to_regprocedure('auth.uid()'), 'EXECUTE')
                   and has_function_privilege('authenticated', to_regprocedure('public.is_office_account()'), 'EXECUTE')
                   and has_function_privilege('authenticated', to_regprocedure('public.is_account_active()'), 'EXECUTE')
                   and has_function_privilege('authenticated', to_regprocedure('public.current_account_role()'), 'EXECUTE')
              else false end,
         'Requires auth/public schema USAGE and auth.uid(), is_office_account(), is_account_active(), current_account_role(), all executable by authenticated'

  union all
  select 'service_role has the migration-required table privileges',
         case when exists (select 1 from pg_roles where rolname = 'service_role')
                    and to_regclass('public.account_access') is not null
                    and to_regclass('public.driver_accounts') is not null
                    and to_regclass('public.ees_locations') is not null
              then has_table_privilege('service_role', to_regclass('public.account_access'), 'SELECT')
                   and has_table_privilege('service_role', to_regclass('public.driver_accounts'), 'SELECT')
                   and has_table_privilege('service_role', to_regclass('public.ees_locations'), 'SELECT')
                   and has_table_privilege('service_role', to_regclass('public.ees_locations'), 'DELETE')
              else false end,
         'Requires SELECT on account_access, driver_accounts and ees_locations, plus DELETE on ees_locations'

  union all
  select 'Existing EES RLS policies match office and own-activity rules',
         coalesce((select bool_and(is_valid) from policy_state), false)
         and not exists (
           select 1 from pg_policies
           where schemaname = 'public'
             and tablename in ('ees_locations', 'ees_location_user_activity')
             and policyname not in (
               'ees_locations_office_read', 'ees_locations_office_insert',
               'ees_locations_office_update', 'ees_locations_office_delete',
               'ees_location_activity_own'
             )
         )
         and (select count(*) from policy_state where is_valid) = 5
         and exists (select 1 from pg_class where oid = to_regclass('public.ees_locations') and relrowsecurity)
         and exists (select 1 from pg_class where oid = to_regclass('public.ees_location_user_activity') and relrowsecurity),
         coalesce((select string_agg(format('%s.%s=%s', table_name, policy_name,
                                            case when is_valid then 'OK' else 'MISSING OR MISMATCHED' end), '; ')
                   from policy_state), 'expected policies not found')
         || '; also requires RLS on both tables and no additional policies'

  union all
  select 'Map-pin tables are both absent for a clean first install',
         to_regclass('public.ees_location_map_pins') is null
         and to_regclass('public.ees_location_map_pin_history') is null,
         format('pins=%s; history=%s',
                coalesce(to_regclass('public.ees_location_map_pins')::text, 'absent'),
                coalesce(to_regclass('public.ees_location_map_pin_history')::text, 'absent'))

  union all
  select 'Locations baseline and updated-at trigger match the reviewed state',
         (select count(*) = 103 from public.ees_locations)
         and exists (
           select 1 from pg_trigger
           where tgrelid = to_regclass('public.ees_locations')
             and tgname = 'ees_locations_updated_at'
             and not tgisinternal
             and tgenabled in ('O', 'A')
         ),
         format('ees_locations rows=%s; enabled ees_locations_updated_at trigger=%s',
                (select count(*) from public.ees_locations),
                exists (
                  select 1 from pg_trigger
                  where tgrelid = to_regclass('public.ees_locations')
                    and tgname = 'ees_locations_updated_at'
                    and not tgisinternal
                    and tgenabled in ('O', 'A')
                ))
)
select check_name,
       case when ok then 'PASS' else 'FAIL' end as result,
       detail
from checks
order by check_name;
