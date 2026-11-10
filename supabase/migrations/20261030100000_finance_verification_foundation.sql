-- Development review only. Do not apply to production until the live schema and access grants are reconciled.
begin;

create table public.finance_role_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('management_reviewer','finance_reviewer','invoice_approver')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, capability)
);
create table public.finance_job_verifications (
  booking_id uuid primary key,
  status text not null check (status in ('missing_paperwork','discrepancy','incomplete_booking','needs_recheck','verified')),
  handover_status text not null default 'blocked' check (handover_status in ('blocked','ready')),
  booking_snapshot jsonb not null,
  observed_details jsonb not null,
  document_checklist jsonb not null,
  checked_fields text[] not null,
  review_note text not null default '',
  checked_by uuid not null references auth.users(id) on delete restrict,
  checked_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  constraint finance_ready_verified check (handover_status <> 'ready' or status = 'verified')
);
create table public.finance_discrepancies (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  field_key text not null,
  expected_value text not null,
  observed_value text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  raised_by uuid not null references auth.users(id) on delete restrict,
  raised_at timestamptz not null default now(),
  resolution text,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  constraint finance_resolution_complete check ((status = 'open' and resolved_at is null and resolved_by is null) or (status = 'resolved' and resolved_at is not null and resolved_by is not null and length(btrim(resolution)) > 0))
);
create unique index finance_open_discrepancy_key on public.finance_discrepancies(booking_id, field_key) where status = 'open';
create index finance_discrepancy_queue on public.finance_discrepancies(status, raised_at);
create index finance_handover_queue on public.finance_job_verifications(handover_status, checked_at);
create table public.finance_audit_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_name text not null,
  event_type text not null check (event_type in ('verification_submitted','discrepancy_resolved','booking_changed','booking_deleted')),
  details jsonb not null,
  occurred_at timestamptz not null default now()
);
create index finance_audit_booking_time on public.finance_audit_events(booking_id, occurred_at, id);

alter table public.finance_role_grants enable row level security;
alter table public.finance_job_verifications enable row level security;
alter table public.finance_discrepancies enable row level security;
alter table public.finance_audit_events enable row level security;
revoke all on public.finance_role_grants, public.finance_job_verifications, public.finance_discrepancies, public.finance_audit_events from anon, authenticated;
grant select on public.finance_role_grants, public.finance_job_verifications, public.finance_discrepancies, public.finance_audit_events to authenticated;
create policy finance_grants_self_read on public.finance_role_grants for select to authenticated using (user_id = auth.uid() and public.is_office_account());
create policy finance_verifications_office_read on public.finance_job_verifications for select to authenticated using (public.is_office_account());
create policy finance_discrepancies_office_read on public.finance_discrepancies for select to authenticated using (public.is_office_account());
create policy finance_audit_office_read on public.finance_audit_events for select to authenticated using (public.is_office_account());

-- Booking edits remain permitted exactly as before; a changed source only invalidates finance readiness.
create function public.finance_invalidate_on_booking_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if row(new.booking_date,new.client_id,new.pickup,new.dropoff,new.pickup_location_id,new.dropoff_location_id,new.driver,new.driver_id,new.vehicle,new.vehicle_id,new.vehicle_registration,new.trailer_registration,new.job_order_number,new.status)
     is distinct from
     row(old.booking_date,old.client_id,old.pickup,old.dropoff,old.pickup_location_id,old.dropoff_location_id,old.driver,old.driver_id,old.vehicle,old.vehicle_id,old.vehicle_registration,old.trailer_registration,old.job_order_number,old.status) then
    update public.finance_job_verifications set status='needs_recheck',handover_status='blocked',revision=revision+1
    where booking_id=new.id and status <> 'needs_recheck';
    if found then
      insert into public.finance_audit_events(booking_id,actor_id,actor_name,event_type,details)
      values(new.id,auth.uid(),coalesce((select nullif(btrim(display_name),'') from public.account_access where user_id=auth.uid()),'System'),'booking_changed',jsonb_build_object('before',jsonb_build_object('booking_date',old.booking_date,'client_id',old.client_id,'pickup',old.pickup,'dropoff',old.dropoff,'driver',old.driver,'vehicle_registration',old.vehicle_registration,'job_order_number',old.job_order_number,'status',old.status),'after',jsonb_build_object('booking_date',new.booking_date,'client_id',new.client_id,'pickup',new.pickup,'dropoff',new.dropoff,'driver',new.driver,'vehicle_registration',new.vehicle_registration,'job_order_number',new.job_order_number,'status',new.status)));
    end if;
  end if;
  return new;
end;
$$;
create trigger finance_invalidate_booking after update of booking_date,client_id,pickup,dropoff,pickup_location_id,dropoff_location_id,driver,driver_id,vehicle,vehicle_id,vehicle_registration,trailer_registration,job_order_number,status
on public.booking_diary for each row execute function public.finance_invalidate_on_booking_change();
revoke all on function public.finance_invalidate_on_booking_change() from public, anon, authenticated;

-- Preserve the existing Booking Diary delete action while retaining an immutable finance trail.
create function public.finance_on_booking_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.finance_job_verifications set status='needs_recheck',handover_status='blocked',revision=revision+1
  where booking_id=old.id;
  if found then
    insert into public.finance_audit_events(booking_id,actor_id,actor_name,event_type,details)
    values(old.id,auth.uid(),coalesce((select nullif(btrim(display_name),'') from public.account_access where user_id=auth.uid()),'System'),'booking_deleted',jsonb_build_object('booking_id',old.id,'booking_date',old.booking_date,'job_order_number',old.job_order_number));
  end if;
  return old;
end;
$$;
create trigger finance_booking_deleted before delete on public.booking_diary
for each row execute function public.finance_on_booking_delete();
revoke all on function public.finance_on_booking_delete() from public, anon, authenticated;

create function public.finance_submit_verification(p_booking_id uuid, p_observed jsonb, p_documents jsonb, p_note text default '')
returns public.finance_job_verifications
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.booking_diary%rowtype;
  v_expected jsonb;
  v_field text;
  v_document text;
  v_missing boolean := false;
  v_mismatch boolean := false;
  v_incomplete boolean := false;
  v_status text;
  v_result public.finance_job_verifications%rowtype;
begin
  if auth.uid() is null or not public.is_office_account() or public.current_account_role() not in ('admin','office_staff') then
    raise exception 'FINANCE_OFFICE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  select * into v_booking from public.booking_diary where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if coalesce(lower(btrim(v_booking.status)), '') in ('cancelled','canceled','rejected') then
    raise exception 'CANCELLED_BOOKING' using errcode = '23514';
  end if;
  if exists(select 1 from public.finance_discrepancies where booking_id=p_booking_id and status='open') then
    raise exception 'OPEN_DISCREPANCY_REQUIRES_MANAGEMENT' using errcode = '23514';
  end if;
  v_expected := jsonb_build_object(
    'booking_date', v_booking.booking_date::text, 'client_id', coalesce(v_booking.client_id::text,''),
    'pickup', coalesce(v_booking.pickup,''), 'dropoff', coalesce(v_booking.dropoff,''),
    'driver', coalesce(v_booking.driver,''), 'vehicle_registration', coalesce(v_booking.vehicle_registration,''),
    'job_order_number', coalesce(v_booking.job_order_number,'')
  );
  if jsonb_typeof(p_observed) <> 'object' or jsonb_typeof(p_documents) <> 'object' then
    raise exception 'INVALID_VERIFICATION_INPUT' using errcode = '22023';
  end if;
  foreach v_field in array array['booking_date','client_id','pickup','dropoff','driver','vehicle_registration','job_order_number'] loop
    if not p_observed ? v_field or jsonb_typeof(p_observed->v_field) <> 'string' then
      raise exception 'MISSING_OBSERVED_FIELD: %', v_field using errcode = '22023';
    end if;
    if lower(regexp_replace(btrim(v_expected->>v_field),'\s+',' ','g')) <> lower(regexp_replace(btrim(p_observed->>v_field),'\s+',' ','g')) then
      v_mismatch := true;
      insert into public.finance_discrepancies(booking_id, field_key, expected_value, observed_value, raised_by)
      values (p_booking_id, v_field, v_expected->>v_field, p_observed->>v_field, auth.uid())
      on conflict (booking_id, field_key) where status = 'open' do nothing;
    end if;
  end loop;
  foreach v_document in array array['green_job_order','parking_receipt','toll_receipt'] loop
    if jsonb_typeof(p_documents->v_document) <> 'object'
      or jsonb_typeof(p_documents->v_document->'required') <> 'boolean'
      or jsonb_typeof(p_documents->v_document->'received') <> 'boolean'
      or jsonb_typeof(p_documents->v_document->'reference') <> 'string'
      or jsonb_typeof(p_documents->v_document->'not_applicable_reason') <> 'string' then
      raise exception 'INVALID_DOCUMENT_CHECK: %', v_document using errcode = '22023';
    end if;
    if v_document = 'green_job_order' and (p_documents->v_document->>'required')::boolean is not true then
      raise exception 'SIGNED_JOB_ORDER_REQUIRED' using errcode = '23514';
    end if;
    if (p_documents->v_document->>'required')::boolean is false and (
      (p_documents->v_document->>'received')::boolean is true
      or length(btrim(p_documents->v_document->>'not_applicable_reason')) < 8
    ) then raise exception 'DOCUMENT_NOT_APPLICABLE_REASON_REQUIRED' using errcode = '22023'; end if;
    if (p_documents->v_document->>'required')::boolean and (
      (p_documents->v_document->>'received')::boolean is not true
      or btrim(p_documents->v_document->>'reference') = ''
    ) then v_missing := true; end if;
  end loop;
  if exists(select 1 from public.finance_discrepancies where booking_id = p_booking_id and status = 'open') then v_mismatch := true; end if;
  v_incomplete := v_booking.client_id is null or nullif(btrim(v_booking.job_order_number),'') is null
    or nullif(btrim(v_booking.driver),'') is null or nullif(btrim(v_booking.vehicle_registration),'') is null;
  v_status := case when v_mismatch then 'discrepancy' when v_missing then 'missing_paperwork' when v_incomplete then 'incomplete_booking' else 'verified' end;
  insert into public.finance_job_verifications(booking_id,status,handover_status,booking_snapshot,observed_details,document_checklist,checked_fields,review_note,checked_by)
  values(p_booking_id,v_status,case when v_status='verified' then 'ready' else 'blocked' end,v_expected,p_observed,p_documents,array['booking_date','client_id','pickup','dropoff','driver','vehicle_registration','job_order_number'],coalesce(p_note,''),auth.uid())
  on conflict (booking_id) do update set status=excluded.status,handover_status=excluded.handover_status,
    booking_snapshot=excluded.booking_snapshot,observed_details=excluded.observed_details,document_checklist=excluded.document_checklist,
    checked_fields=excluded.checked_fields,review_note=excluded.review_note,checked_by=excluded.checked_by,checked_at=now(),revision=public.finance_job_verifications.revision+1
  returning * into v_result;
  insert into public.finance_audit_events(booking_id,actor_id,actor_name,event_type,details)
  values(p_booking_id,auth.uid(),coalesce((select nullif(btrim(display_name),'') from public.account_access where user_id=auth.uid()),auth.uid()::text),'verification_submitted',jsonb_build_object('revision',v_result.revision,'status',v_status,'booking_snapshot',v_expected,'observed_details',p_observed,'document_checklist',p_documents,'note',coalesce(p_note,'')));
  return v_result;
end;
$$;

create function public.finance_resolve_discrepancy(p_discrepancy_id uuid, p_resolution text)
returns public.finance_discrepancies
language plpgsql security definer set search_path = ''
as $$
declare v_row public.finance_discrepancies%rowtype;
begin
  if auth.uid() is null or not public.is_office_account() or public.current_account_role() not in ('admin','office_staff') or not exists (
    select 1 from public.finance_role_grants where user_id=auth.uid() and capability='management_reviewer'
  ) then raise exception 'MANAGEMENT_REVIEW_PERMISSION_REQUIRED' using errcode='42501'; end if;
  if length(btrim(coalesce(p_resolution,''))) < 10 then raise exception 'RESOLUTION_REASON_REQUIRED' using errcode='22023'; end if;
  update public.finance_discrepancies set status='resolved',resolution=btrim(p_resolution),resolved_by=auth.uid(),resolved_at=now()
  where id=p_discrepancy_id and status='open' returning * into v_row;
  if not found then raise exception 'OPEN_DISCREPANCY_NOT_FOUND' using errcode='P0002'; end if;
  update public.finance_job_verifications set status='needs_recheck',handover_status='blocked',revision=revision+1
  where booking_id=v_row.booking_id;
  insert into public.finance_audit_events(booking_id,actor_id,actor_name,event_type,details)
  values(v_row.booking_id,auth.uid(),coalesce((select nullif(btrim(display_name),'') from public.account_access where user_id=auth.uid()),auth.uid()::text),'discrepancy_resolved',jsonb_build_object('discrepancy_id',v_row.id,'field_key',v_row.field_key,'expected_value',v_row.expected_value,'observed_value',v_row.observed_value,'resolution',v_row.resolution));
  return v_row;
end;
$$;
revoke all on function public.finance_submit_verification(uuid,jsonb,jsonb,text) from public, anon;
revoke all on function public.finance_resolve_discrepancy(uuid,text) from public, anon;
grant execute on function public.finance_submit_verification(uuid,jsonb,jsonb,text) to authenticated;
grant execute on function public.finance_resolve_discrepancy(uuid,text) to authenticated;
commit;
