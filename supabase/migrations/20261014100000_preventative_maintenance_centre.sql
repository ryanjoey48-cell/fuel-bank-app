-- Review and apply manually after backup/schema audit. No production data rewritten.
begin;
alter table public.maintenance_items add column if not exists service_key text, add column if not exists service_action text not null default 'other', add column if not exists service_confirmed boolean not null default false, add column if not exists condition text;
alter table public.maintenance_items add constraint maintenance_service_action check(service_action in ('inspection','fluid_replacement','fluid_top_up','component_replacement','repair','other'));
alter table public.maintenance_items add constraint maintenance_confirmation_key check(not service_confirmed or nullif(btrim(service_key),'') is not null);
alter table public.maintenance_requirements add column if not exists replacement_strategy text not null default 'interval', add column if not exists service_key text, add column if not exists schedule_kind text not null default 'replacement', add column if not exists applicability_status text not null default 'applicable', add column if not exists specification text, add column if not exists capacity text;
alter table public.maintenance_requirements add constraint maintenance_schedule_kind check(schedule_kind in ('inspection','replacement'));
alter table public.maintenance_requirements add constraint maintenance_schedule_applicability check(applicability_status in ('applicable','not_applicable'));
-- Allow incomplete configuration only for explicit preventative schedules.
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid='public.maintenance_requirements'::regclass and contype='c' and pg_get_constraintdef(oid) like '%frequency_months IS NOT NULL%OR%mileage_interval IS NOT NULL%' loop execute format('alter table public.maintenance_requirements drop constraint %I',c.conname); end loop; end $$;
alter table public.maintenance_requirements add constraint maintenance_interval_or_schedule check(service_key is not null or frequency_months is not null or mileage_interval is not null);
alter table public.maintenance_requirements add constraint maintenance_replacement_strategy check(replacement_strategy in ('interval','condition') and (replacement_strategy <> 'condition' or (schedule_kind='replacement' and frequency_months is null and mileage_interval is null)));
create or replace function public.save_maintenance_record(payload jsonb, item_rows jsonb, expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  rid uuid := (payload->>'id')::uuid;
  prior public.maintenance_records;
  entry jsonb;
  pos integer := 0;
  total numeric := 0;
  line_amount numeric;
  actor uuid := auth.uid();
  iid uuid;
  req public.maintenance_requirements;
  vid uuid := (payload->>'vehicle_id')::uuid;
begin
  if actor is null or not public.is_office_account() or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then
    raise exception 'MAINTENANCE_FORBIDDEN';
  end if;
  if not exists(select 1 from public.vehicles where id=vid) then raise exception 'MAINTENANCE_VEHICLE'; end if;
  if jsonb_typeof(item_rows) is distinct from 'array' or jsonb_array_length(item_rows)<1 then raise exception 'MAINTENANCE_ITEMS_REQUIRED'; end if;
  if (payload->>'service_date')::date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'MAINTENANCE_FUTURE_DATE'; end if;
  if nullif(btrim(payload->>'off_road_at'),'')::timestamptz > now()
    or nullif(btrim(payload->>'returned_at'),'')::timestamptz > now() then
    raise exception 'MAINTENANCE_FUTURE_DOWNTIME';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
  select * into prior from public.maintenance_records where id=rid for update;
  if found then
    if prior.is_deleted or expected_updated_at is null or prior.updated_at <> expected_updated_at then raise exception 'MAINTENANCE_CONFLICT'; end if;
    insert into public.maintenance_audit(record_id,action,previous_record,previous_items,actor_id)
    values(rid,'edit',to_jsonb(prior),(select jsonb_agg(to_jsonb(i)) from public.maintenance_items i where i.record_id=rid),actor);
  elsif expected_updated_at is not null then
    raise exception 'MAINTENANCE_CONFLICT';
  end if;

  -- Older clients may omit new fields on historical edits. Preserve metadata
  -- before validation, so omission cannot bypass confirmation/odometer checks.
  select jsonb_agg(coalesce((select jsonb_build_object('service_key',i.service_key,'service_action',i.service_action,'service_confirmed',i.service_confirmed,'condition',i.condition) from public.maintenance_items i where i.id=(e->>'id')::uuid and i.record_id=rid),'{}'::jsonb) || e) into item_rows from jsonb_array_elements(item_rows) e;
  for entry in select value from jsonb_array_elements(item_rows) loop
    if coalesce((entry->>'service_confirmed')::boolean,false) then
      if nullif(btrim(entry->>'service_key'),'') is null then raise exception 'MAINTENANCE_SERVICE_KEY'; end if;
      if (entry->>'service_key' in ('engine_oil','coolant','brake_fluid','transmission_oil','power_steering_fluid') and entry->>'service_action'='component_replacement') or (entry->>'service_key' in ('battery','oil_filter','air_filter','fuel_filter','tyres','brake_pads','brake_discs','spark_plugs','timing_belt','timing_chain','shock_absorbers') and entry->>'service_action'='fluid_replacement') then raise exception 'MAINTENANCE_SERVICE_ACTION'; end if;
      if entry->>'service_action' in ('fluid_replacement','component_replacement') and payload->>'odometer' is null and exists(select 1 from public.maintenance_requirements s join public.maintenance_requirement_vehicles a on a.requirement_id=s.id where a.vehicle_id=vid and s.service_key=entry->>'service_key' and s.mileage_interval is not null) then raise exception 'MAINTENANCE_MILEAGE_REQUIRED'; end if;
      if exists(select 1 from public.weekly_mileage w where w.vehicle_id=vid and w.week_ending >= (payload->>'service_date')::date and w.week_ending <= (now() at time zone 'Asia/Bangkok')::date and coalesce(w.odometer_reading,w.mileage) < nullif(payload->>'odometer','')::numeric) then raise exception 'MAINTENANCE_ODOMETER_REVIEW'; end if;
      if exists(select 1 from jsonb_array_elements(item_rows) e where e->>'id'<>entry->>'id' and e->>'service_key'=entry->>'service_key' and e->>'service_action'=entry->>'service_action' and coalesce((e->>'service_confirmed')::boolean,false)) then raise exception 'MAINTENANCE_DUPLICATE_SERVICE'; end if;
    end if;
    if jsonb_typeof(entry->'quantity') is distinct from 'number'
      or jsonb_typeof(entry->'unit_price') is distinct from 'number'
      or (entry->>'quantity')::numeric <> round((entry->>'quantity')::numeric,2)
      or (entry->>'unit_price')::numeric <> round((entry->>'unit_price')::numeric,4)
      or (entry->>'unit_price')::numeric < 0 then
      raise exception 'MAINTENANCE_AMOUNT';
    end if;
    -- A caller predating line_total may omit the key while editing. Preserve an
    -- existing explicit receipt total in that case; an explicit JSON null/blank
    -- intentionally clears it and returns the item to quantity x unit_price.
    if not (entry ? 'line_total') then
      select i.line_total into line_amount
      from public.maintenance_items i
      where i.id=(entry->>'id')::uuid and i.record_id=rid;
      if line_amount is null then
        line_amount := round((entry->>'quantity')::numeric * (entry->>'unit_price')::numeric,2);
      end if;
    elsif nullif(btrim(entry->>'line_total'),'') is not null then
      if jsonb_typeof(entry->'line_total') is distinct from 'number'
        or (entry->>'line_total')::numeric <> round((entry->>'line_total')::numeric,2)
        or (entry->>'line_total')::numeric < 0 then
        raise exception 'MAINTENANCE_AMOUNT';
      end if;
      line_amount := (entry->>'line_total')::numeric;
    else
      line_amount := round((entry->>'quantity')::numeric * (entry->>'unit_price')::numeric,2);
    end if;
    total := total + line_amount;
    if nullif(btrim(entry->>'reminder_km'),'') is not null
      and nullif(btrim(payload->>'odometer'),'') is null
      and nullif(btrim(entry->>'override_km'),'') is null then
      raise exception 'MAINTENANCE_MILEAGE_REQUIRED';
    end if;
    if nullif(btrim(entry->>'override_date'),'') is not null
      and nullif(btrim(entry->>'override_date'),'')::date < (payload->>'service_date')::date then
      raise exception 'MAINTENANCE_DUE_DATE';
    end if;
    if nullif(btrim(entry->>'override_km'),'') is not null
      and nullif(btrim(payload->>'odometer'),'') is not null
      and nullif(btrim(entry->>'override_km'),'')::numeric < nullif(btrim(payload->>'odometer'),'')::numeric then
      raise exception 'MAINTENANCE_DUE_MILEAGE';
    end if;
    if nullif(btrim(entry->>'requirement_id'),'') is not null then
      select * into req from public.maintenance_requirements where id=nullif(btrim(entry->>'requirement_id'),'')::uuid;
      if not found or req.category <> entry->>'category' or not (
        exists(select 1 from public.maintenance_requirement_vehicles where requirement_id=req.id and vehicle_id=vid)
        or (req.vehicle_type is not null and exists(select 1 from public.vehicles where id=vid and vehicle_type=req.vehicle_type))
      ) then raise exception 'MAINTENANCE_REQUIREMENT_SCOPE'; end if;
    end if;
  end loop;

  if nullif(btrim(payload->>'receipt_total'),'') is not null
    and round(nullif(btrim(payload->>'receipt_total'),'')::numeric,2)<>total
    and not coalesce((payload->>'mismatch_confirmed')::boolean,false) then
    raise exception 'MAINTENANCE_RECEIPT_MISMATCH';
  end if;

  insert into public.maintenance_records(id,vehicle_id,service_date,odometer,garage,receipt_reference,receipt_total,calculated_total,mismatch_confirmed,notes,off_road_at,returned_at,created_by,updated_by)
  values(rid,vid,(payload->>'service_date')::date,nullif(btrim(payload->>'odometer'),'')::numeric,nullif(btrim(payload->>'garage'),''),nullif(btrim(payload->>'receipt_reference'),''),nullif(btrim(payload->>'receipt_total'),'')::numeric,total,coalesce((payload->>'mismatch_confirmed')::boolean,false),payload->>'notes',nullif(btrim(payload->>'off_road_at'),'')::timestamptz,nullif(btrim(payload->>'returned_at'),'')::timestamptz,actor,actor)
  on conflict(id) do update set vehicle_id=excluded.vehicle_id,service_date=excluded.service_date,odometer=excluded.odometer,garage=excluded.garage,receipt_reference=excluded.receipt_reference,receipt_total=excluded.receipt_total,calculated_total=excluded.calculated_total,mismatch_confirmed=excluded.mismatch_confirmed,notes=excluded.notes,off_road_at=excluded.off_road_at,returned_at=excluded.returned_at,updated_by=actor,updated_at=clock_timestamp();

  for entry in select value from jsonb_array_elements(item_rows) loop
    iid := (entry->>'id')::uuid;
    if exists(select 1 from public.maintenance_items where id=iid and record_id<>rid) then raise exception 'MAINTENANCE_ITEM_OWNER'; end if;
    insert into public.maintenance_items(id,record_id,position,description,description_th,category,quantity,unit_price,line_total,service_key,service_action,service_confirmed,condition,notes,requirement_id,reminder_months,reminder_km,warning_days,warning_km,override_date,override_km,created_by,updated_by)
    values(iid,rid,pos,btrim(entry->>'description'),nullif(btrim(entry->>'description_th'),''),entry->>'category',(entry->>'quantity')::numeric,(entry->>'unit_price')::numeric,nullif(btrim(entry->>'line_total'),'')::numeric,nullif(btrim(entry->>'service_key'),''),coalesce(entry->>'service_action','other'),coalesce((entry->>'service_confirmed')::boolean,false),entry->>'condition',entry->>'notes',nullif(btrim(entry->>'requirement_id'),'')::uuid,nullif(btrim(entry->>'reminder_months'),'')::integer,nullif(btrim(entry->>'reminder_km'),'')::numeric,coalesce(nullif(btrim(entry->>'warning_days'),'')::integer,30),coalesce(nullif(btrim(entry->>'warning_km'),'')::numeric,1000),nullif(btrim(entry->>'override_date'),'')::date,nullif(btrim(entry->>'override_km'),'')::numeric,actor,actor)
    on conflict(id) do update set service_key=case when entry ? 'service_key' then excluded.service_key else maintenance_items.service_key end,service_action=case when entry ? 'service_action' then excluded.service_action else maintenance_items.service_action end,service_confirmed=case when entry ? 'service_confirmed' then excluded.service_confirmed else maintenance_items.service_confirmed end,condition=case when entry ? 'condition' then excluded.condition else maintenance_items.condition end,position=excluded.position,description=excluded.description,description_th=excluded.description_th,category=excluded.category,quantity=excluded.quantity,unit_price=excluded.unit_price,line_total=case when entry ? 'line_total' then excluded.line_total else maintenance_items.line_total end,notes=excluded.notes,requirement_id=excluded.requirement_id,reminder_months=excluded.reminder_months,reminder_km=excluded.reminder_km,warning_days=excluded.warning_days,warning_km=excluded.warning_km,override_date=excluded.override_date,override_km=excluded.override_km,updated_by=actor,updated_at=clock_timestamp();
    pos := pos + 1;
  end loop;
  delete from public.maintenance_items where record_id=rid and id not in(select (value->>'id')::uuid from jsonb_array_elements(item_rows));
  return rid;
end $$;


create or replace function public.maintenance_centre_version() returns integer language sql stable as $$select 1$$;
revoke all on function public.maintenance_centre_version() from public; grant execute on function public.maintenance_centre_version() to authenticated;
create or replace function public.save_vehicle_maintenance_schedule(payload jsonb, target_vehicle uuid, expected_updated_at timestamptz default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid; prior public.maintenance_requirements; actor uuid:=auth.uid(); key text:=nullif(btrim(payload->>'service_key'),''); kind text:=payload->>'schedule_kind';
begin
 if actor is null or not public.is_office_account() or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then raise exception 'MAINTENANCE_FORBIDDEN'; end if;
 if key is null or length(key)>200 or not exists(select 1 from public.vehicles where id=target_vehicle) then raise exception 'MAINTENANCE_REQUIREMENT_SCOPE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_vehicle::text||key||kind,2));
 select s.* into prior from public.maintenance_requirements s join public.maintenance_requirement_vehicles a on a.requirement_id=s.id where a.vehicle_id=target_vehicle and s.service_key=key and s.schedule_kind=kind for update of s;
 if found then
  if expected_updated_at is null or expected_updated_at<>prior.updated_at then raise exception 'MAINTENANCE_CONFLICT'; end if;
  if exists(select 1 from public.maintenance_requirement_vehicles where requirement_id=prior.id and vehicle_id<>target_vehicle) or prior.vehicle_type is not null then raise exception 'MAINTENANCE_SHARED_TEMPLATE'; end if;
  rid:=prior.id;
 else
  if expected_updated_at is not null then raise exception 'MAINTENANCE_CONFLICT'; end if; rid:=gen_random_uuid();
 end if;
 insert into public.maintenance_requirements(id,name,category,vehicle_type,frequency_months,mileage_interval,warning_days,warning_km,active,notes,created_by,updated_by,service_key,schedule_kind,applicability_status,specification,capacity,replacement_strategy)
 values(rid,payload->>'name',payload->>'category',null,nullif(payload->>'frequency_months','')::integer,nullif(payload->>'mileage_interval','')::numeric,coalesce((payload->>'warning_days')::integer,30),coalesce((payload->>'warning_km')::numeric,1000),true,payload->>'notes',actor,actor,key,kind,payload->>'applicability_status',payload->>'specification',payload->>'capacity',coalesce(payload->>'replacement_strategy','interval'))
 on conflict(id) do update set replacement_strategy=excluded.replacement_strategy,name=excluded.name,category=excluded.category,frequency_months=excluded.frequency_months,mileage_interval=excluded.mileage_interval,warning_days=excluded.warning_days,warning_km=excluded.warning_km,notes=excluded.notes,applicability_status=excluded.applicability_status,specification=excluded.specification,capacity=excluded.capacity,updated_by=actor,updated_at=clock_timestamp();
 insert into public.maintenance_requirement_vehicles values(rid,target_vehicle) on conflict do nothing;
 return rid;
end $$;
revoke all on function public.save_vehicle_maintenance_schedule(jsonb,uuid,timestamptz) from public;
grant execute on function public.save_vehicle_maintenance_schedule(jsonb,uuid,timestamptz) to authenticated;
create policy maintenance_office_guard on public.maintenance_records as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account());
create policy maintenance_office_guard on public.maintenance_items as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account());
create policy maintenance_office_guard on public.maintenance_requirements as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account());
create policy maintenance_office_guard on public.maintenance_requirement_vehicles as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account());
create policy maintenance_office_guard on public.maintenance_attachments as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account());
create policy maintenance_office_guard on public.maintenance_audit as restrictive for all to public using(public.is_account_active() and public.is_office_account()) with check(public.is_account_active() and public.is_office_account());
create policy maintenance_receipt_office_guard on storage.objects as restrictive for all to public using(bucket_id <> 'maintenance-receipts' or (public.is_account_active() and public.is_office_account())) with check(bucket_id <> 'maintenance-receipts' or (public.is_account_active() and public.is_office_account()));
create or replace function public.delete_maintenance_record(target_id uuid, expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.maintenance_records;
begin
 if auth.uid() is null or not public.is_office_account() or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then raise exception 'MAINTENANCE_FORBIDDEN'; end if;
 select * into prior from public.maintenance_records where id=target_id for update;
 if not found or prior.is_deleted or prior.updated_at<>expected_updated_at or expected_updated_at is null then raise exception 'MAINTENANCE_CONFLICT'; end if;
 insert into public.maintenance_audit(record_id,action,previous_record,previous_items,actor_id) values(target_id,'delete',to_jsonb(prior),(select jsonb_agg(to_jsonb(i)) from public.maintenance_items i where record_id=target_id),auth.uid());
 update public.maintenance_records set is_deleted=true,updated_by=auth.uid(),updated_at=clock_timestamp() where id=target_id;
end $$;

revoke all on function public.save_maintenance_record(jsonb,jsonb,timestamptz),public.delete_maintenance_record(uuid,timestamptz) from public;
grant execute on function public.save_maintenance_record(jsonb,jsonb,timestamptz),public.delete_maintenance_record(uuid,timestamptz) to authenticated;
create or replace function public.save_maintenance_requirement(payload jsonb, vehicle_ids uuid[], expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid:=(payload->>'id')::uuid; prior public.maintenance_requirements;
begin
 if auth.uid() is null or not public.is_office_account() or not public.is_account_admin() then raise exception 'MAINTENANCE_FORBIDDEN'; end if;
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


notify pgrst, 'reload schema';
commit;
