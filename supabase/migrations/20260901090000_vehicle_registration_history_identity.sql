begin;

create or replace function public.normalize_vehicle_registration_key(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create table if not exists public.vehicle_registration_aliases (
  id uuid primary key default gen_random_uuid(),
  source_registration text not null check (length(btrim(source_registration)) > 0),
  canonical_registration text not null check (length(btrim(canonical_registration)) > 0),
  source_registration_key text not null unique,
  canonical_registration_key text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.vehicle_registration_aliases (
  source_registration,
  canonical_registration,
  source_registration_key,
  canonical_registration_key,
  reason
)
values
  (
    '9565',
    '3ฒน-9565',
    public.normalize_vehicle_registration_key('9565'),
    public.normalize_vehicle_registration_key('3ฒน-9565'),
    'Confirmed Buew registration correction from abbreviated to full Thai registration.'
  ),
  (
    '4565',
    '3ฒล-4565',
    public.normalize_vehicle_registration_key('4565'),
    public.normalize_vehicle_registration_key('3ฒล-4565'),
    'Confirmed G registration correction from abbreviated to full Thai registration.'
  ),
  (
    '8453',
    'ฒอ-8453',
    public.normalize_vehicle_registration_key('8453'),
    public.normalize_vehicle_registration_key('ฒอ-8453'),
    'Confirmed Oil registration correction from abbreviated to full Thai registration.'
  )
on conflict (source_registration_key) do update
set
  source_registration = excluded.source_registration,
  canonical_registration = excluded.canonical_registration,
  canonical_registration_key = excluded.canonical_registration_key,
  reason = excluded.reason,
  updated_at = now();

alter table public.fuel_logs add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.bank_transfers add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.weekly_mileage add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.weekly_mileage add column if not exists driver_name_snapshot text;
alter table public.vehicle_monthly_performance add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.booking_diary add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.trip_journeys add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.shipments add column if not exists vehicle_reg_snapshot text;

create index if not exists fuel_logs_vehicle_id_idx on public.fuel_logs (vehicle_id);
create index if not exists bank_transfers_vehicle_id_idx on public.bank_transfers (vehicle_id);
create index if not exists weekly_mileage_vehicle_id_idx on public.weekly_mileage (vehicle_id);
create index if not exists vehicle_monthly_performance_vehicle_id_idx on public.vehicle_monthly_performance (vehicle_id);
create index if not exists booking_diary_vehicle_id_idx on public.booking_diary (vehicle_id);
create index if not exists trip_journeys_vehicle_id_idx on public.trip_journeys (vehicle_id);

do $$
declare
  before_counts jsonb;
  after_counts jsonb;
begin
  with mappings as (
    select source_registration, canonical_registration
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  rows as (
    select m.source_registration, m.canonical_registration, 'vehicles.vehicle_reg' as target, count(*) filter (where public.normalize_vehicle_registration_key(v.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)) as old_count, count(*) filter (where public.normalize_vehicle_registration_key(v.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) as new_count from mappings m cross join public.vehicles v group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'drivers.vehicle_reg' as target, count(*) filter (where public.normalize_vehicle_registration_key(d.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)) as old_count, count(*) filter (where public.normalize_vehicle_registration_key(d.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) as new_count from mappings m cross join public.drivers d group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'fuel_logs.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(f.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(f.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.fuel_logs f group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'bank_transfers.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(b.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(b.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.bank_transfers b group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'weekly_mileage.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(w.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(w.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.weekly_mileage w group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'vehicle_service_logs.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(s.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(s.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.vehicle_service_logs s group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'vehicle_monthly_performance.vehicle_registration', count(*) filter (where public.normalize_vehicle_registration_key(vp.vehicle_registration) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(vp.vehicle_registration) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.vehicle_monthly_performance vp group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'booking_diary.vehicle_registration', count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle_registration) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle_registration) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.booking_diary bd group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'booking_diary.vehicle', count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.booking_diary bd group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'trip_journeys.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(t.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(t.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.trip_journeys t group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'shipments.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.shipments sh group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'shipments.vehicle_reg_snapshot', count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg_snapshot) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg_snapshot) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.shipments sh group by 1, 2
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by source_registration, target), '[]'::jsonb)
  into before_counts
  from rows;

  raise notice 'vehicle registration history counts before: %', before_counts;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  )
  update public.vehicles v
  set
    vehicle_reg = m.canonical_registration,
    vehicle_name = case
      when public.normalize_vehicle_registration_key(v.vehicle_name) = m.source_registration_key then m.canonical_registration
      else v.vehicle_name
    end,
    updated_at = now()
  from mappings m
  where public.normalize_vehicle_registration_key(v.vehicle_reg) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      v.vehicle_reg,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.drivers d
  set
    vehicle_reg = m.canonical_registration,
    assigned_vehicle_id = coalesce(d.assigned_vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(d.vehicle_reg) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.fuel_logs f
  set
    vehicle_reg = m.canonical_registration,
    vehicle_id = coalesce(f.vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(f.vehicle_reg) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.bank_transfers b
  set
    vehicle_reg = m.canonical_registration,
    vehicle_id = coalesce(b.vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(b.vehicle_reg) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.weekly_mileage w
  set
    vehicle_reg = m.canonical_registration,
    vehicle_id = coalesce(w.vehicle_id, v.id),
    driver_name_snapshot = coalesce(nullif(btrim(w.driver_name_snapshot), ''), nullif(btrim(d.name), ''))
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  left join public.drivers d on d.id = w.driver_id
  where public.normalize_vehicle_registration_key(w.vehicle_reg) = m.source_registration_key;

  update public.weekly_mileage w
  set driver_name_snapshot = 'Theeraphat'
  from public.drivers d
  where d.id = w.driver_id
    and public.normalize_vehicle_registration_key(w.vehicle_reg) = public.normalize_vehicle_registration_key('78-6996')
    and public.normalize_vehicle_registration_key(d.name) = public.normalize_vehicle_registration_key('Dummy')
    and (w.driver_name_snapshot is null or public.normalize_vehicle_registration_key(w.driver_name_snapshot) = public.normalize_vehicle_registration_key('Dummy'));

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.vehicle_service_logs s
  set
    vehicle_reg = m.canonical_registration,
    vehicle_id = coalesce(s.vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(s.vehicle_reg) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.vehicle_monthly_performance vp
  set
    vehicle_registration = m.canonical_registration,
    vehicle_id = coalesce(vp.vehicle_id, v.id),
    updated_at = now()
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(vp.vehicle_registration) = m.source_registration_key
    and not exists (
      select 1
      from public.vehicle_monthly_performance existing
      where existing.id <> vp.id
        and coalesce(existing.user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(vp.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and existing.year = vp.year
        and existing.month = vp.month
        and public.normalize_vehicle_registration_key(existing.vehicle_registration) = m.canonical_registration_key
    );

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.booking_diary bd
  set
    vehicle_registration = case when public.normalize_vehicle_registration_key(bd.vehicle_registration) = m.source_registration_key then m.canonical_registration else bd.vehicle_registration end,
    vehicle = case when public.normalize_vehicle_registration_key(bd.vehicle) = m.source_registration_key then m.canonical_registration else bd.vehicle end,
    vehicle_id = coalesce(bd.vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(bd.vehicle_registration) = m.source_registration_key
     or public.normalize_vehicle_registration_key(bd.vehicle) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.trip_journeys t
  set
    vehicle_reg = m.canonical_registration,
    vehicle_id = coalesce(t.vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(t.vehicle_reg) = m.source_registration_key;

  with mappings as (
    select *
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  canonical_vehicles as (
    select distinct on (public.normalize_vehicle_registration_key(v.vehicle_reg))
      v.id,
      public.normalize_vehicle_registration_key(v.vehicle_reg) as registration_key
    from public.vehicles v
    order by public.normalize_vehicle_registration_key(v.vehicle_reg), v.active desc, v.updated_at desc nulls last, v.created_at desc
  )
  update public.shipments sh
  set
    vehicle_reg = case when public.normalize_vehicle_registration_key(sh.vehicle_reg) = m.source_registration_key then m.canonical_registration else sh.vehicle_reg end,
    vehicle_reg_snapshot = case when public.normalize_vehicle_registration_key(sh.vehicle_reg_snapshot) = m.source_registration_key then m.canonical_registration else sh.vehicle_reg_snapshot end,
    vehicle_id = coalesce(sh.vehicle_id, v.id)
  from mappings m
  left join canonical_vehicles v on v.registration_key = m.canonical_registration_key
  where public.normalize_vehicle_registration_key(sh.vehicle_reg) = m.source_registration_key
     or public.normalize_vehicle_registration_key(sh.vehicle_reg_snapshot) = m.source_registration_key;

  with mappings as (
    select source_registration, canonical_registration
    from public.vehicle_registration_aliases
    where source_registration_key in (
      public.normalize_vehicle_registration_key('9565'),
      public.normalize_vehicle_registration_key('4565'),
      public.normalize_vehicle_registration_key('8453')
    )
  ),
  rows as (
    select m.source_registration, m.canonical_registration, 'vehicles.vehicle_reg' as target, count(*) filter (where public.normalize_vehicle_registration_key(v.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)) as old_remaining, count(*) filter (where public.normalize_vehicle_registration_key(v.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) as new_count from mappings m cross join public.vehicles v group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'drivers.vehicle_reg' as target, count(*) filter (where public.normalize_vehicle_registration_key(d.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)) as old_remaining, count(*) filter (where public.normalize_vehicle_registration_key(d.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) as new_count from mappings m cross join public.drivers d group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'fuel_logs.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(f.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(f.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.fuel_logs f group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'bank_transfers.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(b.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(b.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.bank_transfers b group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'weekly_mileage.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(w.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(w.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.weekly_mileage w group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'vehicle_service_logs.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(s.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(s.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.vehicle_service_logs s group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'vehicle_monthly_performance.vehicle_registration', count(*) filter (where public.normalize_vehicle_registration_key(vp.vehicle_registration) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(vp.vehicle_registration) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.vehicle_monthly_performance vp group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'booking_diary.vehicle_registration', count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle_registration) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle_registration) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.booking_diary bd group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'booking_diary.vehicle', count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(bd.vehicle) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.booking_diary bd group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'trip_journeys.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(t.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(t.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.trip_journeys t group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'shipments.vehicle_reg', count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.shipments sh group by 1, 2
    union all
    select m.source_registration, m.canonical_registration, 'shipments.vehicle_reg_snapshot', count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg_snapshot) = public.normalize_vehicle_registration_key(m.source_registration)), count(*) filter (where public.normalize_vehicle_registration_key(sh.vehicle_reg_snapshot) = public.normalize_vehicle_registration_key(m.canonical_registration)) from mappings m cross join public.shipments sh group by 1, 2
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by source_registration, target), '[]'::jsonb)
  into after_counts
  from rows;

  raise notice 'vehicle registration history counts after: %', after_counts;
end $$;

commit;
