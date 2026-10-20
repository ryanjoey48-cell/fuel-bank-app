-- REVIEW ONLY — NOT AN ACTIVE MIGRATION.
-- Do not execute in Supabase or move into supabase/migrations without approval.
--
-- Proposed additive storage for manually confirmed destination and truck-entry
-- pins, plus an append-only coordinate change history. Existing EES tables other
-- than ees_locations as a foreign-key target are not altered by this proposal.
-- Application/API work must set updated_by to the verified caller's auth user id.

begin;

create table if not exists public.ees_location_map_pins (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.ees_locations(id) on delete cascade,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  pin_status text not null check (pin_status in ('ambiguous', 'provider_matched', 'manual_confirmed')),
  coordinate_source text not null check (length(btrim(coordinate_source)) > 0),
  source_reference text,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, pin_type)
);

create index if not exists ees_location_map_pins_location_idx
  on public.ees_location_map_pins (location_id, pin_type);

create table if not exists public.ees_location_map_pin_history (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid,
  location_id uuid,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  action text not null check (action in ('insert', 'update', 'delete')),
  old_latitude double precision,
  old_longitude double precision,
  old_pin_status text,
  new_latitude double precision,
  new_longitude double precision,
  new_pin_status text,
  coordinate_source text,
  source_reference text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.ees_location_map_pins enable row level security;
alter table public.ees_location_map_pin_history enable row level security;

drop policy if exists ees_location_map_pins_read on public.ees_location_map_pins;
create policy ees_location_map_pins_read on public.ees_location_map_pins
  for select to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

drop policy if exists ees_location_map_pins_insert on public.ees_location_map_pins;
create policy ees_location_map_pins_insert on public.ees_location_map_pins
  for insert to authenticated
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
    and updated_by = auth.uid()
  );

drop policy if exists ees_location_map_pins_update on public.ees_location_map_pins;
create policy ees_location_map_pins_update on public.ees_location_map_pins
  for update to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  )
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
    and updated_by = auth.uid()
  );

drop policy if exists ees_location_map_pins_delete on public.ees_location_map_pins;
create policy ees_location_map_pins_delete on public.ees_location_map_pins
  for delete to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  );

drop policy if exists ees_location_map_pin_history_read on public.ees_location_map_pin_history;
create policy ees_location_map_pin_history_read on public.ees_location_map_pin_history
  for select to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

create or replace function public.audit_ees_location_map_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ees_location_map_pin_history (
      pin_id, location_id, pin_type, action, new_latitude, new_longitude,
      new_pin_status, coordinate_source, source_reference, changed_by
    ) values (
      new.id, new.location_id, new.pin_type, 'insert', new.latitude, new.longitude,
      new.pin_status, new.coordinate_source, new.source_reference, new.updated_by
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if row(old.location_id, old.pin_type, old.latitude, old.longitude, old.pin_status, old.coordinate_source, old.source_reference)
       is distinct from
       row(new.location_id, new.pin_type, new.latitude, new.longitude, new.pin_status, new.coordinate_source, new.source_reference) then
      insert into public.ees_location_map_pin_history (
        pin_id, location_id, pin_type, action, old_latitude, old_longitude,
        old_pin_status, new_latitude, new_longitude, new_pin_status,
        coordinate_source, source_reference, changed_by
      ) values (
        new.id, new.location_id, new.pin_type, 'update', old.latitude, old.longitude,
        old.pin_status, new.latitude, new.longitude, new.pin_status,
        new.coordinate_source, new.source_reference, new.updated_by
      );
    end if;
    return new;
  else
    insert into public.ees_location_map_pin_history (
      pin_id, location_id, pin_type, action, old_latitude, old_longitude,
      old_pin_status, coordinate_source, source_reference, changed_by
    ) values (
      old.id, old.location_id, old.pin_type, 'delete', old.latitude, old.longitude,
      old.pin_status, old.coordinate_source, old.source_reference, auth.uid()
    );
    return old;
  end if;
end;
$$;

drop trigger if exists ees_location_map_pin_audit on public.ees_location_map_pins;
create trigger ees_location_map_pin_audit
  after insert or update or delete on public.ees_location_map_pins
  for each row execute function public.audit_ees_location_map_pin();

grant select, insert, update, delete on public.ees_location_map_pins to authenticated;
grant select on public.ees_location_map_pin_history to authenticated;

commit;

-- Before activation, review the selected geocoding/map provider's permission to
-- persist coordinates. Google Geocoding coordinates are not suitable for this
-- long-term table without an applicable storage right; Google Place IDs are the
-- stated durable identifier. Manual confirmations or a provider contract that
-- permits storage should be used for persistent pins.
