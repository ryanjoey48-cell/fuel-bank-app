-- Additive inspection ledger. Apply manually after schema review. No financial/service rows modified.
begin;
create table if not exists public.maintenance_vehicle_checks (
 id uuid primary key default gen_random_uuid(), request_id uuid not null, request_hash text not null,
 vehicle_id uuid not null references public.vehicles(id) on delete restrict,
 service_key text not null check(length(btrim(service_key)) between 1 and 200),
 item_name text not null check(length(btrim(item_name)) between 1 and 200),
 check_date date not null check(check_date>=date '1900-01-01'),
 odometer numeric(12,2) check(odometer between 0 and 9999999999.99),
 result text not null check(result in ('not_checked','ok','attention','not_applicable')),
 notes text check(length(notes)<=2000),
 maintenance_record_id uuid references public.maintenance_records(id) on delete restrict,
 checked_by uuid not null references auth.users(id) on delete restrict,
 checked_by_name text not null, created_at timestamptz not null default clock_timestamp(),
 unique(request_id,service_key)
);
create index if not exists maintenance_checks_vehicle_history on public.maintenance_vehicle_checks(vehicle_id,service_key,check_date desc,created_at desc);
alter table public.maintenance_vehicle_checks enable row level security;
do $policy$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='maintenance_vehicle_checks' and policyname='maintenance_checks_office_read') then create policy maintenance_checks_office_read on public.maintenance_vehicle_checks for select to authenticated using(public.is_account_active() and public.is_office_account()); end if; end $policy$;
do $policy$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='maintenance_vehicle_checks' and policyname='maintenance_checks_office_guard') then create policy maintenance_checks_office_guard on public.maintenance_vehicle_checks as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account()); end if; end $policy$;
revoke all on public.maintenance_vehicle_checks from public,anon,authenticated;
grant select on public.maintenance_vehicle_checks to authenticated;
create or replace function public.maintenance_checks_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin raise exception 'MAINTENANCE_CHECK_HISTORY_IMMUTABLE';end$$;
do $trigger$ begin if not exists(select 1 from pg_trigger where tgname='maintenance_checks_history' and tgrelid='public.maintenance_vehicle_checks'::regclass) then create trigger maintenance_checks_history before update or delete on public.maintenance_vehicle_checks for each row execute function public.maintenance_checks_immutable(); end if; end $trigger$;
create or replace function public.maintenance_vehicle_checks_version() returns integer language sql stable as $$select 1$$;
revoke all on function public.maintenance_vehicle_checks_version() from public;
grant execute on function public.maintenance_vehicle_checks_version() to authenticated;
create or replace function public.save_maintenance_vehicle_checks(target_vehicle uuid,check_date date,check_odometer numeric,check_rows jsonb,request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();request_fingerprint text;existing_hash text;existing_actor uuid;entry jsonb;actor_name text;rid uuid;
begin
 if actor is null or not public.is_account_active() or not public.is_office_account() or public.current_account_role() not in ('admin','office_staff') then raise exception 'MAINTENANCE_FORBIDDEN';end if;
 if request_id is null or target_vehicle is null or not exists(select 1 from public.vehicles where id=target_vehicle) then raise exception 'MAINTENANCE_VEHICLE';end if;
 if check_date is null or check_date<date '1900-01-01' or check_date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'MAINTENANCE_CHECK_DATE';end if;
 if jsonb_typeof(check_rows) is distinct from 'array' or jsonb_array_length(check_rows)<1 or jsonb_array_length(check_rows)>100 then raise exception 'MAINTENANCE_CHECK_ITEMS';end if;
 if check_odometer is not null and (check_odometer<0 or check_odometer>9999999999.99) then raise exception 'MAINTENANCE_CHECK_ODOMETER';end if;
 request_fingerprint:=md5(jsonb_build_object('vehicle',target_vehicle,'date',check_date,'odometer',check_odometer,'rows',check_rows)::text);
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,4));
 select c.request_hash,c.checked_by into existing_hash,existing_actor from public.maintenance_vehicle_checks c where c.request_id=save_maintenance_vehicle_checks.request_id limit 1;
 if found then
  if existing_hash<>request_fingerprint or existing_actor<>actor then raise exception 'MAINTENANCE_CHECK_REQUEST_REUSED';end if;
  return (select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.maintenance_vehicle_checks c where c.request_id=save_maintenance_vehicle_checks.request_id);
 end if;
 if exists(select 1 from jsonb_array_elements(check_rows) e group by e->>'service_key' having count(*)>1) then raise exception 'MAINTENANCE_CHECK_DUPLICATE';end if;
 select coalesce(nullif(btrim(a.display_name),''),u.email,actor::text) into actor_name from auth.users u left join public.account_access a on a.user_id=u.id where u.id=actor;
 for entry in select value from jsonb_array_elements(check_rows) loop
  rid:=nullif(entry->>'maintenance_record_id','')::uuid;
  if rid is not null and not exists(select 1 from public.maintenance_records r where r.id=rid and r.vehicle_id=target_vehicle and not r.is_deleted and r.service_date<=check_date) then raise exception 'MAINTENANCE_CHECK_RECORD_SCOPE';end if;
  insert into public.maintenance_vehicle_checks(request_id,request_hash,vehicle_id,service_key,item_name,check_date,odometer,result,notes,maintenance_record_id,checked_by,checked_by_name)
  values(request_id,request_fingerprint,target_vehicle,btrim(entry->>'service_key'),btrim(entry->>'item_name'),check_date,check_odometer,entry->>'result',nullif(btrim(entry->>'notes'),''),rid,actor,actor_name);
 end loop;
 return (select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.maintenance_vehicle_checks c where c.request_id=save_maintenance_vehicle_checks.request_id);
end$$;
revoke all on function public.save_maintenance_vehicle_checks(uuid,date,numeric,jsonb,uuid) from public;
grant execute on function public.save_maintenance_vehicle_checks(uuid,date,numeric,jsonb,uuid) to authenticated;
comment on table public.maintenance_vehicle_checks is 'Append-only office inspection outcomes. Never replacement events or financial visits. Corrections are recorded as new checks.';
notify pgrst,'reload schema';
commit;
