alter table public.fuel_logs
add column if not exists entry_source text default 'line_message';

update public.fuel_logs
set entry_source = 'line_message'
where entry_source is null or entry_source = '';

update public.fuel_logs
set entry_source = 'direct_from_receipt'
where entry_source = 'direct_receipt';

alter table public.fuel_logs
alter column entry_source set not null;

alter table public.fuel_logs
drop constraint if exists fuel_logs_entry_source_check;

alter table public.fuel_logs
add constraint fuel_logs_entry_source_check
check (entry_source in ('line_message', 'direct_from_receipt', 'other'));

notify pgrst, 'reload schema';
