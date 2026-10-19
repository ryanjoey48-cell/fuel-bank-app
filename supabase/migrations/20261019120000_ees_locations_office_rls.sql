-- Harden the existing EES Locations policies without changing table structure.
-- This migration assumes the tables and policies from
-- 20261019100000_ees_locations_directory.sql already exist.
begin;

do $migration$
begin
  if to_regclass('public.ees_locations') is null then
    raise exception 'Expected public.ees_locations to exist before applying the Locations RLS hardening migration.';
  end if;

  if to_regclass('public.ees_location_user_activity') is null then
    raise exception 'Expected public.ees_location_user_activity to exist before applying the Locations RLS hardening migration.';
  end if;

  if to_regprocedure('public.is_office_account()') is null then
    raise exception 'Expected public.is_office_account() to exist before applying the Locations RLS hardening migration.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ees_locations'
      and policyname = 'ees_locations_office_read'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ees_locations'
      and policyname = 'ees_locations_office_insert'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ees_locations'
      and policyname = 'ees_locations_office_update'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ees_locations'
      and policyname = 'ees_locations_office_delete'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ees_location_user_activity'
      and policyname = 'ees_location_activity_own'
  ) then
    raise exception 'Expected existing EES Locations policies were not found; no policy changes were applied.';
  end if;
end;
$migration$;

alter policy ees_locations_office_read on public.ees_locations
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

alter policy ees_locations_office_insert on public.ees_locations
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  );

alter policy ees_locations_office_update on public.ees_locations
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  )
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  );

alter policy ees_locations_office_delete on public.ees_locations
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  );

-- Activity remains limited to the signed-in user's own row and is now also
-- restricted to active office accounts, matching the Locations API.
alter policy ees_location_activity_own on public.ees_location_user_activity
  using (
    auth.uid() = user_id
    and public.is_account_active()
    and public.is_office_account()
  )
  with check (
    auth.uid() = user_id
    and public.is_account_active()
    and public.is_office_account()
  );

commit;
