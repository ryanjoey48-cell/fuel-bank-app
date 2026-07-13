begin;

create table if not exists public.oil_change_baselines (
  id uuid primary key default gen_random_uuid(),
  vehicle_reg text not null,
  last_oil_change_date date not null,
  last_odometer numeric not null,
  interval_km numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.oil_change_baselines
  add column if not exists vehicle_reg text,
  add column if not exists last_oil_change_date date,
  add column if not exists last_odometer numeric,
  add column if not exists interval_km numeric,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists oil_change_baselines_vehicle_reg_unique_idx
  on public.oil_change_baselines (vehicle_reg);

create table if not exists public.oil_change_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_reg text not null,
  oil_change_date date not null,
  odometer numeric not null,
  created_at timestamptz not null default now()
);

alter table public.oil_change_history
  add column if not exists vehicle_reg text,
  add column if not exists oil_change_date date,
  add column if not exists odometer numeric,
  add column if not exists created_at timestamptz not null default now();

create index if not exists oil_change_history_vehicle_reg_date_idx
  on public.oil_change_history (lower(btrim(vehicle_reg)), oil_change_date desc, created_at desc);

create or replace function public.set_oil_change_baselines_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_oil_change_baselines_updated_at on public.oil_change_baselines;
create trigger set_oil_change_baselines_updated_at
before update on public.oil_change_baselines
for each row
execute function public.set_oil_change_baselines_updated_at();

alter table public.oil_change_baselines enable row level security;
alter table public.oil_change_history enable row level security;

drop policy if exists "Allow authenticated read oil baselines" on public.oil_change_baselines;
drop policy if exists "Allow authenticated write oil baselines" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_select_authenticated" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_insert_authenticated" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_update_authenticated" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_delete_authenticated" on public.oil_change_baselines;

create policy "Allow authenticated read oil baselines" on public.oil_change_baselines
for select to authenticated using (true);

create policy "Allow authenticated write oil baselines" on public.oil_change_baselines
for all to authenticated using (true) with check (true);

drop policy if exists "Allow authenticated read oil history" on public.oil_change_history;
drop policy if exists "Allow authenticated write oil history" on public.oil_change_history;
drop policy if exists "oil_change_history_select_authenticated" on public.oil_change_history;
drop policy if exists "oil_change_history_insert_authenticated" on public.oil_change_history;
drop policy if exists "oil_change_history_update_authenticated" on public.oil_change_history;
drop policy if exists "oil_change_history_delete_authenticated" on public.oil_change_history;

create policy "Allow authenticated read oil history" on public.oil_change_history
for select to authenticated using (true);

create policy "Allow authenticated write oil history" on public.oil_change_history
for all to authenticated using (true) with check (true);

commit;
