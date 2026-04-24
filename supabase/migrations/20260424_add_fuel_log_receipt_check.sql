alter table public.fuel_logs
  add column if not exists receipt_checked boolean not null default false,
  add column if not exists receipt_checked_at timestamptz null;
