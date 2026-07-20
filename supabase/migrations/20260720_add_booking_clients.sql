create or replace function public.normalize_client_name(value text)
returns text
language sql
immutable
strict
as $$
  select lower(regexp_replace(btrim(value), '\s+', ' ', 'g'));
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint clients_name_not_blank check (length(btrim(name)) > 0),
  constraint clients_normalized_name_not_blank check (length(btrim(normalized_name)) > 0)
);

create unique index if not exists clients_normalized_name_key
  on public.clients (normalized_name);

create index if not exists clients_active_name_idx
  on public.clients (active, name);

create or replace function public.set_client_normalized_name()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
    and old.normalized_name = public.normalize_client_name('Internal / Other')
    and (
      public.normalize_client_name(new.name) <> old.normalized_name
      or new.active is not true
    )
  then
    raise exception 'Internal / Other cannot be renamed or deactivated.'
      using errcode = '23514';
  end if;

  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.normalized_name := public.normalize_client_name(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_client_normalized_name on public.clients;
create trigger set_client_normalized_name
before insert or update on public.clients
for each row execute function public.set_client_normalized_name();

alter table public.clients enable row level security;

drop policy if exists "clients_select_authenticated" on public.clients;
create policy "clients_select_authenticated"
on public.clients for select
to authenticated
using (true);

drop policy if exists "clients_insert_authenticated" on public.clients;
create policy "clients_insert_authenticated"
on public.clients for insert
to authenticated
with check (created_by is null or created_by = auth.uid());

drop policy if exists "clients_update_admin" on public.clients;
create policy "clients_update_admin"
on public.clients for update
to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
)
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
);

insert into public.clients (name, normalized_name, active, created_by)
values ('Internal / Other', public.normalize_client_name('Internal / Other'), true, null)
on conflict (normalized_name) do update
set active = true;

alter table public.booking_diary
  add column if not exists client_id uuid;

alter table public.booking_diary
  drop constraint if exists booking_diary_client_id_fkey;

alter table public.booking_diary
  add constraint booking_diary_client_id_fkey
  foreign key (client_id)
  references public.clients(id)
  on delete restrict;

create index if not exists booking_diary_client_id_idx
  on public.booking_diary (client_id);

create or replace function public.require_booking_diary_client()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.client_id is null then
    raise exception 'Client name is required for new Booking Diary entries.'
      using errcode = '23502';
  end if;

  if (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    if new.client_id is null then
      raise exception 'Client name cannot be removed from a Booking Diary entry once recorded.'
        using errcode = '23502';
    end if;

    if not exists (
      select 1
      from public.clients
      where id = new.client_id
        and active = true
    ) then
      raise exception 'The selected client is inactive or does not exist.'
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists require_booking_diary_client on public.booking_diary;
create trigger require_booking_diary_client
before insert or update of client_id on public.booking_diary
for each row execute function public.require_booking_diary_client();

comment on table public.clients is 'Lightweight Booking Diary client directory.';
comment on column public.clients.normalized_name is 'Exact reporting and duplicate-prevention key; capitalization and whitespace only.';
comment on column public.booking_diary.client_id is 'Optional for historical rows; required for new rows after the client feature launch.';
