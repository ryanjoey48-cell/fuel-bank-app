begin;

create table if not exists public.oil_change_baselines (
  id uuid primary key default gen_random_uuid(),
  vehicle_reg text not null,
  last_oil_change_date date not null,
  last_odometer numeric not null,
  interval_km numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.oil_change_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_reg text not null,
  oil_change_date date not null,
  odometer numeric not null,
  created_at timestamptz not null default now()
);

create unique index if not exists oil_change_baselines_vehicle_reg_key
  on public.oil_change_baselines (lower(btrim(vehicle_reg)));

create index if not exists oil_change_history_vehicle_reg_date_idx
  on public.oil_change_history (lower(btrim(vehicle_reg)), oil_change_date desc, created_at desc);

alter table public.oil_change_baselines enable row level security;
alter table public.oil_change_history enable row level security;

drop policy if exists "oil_change_baselines_select_authenticated" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_insert_authenticated" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_update_authenticated" on public.oil_change_baselines;
drop policy if exists "oil_change_baselines_delete_authenticated" on public.oil_change_baselines;

create policy "oil_change_baselines_select_authenticated" on public.oil_change_baselines
for select to authenticated using (true);

create policy "oil_change_baselines_insert_authenticated" on public.oil_change_baselines
for insert to authenticated with check (true);

create policy "oil_change_baselines_update_authenticated" on public.oil_change_baselines
for update to authenticated using (true) with check (true);

create policy "oil_change_baselines_delete_authenticated" on public.oil_change_baselines
for delete to authenticated using (true);

drop policy if exists "oil_change_history_select_authenticated" on public.oil_change_history;
drop policy if exists "oil_change_history_insert_authenticated" on public.oil_change_history;
drop policy if exists "oil_change_history_update_authenticated" on public.oil_change_history;
drop policy if exists "oil_change_history_delete_authenticated" on public.oil_change_history;

create policy "oil_change_history_select_authenticated" on public.oil_change_history
for select to authenticated using (true);

create policy "oil_change_history_insert_authenticated" on public.oil_change_history
for insert to authenticated with check (true);

create policy "oil_change_history_update_authenticated" on public.oil_change_history
for update to authenticated using (true) with check (true);

create policy "oil_change_history_delete_authenticated" on public.oil_change_history
for delete to authenticated using (true);

commit;
