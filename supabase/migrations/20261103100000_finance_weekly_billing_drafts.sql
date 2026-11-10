-- Development review only. Requires the verification, paperwork, and expenses/pricing migrations.
-- Draft identifiers are internal UUID-derived labels. No issued TRN sequence or invoice exists here.
begin;

create table public.finance_billing_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  week_start date not null check (extract(isodow from week_start)=1),
  week_end date generated always as (week_start+6) stored,
  status text not null default 'open' check (status in ('open','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index finance_one_open_customer_week on public.finance_billing_batches(client_id,week_start) where status='open';

create table public.finance_draft_trns (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.finance_billing_batches(id) on delete restrict,
  draft_identifier text not null unique,
  status text not null default 'draft' check (status in ('draft','cancelled')),
  validation_status text not null default 'current' check (validation_status in ('current','stale')),
  revision_number integer not null default 0 check (revision_number >= 0),
  current_revision_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.finance_draft_revisions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.finance_draft_trns(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  action text not null check (action in ('created','amended')),
  total_thb numeric(12,2) not null check (total_thb > 0 and total_thb <= 9999999999.99),
  line_count integer not null check (line_count between 1 and 100),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  unique(draft_id,revision_number),
  unique(draft_id,id)
);
alter table public.finance_draft_trns add constraint finance_current_draft_revision
  foreign key (id,current_revision_id) references public.finance_draft_revisions(draft_id,id) on delete restrict;

create table public.finance_draft_revision_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.finance_draft_revisions(id) on delete restrict,
  position integer not null check (position between 1 and 100),
  booking_id uuid not null,
  work_order_number text not null check (length(btrim(work_order_number)) > 0),
  booking_snapshot jsonb not null,
  pricing_snapshot jsonb not null,
  amount_thb numeric(12,2) not null check (amount_thb >= 0 and amount_thb <= 9999999999.99),
  unique(revision_id,position),
  unique(revision_id,booking_id)
);

-- Current allocation is the only mutable projection. Every change creates an immutable
-- full draft revision and an append-only event in the same transaction.
create table public.finance_billing_allocations (
  booking_id uuid primary key,
  client_id uuid not null references public.clients(id) on delete restrict,
  work_order_number text not null,
  draft_id uuid not null references public.finance_draft_trns(id) on delete restrict,
  revision_id uuid not null references public.finance_draft_revisions(id) on delete restrict,
  allocated_at timestamptz not null default now()
);
create unique index finance_one_active_work_order on public.finance_billing_allocations(client_id,lower(btrim(work_order_number)));
create index finance_allocations_draft on public.finance_billing_allocations(draft_id);

create table public.finance_billing_events (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.finance_draft_trns(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('created','amended','cancelled','stale')),
  details jsonb not null,
  occurred_at timestamptz not null default now()
);
create index finance_billing_events_draft_time on public.finance_billing_events(draft_id,occurred_at,id);

create trigger finance_draft_revisions_immutable before update or delete on public.finance_draft_revisions for each row execute function public.finance_reject_history_change();
create trigger finance_draft_lines_immutable before update or delete on public.finance_draft_revision_lines for each row execute function public.finance_reject_history_change();
create trigger finance_billing_events_immutable before update or delete on public.finance_billing_events for each row execute function public.finance_reject_history_change();

alter table public.finance_billing_batches enable row level security;
alter table public.finance_draft_trns enable row level security;
alter table public.finance_draft_revisions enable row level security;
alter table public.finance_draft_revision_lines enable row level security;
alter table public.finance_billing_allocations enable row level security;
alter table public.finance_billing_events enable row level security;
revoke all on public.finance_billing_batches,public.finance_draft_trns,public.finance_draft_revisions,
  public.finance_draft_revision_lines,public.finance_billing_allocations,public.finance_billing_events from public,anon,authenticated;
grant select on public.finance_billing_batches,public.finance_draft_trns,public.finance_draft_revisions,
  public.finance_draft_revision_lines,public.finance_billing_allocations,public.finance_billing_events to authenticated;
create policy finance_batches_read on public.finance_billing_batches for select to authenticated
  using (public.finance_has_capability('finance_reviewer') and exists(select 1 from public.clients c where c.id=public.finance_billing_batches.client_id));
create policy finance_drafts_read on public.finance_draft_trns for select to authenticated
  using (exists(select 1 from public.finance_billing_batches b where b.id=batch_id));
create policy finance_draft_revisions_read on public.finance_draft_revisions for select to authenticated
  using (exists(select 1 from public.finance_draft_trns d where d.id=draft_id));
create policy finance_draft_lines_read on public.finance_draft_revision_lines for select to authenticated
  using (exists(select 1 from public.finance_draft_revisions r where r.id=revision_id));
create policy finance_allocations_read on public.finance_billing_allocations for select to authenticated
  using (public.finance_has_capability('finance_reviewer') and exists(select 1 from public.booking_diary b where b.id=public.finance_billing_allocations.booking_id));
create policy finance_billing_events_read on public.finance_billing_events for select to authenticated
  using (exists(select 1 from public.finance_draft_trns d where d.id=draft_id));

create function public.finance_billing_candidate(p_booking_id uuid,p_draft_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_booking public.booking_diary%rowtype; v_price public.finance_job_price_revisions%rowtype;
  v_alloc public.finance_billing_allocations%rowtype; v_hold text := null;
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501'; end if;
  select * into v_booking from public.booking_diary where id=p_booking_id;
  if not found then return jsonb_build_object('ready',false,'hold','booking_missing'); end if;
  select * into v_alloc from public.finance_billing_allocations where booking_id=p_booking_id;
  select * into v_price from public.finance_job_price_revisions where booking_id=p_booking_id order by created_at desc,id desc limit 1;
  if v_alloc.booking_id is not null and v_alloc.draft_id is distinct from p_draft_id then v_hold:='allocated';
  elsif exists(select 1 from public.finance_discrepancies where booking_id=p_booking_id and status='open') then v_hold:='management_hold';
  elsif not exists(select 1 from public.finance_job_verifications where booking_id=p_booking_id and status='verified' and handover_status='ready') then v_hold:='paperwork_or_verification';
  elsif v_price.id is null then v_hold:='price_missing';
  elsif not exists(select 1 from public.finance_pricing_decisions where revision_id=v_price.id and decision='approved') then v_hold:='price_approval';
  elsif exists(select 1 from public.finance_expense_events e left join public.finance_expense_decisions d on d.event_id=e.id where e.booking_id=p_booking_id and d.event_id is null) then v_hold:='expense_approval';
  elsif not public.finance_job_pricing_ready(p_booking_id) then v_hold:='booking_or_price_changed'; end if;
  return jsonb_build_object('ready',v_hold is null,'hold',v_hold,'price_revision_id',v_price.id,
    'selling_price_thb',case when v_hold is null then v_price.selling_price_thb else null end,
    'allocated_draft_id',v_alloc.draft_id);
end $$;

-- Internal full-revision replacement. Lock the draft and all selected bookings; the
-- allocation primary key and work-order index arbitrate overlapping finance users.
create function public.finance_replace_draft_lines(p_draft_id uuid,p_booking_ids uuid[],p_expected_revision integer)
returns public.finance_draft_revisions language plpgsql security definer set search_path = '' as $$
declare v_draft public.finance_draft_trns%rowtype; v_batch public.finance_billing_batches%rowtype;
  v_booking public.booking_diary%rowtype; v_price public.finance_job_price_revisions%rowtype;
  v_revision public.finance_draft_revisions%rowtype; v_booking_id uuid; v_line jsonb; v_lines jsonb := '[]';
  v_total numeric(12,2) := 0; v_pos integer; v_old_ids uuid[];
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501'; end if;
  select * into v_draft from public.finance_draft_trns where id=p_draft_id for update;
  if not found or v_draft.status<>'draft' then raise exception 'ACTIVE_DRAFT_REQUIRED' using errcode='23514'; end if;
  if p_expected_revision is null or v_draft.revision_number<>p_expected_revision then
    raise exception 'DRAFT_REVISION_CONFLICT' using errcode='40001'; end if;
  if v_draft.revision_number>0 and v_draft.validation_status='current' and p_booking_ids=(
    select array_agg(booking_id order by position) from public.finance_draft_revision_lines
    where revision_id=v_draft.current_revision_id) then
    raise exception 'DRAFT_UNCHANGED' using errcode='23514'; end if;
  select * into v_batch from public.finance_billing_batches where id=v_draft.batch_id for update;
  if v_batch.status<>'open' then raise exception 'ACTIVE_BATCH_REQUIRED' using errcode='23514'; end if;
  if p_booking_ids is null or cardinality(p_booking_ids) not between 1 and 100
    or array_position(p_booking_ids,null) is not null
    or (select count(distinct u.id) from unnest(p_booking_ids) as u(id))<>cardinality(p_booking_ids) then
    raise exception 'INVALID_DRAFT_LINES' using errcode='22023'; end if;
  -- Lock in UUID order to avoid deadlocks when two finance users share candidate jobs.
  perform 1 from public.booking_diary where id=any(p_booking_ids) order by id for update;
  if (select count(*) from public.booking_diary where id=any(p_booking_ids))<>cardinality(p_booking_ids) then
    raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  select array_agg(booking_id order by booking_id) into v_old_ids from public.finance_billing_allocations where draft_id=p_draft_id;
  for v_booking_id in select item.id from unnest(p_booking_ids) with ordinality item(id,position) order by item.position loop
    select * into v_booking from public.booking_diary where id=v_booking_id;
    if v_booking.client_id is distinct from v_batch.client_id or v_booking.booking_date not between v_batch.week_start and v_batch.week_end
      or nullif(btrim(coalesce(v_booking.job_order_number,'')),'') is null then
      raise exception 'BILLING_CUSTOMER_WEEK_OR_WORK_ORDER_MISMATCH' using errcode='23514'; end if;
    if not public.finance_job_pricing_ready(v_booking_id) then raise exception 'BILLING_JOB_NOT_READY' using errcode='23514'; end if;
    if exists(select 1 from public.finance_billing_allocations where booking_id=v_booking_id and draft_id<>p_draft_id) then
      raise exception 'WORK_ORDER_ALREADY_ALLOCATED' using errcode='23505'; end if;
    select * into v_price from public.finance_job_price_revisions where booking_id=v_booking_id order by created_at desc,id desc limit 1;
    v_total:=v_total+v_price.selling_price_thb;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('booking_id',v_booking.id,'work_order_number',v_booking.job_order_number,
      'booking_snapshot',jsonb_build_object('booking_id',v_booking.booking_id,'booking_date',v_booking.booking_date,
        'client_id',v_booking.client_id,'pickup',v_booking.pickup,'dropoff',v_booking.dropoff,'driver',v_booking.driver,
        'vehicle',v_booking.vehicle,'vehicle_registration',v_booking.vehicle_registration,'job_order_number',v_booking.job_order_number),
      'pricing_snapshot',jsonb_build_object('revision_id',v_price.id,'source',v_price.source,'price_list_version_id',v_price.price_list_version_id,
        'original_price_thb',v_price.original_price_thb,'selling_price_thb',v_price.selling_price_thb,
        'override_reason',v_price.override_reason,'approved_by',(select decided_by from public.finance_pricing_decisions where revision_id=v_price.id)),
      'amount_thb',v_price.selling_price_thb));
  end loop;
  if v_total<=0 or v_total>9999999999.99 then raise exception 'INVALID_DRAFT_TOTAL' using errcode='22023'; end if;
  insert into public.finance_draft_revisions(draft_id,revision_number,action,total_thb,line_count,changed_by)
    values(p_draft_id,v_draft.revision_number+1,case when v_draft.revision_number=0 then 'created' else 'amended' end,
      v_total,cardinality(p_booking_ids),auth.uid()) returning * into v_revision;
  for v_line,v_pos in select value,ordinality::integer from jsonb_array_elements(v_lines) with ordinality loop
    insert into public.finance_draft_revision_lines(revision_id,position,booking_id,work_order_number,booking_snapshot,pricing_snapshot,amount_thb)
      values(v_revision.id,v_pos,(v_line->>'booking_id')::uuid,v_line->>'work_order_number',v_line->'booking_snapshot',
        v_line->'pricing_snapshot',(v_line->>'amount_thb')::numeric);
  end loop;
  delete from public.finance_billing_allocations where draft_id=p_draft_id;
  insert into public.finance_billing_allocations(booking_id,client_id,work_order_number,draft_id,revision_id)
    select (value->>'booking_id')::uuid,v_batch.client_id,value->>'work_order_number',p_draft_id,v_revision.id
    from jsonb_array_elements(v_lines);
  update public.finance_draft_trns set revision_number=v_revision.revision_number,current_revision_id=v_revision.id,
    validation_status='current' where id=p_draft_id;
  insert into public.finance_billing_events(draft_id,actor_id,event_type,details)
    values(p_draft_id,auth.uid(),v_revision.action,jsonb_build_object('revision_id',v_revision.id,'revision_number',v_revision.revision_number,
      'prior_booking_ids',coalesce(v_old_ids,'{}'::uuid[]),'booking_ids',p_booking_ids,'total_thb',v_total));
  return v_revision;
end $$;

create function public.finance_create_weekly_draft(p_client_id uuid,p_week_start date,p_booking_ids uuid[])
returns public.finance_draft_trns language plpgsql security definer set search_path = '' as $$
declare v_batch public.finance_billing_batches%rowtype; v_draft public.finance_draft_trns%rowtype;
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501'; end if;
  if p_week_start is null or extract(isodow from p_week_start)<>1 or not exists(select 1 from public.clients where id=p_client_id) then
    raise exception 'INVALID_CUSTOMER_OR_WEEK' using errcode='22023'; end if;
  insert into public.finance_billing_batches(client_id,week_start,created_by)
    values(p_client_id,p_week_start,auth.uid()) returning * into v_batch;
  v_draft.id:=gen_random_uuid();
  insert into public.finance_draft_trns(id,batch_id,draft_identifier,created_by)
    values(v_draft.id,v_batch.id,'DRAFT-'||upper(replace(v_draft.id::text,'-','')),auth.uid()) returning * into v_draft;
  perform public.finance_replace_draft_lines(v_draft.id,p_booking_ids,0);
  select * into v_draft from public.finance_draft_trns where id=v_draft.id;
  return v_draft;
end $$;

create function public.finance_amend_weekly_draft(p_draft_id uuid,p_booking_ids uuid[],p_expected_revision integer)
returns public.finance_draft_revisions language plpgsql security definer set search_path = '' as $$
begin return public.finance_replace_draft_lines(p_draft_id,p_booking_ids,p_expected_revision); end $$;

create function public.finance_cancel_weekly_draft(p_draft_id uuid,p_expected_revision integer,p_reason text)
returns public.finance_draft_trns language plpgsql security definer set search_path = '' as $$
declare v_draft public.finance_draft_trns%rowtype; v_ids uuid[];
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  select * into v_draft from public.finance_draft_trns where id=p_draft_id for update;
  if not found or v_draft.status<>'draft' then raise exception 'ACTIVE_DRAFT_REQUIRED' using errcode='23514'; end if;
  if p_expected_revision is null or v_draft.revision_number<>p_expected_revision then
    raise exception 'DRAFT_REVISION_CONFLICT' using errcode='40001'; end if;
  select array_agg(booking_id order by booking_id) into v_ids from public.finance_billing_allocations where draft_id=p_draft_id;
  delete from public.finance_billing_allocations where draft_id=p_draft_id;
  update public.finance_draft_trns set status='cancelled',validation_status='stale' where id=p_draft_id returning * into v_draft;
  update public.finance_billing_batches set status='cancelled' where id=v_draft.batch_id;
  insert into public.finance_billing_events(draft_id,actor_id,event_type,details)
    values(p_draft_id,auth.uid(),'cancelled',jsonb_build_object('reason',btrim(p_reason),'released_booking_ids',coalesce(v_ids,'{}'::uuid[])));
  return v_draft;
end $$;

create function public.finance_stale_booking_drafts() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_booking_id uuid; v_client_id uuid; v_route text; v_effective date;
begin
  if tg_table_name='finance_price_list_versions' then
    v_client_id:=new.client_id; v_route:=new.route_key; v_effective:=new.effective_from;
    with changed as (
      update public.finance_draft_trns d set validation_status='stale'
      where d.status='draft' and d.validation_status='current' and exists(
        select 1 from public.finance_billing_allocations a join public.booking_diary b on b.id=a.booking_id
        where a.draft_id=d.id and b.client_id=v_client_id and b.booking_date>=v_effective
          and btrim(b.pickup)||' → '||btrim(b.dropoff)=v_route) returning d.id)
    insert into public.finance_billing_events(draft_id,actor_id,event_type,details)
      select id,auth.uid(),'stale',jsonb_build_object('source',tg_table_name,'client_id',v_client_id) from changed;
    return new;
  end if;
  if tg_table_name='finance_expense_decisions' then
    select booking_id into v_booking_id from public.finance_expense_events where id=new.event_id;
  elsif tg_table_name='finance_pricing_decisions' then
    select booking_id into v_booking_id from public.finance_job_price_revisions where id=new.revision_id;
  elsif tg_table_name='finance_paperwork_documents' then v_booking_id:=new.booking_id;
  elsif tg_table_name='booking_diary' then v_booking_id:=case when tg_op='DELETE' then old.id else new.id end;
  else v_booking_id:=new.booking_id; end if;
  with changed as (
    update public.finance_draft_trns d set validation_status='stale'
    where d.status='draft' and d.validation_status='current' and exists(
      select 1 from public.finance_billing_allocations a where a.draft_id=d.id and a.booking_id=v_booking_id) returning d.id)
  insert into public.finance_billing_events(draft_id,actor_id,event_type,details)
    select id,auth.uid(),'stale',jsonb_build_object('source',tg_table_name,'booking_id',v_booking_id) from changed;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger finance_draft_stale_booking after update of booking_date,client_id,pickup,dropoff,driver,vehicle,vehicle_registration,job_order_number,status or delete on public.booking_diary
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_verification after insert or update on public.finance_job_verifications
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_paperwork after update of status on public.finance_paperwork_documents
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_expense after insert on public.finance_expense_events
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_expense_decision after insert on public.finance_expense_decisions
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_price after insert on public.finance_job_price_revisions
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_price_decision after insert on public.finance_pricing_decisions
  for each row execute function public.finance_stale_booking_drafts();
create trigger finance_draft_stale_price_list after insert on public.finance_price_list_versions
  for each row execute function public.finance_stale_booking_drafts();

revoke all on function public.finance_billing_candidate(uuid,uuid),public.finance_replace_draft_lines(uuid,uuid[],integer),
  public.finance_create_weekly_draft(uuid,date,uuid[]),public.finance_amend_weekly_draft(uuid,uuid[],integer),
  public.finance_cancel_weekly_draft(uuid,integer,text),public.finance_stale_booking_drafts() from public,anon,authenticated;
grant execute on function public.finance_billing_candidate(uuid,uuid),public.finance_create_weekly_draft(uuid,date,uuid[]),
  public.finance_amend_weekly_draft(uuid,uuid[],integer),public.finance_cancel_weekly_draft(uuid,integer,text) to authenticated;
commit;
