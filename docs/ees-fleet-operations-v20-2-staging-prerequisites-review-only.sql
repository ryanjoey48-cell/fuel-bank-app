-- REVIEW ONLY. Staging-only prerequisites for an empty EES Development project.
-- Do NOT apply on production (hafoaurzfgkkwpvzedvd).
-- Required before docs/ees-locations-map-pins-review-only.sql on a greenfield staging DB.
-- Creates minimal account helpers/tables expected by Locations RLS and map-pin preflight.
-- Additive and idempotent where practical. Owner approval required.

begin;

create table if not exists public.account_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'office_staff', 'read_only', 'driver')),
  status text not null check (status in ('active', 'suspended', 'pending', 'rejected'))
);

create table if not exists public.driver_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true
);

create or replace function public.is_account_active()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_access a
    where a.user_id = auth.uid()
      and a.status = 'active'
  );
$$;

create or replace function public.current_account_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select a.role
  from public.account_access a
  where a.user_id = auth.uid()
    and a.status = 'active'
  limit 1;
$$;

create or replace function public.is_office_account()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(public.current_account_role() in ('admin', 'office_staff', 'read_only'), false);
$$;

revoke all on function public.is_account_active() from public, anon;
revoke all on function public.current_account_role() from public, anon;
revoke all on function public.is_office_account() from public, anon;
grant execute on function public.is_account_active() to authenticated, service_role;
grant execute on function public.current_account_role() to authenticated, service_role;
grant execute on function public.is_office_account() to authenticated, service_role;

alter table public.account_access enable row level security;
alter table public.driver_accounts enable row level security;

drop policy if exists account_access_self_read on public.account_access;
create policy account_access_self_read on public.account_access
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.account_access, public.driver_accounts to authenticated, service_role;
grant select, insert, update, delete on public.account_access to service_role;
grant select, insert, update, delete on public.driver_accounts to service_role;

comment on table public.account_access is
  'STAGING prerequisite stub for Fleet/Locations RLS helpers. Replace/extend with full account management schema as needed.';
comment on table public.driver_accounts is
  'STAGING prerequisite stub for map-pin service-role actor validation.';

commit;
