alter table public.fuel_logs
  add column if not exists entry_source text not null default 'line_message';

alter table public.fuel_logs
  drop constraint if exists fuel_logs_entry_source_check;

update public.fuel_logs
set entry_source = 'direct_from_receipt'
where entry_source = 'direct_receipt';

update public.fuel_logs
set entry_source = 'line_message'
where entry_source is null or btrim(entry_source) = '';

alter table public.fuel_logs
  add constraint fuel_logs_entry_source_check
  check (entry_source in ('line_message', 'direct_from_receipt', 'other'));

create index if not exists fuel_logs_entry_source_idx
  on public.fuel_logs (user_id, entry_source, date desc);

notify pgrst, 'reload schema';
