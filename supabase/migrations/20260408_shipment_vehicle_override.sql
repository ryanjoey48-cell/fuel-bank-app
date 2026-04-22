alter table public.shipments
  add column if not exists vehicle_type_snapshot text,
  add column if not exists used_vehicle_override boolean not null default false;

update public.shipments
set vehicle_type_snapshot = coalesce(vehicle_type_snapshot, vehicle_type)
where vehicle_type is not null
  and vehicle_type_snapshot is null;

create index if not exists shipments_used_vehicle_override_idx
  on public.shipments (used_vehicle_override);
