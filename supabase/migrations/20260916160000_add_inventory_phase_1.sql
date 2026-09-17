-- Phase 1 inventory: master data, stock-bearing variants and an immutable movement ledger.
begin;

create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  name_th text, description text, active boolean not null default true,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create unique index inventory_categories_name_key on public.inventory_categories(lower(btrim(name)));

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.inventory_categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  name_th text, sku text, description text,
  unit text not null check (length(btrim(unit)) between 1 and 40),
  reorder_quantity numeric(14,3) not null default 0 check (reorder_quantity >= 0),
  preferred_supplier text, storage_location text, notes text, active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create unique index inventory_items_sku_key on public.inventory_items(lower(btrim(sku))) where sku is not null and btrim(sku) <> '';
create index inventory_items_category on public.inventory_items(category_id, active, name);

create table public.inventory_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  name text, sku text, is_default boolean not null default false,
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  current_quantity numeric(14,3) not null default 0 check (current_quantity >= 0),
  average_cost numeric(14,4) not null default 0 check (average_cost >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check ((is_default and name is null) or (not is_default and length(btrim(name)) between 1 and 100))
);
create unique index inventory_variants_default_key on public.inventory_variants(item_id) where is_default;
create unique index inventory_variants_name_key on public.inventory_variants(item_id, lower(btrim(name))) where not is_default;
create unique index inventory_variants_sku_key on public.inventory_variants(lower(btrim(sku))) where sku is not null and btrim(sku) <> '';
create index inventory_variants_attention on public.inventory_variants(current_quantity, minimum_stock, item_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  occurred_at timestamptz not null,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  variant_id uuid not null references public.inventory_variants(id) on delete restrict,
  movement_type text not null check (movement_type in ('received','adjustment_plus','adjustment_minus')),
  quantity numeric(14,3) not null check (quantity > 0),
  previous_quantity numeric(14,3) not null check (previous_quantity >= 0),
  new_quantity numeric(14,3) not null check (new_quantity >= 0),
  unit_cost numeric(14,4) check (unit_cost >= 0),
  total_cost numeric(16,4) check (total_cost >= 0),
  supplier text, storage_location text, reference_number text, notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check ((movement_type = 'received' and unit_cost is not null and total_cost is not null) or movement_type <> 'received')
);
create index inventory_movements_recent on public.inventory_movements(occurred_at desc, created_at desc);
create index inventory_movements_item on public.inventory_movements(item_id, variant_id, occurred_at desc);

insert into public.inventory_categories(name, name_th, description) values
 ('Uniforms','เครื่องแบบ','Staff and driver uniforms'),
 ('Engine Oil & Fluids','น้ำมันเครื่องและของเหลว','Engine oils and vehicle fluids'),
 ('Filters','ไส้กรอง','Vehicle filters'),
 ('Electrical / Bulbs','อุปกรณ์ไฟฟ้า / หลอดไฟ','Electrical parts and bulbs'),
 ('Grease & Lubricants','จาระบีและสารหล่อลื่น','Grease and lubricants'),
 ('Tyres','ยางรถ','New and retained tyres'),
 ('Vehicle Parts','อะไหล่รถยนต์','General vehicle parts'),
 ('Workshop Supplies','วัสดุอู่ซ่อม','Workshop consumables and supplies'),
 ('Other','อื่น ๆ','Flexible category for other stock');

create function public.save_inventory_category(payload jsonb, expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid := coalesce(nullif(payload->>'id','')::uuid, gen_random_uuid()); prior public.inventory_categories; actor uuid := auth.uid();
begin
 if actor is null or not public.is_account_admin() then raise exception 'INVENTORY_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(cid::text, 21));
 select * into prior from public.inventory_categories where id=cid for update;
 if found and (expected_updated_at is null or prior.updated_at <> expected_updated_at) then raise exception 'INVENTORY_CONFLICT'; end if;
 if not found and expected_updated_at is not null then raise exception 'INVENTORY_CONFLICT'; end if;
 insert into public.inventory_categories(id,name,name_th,description,active,created_by,updated_by)
 values(cid,btrim(payload->>'name'),nullif(btrim(payload->>'name_th'),''),nullif(btrim(payload->>'description'),''),coalesce((payload->>'active')::boolean,true),actor,actor)
 on conflict(id) do update set name=excluded.name,name_th=excluded.name_th,description=excluded.description,active=excluded.active,updated_by=actor,updated_at=clock_timestamp();
 return cid;
end $$;

create function public.save_inventory_item(payload jsonb, variant_rows jsonb, expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare iid uuid := (payload->>'id')::uuid; prior public.inventory_items; actor uuid := auth.uid(); entry jsonb; vid uuid; supplied_ids uuid[] := '{}'; default_count integer := 0;
begin
 if actor is null or not public.is_account_admin() then raise exception 'INVENTORY_FORBIDDEN'; end if;
 if iid is null or jsonb_typeof(variant_rows) is distinct from 'array' or jsonb_array_length(variant_rows) < 1 then raise exception 'INVENTORY_VARIANTS_REQUIRED'; end if;
 if not exists(select 1 from public.inventory_categories where id=(payload->>'category_id')::uuid and active) then raise exception 'INVENTORY_CATEGORY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(iid::text, 22));
 select * into prior from public.inventory_items where id=iid for update;
 if found and (expected_updated_at is null or prior.updated_at <> expected_updated_at) then raise exception 'INVENTORY_CONFLICT'; end if;
 if not found and expected_updated_at is not null then raise exception 'INVENTORY_CONFLICT'; end if;
 insert into public.inventory_items(id,category_id,name,name_th,sku,description,unit,reorder_quantity,preferred_supplier,storage_location,notes,active,created_by,updated_by)
 values(iid,(payload->>'category_id')::uuid,btrim(payload->>'name'),nullif(btrim(payload->>'name_th'),''),nullif(btrim(payload->>'sku'),''),nullif(btrim(payload->>'description'),''),btrim(payload->>'unit'),coalesce((payload->>'reorder_quantity')::numeric,0),nullif(btrim(payload->>'preferred_supplier'),''),nullif(btrim(payload->>'storage_location'),''),nullif(btrim(payload->>'notes'),''),coalesce((payload->>'active')::boolean,true),actor,actor)
 on conflict(id) do update set category_id=excluded.category_id,name=excluded.name,name_th=excluded.name_th,sku=excluded.sku,description=excluded.description,unit=excluded.unit,reorder_quantity=excluded.reorder_quantity,preferred_supplier=excluded.preferred_supplier,storage_location=excluded.storage_location,notes=excluded.notes,active=excluded.active,updated_by=actor,updated_at=clock_timestamp();
 for entry in select value from jsonb_array_elements(variant_rows) loop
   vid := (entry->>'id')::uuid; supplied_ids := array_append(supplied_ids, vid);
   if coalesce((entry->>'is_default')::boolean,false) then default_count := default_count + 1; end if;
   if exists(select 1 from public.inventory_variants where id=vid and item_id<>iid) then raise exception 'INVENTORY_VARIANT_OWNER'; end if;
   insert into public.inventory_variants(id,item_id,name,sku,is_default,minimum_stock,average_cost,created_by,updated_by)
   values(vid,iid,case when coalesce((entry->>'is_default')::boolean,false) then null else nullif(btrim(entry->>'name'),'') end,nullif(btrim(entry->>'sku'),''),coalesce((entry->>'is_default')::boolean,false),coalesce((entry->>'minimum_stock')::numeric,0),coalesce((entry->>'average_cost')::numeric,0),actor,actor)
   on conflict(id) do update set name=excluded.name,sku=excluded.sku,is_default=excluded.is_default,minimum_stock=excluded.minimum_stock,average_cost=case when inventory_variants.current_quantity=0 then excluded.average_cost else inventory_variants.average_cost end,updated_by=actor,updated_at=clock_timestamp();
 end loop;
 if default_count > 1 then raise exception 'INVENTORY_DEFAULT_VARIANT'; end if;
 if exists(select 1 from public.inventory_variants v where v.item_id=iid and not (v.id=any(supplied_ids)) and exists(select 1 from public.inventory_movements m where m.variant_id=v.id)) then raise exception 'INVENTORY_VARIANT_HISTORY'; end if;
 delete from public.inventory_variants where item_id=iid and not (id=any(supplied_ids));
 return iid;
end $$;

create function public.post_inventory_movement(payload jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); rid uuid:=(payload->>'request_id')::uuid; mid uuid; variant public.inventory_variants; item public.inventory_items; qty numeric; next_qty numeric; movement text:=payload->>'movement_type'; cost numeric; new_average numeric;
begin
 if actor is null or not public.is_account_active() or public.current_account_role() not in ('admin','office_staff') then raise exception 'INVENTORY_FORBIDDEN'; end if;
 if rid is null then raise exception 'INVENTORY_REQUEST_ID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text, 23));
 select id into mid from public.inventory_movements where request_id=rid;
 if found then return mid; end if;
 qty := (payload->>'quantity')::numeric;
 if qty is null or qty <= 0 or qty <> round(qty,3) then raise exception 'INVENTORY_QUANTITY'; end if;
 if movement not in ('received','adjustment_plus','adjustment_minus') then raise exception 'INVENTORY_MOVEMENT_TYPE'; end if;
 select * into variant from public.inventory_variants where id=(payload->>'variant_id')::uuid for update;
 if not found then raise exception 'INVENTORY_VARIANT'; end if;
 select * into item from public.inventory_items where id=variant.item_id and active for update;
 if not found then raise exception 'INVENTORY_ITEM_ARCHIVED'; end if;
 next_qty := variant.current_quantity + case when movement='adjustment_minus' then -qty else qty end;
 if next_qty < 0 then raise exception 'INVENTORY_NEGATIVE_STOCK'; end if;
 cost := nullif(payload->>'unit_cost','')::numeric;
 if movement='received' and (cost is null or cost < 0 or cost <> round(cost,4)) then raise exception 'INVENTORY_UNIT_COST'; end if;
 new_average := variant.average_cost;
 if movement='received' and next_qty > 0 then new_average := round(((variant.current_quantity*variant.average_cost)+(qty*cost))/next_qty,4); end if;
 update public.inventory_variants set current_quantity=next_qty,average_cost=new_average,updated_by=actor,updated_at=clock_timestamp() where id=variant.id;
 mid := gen_random_uuid();
 insert into public.inventory_movements(id,request_id,occurred_at,item_id,variant_id,movement_type,quantity,previous_quantity,new_quantity,unit_cost,total_cost,supplier,storage_location,reference_number,notes,created_by)
 values(mid,rid,coalesce(nullif(payload->>'occurred_at','')::timestamptz,clock_timestamp()),item.id,variant.id,movement,qty,variant.current_quantity,next_qty,cost,case when cost is null then null else round(qty*cost,4) end,nullif(btrim(payload->>'supplier'),''),coalesce(nullif(btrim(payload->>'storage_location'),''),item.storage_location),nullif(btrim(payload->>'reference_number'),''),nullif(btrim(payload->>'notes'),''),actor);
 return mid;
end $$;

alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_variants enable row level security;
alter table public.inventory_movements enable row level security;
create policy inventory_categories_read on public.inventory_categories for select to authenticated using(public.is_account_active());
create policy inventory_items_read on public.inventory_items for select to authenticated using(public.is_account_active());
create policy inventory_variants_read on public.inventory_variants for select to authenticated using(public.is_account_active());
create policy inventory_movements_read on public.inventory_movements for select to authenticated using(public.is_account_active());
revoke all on public.inventory_categories,public.inventory_items,public.inventory_variants,public.inventory_movements from anon,authenticated;
grant select on public.inventory_categories,public.inventory_items,public.inventory_variants,public.inventory_movements to authenticated;
revoke all on function public.save_inventory_category(jsonb,timestamptz),public.save_inventory_item(jsonb,jsonb,timestamptz),public.post_inventory_movement(jsonb) from public;
grant execute on function public.save_inventory_category(jsonb,timestamptz),public.save_inventory_item(jsonb,jsonb,timestamptz),public.post_inventory_movement(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
