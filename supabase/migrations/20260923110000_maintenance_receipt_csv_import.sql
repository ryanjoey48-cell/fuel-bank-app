-- Additive support for CSV receipt imports. Existing records and items are not rewritten.
begin;

alter table public.maintenance_items
  add column if not exists line_total numeric(12,2)
  check (line_total between 0 and 9999999999.99);

-- CSV-derived unit prices can require fractional satang to reconcile quantity to
-- the printed line total. Manual entry can continue using two decimals.
alter table public.maintenance_items
  alter column unit_price type numeric(14,4) using unit_price::numeric(14,4);

alter table public.maintenance_items drop constraint if exists maintenance_items_category_check;
alter table public.maintenance_items add constraint maintenance_items_category_check
  check (category in ('grease','oil','brakes','tyres','battery','engine','transmission','suspension','steering','electrical','inspection','labour','other','air_conditioning'));

alter table public.maintenance_requirements drop constraint if exists maintenance_requirements_category_check;
alter table public.maintenance_requirements add constraint maintenance_requirements_category_check
  check (category in ('grease','oil','brakes','tyres','battery','engine','transmission','suspension','steering','electrical','inspection','labour','other','air_conditioning'));

comment on column public.maintenance_items.line_total is
  'Optional explicit receipt line total. NULL preserves legacy quantity x unit_price calculation.';

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
  if actor is null or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then
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

  for entry in select value from jsonb_array_elements(item_rows) loop
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
    insert into public.maintenance_items(id,record_id,position,description,description_th,category,quantity,unit_price,line_total,notes,requirement_id,reminder_months,reminder_km,warning_days,warning_km,override_date,override_km,created_by,updated_by)
    values(iid,rid,pos,btrim(entry->>'description'),nullif(btrim(entry->>'description_th'),''),entry->>'category',(entry->>'quantity')::numeric,(entry->>'unit_price')::numeric,nullif(btrim(entry->>'line_total'),'')::numeric,entry->>'notes',nullif(btrim(entry->>'requirement_id'),'')::uuid,nullif(btrim(entry->>'reminder_months'),'')::integer,nullif(btrim(entry->>'reminder_km'),'')::numeric,coalesce(nullif(btrim(entry->>'warning_days'),'')::integer,30),coalesce(nullif(btrim(entry->>'warning_km'),'')::numeric,1000),nullif(btrim(entry->>'override_date'),'')::date,nullif(btrim(entry->>'override_km'),'')::numeric,actor,actor)
    on conflict(id) do update set position=excluded.position,description=excluded.description,description_th=excluded.description_th,category=excluded.category,quantity=excluded.quantity,unit_price=excluded.unit_price,line_total=case when entry ? 'line_total' then excluded.line_total else maintenance_items.line_total end,notes=excluded.notes,requirement_id=excluded.requirement_id,reminder_months=excluded.reminder_months,reminder_km=excluded.reminder_km,warning_days=excluded.warning_days,warning_km=excluded.warning_km,override_date=excluded.override_date,override_km=excluded.override_km,updated_by=actor,updated_at=clock_timestamp();
    pos := pos + 1;
  end loop;
  delete from public.maintenance_items where record_id=rid and id not in(select (value->>'id')::uuid from jsonb_array_elements(item_rows));
  return rid;
end $$;

revoke all on function public.save_maintenance_record(jsonb,jsonb,timestamptz) from public;
grant execute on function public.save_maintenance_record(jsonb,jsonb,timestamptz) to authenticated;

commit;
