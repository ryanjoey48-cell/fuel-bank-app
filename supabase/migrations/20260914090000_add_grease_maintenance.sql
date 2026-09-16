begin;

-- Independent annual maintenance ledger. No existing tables, data or oil logic are changed.
create table public.grease_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  service_date date not null check (service_date >= date '1900-01-01'),
  next_due_date date generated always as ((service_date + interval '1 year')::date) stored,
  odometer numeric(12,2) check (odometer >= 0 and odometer <> 'NaN'::numeric),
  items jsonb not null default '[]'::jsonb,
  total_cost numeric(14,2) not null default 0,
  garage text,
  notes text,
  is_void boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index grease_maintenance_vehicle_service_idx
  on public.grease_maintenance_records (vehicle_id, service_date desc, created_at desc, id desc)
  where not is_void;

create function public.validate_grease_maintenance_record()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  item jsonb;
  quantity numeric;
  cost numeric;
begin
  if new.service_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'Grease service date cannot be in the future';
  end if;
  if jsonb_typeof(new.items) is distinct from 'array' or jsonb_array_length(new.items) > 100 then
    raise exception 'Grease items must be an array of at most 100 entries';
  end if;
  new.total_cost := 0;
  for item in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'description') is distinct from 'string'
      or length(btrim(item->>'description')) = 0
      or length(item->>'description') > 500
      or (item->'quantity' is not null and item->'quantity' <> 'null'::jsonb and jsonb_typeof(item->'quantity') <> 'number')
      or (item->'unit_cost' is not null and item->'unit_cost' <> 'null'::jsonb and jsonb_typeof(item->'unit_cost') <> 'number') then
      raise exception 'Invalid grease item';
    end if;
    quantity := coalesce((item->>'quantity')::numeric, 1);
    cost := coalesce((item->>'unit_cost')::numeric, 0);
    if quantity < 0 or quantity > 1000000 or cost < 0 or cost > 100000000
      or quantity <> round(quantity, 2) or cost <> round(cost, 2) then
      raise exception 'Invalid grease quantity or unit cost';
    end if;
    new.total_cost := new.total_cost + round(quantity * cost, 2);
  end loop;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger grease_maintenance_validate
  before insert or update on public.grease_maintenance_records
  for each row execute function public.validate_grease_maintenance_record();

alter table public.grease_maintenance_records enable row level security;
-- Follow existing fleet visibility, with existing account roles enforced on writes.
create policy grease_maintenance_read on public.grease_maintenance_records
  for select to authenticated using (
    public.is_account_active() and exists (select 1 from public.vehicles v where v.id = vehicle_id)
  );
create policy grease_maintenance_insert on public.grease_maintenance_records
  for insert to authenticated with check (
    public.is_account_active() and public.current_account_role() in ('admin', 'office_staff')
    and exists (select 1 from public.vehicles v where v.id = vehicle_id)
  );
create policy grease_maintenance_update on public.grease_maintenance_records
  for update to authenticated using (
    public.is_account_active() and public.current_account_role() in ('admin', 'office_staff')
    and exists (select 1 from public.vehicles v where v.id = vehicle_id)
  ) with check (
    public.is_account_active() and public.current_account_role() in ('admin', 'office_staff')
    and exists (select 1 from public.vehicles v where v.id = vehicle_id)
  );
-- Corrections may be voided/restored; historical records cannot be deleted by app users.
revoke all on public.grease_maintenance_records from anon, authenticated;
grant select, insert, update on public.grease_maintenance_records to authenticated;
revoke all on function public.validate_grease_maintenance_record() from public;
notify pgrst, 'reload schema';
commit;
