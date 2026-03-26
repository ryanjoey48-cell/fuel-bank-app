create extension if not exists "pgcrypto";

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  vehicle_reg text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  date date not null,
  vehicle_reg text not null,
  odometer numeric(12, 2) not null,
  litres numeric(12, 2) not null,
  total_cost numeric(12, 2) not null,
  station text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  date date not null,
  vehicle_reg text not null,
  amount numeric(12, 2) not null,
  transfer_type text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.drivers enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.bank_transfers enable row level security;

drop policy if exists "drivers_select_own" on public.drivers;
create policy "drivers_select_own" on public.drivers
for select using (auth.uid() = user_id);

drop policy if exists "drivers_insert_own" on public.drivers;
create policy "drivers_insert_own" on public.drivers
for insert with check (auth.uid() = user_id);

drop policy if exists "drivers_update_own" on public.drivers;
create policy "drivers_update_own" on public.drivers
for update using (auth.uid() = user_id);

drop policy if exists "fuel_logs_select_own" on public.fuel_logs;
create policy "fuel_logs_select_own" on public.fuel_logs
for select using (auth.uid() = user_id);

drop policy if exists "fuel_logs_insert_own" on public.fuel_logs;
create policy "fuel_logs_insert_own" on public.fuel_logs
for insert with check (auth.uid() = user_id);

drop policy if exists "bank_transfers_select_own" on public.bank_transfers;
create policy "bank_transfers_select_own" on public.bank_transfers
for select using (auth.uid() = user_id);

drop policy if exists "bank_transfers_insert_own" on public.bank_transfers;
create policy "bank_transfers_insert_own" on public.bank_transfers
for insert with check (auth.uid() = user_id);

create or replace function public.set_user_id()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_driver_user_id on public.drivers;
create trigger set_driver_user_id
before insert on public.drivers
for each row execute function public.set_user_id();

drop trigger if exists set_fuel_log_user_id on public.fuel_logs;
create trigger set_fuel_log_user_id
before insert on public.fuel_logs
for each row execute function public.set_user_id();

drop trigger if exists set_bank_transfer_user_id on public.bank_transfers;
create trigger set_bank_transfer_user_id
before insert on public.bank_transfers
for each row execute function public.set_user_id();
