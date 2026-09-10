begin;

alter table public.vehicle_service_logs enable row level security;

drop policy if exists "vehicle_service_logs_delete_own" on public.vehicle_service_logs;
drop policy if exists "vehicle_service_logs_delete_authenticated" on public.vehicle_service_logs;

create policy "vehicle_service_logs_delete_authenticated" on public.vehicle_service_logs
for delete to authenticated using (true);

comment on table public.vehicle_service_logs is
  'Separate vehicle maintenance and oil-change service events. These rows must not create or update weekly_mileage rows.';

comment on table public.weekly_mileage is
  'Normal weekly vehicle odometer readings only. Oil changes are stored separately in vehicle_service_logs.';

commit;
