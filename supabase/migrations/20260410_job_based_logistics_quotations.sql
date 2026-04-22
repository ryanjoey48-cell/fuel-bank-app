alter table public.shipments
  add column if not exists job_date date,
  add column if not exists weight numeric(12, 2),
  add column if not exists weight_unit text,
  add column if not exists pallets integer,
  add column if not exists length numeric(12, 2),
  add column if not exists width numeric(12, 2),
  add column if not exists height numeric(12, 2),
  add column if not exists pickup_location text,
  add column if not exists dropoff_location text,
  add column if not exists include_base_travel boolean not null default false,
  add column if not exists include_operational_travel boolean not null default false,
  add column if not exists base_location text,
  add column if not exists leg_1_distance_km numeric(10, 2),
  add column if not exists leg_2_distance_km numeric(10, 2),
  add column if not exists leg_3_distance_km numeric(10, 2),
  add column if not exists total_distance_km numeric(10, 2),
  add column if not exists total_operational_distance_km numeric(10, 2),
  add column if not exists quote_distance_mode text,
  add column if not exists quoted_distance_km numeric(10, 2),
  add column if not exists suggested_vehicle_type text,
  add column if not exists diesel_price numeric(12, 2),
  add column if not exists fuel_cost numeric(12, 2),
  add column if not exists toll_cost numeric(12, 2),
  add column if not exists final_price numeric(12, 2),
  add column if not exists status text not null default 'Draft';

update public.shipments
set job_date = coalesce(job_date, shipment_date)
where job_date is null;

update public.shipments
set pickup_location = coalesce(pickup_location, start_location)
where pickup_location is null;

update public.shipments
set dropoff_location = coalesce(dropoff_location, end_location)
where dropoff_location is null;

update public.shipments
set total_distance_km = coalesce(total_distance_km, estimated_distance_km)
where total_distance_km is null;

update public.shipments
set include_operational_travel = coalesce(include_operational_travel, include_base_travel, false)
where include_operational_travel is distinct from coalesce(include_base_travel, false);

update public.shipments
set total_operational_distance_km = coalesce(total_operational_distance_km, total_distance_km, estimated_distance_km)
where total_operational_distance_km is null;

update public.shipments
set quote_distance_mode = coalesce(
  quote_distance_mode,
  case
    when coalesce(include_operational_travel, include_base_travel, false) then 'FULL_OPERATIONAL'
    else 'DELIVERY_ONLY'
  end
)
where quote_distance_mode is null;

update public.shipments
set quoted_distance_km = coalesce(
  quoted_distance_km,
  case
    when quote_distance_mode = 'FULL_OPERATIONAL' then coalesce(total_operational_distance_km, total_distance_km, estimated_distance_km)
    when coalesce(include_operational_travel, include_base_travel, false) then coalesce(leg_2_distance_km, estimated_distance_km, total_distance_km)
    else coalesce(leg_1_distance_km, estimated_distance_km, total_distance_km)
  end
)
where quoted_distance_km is null;

update public.shipments
set leg_1_distance_km = coalesce(leg_1_distance_km, estimated_distance_km)
where leg_1_distance_km is null
  and coalesce(include_base_travel, false) = false;

update public.shipments
set diesel_price = coalesce(diesel_price, fuel_price_per_litre)
where diesel_price is null;

update public.shipments
set fuel_cost = coalesce(fuel_cost, quoted_fuel_cost, estimated_fuel_cost, base_fuel_cost)
where fuel_cost is null;

update public.shipments
set toll_cost = coalesce(toll_cost, toll_estimate)
where toll_cost is null;

update public.shipments
set final_price = coalesce(final_price, quoted_price)
where final_price is null;

update public.shipments
set status = case
  when coalesce(driver_id::text, '') <> '' and coalesce(vehicle_reg, '') <> '' then 'Assigned'
  when coalesce(driver_id::text, '') <> '' then 'Accepted'
  when coalesce(final_price, quoted_price) is not null then 'Quoted'
  else 'Draft'
end
where status is null
   or status not in ('Draft', 'Quoted', 'Accepted', 'Assigned');

alter table public.shipments
  drop constraint if exists shipments_status_check;

alter table public.shipments
  add constraint shipments_status_check
  check (status in ('Draft', 'Quoted', 'Accepted', 'Assigned')) not valid;

alter table public.shipments
  validate constraint shipments_status_check;

notify pgrst, 'reload schema';
