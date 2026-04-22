alter table public.drivers
  add column if not exists assigned_vehicle_id uuid,
  add column if not exists active boolean not null default true,
  add column if not exists company_id uuid;

alter table public.drivers
  drop constraint if exists drivers_assigned_vehicle_id_fkey;

alter table public.drivers
  add constraint drivers_assigned_vehicle_id_fkey
  foreign key (assigned_vehicle_id) references public.vehicles(id) on delete set null;

alter table public.shipments
  add column if not exists driver_name_snapshot text,
  add column if not exists vehicle_reg_snapshot text;

update public.shipments
set driver_name_snapshot = coalesce(driver_name_snapshot, driver)
where driver_name_snapshot is null
  and driver is not null;

update public.shipments
set vehicle_reg_snapshot = coalesce(vehicle_reg_snapshot, vehicle_reg)
where vehicle_reg_snapshot is null
  and vehicle_reg is not null;

create index if not exists drivers_assigned_vehicle_id_idx
  on public.drivers (assigned_vehicle_id);

notify pgrst, 'reload schema';
