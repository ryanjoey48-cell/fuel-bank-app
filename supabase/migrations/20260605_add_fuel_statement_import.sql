alter table public.fuel_logs
  alter column driver_id drop not null;

alter table public.fuel_logs
  drop constraint if exists fuel_logs_driver_id_fkey;

alter table public.fuel_logs
  add constraint fuel_logs_driver_id_fkey
  foreign key (driver_id) references public.drivers(id) on delete set null;

alter table public.fuel_logs
  drop constraint if exists fuel_logs_entry_source_check;

update public.fuel_logs
set entry_source = 'line_message'
where entry_source is null or btrim(entry_source) = '';

alter table public.fuel_logs
  alter column entry_source set default 'line_message',
  alter column entry_source set not null;

alter table public.fuel_logs
  add constraint fuel_logs_entry_source_check
  check (entry_source in ('line_message', 'direct_from_receipt', 'statement_import', 'other'));

create index if not exists fuel_logs_statement_import_idx
  on public.fuel_logs (user_id, entry_source, date desc)
  where entry_source = 'statement_import';
