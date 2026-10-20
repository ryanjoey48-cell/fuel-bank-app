-- EES Locations map pins: post-install verification (READ ONLY).
-- Run in Supabase SQL Editor with a read-capable role that can inspect the
-- PostgreSQL catalogs. This script performs SELECT/catalog inspection only.
-- Returns the 14 PASS/FAIL checks only.

with expected_map_policies(table_name, policy_name, command, target_role) as (
  values
    ('ees_location_map_pins', 'ees_location_map_pins_office_read', 'SELECT', 'authenticated'),
    ('ees_location_map_pins', 'ees_location_map_pins_office_insert', 'INSERT', 'authenticated'),
    ('ees_location_map_pins', 'ees_location_map_pins_office_update', 'UPDATE', 'authenticated'),
    ('ees_location_map_pin_history', 'ees_location_map_pin_history_office_read', 'SELECT', 'authenticated'),
    ('ees_location_map_pin_history', 'ees_location_map_pin_history_auditor_insert', 'INSERT', 'ees_locations_map_pin_auditor')
),
expected_location_policies(table_name, policy_name) as (
  values
    ('ees_locations', 'ees_locations_office_read'),
    ('ees_locations', 'ees_locations_office_insert'),
    ('ees_locations', 'ees_locations_office_update'),
    ('ees_locations', 'ees_locations_office_delete'),
    ('ees_location_user_activity', 'ees_location_activity_own')
),
checks as (
  select
    'Map pins RLS enabled'::text as check_name,
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ees_location_map_pins'
    ), false) as ok,
    'public.ees_location_map_pins must exist with row-level security enabled.'::text as detail

  union all
  select
    'Map pin history RLS enabled',
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ees_location_map_pin_history'
    ), false),
    'public.ees_location_map_pin_history must exist with row-level security enabled.'

  union all
  select
    'Expected map-pin office policies and conditions',
    (
      select count(*) = 5 and bool_and(policy_ok)
      from (
        select expected.policy_name,
          exists (
            select 1
            from pg_policies p
            where p.schemaname = 'public'
              and p.tablename = expected.table_name
              and p.policyname = expected.policy_name
              and p.roles = array[expected.target_role::name]
              and p.cmd = expected.command
              and case expected.policy_name
                when 'ees_location_map_pins_office_read' then
                  p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.qual ilike '%current_account_role%'
                  and p.qual ilike '%admin%'
                  and p.qual ilike '%office_staff%'
                  and p.qual ilike '%read_only%'
                when 'ees_location_map_pins_office_insert' then
                  p.with_check ilike '%is_office_account%'
                  and p.with_check ilike '%is_account_active%'
                  and p.with_check ilike '%current_account_role%'
                  and p.with_check ilike '%admin%'
                  and p.with_check ilike '%office_staff%'
                  and p.with_check ilike '%created_by%auth.uid%'
                  and p.with_check ilike '%confirmed_by%auth.uid%'
                  and p.with_check ilike '%updated_by%auth.uid%'
                when 'ees_location_map_pins_office_update' then
                  p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.qual ilike '%current_account_role%'
                  and p.qual ilike '%admin%'
                  and p.qual ilike '%office_staff%'
                  and p.with_check ilike '%is_office_account%'
                  and p.with_check ilike '%is_account_active%'
                  and p.with_check ilike '%current_account_role%'
                  and p.with_check ilike '%admin%'
                  and p.with_check ilike '%office_staff%'
                  and p.with_check ilike '%updated_by%auth.uid%'
                when 'ees_location_map_pin_history_office_read' then
                  p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.qual ilike '%current_account_role%'
                  and p.qual ilike '%admin%'
                  and p.qual ilike '%office_staff%'
                  and p.qual ilike '%read_only%'
                when 'ees_location_map_pin_history_auditor_insert' then
                  p.with_check = 'true'
                else false
              end
        ) as policy_ok
        from expected_map_policies expected
      ) evaluated
    ),
    'Requires the three authenticated pin policies, office read-only history policy and auditor-only history INSERT policy, with active-office/role checks.'

  union all
  select
    'No unexpected map-pin policies',
    (
      select count(*) = 5
      from pg_policies
      where schemaname = 'public'
        and tablename in ('ees_location_map_pins', 'ees_location_map_pin_history')
        and policyname in (
          'ees_location_map_pins_office_read',
          'ees_location_map_pins_office_insert',
          'ees_location_map_pins_office_update',
          'ees_location_map_pin_history_office_read',
          'ees_location_map_pin_history_auditor_insert'
        )
    ) and not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename in ('ees_location_map_pins', 'ees_location_map_pin_history')
        and policyname not in (
          'ees_location_map_pins_office_read',
          'ees_location_map_pins_office_insert',
          'ees_location_map_pins_office_update',
          'ees_location_map_pin_history_office_read',
          'ees_location_map_pin_history_auditor_insert'
        )
    ),
    'Map-pin tables should have only the five expected policies; extra permissive policies can widen access.'

  union all
  select
    'Service-role map-pin API privileges',
    has_table_privilege('service_role', 'public.ees_location_map_pins', 'SELECT')
    and has_table_privilege('service_role', 'public.ees_location_map_pins', 'INSERT')
    and has_table_privilege('service_role', 'public.ees_location_map_pins', 'UPDATE')
    and not has_table_privilege('service_role', 'public.ees_location_map_pins', 'DELETE'),
    'The API service client needs SELECT/INSERT/UPDATE on pins; deletion is handled through the actor-aware location RPC.'

  union all
  select
    'Restricted map-pin auditor role',
    exists (
      select 1 from pg_roles r
      where r.rolname = 'ees_locations_map_pin_auditor'
        and not r.rolcanlogin
        and not r.rolsuper
        and not r.rolcreatedb
        and not r.rolcreaterole
        and not r.rolreplication
        and not r.rolbypassrls
        and not r.rolinherit
    )
    and not exists (
      select 1
      from pg_auth_members m
      join pg_roles granted_role on granted_role.oid = m.roleid
      join pg_roles member_role on member_role.oid = m.member
      where granted_role.rolname = 'ees_locations_map_pin_auditor'
        and member_role.rolname in ('anon', 'authenticated', 'service_role')
    ),
    'Role must be NOLOGIN, non-superuser, non-BYPASSRLS and not assumable by anon, authenticated or service_role.'

  union all
  select
    'Audit function owner, SECURITY DEFINER and execution boundary',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles owner_role on owner_role.oid = p.proowner
      where n.nspname = 'ees_locations_internal'
        and p.proname = 'audit_ees_location_map_pin'
        and p.pronargs = 0
        and p.prorettype = 'trigger'::regtype
        and p.prosecdef
        and owner_role.rolname = 'ees_locations_map_pin_auditor'
        and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
    and not exists (
      select 1
      from pg_namespace internal_schema
      join pg_roles app_role on app_role.rolname in ('anon', 'authenticated', 'service_role')
      where internal_schema.nspname = 'ees_locations_internal'
        and has_schema_privilege(app_role.rolname, internal_schema.oid, 'USAGE')
    ),
    'SECURITY DEFINER audit trigger must be owned by the restricted role, pin search_path to empty, and remain inaccessible to API roles.'

  union all
  select
    'History is append-only for application roles',
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ees_location_map_pin_history'
    ), false)
    and coalesce((
      select has_table_privilege(auditor.rolname, 'public.ees_location_map_pin_history', 'INSERT')
        and not has_table_privilege(auditor.rolname, 'public.ees_location_map_pin_history', 'SELECT')
        and not has_table_privilege(auditor.rolname, 'public.ees_location_map_pin_history', 'UPDATE')
        and not has_table_privilege(auditor.rolname, 'public.ees_location_map_pin_history', 'DELETE')
      from pg_roles auditor where auditor.rolname = 'ees_locations_map_pin_auditor'
    ), false)
    and has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'SELECT')
    and not has_table_privilege('anon', 'public.ees_location_map_pin_history', 'SELECT')
    and not has_table_privilege('anon', 'public.ees_location_map_pin_history', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'DELETE')
    and not has_table_privilege('service_role', 'public.ees_location_map_pin_history', 'INSERT')
    and not has_table_privilege('service_role', 'public.ees_location_map_pin_history', 'SELECT')
    and not has_table_privilege('service_role', 'public.ees_location_map_pin_history', 'UPDATE')
    and not has_table_privilege('service_role', 'public.ees_location_map_pin_history', 'DELETE'),
    'Only the trigger owner may INSERT history; app roles get no direct history writes and the auditor cannot UPDATE or DELETE.'

  union all
  select
    'Pin write guard and audit triggers enabled',
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public' and c.relname = 'ees_location_map_pins'
        and t.tgname = 'ees_location_map_pin_write_guard'
        and not t.tgisinternal and t.tgenabled in ('O', 'A')
        and p.proname = 'prepare_ees_location_map_pin_write'
        and lower(pg_get_triggerdef(t.oid)) like '%before insert or update%'
    )
    and exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public' and c.relname = 'ees_location_map_pins'
        and t.tgname = 'ees_location_map_pin_audit'
        and not t.tgisinternal and t.tgenabled in ('O', 'A')
        and p.proname = 'audit_ees_location_map_pin'
        and lower(pg_get_triggerdef(t.oid)) like '%after insert%'
        and lower(pg_get_triggerdef(t.oid)) like '%or delete%'
        and lower(pg_get_triggerdef(t.oid)) like '%or update%'
    ),
    'The BEFORE INSERT/UPDATE guard and AFTER INSERT/UPDATE/DELETE audit triggers must be enabled on the pin table.'

  union all
  select
    'Location-delete audit context trigger enabled',
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public' and c.relname = 'ees_locations'
        and t.tgname = 'ees_locations_map_pin_delete_context'
        and not t.tgisinternal and t.tgenabled in ('O', 'A')
        and p.proname = 'prepare_ees_location_delete_audit_context'
        and lower(pg_get_triggerdef(t.oid)) like '%before delete%'
    ),
    'The parent-row BEFORE DELETE trigger must set audit context before a location cascade removes pins.'

  union all
  select
    'Actor-aware delete RPC execution permissions and guard',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'delete_ees_location_with_map_pin_audit_actor'
        and p.pronargs = 2
        and p.proargtypes = '2950 2950'::oidvector
        and not p.prosecdef
        and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
        and has_function_privilege('service_role', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and p.prosrc ilike '%current_user <> ''service_role''%'
        and p.prosrc ilike '%account_access%'
        and p.prosrc ilike '%status = ''active''%'
        and p.prosrc ilike '%admin%'
        and p.prosrc ilike '%office_staff%'
        and p.prosrc ilike '%driver_accounts%'
        and p.prosrc ilike '%set_config%'
        and has_table_privilege('service_role', 'public.account_access', 'SELECT')
        and has_table_privilege('service_role', 'public.driver_accounts', 'SELECT')
        and has_table_privilege('service_role', 'public.ees_locations', 'DELETE')
    ),
    'RPC must be SECURITY INVOKER with empty search_path, callable only by service_role, and validate the active office actor before cascading.'

  union all
  select
    'Historical destinations count and ID uniqueness',
    (select count(*) = 103 and count(id) = 103 and count(distinct id) = 103 from public.ees_locations),
    'Expected 103 existing public.ees_locations rows with one non-null distinct ID per row. This confirms count/ID integrity, not byte-for-byte comparison to a prior snapshot.'

  union all
  select
    'Pacific destinations remain separate',
    (
      select count(case when company_name in (
          'Pacific Knitting Factory Co., Ltd.',
          'Pacific Dyeing & Finishing'
        ) then 1 end) = 2
        and count(distinct case when company_name in (
          'Pacific Knitting Factory Co., Ltd.',
          'Pacific Dyeing & Finishing'
        ) then id end) = 2
        and count(case when company_name = 'Pacific Knitting Factory Co., Ltd.' then 1 end) = 1
        and count(case when company_name = 'Pacific Dyeing & Finishing' then 1 end) = 1
      from public.ees_locations
    ),
    'The two Pacific companies must remain separate destination rows.'

  union all
  select
    'Existing Locations RLS policy set preserved',
    (
      select count(*) = 5 and bool_and(policy_ok)
      from (
        select expected.policy_name,
          exists (
            select 1 from pg_policies p
            where p.schemaname = 'public'
              and p.tablename = expected.table_name
              and p.policyname = expected.policy_name
              and p.roles = array['authenticated'::name]
              and case expected.policy_name
                when 'ees_locations_office_read' then p.cmd = 'SELECT'
                  and p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.qual ilike '%current_account_role%'
                  and p.qual ilike '%admin%'
                  and p.qual ilike '%office_staff%'
                  and p.qual ilike '%read_only%'
                when 'ees_locations_office_insert' then p.cmd = 'INSERT'
                  and p.with_check ilike '%is_office_account%'
                  and p.with_check ilike '%is_account_active%'
                  and p.with_check ilike '%current_account_role%'
                  and p.with_check ilike '%admin%'
                  and p.with_check ilike '%office_staff%'
                when 'ees_locations_office_update' then p.cmd = 'UPDATE'
                  and p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.qual ilike '%current_account_role%'
                  and p.qual ilike '%admin%'
                  and p.qual ilike '%office_staff%'
                  and p.with_check ilike '%is_office_account%'
                  and p.with_check ilike '%is_account_active%'
                  and p.with_check ilike '%current_account_role%'
                  and p.with_check ilike '%admin%'
                  and p.with_check ilike '%office_staff%'
                when 'ees_locations_office_delete' then p.cmd = 'DELETE'
                  and p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.qual ilike '%current_account_role%'
                  and p.qual ilike '%admin%'
                  and p.qual ilike '%office_staff%'
                when 'ees_location_activity_own' then p.cmd = 'ALL'
                  and p.qual ilike '%auth.uid%user_id%'
                  and p.qual ilike '%is_office_account%'
                  and p.qual ilike '%is_account_active%'
                  and p.with_check ilike '%auth.uid%user_id%'
                  and p.with_check ilike '%is_office_account%'
                  and p.with_check ilike '%is_account_active%'
                else false
              end
          ) as policy_ok
        from expected_location_policies expected
      ) expected_policy_checks
    )
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename in ('ees_locations', 'ees_location_user_activity')
        and p.policyname not in (
          'ees_locations_office_read',
          'ees_locations_office_insert',
          'ees_locations_office_update',
          'ees_locations_office_delete',
          'ees_location_activity_own'
        )
    ),
    'Checks the five expected legacy Locations policies still require active office access and users can access only their own activity row.'
)
select
  check_name,
  case when coalesce(ok, false) then 'PASS' else 'FAIL' end as result,
  detail
from checks
order by check_name;
