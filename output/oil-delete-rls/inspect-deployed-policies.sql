-- READ ONLY. Run in the project's SQL Editor, then paste the results.
select current_database(), current_user,
       c.relrowsecurity, c.relforcerowsecurity
from pg_class c where c.oid = 'public.vehicle_service_logs'::regclass;
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
  and tablename = 'vehicle_service_logs' order by cmd, policyname;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'vehicle_service_logs'
  and privilege_type in ('SELECT', 'DELETE') order by grantee, privilege_type;
select p.oid::regprocedure as helper,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p where p.oid in (
  to_regprocedure('public.current_account_role()'),
  to_regprocedure('public.is_account_active()'),
  to_regprocedure('public.is_office_account()')
);
select tgname, tgenabled, pg_get_triggerdef(oid) as definition,
       tgfoid::regprocedure as trigger_function
from pg_trigger where tgrelid = 'public.vehicle_service_logs'::regclass
  and not tgisinternal;
select id, vehicle_reg, service_type, service_date, odometer, user_id
from public.vehicle_service_logs where id in (
  '160dd57f-82a1-4834-a896-e9a7fa3d06bd',
  '388afff7-6421-483b-a754-da56b2f1b0ca',
  'ed4196f7-b1f5-4676-a438-ff06728c8b0f'
) order by service_date;
-- SQL Editor runs as postgres, not the browser's JWT user. auth.uid()/auth.role()
-- here do not prove the application's current session or its effective role.
