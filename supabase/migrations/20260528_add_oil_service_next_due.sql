alter table public.vehicle_service_logs
  add column if not exists next_service_due_odometer numeric(12, 2);

update public.vehicle_service_logs
set next_service_due_odometer = odometer + interval_km
where next_service_due_odometer is null
  and odometer is not null
  and interval_km is not null;
