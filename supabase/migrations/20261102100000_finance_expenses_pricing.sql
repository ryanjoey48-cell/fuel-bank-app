-- Development review only. Apply after the verification and paperwork migrations.
begin;

alter table public.finance_role_grants drop constraint finance_role_grants_capability_check;
alter table public.finance_role_grants add constraint finance_role_grants_capability_check
  check (capability in ('management_reviewer','finance_reviewer','invoice_approver','expense_approver','pricing_approver'));

create function public.finance_has_capability(p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_office_account()
    and public.current_account_role() in ('admin','office_staff')
    and exists(select 1 from public.finance_role_grants where user_id=auth.uid() and capability=p_capability);
$$;

create table public.finance_expense_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  category text not null check (category in ('driver_trip','toll','parking','overtime','container_pickup','overnight','other')),
  event_kind text not null check (event_kind in ('charge','adjustment','reversal')),
  amount_delta numeric(12,2) not null check (amount_delta <> 0 and abs(amount_delta) <= 9999999999.99),
  incurred_on date not null,
  evidence_id uuid references public.finance_paperwork_documents(id) on delete restrict,
  receipt_reference text,
  missing_receipt_reason text,
  corrects_event_id uuid references public.finance_expense_events(id) on delete restrict,
  note text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((event_kind='charge' and amount_delta>0 and corrects_event_id is null)
    or (event_kind in ('adjustment','reversal') and corrects_event_id is not null)),
  check (evidence_id is not null or nullif(btrim(coalesce(receipt_reference,'')),'') is not null
    or length(btrim(coalesce(missing_receipt_reason,''))) >= 10)
);
create unique index finance_expense_one_reversal on public.finance_expense_events(corrects_event_id) where event_kind='reversal';
create unique index finance_expense_one_charge_per_document on public.finance_expense_events(booking_id,category,evidence_id)
  where event_kind='charge' and evidence_id is not null;
create unique index finance_expense_one_charge_per_reference on public.finance_expense_events(booking_id,category,lower(btrim(receipt_reference)))
  where event_kind='charge' and receipt_reference is not null;
create index finance_expense_booking_time on public.finance_expense_events(booking_id,created_at,id);

create table public.finance_expense_decisions (
  event_id uuid primary key references public.finance_expense_events(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reason text not null check (length(btrim(reason)) >= 10),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);

-- A version is immutable. The latest effective date on or before the job date wins.
-- Billing inclusions are explicit customer terms, never inferred from internal expenses.
create table public.finance_price_list_versions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  route_key text not null check (length(btrim(route_key)) between 3 and 200),
  effective_from date not null,
  amount_thb numeric(12,2) not null check (amount_thb >= 0 and amount_thb <= 9999999999.99),
  included_expense_categories text[] not null default '{}',
  terms_note text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(client_id,route_key,effective_from),
  check (included_expense_categories <@ array['driver_trip','toll','parking','overtime','container_pickup','overnight','other']::text[])
);
create index finance_price_list_lookup on public.finance_price_list_versions(client_id,route_key,effective_from desc);

create table public.finance_job_price_revisions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  source text not null check (source in ('price_list','manual')),
  price_list_version_id uuid references public.finance_price_list_versions(id) on delete restrict,
  original_price_thb numeric(12,2) check (original_price_thb >= 0 and original_price_thb <= 9999999999.99),
  selling_price_thb numeric(12,2) not null check (selling_price_thb >= 0 and selling_price_thb <= 9999999999.99),
  override_reason text,
  booking_snapshot jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((source='price_list' and price_list_version_id is not null and original_price_thb=selling_price_thb and override_reason is null)
    or (source='manual' and length(btrim(coalesce(override_reason,'')))>=10))
);
create index finance_price_revision_booking_time on public.finance_job_price_revisions(booking_id,created_at,id);

create table public.finance_pricing_decisions (
  revision_id uuid primary key references public.finance_job_price_revisions(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reason text not null check (length(btrim(reason)) >= 10),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);

create table public.finance_cost_price_audit (
  id bigint generated always as identity primary key,
  booking_id uuid,
  client_id uuid references public.clients(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('expense_added','expense_decided','price_list_version_added','job_price_proposed','job_price_decided')),
  details jsonb not null,
  occurred_at timestamptz not null default now()
);
create index finance_cost_price_audit_booking_time on public.finance_cost_price_audit(booking_id,occurred_at,id);

create function public.finance_reject_history_change() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'FINANCE_APPEND_ONLY' using errcode='42501'; end $$;
create trigger finance_expense_immutable before update or delete on public.finance_expense_events for each row execute function public.finance_reject_history_change();
create trigger finance_expense_decision_immutable before update or delete on public.finance_expense_decisions for each row execute function public.finance_reject_history_change();
create trigger finance_price_list_immutable before update or delete on public.finance_price_list_versions for each row execute function public.finance_reject_history_change();
create trigger finance_job_price_immutable before update or delete on public.finance_job_price_revisions for each row execute function public.finance_reject_history_change();
create trigger finance_pricing_decision_immutable before update or delete on public.finance_pricing_decisions for each row execute function public.finance_reject_history_change();
create trigger finance_cost_price_audit_immutable before update or delete on public.finance_cost_price_audit for each row execute function public.finance_reject_history_change();

alter table public.finance_expense_events enable row level security;
alter table public.finance_expense_decisions enable row level security;
alter table public.finance_price_list_versions enable row level security;
alter table public.finance_job_price_revisions enable row level security;
alter table public.finance_pricing_decisions enable row level security;
alter table public.finance_cost_price_audit enable row level security;
revoke all on public.finance_expense_events,public.finance_expense_decisions,public.finance_price_list_versions,
  public.finance_job_price_revisions,public.finance_pricing_decisions,public.finance_cost_price_audit from public,anon,authenticated;
grant select on public.finance_expense_events,public.finance_expense_decisions,public.finance_price_list_versions,
  public.finance_job_price_revisions,public.finance_pricing_decisions,public.finance_cost_price_audit to authenticated;
create policy finance_expense_read on public.finance_expense_events for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('expense_approver')) and exists(select 1 from public.booking_diary b where b.id=public.finance_expense_events.booking_id));
create policy finance_expense_decision_read on public.finance_expense_decisions for select to authenticated
  using (exists(select 1 from public.finance_expense_events e where e.id=event_id));
create policy finance_price_list_read on public.finance_price_list_versions for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('pricing_approver')) and exists(select 1 from public.clients c where c.id=public.finance_price_list_versions.client_id));
create policy finance_job_price_read on public.finance_job_price_revisions for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('pricing_approver')) and exists(select 1 from public.booking_diary b where b.id=public.finance_job_price_revisions.booking_id));
create policy finance_pricing_decision_read on public.finance_pricing_decisions for select to authenticated
  using (exists(select 1 from public.finance_job_price_revisions p where p.id=revision_id));
create policy finance_cost_price_audit_read on public.finance_cost_price_audit for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('expense_approver') or public.finance_has_capability('pricing_approver'))
    and ((booking_id is not null and exists(select 1 from public.booking_diary b where b.id=public.finance_cost_price_audit.booking_id))
      or (client_id is not null and exists(select 1 from public.clients c where c.id=public.finance_cost_price_audit.client_id))));

create function public.finance_record_expense(p_booking_id uuid,p_category text,p_amount numeric,p_incurred_on date,
  p_evidence_id uuid,p_receipt_reference text,p_missing_reason text,p_note text,p_corrects_event_id uuid default null,p_reversal boolean default false)
returns public.finance_expense_events language plpgsql security definer set search_path = '' as $$
declare v_row public.finance_expense_events%rowtype; v_prior public.finance_expense_events%rowtype;
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.booking_diary where id=p_booking_id) then raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.finance_job_verifications where booking_id=p_booking_id and status='verified' and handover_status='ready')
    or exists(select 1 from public.finance_discrepancies where booking_id=p_booking_id and status='open') then
    raise exception 'JOB_VERIFICATION_REQUIRED' using errcode='23514'; end if;
  if p_category not in ('driver_trip','toll','parking','overtime','container_pickup','overnight','other')
    or p_incurred_on is null or p_amount is null or p_amount=0 or abs(p_amount)>9999999999.99 or p_amount<>round(p_amount,2) then
    raise exception 'INVALID_EXPENSE' using errcode='22023'; end if;
  if p_evidence_id is not null and not exists(select 1 from public.finance_paperwork_documents
    where id=p_evidence_id and booking_id=p_booking_id and status='reviewed'
      and (p_category not in ('toll','parking') or kind=case when p_category='toll' then 'toll_receipt' else 'parking_receipt' end)) then
    raise exception 'REVIEWED_RECEIPT_REQUIRED' using errcode='23514'; end if;
  if p_evidence_id is null and nullif(btrim(coalesce(p_receipt_reference,'')),'') is null
    and length(btrim(coalesce(p_missing_reason,'')))<10 then
    raise exception 'MISSING_RECEIPT_REASON_REQUIRED' using errcode='22023'; end if;
  if p_corrects_event_id is not null then
    select * into v_prior from public.finance_expense_events where id=p_corrects_event_id and booking_id=p_booking_id for update;
    if not found or v_prior.category<>p_category then raise exception 'INVALID_EXPENSE_CORRECTION' using errcode='23514'; end if;
    if p_reversal and (p_amount<>-v_prior.amount_delta or exists(select 1 from public.finance_expense_events
      where corrects_event_id=p_corrects_event_id and event_kind='reversal')) then
      raise exception 'INVALID_EXPENSE_REVERSAL' using errcode='23514'; end if;
  elsif p_reversal then raise exception 'INVALID_EXPENSE_REVERSAL' using errcode='23514';
  elsif p_amount<0 then raise exception 'INVALID_EXPENSE' using errcode='22023'; end if;
  insert into public.finance_expense_events(booking_id,category,event_kind,amount_delta,incurred_on,evidence_id,
    receipt_reference,missing_receipt_reason,corrects_event_id,note,created_by)
  values(p_booking_id,p_category,case when p_reversal then 'reversal' when p_corrects_event_id is not null then 'adjustment' else 'charge' end,
    p_amount,p_incurred_on,p_evidence_id,nullif(btrim(p_receipt_reference),''),nullif(btrim(p_missing_reason),''),p_corrects_event_id,coalesce(p_note,''),auth.uid()) returning * into v_row;
  insert into public.finance_cost_price_audit(booking_id,actor_id,event_type,details)
    values(p_booking_id,auth.uid(),'expense_added',jsonb_build_object('event_id',v_row.id,'category',v_row.category,'kind',v_row.event_kind,'amount_delta',v_row.amount_delta,'evidence_id',v_row.evidence_id,'corrects_event_id',v_row.corrects_event_id));
  return v_row;
end $$;

create function public.finance_decide_expense(p_event_id uuid,p_approved boolean,p_reason text)
returns public.finance_expense_decisions language plpgsql security definer set search_path = '' as $$
declare v_event public.finance_expense_events%rowtype; v_row public.finance_expense_decisions%rowtype;
begin
  if not public.finance_has_capability('expense_approver') then raise exception 'EXPENSE_APPROVER_REQUIRED' using errcode='42501'; end if;
  select * into v_event from public.finance_expense_events where id=p_event_id for update;
  if not found or not exists(select 1 from public.booking_diary where id=v_event.booking_id) then raise exception 'EXPENSE_NOT_FOUND' using errcode='P0002'; end if;
  if v_event.created_by=auth.uid() then raise exception 'SELF_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  if p_approved is null or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'DECISION_REASON_REQUIRED' using errcode='22023'; end if;
  insert into public.finance_expense_decisions(event_id,decision,reason,decided_by)
    values(p_event_id,case when p_approved then 'approved' else 'rejected' end,btrim(p_reason),auth.uid()) returning * into v_row;
  insert into public.finance_cost_price_audit(booking_id,actor_id,event_type,details)
    values(v_event.booking_id,auth.uid(),'expense_decided',jsonb_build_object('event_id',p_event_id,'decision',v_row.decision,'reason',v_row.reason));
  return v_row;
end $$;

create function public.finance_add_price_list_version(p_client_id uuid,p_route_key text,p_effective_from date,
  p_amount numeric,p_included text[] default '{}',p_terms text default '')
returns public.finance_price_list_versions language plpgsql security definer set search_path = '' as $$
declare v_row public.finance_price_list_versions%rowtype;
begin
  if not public.finance_has_capability('pricing_approver') then raise exception 'PRICING_APPROVER_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  if p_effective_from is null or length(btrim(coalesce(p_route_key,''))) not between 3 and 200
    or p_amount is null or p_amount<0 or p_amount>9999999999.99 or p_amount<>round(p_amount,2)
    or p_included is null or not (p_included <@ array['driver_trip','toll','parking','overtime','container_pickup','overnight','other']::text[]) then
    raise exception 'INVALID_PRICE_LIST_VERSION' using errcode='22023'; end if;
  insert into public.finance_price_list_versions(client_id,route_key,effective_from,amount_thb,included_expense_categories,terms_note,created_by)
    values(p_client_id,btrim(p_route_key),p_effective_from,p_amount,p_included,coalesce(p_terms,''),auth.uid()) returning * into v_row;
  insert into public.finance_cost_price_audit(booking_id,client_id,actor_id,event_type,details)
    values(null,p_client_id,auth.uid(),'price_list_version_added',jsonb_build_object('version_id',v_row.id,'client_id',p_client_id,'route_key',v_row.route_key,'effective_from',p_effective_from,'amount_thb',p_amount));
  return v_row;
end $$;

create function public.finance_propose_job_price(p_booking_id uuid,p_price_list_version_id uuid,p_manual_amount numeric,p_reason text)
returns public.finance_job_price_revisions language plpgsql security definer set search_path = '' as $$
declare v_booking public.booking_diary%rowtype; v_list public.finance_price_list_versions%rowtype;
  v_row public.finance_job_price_revisions%rowtype; v_route text;
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501'; end if;
  select * into v_booking from public.booking_diary where id=p_booking_id for update;
  if not found or v_booking.client_id is null then raise exception 'BOOKING_CUSTOMER_REQUIRED' using errcode='23514'; end if;
  if not exists(select 1 from public.finance_job_verifications where booking_id=p_booking_id and status='verified' and handover_status='ready')
    or exists(select 1 from public.finance_discrepancies where booking_id=p_booking_id and status='open') then
    raise exception 'JOB_VERIFICATION_REQUIRED' using errcode='23514'; end if;
  v_route:=btrim(v_booking.pickup)||' → '||btrim(v_booking.dropoff);
  select * into v_list from public.finance_price_list_versions where client_id=v_booking.client_id
    and route_key=v_route and effective_from<=v_booking.booking_date order by effective_from desc limit 1;
  if p_price_list_version_id is not null then
    if not found or v_list.id<>p_price_list_version_id or p_manual_amount is not null then
      raise exception 'PRICE_LIST_VERSION_NOT_EFFECTIVE' using errcode='23514'; end if;
  elsif p_manual_amount is null or p_manual_amount<0 or p_manual_amount>9999999999.99
    or p_manual_amount<>round(p_manual_amount,2) or length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'MANUAL_PRICE_REASON_REQUIRED' using errcode='22023'; end if;
  insert into public.finance_job_price_revisions(booking_id,client_id,source,price_list_version_id,original_price_thb,
    selling_price_thb,override_reason,booking_snapshot,created_by)
    values(p_booking_id,v_booking.client_id,case when p_price_list_version_id is null then 'manual' else 'price_list' end,
      p_price_list_version_id,case when found then v_list.amount_thb else null end,
      case when p_price_list_version_id is null then p_manual_amount else v_list.amount_thb end,
      case when p_price_list_version_id is null then btrim(p_reason) else null end,
      jsonb_build_object('booking_date',v_booking.booking_date,'client_id',v_booking.client_id,'pickup',v_booking.pickup,'dropoff',v_booking.dropoff,'job_order_number',v_booking.job_order_number),auth.uid()) returning * into v_row;
  insert into public.finance_cost_price_audit(booking_id,actor_id,event_type,details)
    values(p_booking_id,auth.uid(),'job_price_proposed',jsonb_build_object('revision_id',v_row.id,'source',v_row.source,'original_price_thb',v_row.original_price_thb,'selling_price_thb',v_row.selling_price_thb,'override_reason',v_row.override_reason));
  return v_row;
end $$;

create function public.finance_decide_job_price(p_revision_id uuid,p_approved boolean,p_reason text)
returns public.finance_pricing_decisions language plpgsql security definer set search_path = '' as $$
declare v_price public.finance_job_price_revisions%rowtype; v_row public.finance_pricing_decisions%rowtype;
begin
  if not public.finance_has_capability('pricing_approver') then raise exception 'PRICING_APPROVER_REQUIRED' using errcode='42501'; end if;
  select * into v_price from public.finance_job_price_revisions where id=p_revision_id for update;
  if not found or not exists(select 1 from public.booking_diary where id=v_price.booking_id) then raise exception 'PRICE_REVISION_NOT_FOUND' using errcode='P0002'; end if;
  if v_price.created_by=auth.uid() then raise exception 'SELF_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  if p_approved is null or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'DECISION_REASON_REQUIRED' using errcode='22023'; end if;
  insert into public.finance_pricing_decisions(revision_id,decision,reason,decided_by)
    values(p_revision_id,case when p_approved then 'approved' else 'rejected' end,btrim(p_reason),auth.uid()) returning * into v_row;
  insert into public.finance_cost_price_audit(booking_id,actor_id,event_type,details)
    values(v_price.booking_id,auth.uid(),'job_price_decided',jsonb_build_object('revision_id',p_revision_id,'decision',v_row.decision,'reason',v_row.reason));
  return v_row;
end $$;

create function public.finance_job_pricing_ready(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.finance_has_capability('finance_reviewer') or public.finance_has_capability('pricing_approver') or public.finance_has_capability('expense_approver'))
    and exists(select 1 from public.booking_diary where id=p_booking_id)
    and exists(select 1 from public.finance_job_verifications where booking_id=p_booking_id and status='verified' and handover_status='ready')
    and not exists(select 1 from public.finance_discrepancies where booking_id=p_booking_id and status='open')
    and exists(select 1 from public.finance_job_price_revisions p
      join public.booking_diary b on b.id=p.booking_id
      left join public.finance_pricing_decisions d on d.revision_id=p.id
      where p.booking_id=p_booking_id and d.decision='approved'
        and p.booking_snapshot=jsonb_build_object('booking_date',b.booking_date,'client_id',b.client_id,'pickup',b.pickup,'dropoff',b.dropoff,'job_order_number',b.job_order_number)
        and (p.source='manual' or p.price_list_version_id=(select v.id from public.finance_price_list_versions v
          where v.client_id=b.client_id and v.route_key=btrim(b.pickup)||' → '||btrim(b.dropoff)
            and v.effective_from<=b.booking_date order by v.effective_from desc limit 1))
        and p.id=(select id from public.finance_job_price_revisions where booking_id=p_booking_id order by created_at desc,id desc limit 1))
    and not exists(select 1 from public.finance_expense_events e left join public.finance_expense_decisions d on d.event_id=e.id
      where e.booking_id=p_booking_id and d.event_id is null);
$$;

revoke all on function public.finance_has_capability(text),public.finance_record_expense(uuid,text,numeric,date,uuid,text,text,text,uuid,boolean),
  public.finance_decide_expense(uuid,boolean,text),public.finance_add_price_list_version(uuid,text,date,numeric,text[],text),
  public.finance_propose_job_price(uuid,uuid,numeric,text),public.finance_decide_job_price(uuid,boolean,text),
  public.finance_job_pricing_ready(uuid),public.finance_reject_history_change() from public,anon;
grant execute on function public.finance_has_capability(text),public.finance_record_expense(uuid,text,numeric,date,uuid,text,text,text,uuid,boolean),
  public.finance_decide_expense(uuid,boolean,text),public.finance_add_price_list_version(uuid,text,date,numeric,text[],text),
  public.finance_propose_job_price(uuid,uuid,numeric,text),public.finance_decide_job_price(uuid,boolean,text),
  public.finance_job_pricing_ready(uuid) to authenticated;
commit;
