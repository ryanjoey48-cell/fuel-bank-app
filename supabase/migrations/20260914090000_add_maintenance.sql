-- Standalone unified Maintenance migration for a clean Maintenance environment.
-- Prerequisites: existing vehicles, auth/storage schemas and account-access helpers.
-- Production was provisioned manually: do not replay this file there.
-- The legacy grease schema is independent and is not modified or required here.
begin;
create table public.maintenance_records (
 id uuid primary key default gen_random_uuid(),
 vehicle_id uuid not null references public.vehicles(id) on delete restrict,
 service_date date not null check(service_date >= date '1900-01-01'),
 odometer numeric(12,2) check(odometer between 0 and 9999999999.99),
 garage text, receipt_reference text, receipt_total numeric(12,2) check(receipt_total between 0 and 9999999999.99),
 calculated_total numeric(12,2) not null default 0 check(calculated_total >= 0),
 mismatch_confirmed boolean not null default false, notes text,
 off_road_at timestamptz, returned_at timestamptz,
 is_deleted boolean not null default false,
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id) on delete restrict, updated_at timestamptz not null default now(),
 check(returned_at is null or (off_road_at is not null and returned_at >= off_road_at))
);
create table public.maintenance_requirements (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 200),
 category text not null check(category in ('grease','oil','brakes','tyres','battery','engine','transmission','suspension','steering','electrical','inspection','labour','other')),
 vehicle_type text, frequency_months integer check(frequency_months between 1 and 1200),
 mileage_interval numeric(12,2) check(mileage_interval > 0 and mileage_interval <= 9999999999.99),
 warning_days integer not null default 30 check(warning_days between 0 and 3650),
 warning_km numeric(12,2) not null default 1000 check(warning_km between 0 and 9999999999.99),
 active boolean not null default true, notes text,
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id) on delete restrict, updated_at timestamptz not null default now(),
 check(frequency_months is not null or mileage_interval is not null)
);
create table public.maintenance_requirement_vehicles (
 requirement_id uuid not null references public.maintenance_requirements(id) on delete restrict,
 vehicle_id uuid not null references public.vehicles(id) on delete restrict,
 primary key(requirement_id,vehicle_id)
);
create table public.maintenance_items (
 id uuid primary key default gen_random_uuid(), record_id uuid not null references public.maintenance_records(id) on delete restrict,
 position integer not null check(position >= 0), description text not null check(length(btrim(description)) between 1 and 500),
 description_th text, category text not null check(category in ('grease','oil','brakes','tyres','battery','engine','transmission','suspension','steering','electrical','inspection','labour','other')),
 quantity numeric(10,2) not null default 1 check(quantity between 0 and 1000000),
 unit_price numeric(12,2) not null default 0 check(unit_price between 0 and 100000000), notes text,
 requirement_id uuid references public.maintenance_requirements(id) on delete restrict,
 reminder_months integer check(reminder_months between 1 and 1200),
 reminder_km numeric(12,2) check(reminder_km > 0 and reminder_km <= 9999999999.99),
 warning_days integer not null default 30 check(warning_days between 0 and 3650),
 warning_km numeric(12,2) not null default 1000 check(warning_km between 0 and 9999999999.99),
 override_date date check(override_date >= date '1900-01-01'), override_km numeric(12,2) check(override_km between 0 and 9999999999.99),
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id) on delete restrict, updated_at timestamptz not null default now()
);
create table public.maintenance_attachments (
 id uuid primary key default gen_random_uuid(), record_id uuid not null references public.maintenance_records(id) on delete restrict,
 file_path text not null unique, original_filename text not null check(length(original_filename) between 1 and 500),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
 uploaded_at timestamptz not null default now(),
 check(split_part(file_path,'/',1) = record_id::text and array_length(string_to_array(file_path,'/'),1)=2)
);
create table public.maintenance_audit (
 id uuid primary key default gen_random_uuid(), record_id uuid not null references public.maintenance_records(id) on delete restrict,
 action text not null, previous_record jsonb, previous_items jsonb,
 actor_id uuid not null references auth.users(id) on delete restrict, occurred_at timestamptz not null default clock_timestamp()
);
create index maintenance_records_vehicle_date on public.maintenance_records(vehicle_id,service_date desc) where not is_deleted;
create index maintenance_items_record on public.maintenance_items(record_id,position);
create index maintenance_items_requirement on public.maintenance_items(requirement_id);
create index maintenance_attachments_record on public.maintenance_attachments(record_id);
create index maintenance_requirement_vehicle on public.maintenance_requirement_vehicles(vehicle_id);
create index maintenance_audit_record on public.maintenance_audit(record_id,occurred_at desc);

-- RPCs are the ONLY write path for visits/items/templates, ensuring atomic validation and money totals.
create function public.save_maintenance_record(payload jsonb, item_rows jsonb, expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid := (payload->>'id')::uuid; prior public.maintenance_records; entry jsonb; pos integer:=0; total numeric:=0; actor uuid:=auth.uid(); iid uuid; req public.maintenance_requirements; vid uuid:=(payload->>'vehicle_id')::uuid;
begin
 if actor is null or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then raise exception 'MAINTENANCE_FORBIDDEN'; end if;
 if not exists(select 1 from public.vehicles where id=vid) then raise exception 'MAINTENANCE_VEHICLE'; end if;
 if jsonb_typeof(item_rows) is distinct from 'array' or jsonb_array_length(item_rows)<1 then raise exception 'MAINTENANCE_ITEMS_REQUIRED'; end if;
 if (payload->>'service_date')::date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'MAINTENANCE_FUTURE_DATE'; end if;
 if (payload->>'off_road_at')::timestamptz > now() or (payload->>'returned_at')::timestamptz > now() then raise exception 'MAINTENANCE_FUTURE_DOWNTIME'; end if;
 -- Lock a stable per-request UUID before looking up existing data (also prevents duplicate retries).
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select * into prior from public.maintenance_records where id=rid for update;
 if found then
   if prior.is_deleted or expected_updated_at is null or prior.updated_at <> expected_updated_at then raise exception 'MAINTENANCE_CONFLICT'; end if;
   insert into public.maintenance_audit(record_id,action,previous_record,previous_items,actor_id)
   values(rid,'edit',to_jsonb(prior),(select jsonb_agg(to_jsonb(i)) from public.maintenance_items i where i.record_id=rid),actor);
 elsif expected_updated_at is not null then raise exception 'MAINTENANCE_CONFLICT';
 end if;
 for entry in select value from jsonb_array_elements(item_rows) loop
   if jsonb_typeof(entry->'quantity') is distinct from 'number' or jsonb_typeof(entry->'unit_price') is distinct from 'number'
     or (entry->>'quantity')::numeric <> round((entry->>'quantity')::numeric,2)
     or (entry->>'unit_price')::numeric <> round((entry->>'unit_price')::numeric,2) then raise exception 'MAINTENANCE_AMOUNT'; end if;
   total:=total+round((entry->>'quantity')::numeric*(entry->>'unit_price')::numeric,2);
   if entry->>'reminder_km' is not null and payload->>'odometer' is null and entry->>'override_km' is null then raise exception 'MAINTENANCE_MILEAGE_REQUIRED'; end if;
   if entry->>'override_date' is not null and (entry->>'override_date')::date < (payload->>'service_date')::date then raise exception 'MAINTENANCE_DUE_DATE'; end if;
   if entry->>'override_km' is not null and (entry->>'override_km')::numeric < (payload->>'odometer')::numeric then raise exception 'MAINTENANCE_DUE_MILEAGE'; end if;
   if entry->>'requirement_id' is not null then
     select * into req from public.maintenance_requirements where id=(entry->>'requirement_id')::uuid;
     if not found or req.category <> entry->>'category' or not (
       exists(select 1 from public.maintenance_requirement_vehicles where requirement_id=req.id and vehicle_id=vid)
       or (req.vehicle_type is not null and exists(select 1 from public.vehicles where id=vid and vehicle_type=req.vehicle_type))
     ) then raise exception 'MAINTENANCE_REQUIREMENT_SCOPE'; end if;
   end if;
 end loop;
 if payload->>'receipt_total' is not null and round((payload->>'receipt_total')::numeric,2)<>total and not coalesce((payload->>'mismatch_confirmed')::boolean,false) then raise exception 'MAINTENANCE_RECEIPT_MISMATCH'; end if;
 insert into public.maintenance_records(id,vehicle_id,service_date,odometer,garage,receipt_reference,receipt_total,calculated_total,mismatch_confirmed,notes,off_road_at,returned_at,created_by,updated_by)
 values(rid,vid,(payload->>'service_date')::date,(payload->>'odometer')::numeric,nullif(btrim(payload->>'garage'),''),nullif(btrim(payload->>'receipt_reference'),''),(payload->>'receipt_total')::numeric,total,coalesce((payload->>'mismatch_confirmed')::boolean,false),payload->>'notes',(payload->>'off_road_at')::timestamptz,(payload->>'returned_at')::timestamptz,actor,actor)
 on conflict(id) do update set vehicle_id=excluded.vehicle_id,service_date=excluded.service_date,odometer=excluded.odometer,garage=excluded.garage,receipt_reference=excluded.receipt_reference,receipt_total=excluded.receipt_total,calculated_total=excluded.calculated_total,mismatch_confirmed=excluded.mismatch_confirmed,notes=excluded.notes,off_road_at=excluded.off_road_at,returned_at=excluded.returned_at,updated_by=actor,updated_at=clock_timestamp();
 for entry in select value from jsonb_array_elements(item_rows) loop
   iid:=(entry->>'id')::uuid;
   if exists(select 1 from public.maintenance_items where id=iid and record_id<>rid) then raise exception 'MAINTENANCE_ITEM_OWNER'; end if;
   insert into public.maintenance_items(id,record_id,position,description,description_th,category,quantity,unit_price,notes,requirement_id,reminder_months,reminder_km,warning_days,warning_km,override_date,override_km,created_by,updated_by)
   values(iid,rid,pos,btrim(entry->>'description'),nullif(btrim(entry->>'description_th'),''),entry->>'category',(entry->>'quantity')::numeric,(entry->>'unit_price')::numeric,entry->>'notes',(entry->>'requirement_id')::uuid,(entry->>'reminder_months')::integer,(entry->>'reminder_km')::numeric,coalesce((entry->>'warning_days')::integer,30),coalesce((entry->>'warning_km')::numeric,1000),(entry->>'override_date')::date,(entry->>'override_km')::numeric,actor,actor)
   on conflict(id) do update set position=excluded.position,description=excluded.description,description_th=excluded.description_th,category=excluded.category,quantity=excluded.quantity,unit_price=excluded.unit_price,notes=excluded.notes,requirement_id=excluded.requirement_id,reminder_months=excluded.reminder_months,reminder_km=excluded.reminder_km,warning_days=excluded.warning_days,warning_km=excluded.warning_km,override_date=excluded.override_date,override_km=excluded.override_km,updated_by=actor,updated_at=clock_timestamp();
   pos:=pos+1;
 end loop;
 delete from public.maintenance_items where record_id=rid and id not in(select (value->>'id')::uuid from jsonb_array_elements(item_rows));
 return rid;
end $$;

create function public.delete_maintenance_record(target_id uuid, expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.maintenance_records;
begin
 if auth.uid() is null or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then raise exception 'MAINTENANCE_FORBIDDEN'; end if;
 select * into prior from public.maintenance_records where id=target_id for update;
 if not found or prior.is_deleted or prior.updated_at<>expected_updated_at or expected_updated_at is null then raise exception 'MAINTENANCE_CONFLICT'; end if;
 insert into public.maintenance_audit(record_id,action,previous_record,previous_items,actor_id) values(target_id,'delete',to_jsonb(prior),(select jsonb_agg(to_jsonb(i)) from public.maintenance_items i where record_id=target_id),auth.uid());
 update public.maintenance_records set is_deleted=true,updated_by=auth.uid(),updated_at=clock_timestamp() where id=target_id;
end $$;

create function public.save_maintenance_requirement(payload jsonb, vehicle_ids uuid[], expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid:=(payload->>'id')::uuid; prior public.maintenance_requirements;
begin
 if auth.uid() is null or not public.is_account_admin() then raise exception 'MAINTENANCE_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,1));
 select * into prior from public.maintenance_requirements where id=rid for update;
 if found then
   if expected_updated_at is null or prior.updated_at<>expected_updated_at then raise exception 'MAINTENANCE_CONFLICT'; end if;
 elsif expected_updated_at is not null then raise exception 'MAINTENANCE_CONFLICT'; end if;
 if nullif(payload->>'vehicle_type','') is null and coalesce(array_length(vehicle_ids,1),0)=0 then raise exception 'MAINTENANCE_REQUIREMENT_SCOPE'; end if;
 insert into public.maintenance_requirements(id,name,category,vehicle_type,frequency_months,mileage_interval,warning_days,warning_km,active,notes,created_by,updated_by)
 values(rid,payload->>'name',payload->>'category',nullif(payload->>'vehicle_type',''),(payload->>'frequency_months')::integer,(payload->>'mileage_interval')::numeric,(payload->>'warning_days')::integer,(payload->>'warning_km')::numeric,(payload->>'active')::boolean,payload->>'notes',auth.uid(),auth.uid())
 on conflict(id) do update set name=excluded.name,category=excluded.category,vehicle_type=excluded.vehicle_type,frequency_months=excluded.frequency_months,mileage_interval=excluded.mileage_interval,warning_days=excluded.warning_days,warning_km=excluded.warning_km,active=excluded.active,notes=excluded.notes,updated_by=auth.uid(),updated_at=clock_timestamp();
 delete from public.maintenance_requirement_vehicles where requirement_id=rid;
 insert into public.maintenance_requirement_vehicles(requirement_id,vehicle_id) select rid,unnest(vehicle_ids) on conflict do nothing;
 return rid;
end $$;

-- All fleet records are currently shared with authenticated staff; retain that model,
-- additionally requiring an active account and visibility of the existing vehicle.
alter table public.maintenance_records enable row level security;
alter table public.maintenance_items enable row level security;
alter table public.maintenance_requirements enable row level security;
alter table public.maintenance_requirement_vehicles enable row level security;
alter table public.maintenance_attachments enable row level security;
alter table public.maintenance_audit enable row level security;
create policy maintenance_records_read on public.maintenance_records for select to authenticated using(public.is_account_active() and exists(select 1 from public.vehicles v where v.id=vehicle_id));
create policy maintenance_items_read on public.maintenance_items for select to authenticated using(public.is_account_active() and exists(select 1 from public.maintenance_records r where r.id=record_id));
create policy maintenance_requirements_read on public.maintenance_requirements for select to authenticated using(public.is_account_active());
create policy maintenance_applicability_read on public.maintenance_requirement_vehicles for select to authenticated using(public.is_account_active() and exists(select 1 from public.vehicles v where v.id=vehicle_id));
create policy maintenance_audit_read on public.maintenance_audit for select to authenticated using(public.is_account_active() and exists(select 1 from public.maintenance_records r where r.id=record_id));
create policy maintenance_attachments_read on public.maintenance_attachments for select to authenticated using(public.is_account_active() and exists(select 1 from public.maintenance_records r where r.id=record_id));
create policy maintenance_attachments_insert on public.maintenance_attachments for insert to authenticated with check(public.is_account_active() and public.current_account_role() in ('admin','office_staff') and uploaded_by=auth.uid() and exists(select 1 from public.maintenance_records r where r.id=record_id and not r.is_deleted));
create policy maintenance_attachments_delete on public.maintenance_attachments for delete to authenticated using(public.is_account_active() and public.current_account_role() in ('admin','office_staff') and exists(select 1 from public.maintenance_records r where r.id=record_id));
revoke all on public.maintenance_records,public.maintenance_items,public.maintenance_requirements,public.maintenance_requirement_vehicles,public.maintenance_attachments,public.maintenance_audit from anon,authenticated;
grant select on public.maintenance_records,public.maintenance_items,public.maintenance_requirements,public.maintenance_requirement_vehicles,public.maintenance_attachments,public.maintenance_audit to authenticated;
grant insert,delete on public.maintenance_attachments to authenticated;
revoke all on function public.save_maintenance_record(jsonb,jsonb,timestamptz),public.delete_maintenance_record(uuid,timestamptz),public.save_maintenance_requirement(jsonb,uuid[],timestamptz) from public;
grant execute on function public.save_maintenance_record(jsonb,jsonb,timestamptz),public.delete_maintenance_record(uuid,timestamptz),public.save_maintenance_requirement(jsonb,uuid[],timestamptz) to authenticated;

-- A new private bucket only. Do not modify any existing bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('maintenance-receipts','maintenance-receipts',false,10485760,array['image/jpeg','image/png','application/pdf']);
create policy maintenance_receipts_read on storage.objects for select to authenticated using(bucket_id='maintenance-receipts' and public.is_account_active() and exists(select 1 from public.maintenance_records r where r.id::text=split_part(name,'/',1)));
create policy maintenance_receipts_upload on storage.objects for insert to authenticated with check(bucket_id='maintenance-receipts' and public.is_account_active() and public.current_account_role() in ('admin','office_staff') and exists(select 1 from public.maintenance_records r where r.id::text=split_part(name,'/',1) and not r.is_deleted));
create policy maintenance_receipts_delete on storage.objects for delete to authenticated using(bucket_id='maintenance-receipts' and public.is_account_active() and public.current_account_role() in ('admin','office_staff') and exists(select 1 from public.maintenance_records r where r.id::text=split_part(name,'/',1)));
notify pgrst,'reload schema';
commit;
