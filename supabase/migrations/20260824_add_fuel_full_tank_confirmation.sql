alter table public.fuel_logs
  add column if not exists full_tank_confirmed boolean not null default false,
  add column if not exists full_tank_confirmed_at timestamptz null;

comment on column public.fuel_logs.full_tank_confirmed is
  'True only when the fuel entry was confirmed as a full-tank fill and may be used as a verified vehicle fuel-cycle boundary.';

comment on column public.fuel_logs.full_tank_confirmed_at is
  'Timestamp when the full-tank boundary was confirmed. Historical fuel logs are not backfilled.';
