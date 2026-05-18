begin;

alter table public.weekly_mileage enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_service_logs enable row level security;

drop policy if exists "weekly_mileage_select_own" on public.weekly_mileage;
drop policy if exists "weekly_mileage_insert_own" on public.weekly_mileage;
drop policy if exists "weekly_mileage_update_own" on public.weekly_mileage;
drop policy if exists "weekly_mileage_delete_own" on public.weekly_mileage;

create policy "weekly_mileage_select_authenticated" on public.weekly_mileage
for select to authenticated using (true);

create policy "weekly_mileage_insert_authenticated" on public.weekly_mileage
for insert to authenticated with check (true);

create policy "weekly_mileage_update_authenticated" on public.weekly_mileage
for update to authenticated using (true) with check (true);

create policy "weekly_mileage_delete_authenticated" on public.weekly_mileage
for delete to authenticated using (true);

drop policy if exists "vehicles_select_own" on public.vehicles;
drop policy if exists "vehicles_insert_own" on public.vehicles;
drop policy if exists "vehicles_update_own" on public.vehicles;
drop policy if exists "vehicles_delete_own" on public.vehicles;

create policy "vehicles_select_authenticated" on public.vehicles
for select to authenticated using (true);

create policy "vehicles_insert_authenticated" on public.vehicles
for insert to authenticated with check (true);

create policy "vehicles_update_authenticated" on public.vehicles
for update to authenticated using (true) with check (true);

create policy "vehicles_delete_authenticated" on public.vehicles
for delete to authenticated using (true);

drop policy if exists "vehicle_service_logs_select_own" on public.vehicle_service_logs;
drop policy if exists "vehicle_service_logs_insert_own" on public.vehicle_service_logs;
drop policy if exists "vehicle_service_logs_update_own" on public.vehicle_service_logs;
drop policy if exists "vehicle_service_logs_delete_own" on public.vehicle_service_logs;

create policy "vehicle_service_logs_select_authenticated" on public.vehicle_service_logs
for select to authenticated using (true);

create policy "vehicle_service_logs_insert_authenticated" on public.vehicle_service_logs
for insert to authenticated with check (true);

create policy "vehicle_service_logs_update_authenticated" on public.vehicle_service_logs
for update to authenticated using (true) with check (true);

create policy "vehicle_service_logs_delete_authenticated" on public.vehicle_service_logs
for delete to authenticated using (true);

commit;
