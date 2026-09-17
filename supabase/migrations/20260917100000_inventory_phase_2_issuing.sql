-- Phase 2 inventory: issue stock to existing drivers, vehicles, or general company use.
-- Apply after 20260916160000_add_inventory_phase_1.sql. No production migration is run by the app.
begin;

alter table public.inventory_movements
  add column driver_id uuid references public.drivers(id) on delete restrict,
  add column vehicle_id uuid references public.vehicles(id) on delete restrict,
  add column created_by_name text;

update public.inventory_movements movement
set created_by_name = coalesce(
  (select nullif(btrim(access.display_name),'') from public.account_access access where access.user_id=movement.created_by),
  movement.created_by::text
)
where created_by_name is null;

alter table public.inventory_movements alter column created_by_name set not null;
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('received','adjustment_plus','adjustment_minus','issued_to_driver','issued_to_vehicle','general_use'));
alter table public.inventory_movements add constraint inventory_movements_issue_target_check check (
  (movement_type='issued_to_driver' and driver_id is not null and vehicle_id is null) or
  (movement_type='issued_to_vehicle' and vehicle_id is not null and driver_id is null) or
  (movement_type='general_use' and driver_id is null and vehicle_id is null) or
  (movement_type in ('received','adjustment_plus','adjustment_minus') and driver_id is null and vehicle_id is null)
);
create index inventory_movements_driver on public.inventory_movements(driver_id,occurred_at desc) where driver_id is not null;
create index inventory_movements_vehicle on public.inventory_movements(vehicle_id,occurred_at desc) where vehicle_id is not null;

create or replace function public.post_inventory_movement(payload jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid:=auth.uid(); rid uuid:=(payload->>'request_id')::uuid; mid uuid;
 variant public.inventory_variants; item public.inventory_items; qty numeric; next_qty numeric;
 movement text:=payload->>'movement_type'; cost numeric; new_average numeric;
 target_driver uuid:=nullif(payload->>'driver_id','')::uuid; target_vehicle uuid:=nullif(payload->>'vehicle_id','')::uuid;
 actor_name text;
begin
 if actor is null or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then raise exception 'INVENTORY_FORBIDDEN'; end if;
 if rid is null then raise exception 'INVENTORY_REQUEST_ID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,23));
 select id into mid from public.inventory_movements where request_id=rid;
 if found then return mid; end if;
 qty:=(payload->>'quantity')::numeric;
 if qty is null or qty<=0 or qty<>round(qty,3) then raise exception 'INVENTORY_QUANTITY'; end if;
 if movement not in ('received','adjustment_plus','adjustment_minus','issued_to_driver','issued_to_vehicle','general_use') then raise exception 'INVENTORY_MOVEMENT_TYPE'; end if;
 if movement='issued_to_driver' and (target_driver is null or target_vehicle is not null or not exists(select 1 from public.drivers where id=target_driver and active)) then raise exception 'INVENTORY_DRIVER'; end if;
 if movement='issued_to_vehicle' and (target_vehicle is null or target_driver is not null or not exists(select 1 from public.vehicles where id=target_vehicle and active)) then raise exception 'INVENTORY_VEHICLE'; end if;
 if movement in ('received','adjustment_plus','adjustment_minus','general_use') and (target_driver is not null or target_vehicle is not null) then raise exception 'INVENTORY_TARGET'; end if;
 select * into variant from public.inventory_variants where id=(payload->>'variant_id')::uuid for update;
 if not found then raise exception 'INVENTORY_VARIANT'; end if;
 select * into item from public.inventory_items where id=variant.item_id and active for update;
 if not found then raise exception 'INVENTORY_ITEM_ARCHIVED'; end if;
 next_qty:=variant.current_quantity+case when movement in ('adjustment_minus','issued_to_driver','issued_to_vehicle','general_use') then -qty else qty end;
 if next_qty<0 then raise exception 'INVENTORY_INSUFFICIENT_STOCK'; end if;
 cost:=nullif(payload->>'unit_cost','')::numeric;
 if movement='received' and (cost is null or cost<0 or cost<>round(cost,4)) then raise exception 'INVENTORY_UNIT_COST'; end if;
 new_average:=variant.average_cost;
 if movement='received' and next_qty>0 then new_average:=round(((variant.current_quantity*variant.average_cost)+(qty*cost))/next_qty,4); end if;
 select coalesce(nullif(btrim(display_name),''),actor::text) into actor_name from public.account_access where user_id=actor;
 actor_name:=coalesce(actor_name,actor::text);
 update public.inventory_variants set current_quantity=next_qty,average_cost=new_average,updated_by=actor,updated_at=clock_timestamp() where id=variant.id;
 mid:=gen_random_uuid();
 insert into public.inventory_movements(id,request_id,occurred_at,item_id,variant_id,movement_type,quantity,previous_quantity,new_quantity,unit_cost,total_cost,supplier,storage_location,reference_number,notes,driver_id,vehicle_id,created_by,created_by_name)
 values(mid,rid,coalesce(nullif(payload->>'occurred_at','')::timestamptz,clock_timestamp()),item.id,variant.id,movement,qty,variant.current_quantity,next_qty,cost,case when cost is null then null else round(qty*cost,4) end,nullif(btrim(payload->>'supplier'),''),coalesce(nullif(btrim(payload->>'storage_location'),''),item.storage_location),nullif(btrim(payload->>'reference_number'),''),nullif(btrim(payload->>'notes'),''),target_driver,target_vehicle,actor,actor_name);
 return mid;
end $$;

notify pgrst,'reload schema';
commit;
