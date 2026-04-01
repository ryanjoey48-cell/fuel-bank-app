create extension if not exists "pgcrypto";

alter table public.fuel_logs
  add column if not exists price_per_litre numeric(12, 2),
  add column if not exists fuel_type text,
  add column if not exists payment_method text;

alter table public.fuel_logs
  alter column odometer drop not null;

create table if not exists public.weekly_mileage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  week_ending date not null,
  vehicle_reg text not null,
  odometer_reading bigint not null,
  created_at timestamptz not null default now()
);

create unique index if not exists weekly_mileage_user_vehicle_week_key
  on public.weekly_mileage (user_id, vehicle_reg, week_ending);

create index if not exists weekly_mileage_driver_id_idx
  on public.weekly_mileage (driver_id);

create index if not exists weekly_mileage_week_ending_idx
  on public.weekly_mileage (week_ending desc);

alter table public.drivers enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.bank_transfers enable row level security;
alter table public.weekly_mileage enable row level security;

drop policy if exists "drivers_delete_own" on public.drivers;
create policy "drivers_delete_own" on public.drivers
for delete using (auth.uid() = user_id);

drop policy if exists "fuel_logs_update_own" on public.fuel_logs;
create policy "fuel_logs_update_own" on public.fuel_logs
for update using (auth.uid() = user_id);

drop policy if exists "fuel_logs_delete_own" on public.fuel_logs;
create policy "fuel_logs_delete_own" on public.fuel_logs
for delete using (auth.uid() = user_id);

drop policy if exists "bank_transfers_update_own" on public.bank_transfers;
create policy "bank_transfers_update_own" on public.bank_transfers
for update using (auth.uid() = user_id);

drop policy if exists "bank_transfers_delete_own" on public.bank_transfers;
create policy "bank_transfers_delete_own" on public.bank_transfers
for delete using (auth.uid() = user_id);

drop policy if exists "weekly_mileage_select_own" on public.weekly_mileage;
create policy "weekly_mileage_select_own" on public.weekly_mileage
for select using (auth.uid() = user_id);

drop policy if exists "weekly_mileage_insert_own" on public.weekly_mileage;
create policy "weekly_mileage_insert_own" on public.weekly_mileage
for insert with check (auth.uid() = user_id);

drop policy if exists "weekly_mileage_update_own" on public.weekly_mileage;
create policy "weekly_mileage_update_own" on public.weekly_mileage
for update using (auth.uid() = user_id);

drop policy if exists "weekly_mileage_delete_own" on public.weekly_mileage;
create policy "weekly_mileage_delete_own" on public.weekly_mileage
for delete using (auth.uid() = user_id);

drop trigger if exists set_weekly_mileage_user_id on public.weekly_mileage;
create trigger set_weekly_mileage_user_id
before insert on public.weekly_mileage
for each row execute function public.set_user_id();

notify pgrst, 'reload schema';
