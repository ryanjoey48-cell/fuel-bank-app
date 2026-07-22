-- Read-only verification for Phase 3: Supabase RLS and policy status.
-- Run manually in Supabase SQL editor before approving any security migration.
-- This script does not change data, tables, policies, or privileges.

with application_tables(table_schema, table_name) as (
  values
    ('public', 'booking_diary'),
    ('public', 'clients'),
    ('public', 'saved_locations'),
    ('public', 'shipments'),
    ('public', 'trip_journeys'),
    ('public', 'trip_fuel_logs'),
    ('public', 'fuel_logs'),
    ('public', 'weekly_mileage'),
    ('public', 'vehicles'),
    ('public', 'drivers'),
    ('public', 'oil_change_baselines'),
    ('public', 'oil_change_history'),
    ('public', 'vehicle_service_logs'),
    ('public', 'support_tickets'),
    ('public', 'route_distance_estimates'),
    ('public', 'bank_transfers')
),
table_status as (
  select
    app.table_schema,
    app.table_name,
    c.oid,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced,
    c.relkind,
    case
      when c.oid is null then 'missing_table'
      when c.relrowsecurity then 'rls_enabled'
      else 'rls_disabled'
    end as rls_status
  from application_tables app
  left join pg_namespace n
    on n.nspname = app.table_schema
  left join pg_class c
    on c.relnamespace = n.oid
   and c.relname = app.table_name
   and c.relkind in ('r', 'p')
)
select
  s.table_schema,
  s.table_name,
  s.rls_status,
  s.rls_forced,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'policy_name', p.polname,
      'command', case p.polcmd
        when 'r' then 'select'
        when 'a' then 'insert'
        when 'w' then 'update'
        when 'd' then 'delete'
        when '*' then 'all'
        else p.polcmd::text
      end,
      'roles', (
        select array_agg(r.rolname order by r.rolname)
        from unnest(p.polroles) as role_oid
        join pg_roles r on r.oid = role_oid
      ),
      'using_expression', pg_get_expr(p.polqual, p.polrelid),
      'with_check_expression', pg_get_expr(p.polwithcheck, p.polrelid)
    )
    order by p.polname
  ) filter (where p.oid is not null), '[]'::jsonb) as policies
from table_status s
left join pg_policy p
  on p.polrelid = s.oid
group by
  s.table_schema,
  s.table_name,
  s.rls_status,
  s.rls_forced
order by
  case s.rls_status
    when 'missing_table' then 0
    when 'rls_disabled' then 1
    else 2
  end,
  s.table_name;

-- Anonymous-access smoke checks to run after reviewing the policy inventory:
-- 1. In a clean incognito browser, confirm protected app pages redirect to login.
-- 2. With the anon key only, REST requests to operational tables should return zero business rows or 401/403.
-- 3. Authenticated staff should still see shared company records required for daily operations.
-- 4. Admin-only mutations should be blocked unless the authenticated user has a database-backed admin role.
