-- Development review only. Requires weekly billing drafts migration.
-- Submissions and packs freeze approved draft snapshots. No issued TRN or invoice number.
begin;

-- Approvers must read the draft/batch chain without holding finance_reviewer.
drop policy if exists finance_batches_read on public.finance_billing_batches;
create policy finance_batches_read on public.finance_billing_batches for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('invoice_approver'))
    and exists(select 1 from public.clients c where c.id=public.finance_billing_batches.client_id));

-- Submission is the approval candidate. Decisions and packs are append-only history.
create table public.finance_invoice_submissions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.finance_draft_trns(id) on delete restrict,
  draft_revision_id uuid not null references public.finance_draft_revisions(id) on delete restrict,
  submission_number integer not null check (submission_number > 0),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','invalidated','withdrawn')),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  review_snapshot jsonb not null,
  unique(draft_id, submission_number),
  unique(draft_id, id)
);
create unique index finance_one_pending_invoice_submission
  on public.finance_invoice_submissions(draft_id) where status='pending';
create index finance_invoice_submissions_draft
  on public.finance_invoice_submissions(draft_id, submission_number desc);

create table public.finance_invoice_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.finance_invoice_submissions(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reason text not null check (length(btrim(reason)) >= 10),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);

create table public.finance_document_packs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.finance_draft_trns(id) on delete restrict,
  submission_id uuid not null references public.finance_invoice_submissions(id) on delete restrict,
  pack_number integer not null check (pack_number > 0),
  status text not null default 'prepared'
    check (status in ('prepared','held','superseded')),
  hold_reasons text[] not null default '{}',
  pack_snapshot jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(draft_id, pack_number),
  unique(draft_id, id)
);
create index finance_document_packs_submission
  on public.finance_document_packs(submission_id, pack_number desc);

create table public.finance_document_pack_lines (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.finance_document_packs(id) on delete restrict,
  position integer not null check (position between 1 and 100),
  booking_id uuid not null,
  work_order_number text not null check (length(btrim(work_order_number)) > 0),
  amount_thb numeric(12,2) not null check (amount_thb >= 0 and amount_thb <= 9999999999.99),
  booking_snapshot jsonb not null,
  pricing_snapshot jsonb not null,
  paperwork_refs jsonb not null,
  unique(pack_id, position),
  unique(pack_id, booking_id)
);

create table public.finance_document_pack_checklists (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.finance_document_packs(id) on delete restrict,
  checklist_type text not null check (checklist_type in ('green_paper_retrieval','customer_dispatch')),
  items jsonb not null,
  unique(pack_id, checklist_type)
);

create table public.finance_approval_events (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.finance_draft_trns(id) on delete restrict,
  submission_id uuid references public.finance_invoice_submissions(id) on delete restrict,
  pack_id uuid references public.finance_document_packs(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in (
    'submitted','approved','rejected','invalidated','withdrawn','pack_prepared','pack_superseded')),
  details jsonb not null,
  occurred_at timestamptz not null default now()
);
create index finance_approval_events_draft_time
  on public.finance_approval_events(draft_id, occurred_at, id);

create trigger finance_invoice_decisions_immutable
  before update or delete on public.finance_invoice_decisions
  for each row execute function public.finance_reject_history_change();
create trigger finance_document_pack_lines_immutable
  before update or delete on public.finance_document_pack_lines
  for each row execute function public.finance_reject_history_change();
create trigger finance_document_pack_checklists_immutable
  before update or delete on public.finance_document_pack_checklists
  for each row execute function public.finance_reject_history_change();
create trigger finance_approval_events_immutable
  before update or delete on public.finance_approval_events
  for each row execute function public.finance_reject_history_change();

alter table public.finance_invoice_submissions enable row level security;
alter table public.finance_invoice_decisions enable row level security;
alter table public.finance_document_packs enable row level security;
alter table public.finance_document_pack_lines enable row level security;
alter table public.finance_document_pack_checklists enable row level security;
alter table public.finance_approval_events enable row level security;

revoke all on public.finance_invoice_submissions, public.finance_invoice_decisions,
  public.finance_document_packs, public.finance_document_pack_lines,
  public.finance_document_pack_checklists, public.finance_approval_events
  from public, anon, authenticated;
grant select on public.finance_invoice_submissions, public.finance_invoice_decisions,
  public.finance_document_packs, public.finance_document_pack_lines,
  public.finance_document_pack_checklists, public.finance_approval_events to authenticated;

create policy finance_invoice_submissions_read on public.finance_invoice_submissions for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('invoice_approver'))
    and exists(select 1 from public.finance_draft_trns d where d.id=draft_id));
create policy finance_invoice_decisions_read on public.finance_invoice_decisions for select to authenticated
  using (exists(select 1 from public.finance_invoice_submissions s where s.id=submission_id));
create policy finance_document_packs_read on public.finance_document_packs for select to authenticated
  using ((public.finance_has_capability('finance_reviewer') or public.finance_has_capability('invoice_approver'))
    and exists(select 1 from public.finance_draft_trns d where d.id=draft_id));
create policy finance_document_pack_lines_read on public.finance_document_pack_lines for select to authenticated
  using (exists(select 1 from public.finance_document_packs p where p.id=pack_id));
create policy finance_document_pack_checklists_read on public.finance_document_pack_checklists for select to authenticated
  using (exists(select 1 from public.finance_document_packs p where p.id=pack_id));
create policy finance_approval_events_read on public.finance_approval_events for select to authenticated
  using (exists(select 1 from public.finance_draft_trns d where d.id=draft_id));

-- Data readiness only. invoice_approver must re-check jobs without holding finance_reviewer.
create function public.finance_job_billable(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.booking_diary where id=p_booking_id)
    and exists(select 1 from public.finance_job_verifications
      where booking_id=p_booking_id and status='verified' and handover_status='ready')
    and not exists(select 1 from public.finance_discrepancies where booking_id=p_booking_id and status='open')
    and exists(select 1 from public.finance_job_price_revisions p
      join public.booking_diary b on b.id=p.booking_id
      left join public.finance_pricing_decisions d on d.revision_id=p.id
      where p.booking_id=p_booking_id and d.decision='approved'
        and p.booking_snapshot=jsonb_build_object('booking_date',b.booking_date,'client_id',b.client_id,
          'pickup',b.pickup,'dropoff',b.dropoff,'job_order_number',b.job_order_number)
        and (p.source='manual' or p.price_list_version_id=(select v.id from public.finance_price_list_versions v
          where v.client_id=b.client_id and v.route_key=btrim(b.pickup)||' → '||btrim(b.dropoff)
            and v.effective_from<=b.booking_date order by v.effective_from desc limit 1))
        and p.id=(select id from public.finance_job_price_revisions where booking_id=p_booking_id
          order by created_at desc,id desc limit 1))
    and not exists(select 1 from public.finance_expense_events e
      left join public.finance_expense_decisions d on d.event_id=e.id
      where e.booking_id=p_booking_id and d.event_id is null);
$$;

-- Freeze paperwork, booking and price facts shown to the approver at submission time.
create function public.finance_build_invoice_review_snapshot(p_draft_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_draft public.finance_draft_trns%rowtype; v_batch public.finance_billing_batches%rowtype;
  v_revision public.finance_draft_revisions%rowtype; v_client_name text; v_lines jsonb := '[]';
  v_line record; v_docs jsonb; v_missing boolean := false;
begin
  select * into v_draft from public.finance_draft_trns where id=p_draft_id;
  if not found then raise exception 'ACTIVE_DRAFT_REQUIRED' using errcode='P0002'; end if;
  select * into v_batch from public.finance_billing_batches where id=v_draft.batch_id;
  select name into v_client_name from public.clients where id=v_batch.client_id;
  select * into v_revision from public.finance_draft_revisions where id=p_revision_id and draft_id=p_draft_id;
  if not found then raise exception 'DRAFT_REVISION_REQUIRED' using errcode='P0002'; end if;
  for v_line in
    select * from public.finance_draft_revision_lines where revision_id=p_revision_id order by position
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'kind', d.kind, 'status', d.status,
      'original_filename', d.original_filename, 'physical_location', d.physical_location)
      order by d.kind, d.created_at), '[]'::jsonb)
      into v_docs
      from public.finance_paperwork_documents d
      where d.booking_id=v_line.booking_id and d.status='reviewed';
    if not exists(select 1 from public.finance_paperwork_documents d
      where d.booking_id=v_line.booking_id and d.kind='green_job_order' and d.status='reviewed'
        and length(btrim(coalesce(d.physical_location,''))) >= 3) then
      v_missing := true;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'position', v_line.position, 'booking_id', v_line.booking_id,
      'work_order_number', v_line.work_order_number, 'amount_thb', v_line.amount_thb,
      'booking_snapshot', v_line.booking_snapshot, 'pricing_snapshot', v_line.pricing_snapshot,
      'paperwork_refs', v_docs));
  end loop;
  return jsonb_build_object(
    'client_id', v_batch.client_id, 'client_name', coalesce(v_client_name,''),
    'week_start', v_batch.week_start, 'week_end', v_batch.week_end,
    'draft_identifier', v_draft.draft_identifier, 'revision_number', v_revision.revision_number,
    'total_thb', v_revision.total_thb, 'line_count', v_revision.line_count,
    'missing_green_paper', v_missing, 'lines', v_lines,
    'layout_note', 'INTEGRA headings only; no historical TRN629 figures or formulas');
end $$;

create function public.finance_invalidate_invoice_approvals(p_draft_id uuid, p_reason text, p_details jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_row public.finance_invoice_submissions%rowtype;
  v_pack_ids uuid[];
begin
  for v_row in
    select * from public.finance_invoice_submissions
    where draft_id=p_draft_id and status in ('pending','approved')
    for update
  loop
    select array_agg(id) into v_pack_ids from public.finance_document_packs
      where submission_id=v_row.id and status in ('prepared','held');
    update public.finance_invoice_submissions set status='invalidated' where id=v_row.id;
    update public.finance_document_packs set status='superseded'
      where submission_id=v_row.id and status in ('prepared','held');
    insert into public.finance_approval_events(draft_id, submission_id, actor_id, event_type, details)
      values(p_draft_id, v_row.id, auth.uid(), 'invalidated',
        jsonb_build_object('reason', p_reason) || coalesce(p_details,'{}'::jsonb));
    if v_pack_ids is not null then
      insert into public.finance_approval_events(draft_id, submission_id, pack_id, actor_id, event_type, details)
        select p_draft_id, v_row.id, pack_id, auth.uid(), 'pack_superseded',
          jsonb_build_object('reason', p_reason)
        from unnest(v_pack_ids) as pack_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.finance_submit_invoice_draft(p_draft_id uuid, p_expected_revision integer)
returns public.finance_invoice_submissions language plpgsql security definer set search_path = '' as $$
declare v_draft public.finance_draft_trns%rowtype; v_submission public.finance_invoice_submissions%rowtype;
  v_number integer; v_snapshot jsonb; v_booking_id uuid;
begin
  if not public.finance_has_capability('finance_reviewer') then
    raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501';
  end if;
  select * into v_draft from public.finance_draft_trns where id=p_draft_id for update;
  if not found or v_draft.status<>'draft' then
    raise exception 'ACTIVE_DRAFT_REQUIRED' using errcode='23514';
  end if;
  if p_expected_revision is null or v_draft.revision_number<>p_expected_revision
    or v_draft.current_revision_id is null then
    raise exception 'DRAFT_REVISION_CONFLICT' using errcode='40001';
  end if;
  if v_draft.validation_status<>'current' then
    raise exception 'DRAFT_STALE_REQUIRES_REAMEND' using errcode='23514';
  end if;
  if exists(select 1 from public.finance_invoice_submissions where draft_id=p_draft_id and status='pending') then
    raise exception 'INVOICE_SUBMISSION_PENDING' using errcode='23505';
  end if;
  if exists(select 1 from public.finance_invoice_submissions where draft_id=p_draft_id and status='approved') then
    raise exception 'INVOICE_ALREADY_APPROVED' using errcode='23505';
  end if;
  -- Re-validate every allocated booking before manager review.
  for v_booking_id in
    select booking_id from public.finance_billing_allocations where draft_id=p_draft_id order by booking_id
  loop
    if not public.finance_job_billable(v_booking_id) then
      raise exception 'BILLING_JOB_NOT_READY' using errcode='23514';
    end if;
  end loop;
  v_snapshot := public.finance_build_invoice_review_snapshot(p_draft_id, v_draft.current_revision_id);
  select coalesce(max(submission_number),0)+1 into v_number
    from public.finance_invoice_submissions where draft_id=p_draft_id;
  insert into public.finance_invoice_submissions(
    draft_id, draft_revision_id, submission_number, submitted_by, review_snapshot)
    values(p_draft_id, v_draft.current_revision_id, v_number, auth.uid(), v_snapshot)
    returning * into v_submission;
  insert into public.finance_approval_events(draft_id, submission_id, actor_id, event_type, details)
    values(p_draft_id, v_submission.id, auth.uid(), 'submitted',
      jsonb_build_object('submission_number', v_number, 'revision_id', v_draft.current_revision_id,
        'total_thb', v_snapshot->>'total_thb'));
  return v_submission;
end $$;

create function public.finance_decide_invoice_submission(p_submission_id uuid, p_approve boolean, p_reason text)
returns public.finance_invoice_decisions language plpgsql security definer set search_path = '' as $$
declare v_submission public.finance_invoice_submissions%rowtype;
  v_draft public.finance_draft_trns%rowtype; v_decision public.finance_invoice_decisions%rowtype;
  v_booking_id uuid;
begin
  if not public.finance_has_capability('invoice_approver') then
    raise exception 'INVOICE_APPROVER_REQUIRED' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'APPROVAL_REASON_REQUIRED' using errcode='22023';
  end if;
  select * into v_submission from public.finance_invoice_submissions where id=p_submission_id for update;
  if not found or v_submission.status<>'pending' then
    raise exception 'PENDING_SUBMISSION_REQUIRED' using errcode='23514';
  end if;
  if v_submission.submitted_by = auth.uid() then
    raise exception 'APPROVER_MUST_DIFFER' using errcode='42501';
  end if;
  select * into v_draft from public.finance_draft_trns where id=v_submission.draft_id for update;
  if v_draft.status<>'draft' or v_draft.validation_status<>'current'
    or v_draft.current_revision_id is distinct from v_submission.draft_revision_id then
    perform public.finance_invalidate_invoice_approvals(v_draft.id, 'stale_before_decision',
      jsonb_build_object('submission_id', p_submission_id));
    raise exception 'SUBMISSION_NO_LONGER_CURRENT' using errcode='23514';
  end if;
  for v_booking_id in
    select booking_id from public.finance_billing_allocations where draft_id=v_draft.id order by booking_id
  loop
    if not public.finance_job_billable(v_booking_id) then
      perform public.finance_invalidate_invoice_approvals(v_draft.id, 'job_not_ready_before_decision',
        jsonb_build_object('submission_id', p_submission_id, 'booking_id', v_booking_id));
      raise exception 'BILLING_JOB_NOT_READY' using errcode='23514';
    end if;
  end loop;
  insert into public.finance_invoice_decisions(submission_id, decision, reason, decided_by)
    values(p_submission_id, case when p_approve then 'approved' else 'rejected' end, btrim(p_reason), auth.uid())
    returning * into v_decision;
  update public.finance_invoice_submissions
    set status=case when p_approve then 'approved' else 'rejected' end
    where id=p_submission_id;
  insert into public.finance_approval_events(draft_id, submission_id, actor_id, event_type, details)
    values(v_draft.id, p_submission_id, auth.uid(),
      case when p_approve then 'approved' else 'rejected' end,
      jsonb_build_object('decision_id', v_decision.id, 'reason', btrim(p_reason)));
  return v_decision;
end $$;

create function public.finance_withdraw_invoice_submission(p_submission_id uuid, p_reason text)
returns public.finance_invoice_submissions language plpgsql security definer set search_path = '' as $$
declare v_submission public.finance_invoice_submissions%rowtype;
begin
  if not public.finance_has_capability('finance_reviewer') then
    raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'WITHDRAWAL_REASON_REQUIRED' using errcode='22023';
  end if;
  select * into v_submission from public.finance_invoice_submissions where id=p_submission_id for update;
  if not found or v_submission.status<>'pending' then
    raise exception 'PENDING_SUBMISSION_REQUIRED' using errcode='23514';
  end if;
  update public.finance_invoice_submissions set status='withdrawn' where id=p_submission_id
    returning * into v_submission;
  insert into public.finance_approval_events(draft_id, submission_id, actor_id, event_type, details)
    values(v_submission.draft_id, p_submission_id, auth.uid(), 'withdrawn',
      jsonb_build_object('reason', btrim(p_reason)));
  return v_submission;
end $$;

create function public.finance_prepare_document_pack(p_submission_id uuid)
returns public.finance_document_packs language plpgsql security definer set search_path = '' as $$
declare v_submission public.finance_invoice_submissions%rowtype;
  v_draft public.finance_draft_trns%rowtype; v_pack public.finance_document_packs%rowtype;
  v_snapshot jsonb; v_line jsonb; v_pos integer; v_holds text[] := '{}';
  v_number integer; v_green jsonb := '[]'; v_dispatch jsonb; v_item jsonb;
begin
  if not public.finance_has_capability('finance_reviewer') then
    raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode='42501';
  end if;
  select * into v_submission from public.finance_invoice_submissions where id=p_submission_id for update;
  if not found or v_submission.status<>'approved' then
    raise exception 'APPROVED_SUBMISSION_REQUIRED' using errcode='23514';
  end if;
  select * into v_draft from public.finance_draft_trns where id=v_submission.draft_id for update;
  if v_draft.status<>'draft' or v_draft.validation_status<>'current'
    or v_draft.current_revision_id is distinct from v_submission.draft_revision_id then
    perform public.finance_invalidate_invoice_approvals(v_draft.id, 'stale_before_pack',
      jsonb_build_object('submission_id', p_submission_id));
    raise exception 'SUBMISSION_NO_LONGER_CURRENT' using errcode='23514';
  end if;
  v_snapshot := public.finance_build_invoice_review_snapshot(v_draft.id, v_submission.draft_revision_id);
  if coalesce((v_snapshot->>'missing_green_paper')::boolean, false) then
    v_holds := array_append(v_holds, 'missing_paperwork');
  end if;
  -- Pack lines must match the approved weekly billing order exactly.
  if (select array_agg(booking_id order by position)
        from public.finance_draft_revision_lines where revision_id=v_submission.draft_revision_id)
     is distinct from
     (select array_agg((value->>'booking_id')::uuid order by ordinality)
        from jsonb_array_elements(v_snapshot->'lines') with ordinality) then
    raise exception 'PACK_ORDER_MISMATCH' using errcode='23514';
  end if;
  select coalesce(max(pack_number),0)+1 into v_number
    from public.finance_document_packs where draft_id=v_draft.id;
  update public.finance_document_packs set status='superseded'
    where draft_id=v_draft.id and status in ('prepared','held');
  insert into public.finance_document_packs(
    draft_id, submission_id, pack_number, status, hold_reasons, pack_snapshot, created_by)
    values(v_draft.id, p_submission_id, v_number,
      case when cardinality(v_holds)>0 then 'held' else 'prepared' end,
      v_holds, v_snapshot, auth.uid())
    returning * into v_pack;
  for v_line, v_pos in
    select value, ordinality::integer from jsonb_array_elements(v_snapshot->'lines') with ordinality
  loop
    insert into public.finance_document_pack_lines(
      pack_id, position, booking_id, work_order_number, amount_thb,
      booking_snapshot, pricing_snapshot, paperwork_refs)
      values(v_pack.id, v_pos, (v_line->>'booking_id')::uuid, v_line->>'work_order_number',
        (v_line->>'amount_thb')::numeric, v_line->'booking_snapshot', v_line->'pricing_snapshot',
        v_line->'paperwork_refs');
    for v_item in select value from jsonb_array_elements(coalesce(v_line->'paperwork_refs','[]'::jsonb)) loop
      if v_item->>'kind' = 'green_job_order' then
        v_green := v_green || jsonb_build_array(jsonb_build_object(
          'booking_id', v_line->>'booking_id',
          'work_order_number', v_line->>'work_order_number',
          'document_id', v_item->>'document_id',
          'physical_location', v_item->>'physical_location',
          'checked', false,
          'label', format('Green paper %s · %s', v_line->>'work_order_number', coalesce(v_item->>'physical_location','MISSING'))));
      end if;
    end loop;
    if not exists(
      select 1 from jsonb_array_elements(coalesce(v_line->'paperwork_refs','[]'::jsonb)) d
      where d.value->>'kind'='green_job_order') then
      v_green := v_green || jsonb_build_array(jsonb_build_object(
        'booking_id', v_line->>'booking_id',
        'work_order_number', v_line->>'work_order_number',
        'document_id', null, 'physical_location', null, 'checked', false,
        'label', format('Green paper %s · MISSING', v_line->>'work_order_number')));
    end if;
  end loop;
  v_dispatch := jsonb_build_array(
    jsonb_build_object('key','customer_period','checked',false,'label','Customer details and billing period confirmed'),
    jsonb_build_object('key','ordered_work_orders','checked',false,'label','Work-order order matches approved weekly billing sequence'),
    jsonb_build_object('key','selling_prices','checked',false,'label','Customer selling-price breakdown reviewed'),
    jsonb_build_object('key','draft_total','checked',false,'label','Draft total matches approved submission'),
    jsonb_build_object('key','supporting_docs','checked',false,'label','Supporting document references attached'),
    jsonb_build_object('key','manager_approval','checked',false,'label','Manager approval remains valid'),
    jsonb_build_object('key','no_customer_dispatch','checked',false,
      'label','Customer dispatch held — no issued TRN or genuine invoice'));
  if cardinality(v_holds)>0 then
    v_dispatch := v_dispatch || jsonb_build_array(jsonb_build_object(
      'key','missing_paperwork_hold','checked',false,
      'label','Missing-paperwork hold blocks customer dispatch'));
  end if;
  insert into public.finance_document_pack_checklists(pack_id, checklist_type, items)
    values(v_pack.id, 'green_paper_retrieval', v_green),
          (v_pack.id, 'customer_dispatch', v_dispatch);
  insert into public.finance_approval_events(draft_id, submission_id, pack_id, actor_id, event_type, details)
    values(v_draft.id, p_submission_id, v_pack.id, auth.uid(), 'pack_prepared',
      jsonb_build_object('pack_number', v_number, 'status', v_pack.status, 'hold_reasons', v_holds,
        'total_thb', v_snapshot->>'total_thb'));
  return v_pack;
end $$;

-- Material draft changes invalidate pending or approved submissions and supersede packs.
create function public.finance_approval_follow_draft_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.validation_status='stale' and old.validation_status is distinct from 'stale' then
      perform public.finance_invalidate_invoice_approvals(new.id, 'draft_marked_stale',
        jsonb_build_object('source','finance_draft_trns'));
    elsif new.revision_number is distinct from old.revision_number then
      perform public.finance_invalidate_invoice_approvals(new.id, 'draft_revised',
        jsonb_build_object('revision_number', new.revision_number));
    elsif new.status='cancelled' and old.status is distinct from 'cancelled' then
      perform public.finance_invalidate_invoice_approvals(new.id, 'draft_cancelled',
        jsonb_build_object('source','finance_draft_trns'));
    end if;
  end if;
  return new;
end $$;
create trigger finance_approval_follow_draft_change after update of validation_status, revision_number, status
  on public.finance_draft_trns for each row execute function public.finance_approval_follow_draft_change();

revoke all on function public.finance_job_billable(uuid),
  public.finance_build_invoice_review_snapshot(uuid,uuid),
  public.finance_invalidate_invoice_approvals(uuid,text,jsonb),
  public.finance_submit_invoice_draft(uuid,integer),
  public.finance_decide_invoice_submission(uuid,boolean,text),
  public.finance_withdraw_invoice_submission(uuid,text),
  public.finance_prepare_document_pack(uuid),
  public.finance_approval_follow_draft_change() from public, anon, authenticated;
grant execute on function public.finance_submit_invoice_draft(uuid,integer),
  public.finance_decide_invoice_submission(uuid,boolean,text),
  public.finance_withdraw_invoice_submission(uuid,text),
  public.finance_prepare_document_pack(uuid) to authenticated;
commit;
