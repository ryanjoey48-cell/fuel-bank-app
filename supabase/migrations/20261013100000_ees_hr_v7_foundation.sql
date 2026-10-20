-- EES HR V7, phase B. Review in a Supabase branch before production.
-- Additive: preserves all existing driver/vehicle IDs, jobs and meeting content.
-- No employee backfill, no real record deletion, no grants based on an email.
begin;

do $$ begin
  if to_regclass('public.ees_hr_admins') is null
    or to_regclass('public.ees_hr_meetings') is null
    or to_regclass('public.ees_driver_vehicle_assignments') is null
    or to_regprocedure('public.is_office_account()') is null
    or to_regprocedure('public.current_account_role()') is null then
    raise exception 'HR_V7_EXISTING_SCHEMA_REQUIRED';
  end if;
end $$;

alter table public.ees_hr_admins add column if not exists active boolean not null default true;
alter table public.vehicles add column if not exists vehicle_model text;

create table if not exists public.ees_operational_managers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  driver_ids bigint[],
  granted_by uuid not null,
  granted_at timestamptz not null default now()
);
create or replace function public.ees_hr_v7_office_read()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and auth.role() = 'authenticated'
    and public.is_account_active() and public.is_office_account();
$$;
create or replace function public.ees_is_hr_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ees_hr_v7_office_read()
    and public.current_account_role() in ('admin','office_staff')
    and exists(select 1 from public.ees_hr_admins h where h.user_id = auth.uid() and h.active);
$$;
create or replace function public.ees_hr_v7_operate(p_driver_id bigint default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ees_hr_v7_office_read() and public.current_account_role() in ('admin','office_staff') and (
    public.current_account_role() = 'admin' or public.ees_is_hr_admin()
    or exists(select 1 from public.ees_operational_managers m
      where m.user_id = auth.uid() and m.active
        and (m.driver_ids is null or p_driver_id = any(m.driver_ids)))
  );
$$;

create table if not exists public.ees_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  driver_id bigint unique references public.drivers(id) on delete restrict,
  preferred_name text,
  employee_number text unique,
  job_role text,
  department text,
  employment_status text not null default 'not_recorded'
    check(employment_status in ('not_recorded','active','on_leave','left')),
  start_date date,
  end_date date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  check(end_date is null or start_date is null or end_date >= start_date),
  check(driver_id is not null or nullif(btrim(preferred_name),'') is not null)
);
create table if not exists public.ees_employee_private (
  employee_id uuid primary key references public.ees_employee_profiles(id) on delete restrict,
  legal_name_th text, english_name text, telephone text, address text,
  emergency_contact text, emergency_phone text, employment_notes text,
  updated_by uuid not null, updated_at timestamptz not null default now()
);
create table if not exists public.ees_employee_employment_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
  employment_status text not null, effective_on date not null,
  reason text not null, recorded_by uuid not null, recorded_at timestamptz not null default now()
);
create table if not exists public.ees_employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
  effective_from date not null, amount numeric(12,2) not null check(amount >= 0),
  currency text not null default 'THB', period text not null check(period in ('monthly','daily')),
  reason text not null, recorded_by uuid not null, recorded_at timestamptz not null default now()
);
create table if not exists public.ees_hr_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null,
  action text not null, entity_type text not null, entity_id text not null,
  changed_fields text[] not null default '{}',
  recorded_at timestamptz not null default now()
);

alter table public.ees_hr_meetings add column if not exists employee_id uuid
  references public.ees_employee_profiles(id) on delete restrict;
alter table public.ees_hr_meetings alter column driver_id drop not null;
alter table public.ees_hr_meetings add column if not exists author_name_snapshot text;
-- Extend only a single-column category constraint. Abort if existing content is
-- outside the supported superset; never rewrite legacy meeting categories.
do $$ declare c record; begin
  if exists(select 1 from public.ees_hr_meetings where category not in
    ('general','performance','attendance','welfare','safety','disciplinary','training','other')) then
    raise exception 'HR_V7_REVIEW_EXISTING_MEETING_CATEGORIES';
  end if;
  for c in select conname from pg_constraint where conrelid = 'public.ees_hr_meetings'::regclass
    and contype = 'c' and conkey = array[(select attnum from pg_attribute
      where attrelid = 'public.ees_hr_meetings'::regclass and attname = 'category')]::smallint[]
  loop execute format('alter table public.ees_hr_meetings drop constraint %I',c.conname); end loop;
  alter table public.ees_hr_meetings add constraint ees_hr_meetings_v7_category_check
    check(category in ('general','performance','attendance','welfare','safety','disciplinary','training','other'));
end $$;

create table if not exists public.ees_hr_meeting_addenda (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.ees_hr_meetings(id) on delete restrict,
  kind text not null check(kind in ('correction','addendum','acknowledgement')),
  reason text not null, content text not null,
  acknowledgement text check(acknowledgement in ('not_requested','pending','acknowledged','declined')),
  created_by uuid not null, created_at timestamptz not null default now()
);
create table if not exists public.ees_hr_meeting_state (
  meeting_id uuid primary key references public.ees_hr_meetings(id) on delete restrict,
  is_test boolean not null default false, archived_at timestamptz,
  reason text not null, recorded_by uuid not null, recorded_at timestamptz not null default now()
);
create table if not exists public.ees_hr_followups (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.ees_employee_profiles(id) on delete restrict,
  driver_id bigint references public.drivers(id) on delete restrict,
  meeting_id uuid unique references public.ees_hr_meetings(id) on delete restrict,
  due_date date not null, responsible_id uuid references auth.users(id) on delete set null,
  required_action text not null, completed_at timestamptz, completed_by uuid,
  outcome_notes text, created_by uuid not null, created_at timestamptz not null default now(),
  check(employee_id is not null or driver_id is not null),
  check((completed_at is null and completed_by is null) or
        (completed_at is not null and completed_by is not null and nullif(btrim(outcome_notes),'') is not null))
);
create table if not exists public.ees_hr_followup_events (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null references public.ees_hr_followups(id) on delete restrict,
  action text not null, outcome_notes text, actor_id uuid not null,
  recorded_at timestamptz not null default now()
);

create table if not exists public.ees_hr_document_policies (
  id uuid primary key default gen_random_uuid(),
  category text not null check(category in ('national_id','driving_licence','contract','training','safety','other')),
  processing_purpose text not null, documented_lawful_basis text not null,
  retention_days integer not null check(retention_days between 1 and 36525),
  policy_reference text not null, active boolean not null default true,
  approved_by uuid not null, approved_at timestamptz not null default now()
);
create table if not exists public.ees_employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
  category text not null, description text,
  original_filename text not null, mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 10485760),
  object_key text not null unique, version_group uuid not null, version integer not null check(version > 0),
  replaces_id uuid references public.ees_employee_documents(id) on delete restrict,
  issue_date date, expiry_date date,
  policy_id uuid not null references public.ees_hr_document_policies(id) on delete restrict,
  processing_purpose text not null, documented_lawful_basis text not null,
  retain_until date not null, legal_hold boolean not null default false,
  state text not null default 'pending' check(state in ('pending','ready','retired','purge_pending','purged','failed')),
  uploaded_by uuid not null, uploaded_at timestamptz not null default now(),
  retired_at timestamptz, purged_at timestamptz,
  retirement_reason text, purge_reason text, legal_hold_reason text,
  unique(version_group,version), check(expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create table if not exists public.ees_employee_licences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
  category text not null, licence_number text not null,
  issue_date date not null, expiry_date date not null check(expiry_date >= issue_date),
  front_document_id uuid references public.ees_employee_documents(id) on delete restrict,
  back_document_id uuid references public.ees_employee_documents(id) on delete restrict,
  verification_status text not null default 'unverified' check(verification_status in ('unverified','verified','rejected')),
  verified_by uuid, verified_at timestamptz,
  recorded_by uuid not null, recorded_at timestamptz not null default now()
);
create table if not exists public.ees_licence_vehicle_rules (
  id uuid primary key default gen_random_uuid(), category text not null, vehicle_type text not null,
  compatible boolean not null, reliable_source text not null,
  reviewed_by uuid not null, reviewed_at timestamptz not null default now(), active boolean not null default true
);
create table if not exists public.ees_employee_training (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
  course text not null, completed_on date not null, expires_on date,
  certificate_id uuid references public.ees_employee_documents(id) on delete restrict,
  notes text, recorded_by uuid not null, recorded_at timestamptz not null default now(),
  check(expires_on is null or expires_on >= completed_on)
);

create index if not exists ees_hr_meetings_employee_date_idx on public.ees_hr_meetings(employee_id,meeting_date desc);
create index if not exists ees_hr_meetings_driver_date_idx on public.ees_hr_meetings(driver_id,meeting_date desc);
create index if not exists ees_hr_followups_open_due_idx on public.ees_hr_followups(due_date) where completed_at is null;
create index if not exists ees_hr_followups_driver_idx on public.ees_hr_followups(driver_id,due_date);
create index if not exists ees_hr_followups_employee_idx on public.ees_hr_followups(employee_id,due_date);
create index if not exists ees_employee_documents_employee_idx on public.ees_employee_documents(employee_id,uploaded_at desc);
create index if not exists ees_employee_licences_employee_idx on public.ees_employee_licences(employee_id,recorded_at desc);
create index if not exists ees_assignment_vehicle_dates_idx on public.ees_driver_vehicle_assignments(vehicle_id,effective_from,effective_to);

-- Confidential tables have a restrictive guard as well as their explicit HR
-- permission, so an older permissive policy cannot expose them to office users.
do $$ declare t text; begin
  foreach t in array array['ees_employee_profiles','ees_employee_private','ees_employee_employment_history',
    'ees_employee_compensation','ees_hr_audit','ees_hr_meetings','ees_hr_meeting_addenda','ees_hr_meeting_state',
    'ees_hr_followups','ees_hr_followup_events','ees_hr_document_policies','ees_employee_documents',
    'ees_employee_licences','ees_licence_vehicle_rules','ees_employee_training'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists ees_hr_v7_guard on public.%I',t);
    execute format('create policy ees_hr_v7_guard on public.%I as restrictive for all to authenticated using (public.ees_is_hr_admin()) with check (public.ees_is_hr_admin())',t);
    execute format('drop policy if exists ees_hr_v7_read on public.%I',t);
    execute format('create policy ees_hr_v7_read on public.%I for select to authenticated using (public.ees_is_hr_admin())',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
-- All HR mutations go through the explicit audited RPC, not direct table edits.
alter table public.ees_hr_admins enable row level security;
revoke insert,update,delete on public.ees_hr_admins from public,anon,authenticated;
alter table public.ees_operational_managers enable row level security;
revoke all on public.ees_operational_managers from public,anon,authenticated;

create or replace function public.ees_hr_v7_immutable()
returns trigger language plpgsql set search_path = '' as $$ begin
  raise exception 'HR_V7_APPEND_ONLY' using errcode = '42501';
end $$;
do $$ declare t text; begin
  foreach t in array array['ees_hr_meetings','ees_hr_meeting_addenda','ees_hr_audit','ees_hr_followup_events',
    'ees_employee_employment_history','ees_employee_compensation'] loop
    execute format('drop trigger if exists ees_hr_v7_immutable on public.%I',t);
    execute format('create trigger ees_hr_v7_immutable before update or delete on public.%I for each row execute function public.ees_hr_v7_immutable()',t);
  end loop;
end $$;

-- Private bucket and a bucket-specific RESTRICTIVE guard protect even against
-- pre-existing permissive Storage policies for unrelated/public buckets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ees-employee-documents','ees-employee-documents',false,10485760,
  array['image/jpeg','image/png','image/heic','image/heif','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists ees_hr_v7_private_bucket_guard on storage.objects;
create policy ees_hr_v7_private_bucket_guard on storage.objects as restrictive for all to public
using (bucket_id <> 'ees-employee-documents')
with check (bucket_id <> 'ees-employee-documents');
-- Private bytes are served/uploaded only by authenticated HR server handlers.
-- Application-role clients cannot mint their own long-lived signed URLs or
-- bypass the server's binary/MIME checks. The server verifies HR membership
-- and metadata RLS before using its private Storage credential.
drop policy if exists ees_hr_v7_document_read on storage.objects;
create policy ees_hr_v7_document_read on storage.objects for select to authenticated
using (bucket_id='ees-employee-documents' and public.ees_is_hr_admin()
  and exists(select 1 from public.ees_employee_documents d where d.object_key=name and d.state in ('pending','ready','retired','purge_pending','failed')));
drop policy if exists ees_hr_v7_document_upload on storage.objects;
create policy ees_hr_v7_document_upload on storage.objects for insert to authenticated
with check(bucket_id='ees-employee-documents' and public.ees_is_hr_admin()
  and exists(select 1 from public.ees_employee_documents d where d.object_key=name and d.state='pending' and d.uploaded_by=auth.uid()));
drop policy if exists ees_hr_v7_document_delete on storage.objects;
create policy ees_hr_v7_document_delete on storage.objects for delete to authenticated
using(bucket_id='ees-employee-documents' and public.ees_is_hr_admin()
  and exists(select 1 from public.ees_employee_documents d where d.object_key=name
    and ((d.state='purge_pending' and not d.legal_hold
      and d.retain_until <= (clock_timestamp() at time zone 'Asia/Bangkok')::date)
      or (d.state in ('pending','failed') and d.uploaded_by=auth.uid()))));

create or replace function public.ees_hr_v7_keep_bucket_private()
returns trigger language plpgsql set search_path='' as $$ begin
  if (old.id='ees-employee-documents' or new.id='ees-employee-documents') and new.public then
    raise exception 'HR_DOCUMENT_BUCKET_MUST_BE_PRIVATE' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists ees_hr_v7_keep_bucket_private on storage.buckets;
create trigger ees_hr_v7_keep_bucket_private before update on storage.buckets
for each row execute function public.ees_hr_v7_keep_bucket_private();

create or replace function public.ees_hr_v7_storage_ready()
returns boolean language sql stable security definer set search_path='' as $$
  select public.ees_is_hr_admin()
    and exists(select 1 from storage.buckets where id='ees-employee-documents' and not public)
    and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
    and exists(select 1 from pg_policy p where p.polrelid='storage.objects'::regclass
      and p.polname='ees_hr_v7_private_bucket_guard' and not p.polpermissive and p.polcmd='*'
      and p.polroles=array[0::oid]
      and regexp_replace(replace(pg_get_expr(p.polqual,p.polrelid),'::text',''),'[[:space:]()]','','g') = 'bucket_id<>''ees-employee-documents'''
      and regexp_replace(replace(pg_get_expr(p.polwithcheck,p.polrelid),'::text',''),'[[:space:]()]','','g') = 'bucket_id<>''ees-employee-documents''');
$$;
revoke all on function public.ees_hr_v7_office_read() from public;
revoke all on function public.ees_is_hr_admin() from public;
revoke all on function public.ees_hr_v7_operate(bigint) from public;
revoke all on function public.ees_hr_v7_storage_ready() from public;
grant execute on function public.ees_hr_v7_office_read(),public.ees_is_hr_admin(),
  public.ees_hr_v7_operate(bigint),public.ees_hr_v7_storage_ready() to authenticated;

notify pgrst,'reload schema';
commit;
