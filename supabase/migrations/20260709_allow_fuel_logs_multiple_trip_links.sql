alter table public.trip_fuel_logs
  add column if not exists link_type text default 'confirmed',
  add column if not exists notes text,
  add column if not exists created_by uuid;

drop index if exists public.trip_fuel_logs_fuel_log_unique_idx;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'trip_fuel_logs'
      and c.contype = 'u'
      and array_length(c.conkey, 1) = 1
      and c.conkey[1] = (
        select a.attnum
        from pg_attribute a
        where a.attrelid = t.oid
          and a.attname = 'fuel_log_id'
          and not a.attisdropped
      )
  loop
    execute format('alter table public.trip_fuel_logs drop constraint if exists %I', constraint_record.conname);
  end loop;
end $$;

do $$
declare
  index_record record;
begin
  for index_record in
    select i.relname
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'trip_fuel_logs'
      and ix.indisunique
      and ix.indnkeyatts = 1
      and ix.indkey[0] = (
        select a.attnum
        from pg_attribute a
        where a.attrelid = t.oid
          and a.attname = 'fuel_log_id'
          and not a.attisdropped
      )
  loop
    execute format('drop index if exists public.%I', index_record.relname);
  end loop;
end $$;

create unique index if not exists trip_fuel_logs_trip_fuel_unique_idx
  on public.trip_fuel_logs (trip_journey_id, fuel_log_id);

create index if not exists trip_fuel_logs_link_type_idx
  on public.trip_fuel_logs (link_type);

notify pgrst, 'reload schema';
