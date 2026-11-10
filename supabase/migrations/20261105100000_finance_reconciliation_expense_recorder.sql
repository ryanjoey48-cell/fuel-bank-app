-- Prepared for local review only. Requires 20261030, 20261031, 20261102 and 20261103 Finance migrations.
-- An explicit expense_recorder grant lets office staff enter returned-paperwork costs.
-- This grant never confers pricing, expense approval or invoice approval.
begin;

alter table public.finance_role_grants drop constraint finance_role_grants_capability_check;
alter table public.finance_role_grants add constraint finance_role_grants_capability_check
  check (capability in ('management_reviewer','finance_reviewer','invoice_approver','expense_approver','pricing_approver','expense_recorder'));

drop policy finance_expense_read on public.finance_expense_events;
create policy finance_expense_read on public.finance_expense_events for select to authenticated
  using ((public.finance_has_capability('expense_recorder') or public.finance_has_capability('finance_reviewer')
      or public.finance_has_capability('expense_approver'))
    and exists(select 1 from public.booking_diary b where b.id=public.finance_expense_events.booking_id));

create function public.finance_record_reconciliation_expense(
  p_booking_id uuid,p_category text,p_amount numeric,p_incurred_on date,
  p_evidence_id uuid,p_receipt_reference text,p_missing_reason text,p_note text default '')
returns public.finance_expense_events language plpgsql security definer set search_path = '' as $$
declare v_row public.finance_expense_events%rowtype;
begin
  if not public.finance_has_capability('expense_recorder') then
    raise exception 'EXPENSE_RECORDER_REQUIRED' using errcode='42501'; end if;
  -- The booking lock serializes this entry with draft allocation and verification updates.
  perform 1 from public.booking_diary where id=p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  if exists(select 1 from public.finance_billing_allocations where booking_id=p_booking_id) then
    raise exception 'BILLING_ALLOCATION_LOCKED' using errcode='23514'; end if;
  if p_category not in ('driver_trip','toll','parking','overtime','container_pickup','overnight','other')
    or p_incurred_on is null or p_amount is null or p_amount<=0
    or p_amount>9999999999.99 or p_amount<>round(p_amount,2) then
    raise exception 'INVALID_EXPENSE' using errcode='22023'; end if;
  if p_evidence_id is not null and not exists(
    select 1 from public.finance_paperwork_documents
    where id=p_evidence_id and booking_id=p_booking_id and status='reviewed'
      and (p_category not in ('toll','parking')
        or kind=case when p_category='toll' then 'toll_receipt' else 'parking_receipt' end)) then
    raise exception 'REVIEWED_RECEIPT_REQUIRED' using errcode='23514'; end if;
  if p_evidence_id is null and nullif(btrim(coalesce(p_receipt_reference,'')),'') is null
    and length(btrim(coalesce(p_missing_reason,'')))<10 then
    raise exception 'MISSING_RECEIPT_REASON_REQUIRED' using errcode='22023'; end if;
  insert into public.finance_expense_events(booking_id,category,event_kind,amount_delta,incurred_on,
    evidence_id,receipt_reference,missing_receipt_reason,note,created_by)
  values(p_booking_id,p_category,'charge',p_amount,p_incurred_on,p_evidence_id,
    nullif(btrim(p_receipt_reference),''),nullif(btrim(p_missing_reason),''),coalesce(p_note,''),auth.uid())
  returning * into v_row;
  insert into public.finance_cost_price_audit(booking_id,actor_id,event_type,details)
  values(p_booking_id,auth.uid(),'expense_added',jsonb_build_object('event_id',v_row.id,
    'context','office_reconciliation','category',v_row.category,'amount_delta',v_row.amount_delta,
    'evidence_id',v_row.evidence_id,'missing_receipt_reason',v_row.missing_receipt_reason));
  return v_row;
end $$;

revoke all on function public.finance_record_reconciliation_expense(uuid,text,numeric,date,uuid,text,text,text) from public,anon;
grant execute on function public.finance_record_reconciliation_expense(uuid,text,numeric,date,uuid,text,text,text) to authenticated;
commit;
