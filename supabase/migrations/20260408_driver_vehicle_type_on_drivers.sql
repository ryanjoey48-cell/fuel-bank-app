alter table public.drivers
  add column if not exists vehicle_type text;

create index if not exists drivers_vehicle_type_idx
  on public.drivers (vehicle_type);
