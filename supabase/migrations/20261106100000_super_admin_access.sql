-- Prepared for owner review. Do not apply to production without approval.
-- Promotes only the single confirmed Supabase Auth account named below.
begin;

do $$
declare
  target_user_id uuid;
  verified_count integer;
  existing_role text;
  existing_status text;
begin
  if to_regclass('public.account_access') is null
    or to_regclass('public.account_access_audit') is null
    or to_regclass('public.finance_role_grants') is null
    or to_regprocedure('public.current_account_role()') is null then
    raise exception 'Apply and verify the account-access and Finance authorization migrations first.';
  end if;

  select count(*), min(users.id::text)::uuid
  into verified_count, target_user_id
  from auth.users users
  where lower(users.email) = 'joeryan09@outlook.com'
    and users.email_confirmed_at is not null;

  if verified_count <> 1 or target_user_id is null then
    raise exception 'Expected exactly one email-confirmed Supabase Auth account for the designated EES owner.';
  end if;

  select access.role, access.status
  into existing_role, existing_status
  from public.account_access access
  where access.user_id = target_user_id;

  if existing_status = 'suspended' then
    raise exception 'The designated account is suspended; resolve that status explicitly before granting Super Admin access.';
  end if;

  alter table public.account_access drop constraint if exists account_access_role_check;
  alter table public.account_access add constraint account_access_role_check
    check (role in ('super_admin', 'admin', 'office_staff', 'read_only'));

  alter table public.account_access_audit drop constraint if exists account_access_audit_previous_role_check;
  alter table public.account_access_audit add constraint account_access_audit_previous_role_check
    check (previous_role is null or previous_role in ('super_admin', 'admin', 'office_staff', 'read_only'));
  alter table public.account_access_audit drop constraint if exists account_access_audit_new_role_check;
  alter table public.account_access_audit add constraint account_access_audit_new_role_check
    check (new_role is null or new_role in ('super_admin', 'admin', 'office_staff', 'read_only'));

  insert into public.account_access (
    user_id, display_name, role, status, last_access_changed_at, changed_by
  )
  select target_user_id,
    coalesce(nullif(btrim(access.display_name), ''), 'Joey Ryan'),
    'super_admin',
    'active',
    now(),
    null
  from (select 1) seed
  left join public.account_access access on access.user_id = target_user_id
  on conflict (user_id) do update set
    role = 'super_admin',
    last_access_changed_at = now(),
    changed_by = null;

  insert into public.account_access_audit (
    actor_user_id, actor_display_name, target_user_id, target_display_name,
    action, previous_role, new_role, previous_status, new_status, success
  )
  values (
    null, 'Database migration', target_user_id, 'Joey Ryan',
    'designated_super_admin_grant',
    existing_role,
    'super_admin',
    existing_status,
    'active',
    true
  );

  insert into public.finance_role_grants (user_id, capability, granted_by)
  select target_user_id, capability, null
  from unnest(array[
    'management_reviewer',
    'finance_reviewer',
    'invoice_approver',
    'expense_approver',
    'pricing_approver',
    'expense_recorder'
  ]::text[]) as capabilities(capability)
  on conflict (user_id, capability) do nothing;
end;
$$;

create or replace function public.current_account_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when account_access.role = 'super_admin' then 'admin' else account_access.role end
  from public.account_access
  where account_access.user_id = auth.uid()
    and account_access.status = 'active';
$$;

revoke all on function public.current_account_role() from public, anon;
grant execute on function public.current_account_role() to authenticated;

notify pgrst, 'reload schema';
commit;
