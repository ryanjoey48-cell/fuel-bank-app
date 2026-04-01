begin;

do $$
declare
  drivers_id_type text;
  auth_users_id_type text;
  legacy_mileage_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into drivers_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'drivers'
    and a.attname = 'id'
    and not a.attisdropped;

  if drivers_id_type is null then
    raise exception 'Could not determine public.drivers.id data type';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into auth_users_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth'
    and c.relname = 'users'
    and a.attname = 'id'
    and not a.attisdropped;

  if auth_users_id_type is null then
    raise exception 'Could not determine auth.users.id data type';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into legacy_mileage_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'weekly_mileage'
    and a.attname = 'mileage'
    and not a.attisdropped;

  if legacy_mileage_type is null then
    legacy_mileage_type := 'bigint';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'driver_id'
  ) then
    execute format(
      'alter table public.weekly_mileage add column driver_id %s',
      drivers_id_type
    );
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'user_id'
  ) then
    execute format(
      'alter table public.weekly_mileage add column user_id %s',
      auth_users_id_type
    );
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'odometer_reading'
  ) then
    execute format(
      'alter table public.weekly_mileage add column odometer_reading %s',
      legacy_mileage_type
    );
  end if;
end
$$;

update public.weekly_mileage wm
set driver_id = d.id
from public.drivers d
where wm.driver_id is null
  and (
    (wm.driver is not null and lower(btrim(wm.driver)) = lower(btrim(d.name)))
    or (
      wm.vehicle_reg is not null
      and lower(btrim(wm.vehicle_reg)) = lower(btrim(d.vehicle_reg))
    )
  );

update public.weekly_mileage wm
set odometer_reading = wm.mileage
where wm.odometer_reading is null
  and wm.mileage is not null;

update public.weekly_mileage wm
set mileage = wm.odometer_reading
where wm.mileage is null
  and wm.odometer_reading is not null;

update public.weekly_mileage wm
set user_id = d.user_id
from public.drivers d
where wm.user_id is null
  and wm.driver_id = d.id;

alter table public.weekly_mileage
  drop constraint if exists weekly_mileage_driver_id_fkey;

alter table public.weekly_mileage
  add constraint weekly_mileage_driver_id_fkey
  foreign key (driver_id) references public.drivers(id) on delete set null;

create index if not exists weekly_mileage_driver_id_idx
  on public.weekly_mileage (driver_id);

create index if not exists weekly_mileage_week_ending_idx
  on public.weekly_mileage (week_ending desc);

create or replace function public.sync_weekly_mileage_driver_snapshot()
returns trigger
language plpgsql
as $$
declare
  matched_name text;
  matched_vehicle_reg text;
  matched_user_id public.weekly_mileage.user_id%type;
begin
  if new.driver_id is not null then
    select name, vehicle_reg, user_id
      into matched_name, matched_vehicle_reg, matched_user_id
    from public.drivers
    where id = new.driver_id;

    if matched_name is not null then
      new.driver := matched_name;
    end if;

    if (new.vehicle_reg is null or btrim(new.vehicle_reg) = '') and matched_vehicle_reg is not null then
      new.vehicle_reg := matched_vehicle_reg;
    end if;

    if new.user_id is null and matched_user_id is not null then
      new.user_id := matched_user_id;
    end if;
  end if;

  if new.odometer_reading is null and new.mileage is not null then
    new.odometer_reading := new.mileage;
  end if;

  if new.mileage is null and new.odometer_reading is not null then
    new.mileage := new.odometer_reading;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_weekly_mileage_driver_snapshot on public.weekly_mileage;

create trigger sync_weekly_mileage_driver_snapshot
before insert or update on public.weekly_mileage
for each row execute function public.sync_weekly_mileage_driver_snapshot();

comment on column public.weekly_mileage.driver_id is 'Relational link to public.drivers.id';
comment on column public.weekly_mileage.odometer_reading is 'Canonical weekly odometer value used by the app';

commit;
