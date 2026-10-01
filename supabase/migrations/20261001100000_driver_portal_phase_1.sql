begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'driver_portal') then
    create role driver_portal nologin noinherit;
  end if;
end
$$;

grant driver_portal to authenticator;
revoke usage on schema public from driver_portal;

create table if not exists public.driver_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  drivers_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into drivers_id_type
  from pg_attribute a
  where a.attrelid = 'public.drivers'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if drivers_id_type is null then
    raise exception 'public.drivers.id is required before installing the driver portal';
  end if;

  execute format(
    'alter table public.driver_accounts add column if not exists driver_id %s unique references public.drivers(id) on delete restrict',
    drivers_id_type
  );
end
$$;

alter table public.driver_accounts alter column driver_id set not null;
create unique index if not exists driver_accounts_driver_id_unique_idx
  on public.driver_accounts(driver_id);

create table if not exists public.driver_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_account_id uuid not null references public.driver_accounts(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists driver_sessions_active_lookup_idx
  on public.driver_sessions(token_hash, expires_at)
  where revoked_at is null;
create index if not exists driver_sessions_account_idx
  on public.driver_sessions(driver_account_id, created_at desc);

create or replace function public.set_driver_account_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_driver_account_updated_at on public.driver_accounts;
create trigger set_driver_account_updated_at
before update on public.driver_accounts
for each row execute function public.set_driver_account_updated_at();

alter table public.driver_accounts enable row level security;
alter table public.driver_sessions enable row level security;
revoke all on public.driver_accounts from anon, authenticated, driver_portal;
revoke all on public.driver_sessions from anon, authenticated, driver_portal;

do $$
declare
  drivers_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into drivers_id_type
  from pg_attribute a
  where a.attrelid = 'public.drivers'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  execute format(
    'alter table public.booking_diary add column if not exists driver_id %s references public.drivers(id) on delete set null',
    drivers_id_type
  );
end
$$;

create index if not exists booking_diary_driver_id_date_idx
  on public.booking_diary(driver_id, booking_date, pickup_time);

with unique_driver_names as (
  select lower(btrim(name)) as normalized_name, (array_agg(id order by id))[1] as driver_id
  from public.drivers
  where active = true and nullif(btrim(name), '') is not null
  group by lower(btrim(name))
  having count(*) = 1
)
update public.booking_diary booking
set driver_id = names.driver_id
from unique_driver_names names
where booking.driver_id is null
  and lower(btrim(booking.driver)) = names.normalized_name;

create or replace function public.is_office_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_access access
    where access.user_id = auth.uid()
      and access.status = 'active'
  ) and not exists (
    select 1
    from public.driver_accounts driver_account
    where driver_account.auth_user_id = auth.uid()
      and driver_account.active = true
  );
$$;

revoke all on function public.is_office_account() from public, anon, driver_portal;
grant execute on function public.is_office_account() to authenticated;

alter table public.booking_diary enable row level security;
drop policy if exists booking_diary_office_select on public.booking_diary;
drop policy if exists booking_diary_office_insert on public.booking_diary;
drop policy if exists booking_diary_office_update on public.booking_diary;
drop policy if exists booking_diary_office_delete on public.booking_diary;
create policy booking_diary_office_select on public.booking_diary
  for select to authenticated using (public.is_office_account());
create policy booking_diary_office_insert on public.booking_diary
  for insert to authenticated with check (public.is_office_account());
create policy booking_diary_office_update on public.booking_diary
  for update to authenticated using (public.is_office_account()) with check (public.is_office_account());
create policy booking_diary_office_delete on public.booking_diary
  for delete to authenticated using (public.is_office_account());

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
begin
  if exists (
    select 1
    from public.driver_accounts driver_account
    where driver_account.auth_user_id = (event->>'user_id')::uuid
      and driver_account.active = true
  ) then
    claims := event->'claims';
    claims := jsonb_set(claims, '{role}', to_jsonb('driver_portal'::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb('driver'::text));
    return jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated, driver_portal;

notify pgrst, 'reload schema';
commit;
