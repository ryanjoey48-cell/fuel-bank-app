-- Admin User Management access model.
-- Review and run manually only after preview approval. This file is not applied by the app.

create extension if not exists "pgcrypto";

create table if not exists public.account_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'office_staff' check (role in ('admin', 'office_staff', 'read_only')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_access_changed_at timestamptz,
  changed_by uuid references auth.users(id) on delete set null
);

create table if not exists public.account_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_display_name text,
  target_user_id uuid references auth.users(id) on delete set null,
  target_display_name text,
  action text not null,
  previous_role text check (previous_role is null or previous_role in ('admin', 'office_staff', 'read_only')),
  new_role text check (new_role is null or new_role in ('admin', 'office_staff', 'read_only')),
  previous_status text check (previous_status is null or previous_status in ('active', 'suspended')),
  new_status text check (new_status is null or new_status in ('active', 'suspended')),
  success boolean not null default true,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists account_access_role_status_idx on public.account_access(role, status);
create index if not exists account_access_audit_target_created_idx on public.account_access_audit(target_user_id, created_at desc);
create index if not exists account_access_audit_actor_created_idx on public.account_access_audit(actor_user_id, created_at desc);

create or replace function public.set_account_access_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_account_access_updated_at on public.account_access;
create trigger set_account_access_updated_at
before update on public.account_access
for each row
execute function public.set_account_access_updated_at();

insert into public.account_access (user_id, display_name, role, status, last_access_changed_at)
select
  users.id,
  coalesce(users.raw_user_meta_data->>'name', users.raw_user_meta_data->>'full_name', users.email),
  case
    when lower(users.email) = 'joeryan09@outlook.com' then 'admin'
    when coalesce(users.raw_app_meta_data->>'role', users.raw_user_meta_data->>'role') = 'admin' then 'admin'
    when coalesce(users.raw_app_meta_data->>'role', users.raw_user_meta_data->>'role') in ('read_only', 'read-only', 'readonly') then 'read_only'
    else 'office_staff'
  end,
  'active',
  now()
from auth.users
on conflict (user_id) do update
set
  display_name = coalesce(public.account_access.display_name, excluded.display_name),
  role = case
    when public.account_access.user_id in (select id from auth.users where lower(email) = 'joeryan09@outlook.com') then 'admin'
    else public.account_access.role
  end,
  status = case
    when public.account_access.user_id in (select id from auth.users where lower(email) = 'joeryan09@outlook.com') then 'active'
    else public.account_access.status
  end;

create or replace function public.current_account_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select account_access.role
     from public.account_access
     where account_access.user_id = auth.uid()
       and account_access.status = 'active'),
    case
      when exists (select 1 from auth.users where users.id = auth.uid() and lower(users.email) = 'joeryan09@outlook.com')
      then 'admin'
      else null
    end
  );
$$;

create or replace function public.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select account_access.status = 'active'
     from public.account_access
     where account_access.user_id = auth.uid()),
    exists (select 1 from auth.users where users.id = auth.uid() and lower(users.email) = 'joeryan09@outlook.com')
  );
$$;

create or replace function public.is_account_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_account_role() = 'admin' and public.is_account_active();
$$;

create or replace function public.is_support_ticket_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_account_admin();
$$;

alter table public.account_access enable row level security;
alter table public.account_access_audit enable row level security;

drop policy if exists "account_access_self_select" on public.account_access;
create policy "account_access_self_select"
on public.account_access for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "account_access_admin_select" on public.account_access;
create policy "account_access_admin_select"
on public.account_access for select
to authenticated
using (public.is_account_admin());

drop policy if exists "account_access_audit_admin_select" on public.account_access_audit;
create policy "account_access_audit_admin_select"
on public.account_access_audit for select
to authenticated
using (public.is_account_admin());

drop policy if exists "account_access_audit_self_select" on public.account_access_audit;
create policy "account_access_audit_self_select"
on public.account_access_audit for select
to authenticated
using (actor_user_id = auth.uid() or target_user_id = auth.uid());

drop policy if exists "clients_update_admin" on public.clients;
create policy "clients_update_admin" on public.clients for update to authenticated
using (public.is_account_admin())
with check (public.is_account_admin());

create or replace function public.get_booking_client_delete_eligibility()
returns table (
  client_id uuid,
  booking_references bigint,
  other_references bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  client_row record;
  foreign_key_row record;
  reference_count bigint;
begin
  if auth.uid() is null or not public.is_account_admin() then
    raise exception 'Admin permission required to manage clients.'
      using errcode = '42501';
  end if;

  for client_row in select id from public.clients loop
    client_id := client_row.id;
    booking_references := 0;
    other_references := 0;

    for foreign_key_row in
      select
        constraint_row.conrelid::regclass as reference_table,
        source_attribute.attname as reference_column
      from pg_catalog.pg_constraint constraint_row
      cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
      join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
        on target_key.position = source_key.position
      join pg_catalog.pg_attribute source_attribute
        on source_attribute.attrelid = constraint_row.conrelid
       and source_attribute.attnum = source_key.attnum
      join pg_catalog.pg_attribute target_attribute
        on target_attribute.attrelid = constraint_row.confrelid
       and target_attribute.attnum = target_key.attnum
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.clients'::regclass
        and target_attribute.attname = 'id'
    loop
      execute format(
        'select count(*) from %s where %I = $1',
        foreign_key_row.reference_table,
        foreign_key_row.reference_column
      )
      into reference_count
      using client_row.id;

      if foreign_key_row.reference_table = 'public.booking_diary'::regclass then
        booking_references := booking_references + reference_count;
      else
        other_references := other_references + reference_count;
      end if;
    end loop;

    return next;
  end loop;
end;
$$;

revoke all on function public.get_booking_client_delete_eligibility() from public;
grant execute on function public.get_booking_client_delete_eligibility() to authenticated;

create or replace function public.delete_unused_booking_client(target_client_id uuid)
returns table (
  deleted_id uuid,
  deleted_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_name text;
  current_normalized_name text;
  foreign_key_row record;
  has_reference boolean;
begin
  if auth.uid() is null or not public.is_account_admin() then
    raise exception 'Admin permission required to manage clients.'
      using errcode = '42501';
  end if;

  select client.name, client.normalized_name
  into current_name, current_normalized_name
  from public.clients client
  where client.id = target_client_id
  for update;

  if not found then
    raise exception 'Client no longer exists.'
      using errcode = 'P0002';
  end if;

  if current_normalized_name = public.normalize_client_name('Internal / Other') then
    raise exception 'Internal / Other cannot be deleted.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.booking_diary booking
    where booking.client_id = target_client_id
  ) then
    raise exception 'Cannot delete this client because it is used by bookings. Deactivate it instead.'
      using errcode = '23503';
  end if;

  for foreign_key_row in
    select
      constraint_row.conrelid::regclass as reference_table,
      source_attribute.attname as reference_column
    from pg_catalog.pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
    join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_attribute
      on source_attribute.attrelid = constraint_row.conrelid
     and source_attribute.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_attribute
      on target_attribute.attrelid = constraint_row.confrelid
     and target_attribute.attnum = target_key.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.clients'::regclass
      and constraint_row.conrelid <> 'public.booking_diary'::regclass
      and target_attribute.attname = 'id'
  loop
    execute format(
      'select exists(select 1 from %s where %I = $1)',
      foreign_key_row.reference_table,
      foreign_key_row.reference_column
    )
    into has_reference
    using target_client_id;

    if has_reference then
      raise exception 'Cannot delete this client because it is referenced by other records. Deactivate it instead.'
        using errcode = '23503';
    end if;
  end loop;

  delete from public.clients client
  where client.id = target_client_id
  returning client.id, client.name into deleted_id, deleted_name;

  return next;
end;
$$;

revoke all on function public.delete_unused_booking_client(uuid) from public;
grant execute on function public.delete_unused_booking_client(uuid) to authenticated;

notify pgrst, 'reload schema';
