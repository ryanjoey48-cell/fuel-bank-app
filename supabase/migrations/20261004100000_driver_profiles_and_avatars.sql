begin;

-- Portal authentication is an opaque HttpOnly cookie, not a Supabase browser JWT.
-- Future profile APIs must verify that cookie and derive auth_user_id server-side.
-- Do not grant direct browser access or mutate operational public.drivers fields.
create table public.driver_profiles (
  auth_user_id uuid primary key
    references public.driver_accounts(auth_user_id) on delete cascade,
  display_name text check (
    display_name is null or
    (length(btrim(display_name)) between 1 and 100 and display_name = btrim(display_name))
  ),
  phone text check (
    phone is null or
    (length(btrim(phone)) between 1 and 30 and phone = btrim(phone))
  ),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Server-generated immutable object names; replacements use a new object UUID.
  -- Prevent cross-account paths, traversal and unsupported extensions.
  constraint driver_profiles_own_avatar_path check (
    avatar_path is null or
    avatar_path ~ ('^' || auth_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  )
);

alter table public.driver_profiles enable row level security;
revoke all on public.driver_profiles from public, anon, authenticated, driver_portal, service_role;
-- Trusted server APIs only. No direct driver JWT policies: that is not portal auth.
grant select, insert, update on public.driver_profiles to service_role;
-- No deletion grant; no API for changing official identity or account linkage.

create function public.set_driver_profile_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_driver_profile_updated_at() from public, anon, authenticated, driver_portal;
create trigger driver_profiles_updated_at
before update on public.driver_profiles
for each row execute function public.set_driver_profile_updated_at();

-- Refuse to repurpose an existing bucket or overwrite its configuration.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'driver-avatars') then
    raise exception 'driver-avatars already exists; inspect its security configuration before applying this migration';
  end if;
end;
$$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-avatars', 'driver-avatars', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']);

-- Intentionally no authenticated/driver_portal storage policies. Uploads and short-lived
-- signed reads must be issued server-side after verified own-profile/admin authorization.
-- API implementation must also validate actual image bytes, size, and allowed fields;
-- bucket MIME declarations alone are not adequate file-content validation.
-- Existing unrelated bucket policies and all bookings/events/accounts remain unchanged.
-- Language preference reuses the existing fuel-bank-language local storage system.
-- No password, auth token, email copy, driver ID copy or operational name is stored here.

notify pgrst, 'reload schema';
commit;
