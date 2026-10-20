-- REVIEW ONLY. The app never applies this migration.
-- Run the accompanying read-only diagnostic first. Apply only when missing/stale
-- DELETE eligibility is confirmed. This file deletes no service records.
begin;

do $$
begin
  if to_regclass('public.vehicle_service_logs') is null
     or to_regprocedure('public.current_account_role()') is null
     or to_regprocedure('public.is_account_active()') is null
     or to_regprocedure('public.is_office_account()') is null then
    raise exception 'Required service table/account-access functions are missing. Review the existing access-model migrations first.';
  end if;
  -- Never discard tenant/ownership or other restrictive policies without review.
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.vehicle_service_logs'::regclass
      and not polpermissive and polcmd in ('d', '*')
      and polname <> 'vehicle_service_logs_delete_active_business_roles'
  ) then
    raise exception 'Existing restrictive DELETE/ALL policies require review. No changes applied; inspect pg_policies before adapting this migration.';
  end if;
end;
$$;

alter table public.vehicle_service_logs enable row level security;
-- Replace the repository's previous unrestricted authenticated DELETE policy.
drop policy if exists vehicle_service_logs_delete_authenticated on public.vehicle_service_logs;
drop policy if exists vehicle_service_logs_delete_oil_service_roles on public.vehicle_service_logs;
create policy vehicle_service_logs_delete_oil_service_roles
on public.vehicle_service_logs for delete to authenticated
using (
  auth.uid() is not null
  and public.is_account_active()
  and public.is_office_account()
  and public.current_account_role() in ('admin', 'office_staff')
  and (service_type = 'oil_change' or service_type is null)
);

-- Restrictive AND guard also prevents existing permissive DELETE/ALL policies
-- from authorizing read-only, suspended or driver-only accounts.
drop policy if exists vehicle_service_logs_delete_active_business_roles on public.vehicle_service_logs;
create policy vehicle_service_logs_delete_active_business_roles
on public.vehicle_service_logs as restrictive for delete to authenticated
using (
  auth.uid() is not null
  and public.is_account_active()
  and public.is_office_account()
  and public.current_account_role() in ('admin', 'office_staff')
);

revoke delete on public.vehicle_service_logs from public, anon, driver_portal;
grant delete on public.vehicle_service_logs to authenticated;
-- SELECT policies are deliberately retained: they also constrain DELETE and
-- RETURNING visibility. Do not broaden SELECT to work around a tenant boundary.
notify pgrst, 'reload schema';
commit;
