-- Review only. Apply after 20261030100000_finance_verification_foundation.sql in a proven development baseline.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ees-finance-paperwork','ees-finance-paperwork',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
do $$ begin
  if not exists(select 1 from storage.buckets where id='ees-finance-paperwork' and public=false
    and file_size_limit=10485760
    and allowed_mime_types @> array['application/pdf','image/jpeg','image/png','image/webp']::text[]
    and allowed_mime_types <@ array['application/pdf','image/jpeg','image/png','image/webp']::text[]) then
    raise exception 'FINANCE_PRIVATE_BUCKET_CONFIGURATION_REQUIRED';
  end if;
end $$;

create table public.finance_paperwork_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  kind text not null check(kind in ('green_job_order','parking_receipt','toll_receipt','other')),
  object_key text not null unique,
  original_filename text not null check(length(original_filename) between 1 and 180),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  status text not null default 'pending' check(status in ('pending','uploaded','reviewed','rejected','superseded')),
  revision_of uuid references public.finance_paperwork_documents(id) on delete restrict,
  physical_location text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  check(status <> 'reviewed' or (reviewed_by is not null and reviewed_at is not null and length(btrim(physical_location)) >= 3))
);
create index finance_paperwork_booking_time on public.finance_paperwork_documents(booking_id,created_at desc);
create index finance_paperwork_pending on public.finance_paperwork_documents(uploaded_by,created_at) where status='pending';
create unique index finance_paperwork_one_reviewed_successor on public.finance_paperwork_documents(revision_of)
  where status='reviewed' and revision_of is not null;

create table public.finance_paperwork_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.finance_paperwork_documents(id) on delete restrict,
  booking_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check(event_type in ('reserved','uploaded','reviewed','rejected','superseded')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index finance_paperwork_events_doc_time on public.finance_paperwork_events(document_id,occurred_at,id);

create function public.finance_can_read_paperwork(p_booking_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and public.is_office_account()
    and public.current_account_role() in ('admin','office_staff')
    and exists(select 1 from public.booking_diary where id=p_booking_id);
$$;
create function public.finance_can_write_paperwork(p_booking_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.finance_can_read_paperwork(p_booking_id);
$$;
revoke all on function public.finance_can_read_paperwork(uuid),public.finance_can_write_paperwork(uuid) from public,anon;
grant execute on function public.finance_can_read_paperwork(uuid),public.finance_can_write_paperwork(uuid) to authenticated;

alter table public.finance_paperwork_documents enable row level security;
alter table public.finance_paperwork_events enable row level security;
revoke all on public.finance_paperwork_documents,public.finance_paperwork_events from public,anon,authenticated;
grant select on public.finance_paperwork_documents,public.finance_paperwork_events to authenticated;
create policy finance_paperwork_read on public.finance_paperwork_documents for select to authenticated
  using(public.finance_can_read_paperwork(booking_id));
create policy finance_paperwork_events_read on public.finance_paperwork_events for select to authenticated
  using(public.finance_can_read_paperwork(booking_id));

-- Storage keys are issued by the database. Authenticated users cannot choose another booking's key.
create policy finance_paperwork_storage_insert on storage.objects for insert to authenticated
  with check(bucket_id='ees-finance-paperwork' and exists(
    select 1 from public.finance_paperwork_documents d
    where d.object_key=name and d.status='pending' and d.uploaded_by=auth.uid()
      and public.finance_can_write_paperwork(d.booking_id)));
create policy finance_paperwork_storage_read on storage.objects for select to authenticated
  using(bucket_id='ees-finance-paperwork' and exists(
    select 1 from public.finance_paperwork_documents d
    where d.object_key=name and d.status in ('uploaded','reviewed','rejected','superseded')
      and public.finance_can_read_paperwork(d.booking_id)));
-- Restrictive guards keep older broad Storage policies from opening this bucket through OR policy composition.
create policy finance_paperwork_storage_insert_guard on storage.objects as restrictive for insert to public
  with check(bucket_id <> 'ees-finance-paperwork' or exists(
    select 1 from public.finance_paperwork_documents d
    where d.object_key=name and d.status='pending' and d.uploaded_by=auth.uid()
      and public.finance_can_write_paperwork(d.booking_id)));
create policy finance_paperwork_storage_read_guard on storage.objects as restrictive for select to public
  using(bucket_id <> 'ees-finance-paperwork' or exists(
    select 1 from public.finance_paperwork_documents d
    where d.object_key=name and d.status in ('uploaded','reviewed','rejected','superseded')
      and public.finance_can_read_paperwork(d.booking_id)));
create policy finance_paperwork_storage_no_update on storage.objects as restrictive for update to public
  using(bucket_id <> 'ees-finance-paperwork') with check(bucket_id <> 'ees-finance-paperwork');
create policy finance_paperwork_storage_no_delete on storage.objects as restrictive for delete to public
  using(bucket_id <> 'ees-finance-paperwork');

create function public.finance_reserve_paperwork(p_booking_id uuid,p_kind text,p_filename text,p_mime text,p_size integer,p_revision_of uuid default null)
returns public.finance_paperwork_documents language plpgsql security definer set search_path = '' as $$
declare v_row public.finance_paperwork_documents%rowtype; v_previous public.finance_paperwork_documents%rowtype;
begin
  if auth.uid() is null or not public.is_office_account() or public.current_account_role() not in ('admin','office_staff')
    or not exists(select 1 from public.booking_diary where id=p_booking_id) then
    raise exception 'FINANCE_PAPERWORK_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if p_kind not in ('green_job_order','parking_receipt','toll_receipt','other') or p_mime not in ('application/pdf','image/jpeg','image/png','image/webp')
    or p_size is null or p_size not between 1 and 10485760 or length(btrim(coalesce(p_filename,''))) not between 1 and 180 then
    raise exception 'FINANCE_PAPERWORK_INVALID_FILE' using errcode='22023';
  end if;
  if p_revision_of is not null then
    select * into v_previous from public.finance_paperwork_documents where id=p_revision_of and booking_id=p_booking_id and kind=p_kind;
    if not found or v_previous.status not in ('reviewed','rejected','superseded') then
      raise exception 'FINANCE_PAPERWORK_REVISION_INVALID' using errcode='23514';
    end if;
  end if;
  v_row.id:=gen_random_uuid();
  insert into public.finance_paperwork_documents(id,booking_id,kind,object_key,original_filename,mime_type,size_bytes,revision_of,uploaded_by)
  values(v_row.id,p_booking_id,p_kind,p_booking_id::text||'/'||v_row.id::text,btrim(p_filename),p_mime,p_size,p_revision_of,auth.uid())
  returning * into v_row;
  insert into public.finance_paperwork_events(document_id,booking_id,actor_id,event_type,details)
  values(v_row.id,p_booking_id,auth.uid(),'reserved',jsonb_build_object('revision_of',p_revision_of));
  return v_row;
end $$;

create function public.finance_finalize_paperwork(p_document_id uuid)
returns public.finance_paperwork_documents language plpgsql security definer set search_path = '' as $$
declare v_row public.finance_paperwork_documents%rowtype; v_object record;
begin
  select * into v_row from public.finance_paperwork_documents where id=p_document_id for update;
  if not found or v_row.uploaded_by is distinct from auth.uid() or v_row.status not in ('pending','uploaded')
    or not public.is_office_account() or public.current_account_role() not in ('admin','office_staff')
    or not exists(select 1 from public.booking_diary where id=v_row.booking_id) then
    raise exception 'FINANCE_PAPERWORK_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if v_row.status='uploaded' then return v_row; end if;
  select metadata->>'size' as size_text,metadata->>'mimetype' as mime into v_object
  from storage.objects where bucket_id='ees-finance-paperwork' and name=v_row.object_key;
  if not found or v_object.size_text is distinct from v_row.size_bytes::text or v_object.mime is distinct from v_row.mime_type then
    raise exception 'FINANCE_PAPERWORK_UPLOAD_INCOMPLETE' using errcode='23514';
  end if;
  update public.finance_paperwork_documents set status='uploaded',finalized_at=now() where id=p_document_id returning * into v_row;
  insert into public.finance_paperwork_events(document_id,booking_id,actor_id,event_type)
  values(v_row.id,v_row.booking_id,auth.uid(),'uploaded');
  return v_row;
end $$;

create function public.finance_review_paperwork(p_document_id uuid,p_approved boolean,p_physical_location text,p_note text default '')
returns public.finance_paperwork_documents language plpgsql security definer set search_path = '' as $$
declare v_row public.finance_paperwork_documents%rowtype;
begin
  select * into v_row from public.finance_paperwork_documents where id=p_document_id for update;
  if not found or v_row.status<>'uploaded' or not public.is_office_account()
    or public.current_account_role() not in ('admin','office_staff')
    or not exists(select 1 from public.booking_diary where id=v_row.booking_id) then
    raise exception 'FINANCE_PAPERWORK_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if p_approved is null or (p_approved and length(btrim(coalesce(p_physical_location,'')))<3)
    or (not p_approved and length(btrim(coalesce(p_note,'')))<8) then
    raise exception 'FINANCE_PAPERWORK_REVIEW_INCOMPLETE' using errcode='22023';
  end if;
  update public.finance_paperwork_documents set status=case when p_approved then 'reviewed' else 'rejected' end,
    physical_location=nullif(btrim(p_physical_location),''),reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(coalesce(p_note,''))
  where id=p_document_id returning * into v_row;
  insert into public.finance_paperwork_events(document_id,booking_id,actor_id,event_type,details)
  values(v_row.id,v_row.booking_id,auth.uid(),v_row.status,jsonb_build_object('physical_location',v_row.physical_location,'note',v_row.review_note));
  if p_approved and v_row.revision_of is not null then
    update public.finance_paperwork_documents set status='superseded' where id=v_row.revision_of and status='reviewed';
    if found then
      insert into public.finance_paperwork_events(document_id,booking_id,actor_id,event_type,details)
      values(v_row.revision_of,v_row.booking_id,auth.uid(),'superseded',jsonb_build_object('replacement_id',v_row.id));
    end if;
  end if;
  update public.finance_job_verifications set status='needs_recheck',handover_status='blocked',revision=revision+1
  where booking_id=v_row.booking_id and status='verified';
  return v_row;
end $$;

-- Existing verification must cite the current reviewed document IDs, never a bare filename or pending upload.
alter function public.finance_submit_verification(uuid,jsonb,jsonb,text) rename to finance_submit_verification_unchecked;
revoke all on function public.finance_submit_verification_unchecked(uuid,jsonb,jsonb,text) from public,anon,authenticated;
create function public.finance_submit_verification(p_booking_id uuid,p_observed jsonb,p_documents jsonb,p_note text default '')
returns public.finance_job_verifications language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_check jsonb; v_id uuid;
begin
  if auth.uid() is null or not public.is_office_account() or public.current_account_role() not in ('admin','office_staff') then
    raise exception 'FINANCE_OFFICE_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  foreach v_kind in array array['green_job_order','parking_receipt','toll_receipt'] loop
    v_check:=p_documents->v_kind;
    if jsonb_typeof(v_check)='object' and v_check->>'received'='true' then
      if coalesce(v_check->>'reference','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'FINANCE_REVIEWED_DOCUMENT_REQUIRED' using errcode='23514';
      end if;
      v_id:=(v_check->>'reference')::uuid;
      if not exists(select 1 from public.finance_paperwork_documents where id=v_id and booking_id=p_booking_id and kind=v_kind and status='reviewed') then
        raise exception 'FINANCE_REVIEWED_DOCUMENT_REQUIRED' using errcode='23514';
      end if;
    end if;
  end loop;
  return public.finance_submit_verification_unchecked(p_booking_id,p_observed,p_documents,p_note);
end $$;

revoke all on function public.finance_reserve_paperwork(uuid,text,text,text,integer,uuid),
  public.finance_finalize_paperwork(uuid),public.finance_review_paperwork(uuid,boolean,text,text),
  public.finance_submit_verification(uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.finance_reserve_paperwork(uuid,text,text,text,integer,uuid),
  public.finance_finalize_paperwork(uuid),public.finance_review_paperwork(uuid,boolean,text,text),
  public.finance_submit_verification(uuid,jsonb,jsonb,text) to authenticated;
commit;
