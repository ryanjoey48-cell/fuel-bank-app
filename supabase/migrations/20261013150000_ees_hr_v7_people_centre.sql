-- Additive People Centre extension. Review/apply after all five V7 migrations.
-- No employee backfill, driver changes, public files, or employment-rule defaults.
begin;
do $$ declare definition text; old_clause text:='from public.account_access where user_id=target_user and status=''active'' and role in (''admin'',''office_staff'')';
 new_clause text:='from public.account_access a where a.user_id=target_user and a.status=''active'' and a.role in (''admin'',''office_staff'')';
begin
 definition:=pg_get_functiondef('public.ees_hr_v7_action(text,jsonb,uuid)'::regprocedure);
 if position(old_clause in definition)>0 then execute replace(definition,old_clause,new_clause);
 elsif position(new_clause in definition)=0 then raise exception 'HR_V7_REVIEW_MANAGER_PREDICATE'; end if;
end $$;
create table if not exists public.ees_hr_absences (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
 category text not null check(category in ('annual','sick','unpaid','other','unexplained')),
 start_date date not null, end_date date not null check(end_date>=start_date),
 status text not null check(status in ('requested','approved','rejected','cancelled','completed')),
 approved_by uuid references auth.users(id), approved_at timestamptz,
 return_date date, return_status text not null default 'expected' check(return_status in ('expected','returned','overdue')),
 notes text, document_ids uuid[] not null default '{}', version integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.ees_hr_incidents (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.ees_employee_profiles(id) on delete restrict,
 occurred_at timestamptz not null,
 category text not null check(category in ('accident','damage','safety','complaint','conduct','other')),
 description text not null check(length(btrim(description))>0),
 vehicle_id uuid references public.vehicles(id) on delete restrict,
 job_reference text, severity text not null check(severity in ('low','medium','high','critical')),
 status text not null check(status in ('open','investigating','action_required','resolved')),
 action_taken text, responsible_id uuid references auth.users(id), followup_date date,
 resolved_at timestamptz, document_ids uuid[] not null default '{}', version integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 check((status='resolved')=(resolved_at is not null))
);
create table if not exists public.ees_hr_case_events (
 id uuid primary key default gen_random_uuid(),
 absence_id uuid references public.ees_hr_absences(id) on delete restrict,
 incident_id uuid references public.ees_hr_incidents(id) on delete restrict,
 snapshot jsonb not null, actor_id uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 check(num_nonnulls(absence_id,incident_id)=1)
);
create index if not exists ees_hr_absence_employee_dates on public.ees_hr_absences(employee_id,start_date,end_date);
create index if not exists ees_hr_incident_employee_date on public.ees_hr_incidents(employee_id,occurred_at desc);
create index if not exists ees_hr_case_absence on public.ees_hr_case_events(absence_id,recorded_at);
create index if not exists ees_hr_case_incident on public.ees_hr_case_events(incident_id,recorded_at);
do $$ declare t text; begin
 foreach t in array array['ees_hr_absences','ees_hr_incidents','ees_hr_case_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists ees_people_hr_read on public.%I',t);
  execute format('create policy ees_people_hr_read on public.%I for select to authenticated using(public.ees_is_hr_admin())',t);
 end loop;
end $$;
create or replace function public.ees_people_event_guard()
returns trigger language plpgsql set search_path='' as $$ begin
 raise exception 'HR_V7_APPEND_ONLY' using errcode='42501';
end $$;
drop trigger if exists ees_people_event_guard on public.ees_hr_case_events;
create trigger ees_people_event_guard before update or delete on public.ees_hr_case_events
 for each row execute function public.ees_people_event_guard();
create or replace function public.ees_people_case_guard()
returns trigger language plpgsql security definer set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'HR_V7_APPEND_ONLY' using errcode='42501'; end if;
 if not public.ees_is_hr_admin() or current_setting('ees.people_case',true) is distinct from new.id::text
 then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
 if tg_op='UPDATE' and (new.employee_id is distinct from old.employee_id or new.created_by is distinct from old.created_by
   or new.created_at is distinct from old.created_at or new.version<>old.version+1)
 then raise exception 'HR_V7_APPEND_ONLY' using errcode='42501'; end if;
 return new;
end $$;
drop trigger if exists ees_people_case_guard on public.ees_hr_absences;
create trigger ees_people_case_guard before insert or update or delete on public.ees_hr_absences for each row execute function public.ees_people_case_guard();
drop trigger if exists ees_people_case_guard on public.ees_hr_incidents;
create trigger ees_people_case_guard before insert or update or delete on public.ees_hr_incidents for each row execute function public.ees_people_case_guard();
create or replace function public.ees_people_ready()
returns boolean language plpgsql stable security definer set search_path='' as $$ begin
 if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
 return public.ees_hr_v7_release_ready() and (select count(*)=3 from pg_catalog.pg_trigger
 where not tgisinternal and tgenabled<>'D' and tgname in ('ees_people_event_guard','ees_people_case_guard'));
end $$;
create or replace function public.ees_people_action(p_kind text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.ees_hr_absences%rowtype; i public.ees_hr_incidents%rowtype;
 key uuid:=coalesce(nullif(p_input->>'id','')::uuid,gen_random_uuid()); employee uuid;
 docs uuid[]; result jsonb; cached public.ees_hr_v7_requests%rowtype;
 today date:=(now() at time zone 'Asia/Bangkok')::date; new_status text;
begin
 if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
 if not public.ees_people_ready() then raise exception 'HR_RELEASE_REQUIRED'; end if;
 if p_kind not in ('absences','incidents') or p_request_id is null or jsonb_typeof(p_input)<>'object' then raise exception 'HR_INVALID_INPUT'; end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in
 ('id','employeeId','version','category','status','startDate','endDate','returnDate','returnStatus','notes','documentIds',
 'occurredAt','description','vehicleId','jobReference','severity','actionTaken','responsibleId','followupDate'))
 then raise exception 'HR_INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into cached from public.ees_hr_v7_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if cached.action<>'people_'||p_kind or cached.input_hash<>md5(p_input::text) then raise exception 'HR_REQUEST_REUSED'; end if;
  return cached.result;
 end if;
 employee:=(p_input->>'employeeId')::uuid;
 perform 1 from public.ees_employee_profiles where id=employee for update;
 if not found then raise exception 'HR_PERSONNEL_REQUIRED'; end if;
 if p_input ? 'id' then
  if p_kind='absences' then select * into a from public.ees_hr_absences where id=key for update;
   if not found then raise exception 'HR_NOT_FOUND'; end if;
   if a.employee_id<>employee then raise exception 'HR_IDENTITY_MISMATCH'; end if;
   if a.version is distinct from (p_input->>'version')::integer then raise exception 'HR_CONFLICT'; end if;
  else select * into i from public.ees_hr_incidents where id=key for update;
   if not found then raise exception 'HR_NOT_FOUND'; end if;
   if i.employee_id<>employee then raise exception 'HR_IDENTITY_MISMATCH'; end if;
   if i.version is distinct from (p_input->>'version')::integer then raise exception 'HR_CONFLICT'; end if;
  end if;
 end if;
 select coalesce(array_agg(value::uuid),'{}') into docs from jsonb_array_elements_text(coalesce(p_input->'documentIds','[]'));
 if cardinality(docs)>20 or exists(select 1 from unnest(docs) d where not exists(
  select 1 from public.ees_employee_documents ed where ed.id=d and ed.employee_id=employee and ed.state='ready'))
 then raise exception 'HR_IDENTITY_MISMATCH'; end if;
 new_status:=p_input->>'status';
 if new_status is null or p_input->>'category' is null then raise exception 'HR_INVALID_INPUT'; end if;
 perform set_config('ees.people_case',key::text,true);
 if p_kind='absences' then
  if p_input->>'category' not in ('annual','sick','unpaid','other','unexplained') or new_status not in ('requested','approved','rejected','cancelled','completed')
   or nullif(p_input->>'startDate','') is null or nullif(p_input->>'endDate','') is null
   or coalesce(p_input->>'returnStatus','expected') not in ('expected','returned','overdue')
   or length(coalesce(p_input->>'notes',''))>4000 then raise exception 'HR_INVALID_INPUT'; end if;
  if (p_input->>'endDate')::date<(p_input->>'startDate')::date then raise exception 'HR_INVALID_DATE'; end if;
  if new_status='completed' and (p_input->>'returnStatus' is distinct from 'returned' or nullif(p_input->>'returnDate','') is null)
   then raise exception 'HR_RETURN_REQUIRED'; end if;
  if p_input->>'returnStatus'='returned' and (nullif(p_input->>'returnDate','') is null or (p_input->>'returnDate')::date>today
    or (p_input->>'returnDate')::date<(p_input->>'startDate')::date) then raise exception 'HR_INVALID_DATE'; end if;
  if new_status='completed' and (a.approved_by is null or a.status not in ('approved','completed')) then raise exception 'HR_APPROVAL_REQUIRED'; end if;
  a.approved_by:=case when new_status='approved' and a.status is distinct from 'approved' then auth.uid() else a.approved_by end;
  a.approved_at:=case when new_status='approved' and a.status is distinct from 'approved' then now() else a.approved_at end;
  insert into public.ees_hr_absences(id,employee_id,category,start_date,end_date,status,approved_by,approved_at,return_date,return_status,notes,document_ids,created_by,updated_by)
  values(key,employee,p_input->>'category',(p_input->>'startDate')::date,(p_input->>'endDate')::date,new_status,a.approved_by,a.approved_at,
   nullif(p_input->>'returnDate','')::date,coalesce(p_input->>'returnStatus','expected'),nullif(p_input->>'notes',''),docs,auth.uid(),auth.uid())
  on conflict(id) do update set category=excluded.category,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,
   approved_by=excluded.approved_by,approved_at=excluded.approved_at,return_date=excluded.return_date,return_status=excluded.return_status,
   notes=excluded.notes,document_ids=excluded.document_ids,version=ees_hr_absences.version+1,updated_by=auth.uid(),updated_at=now()
  returning to_jsonb(ees_hr_absences) into result;
  insert into public.ees_hr_case_events(absence_id,snapshot,actor_id) values(key,result,auth.uid());
 else
  if p_input->>'category' not in ('accident','damage','safety','complaint','conduct','other') or new_status not in ('open','investigating','action_required','resolved')
   or nullif(btrim(p_input->>'description'),'') is null or length(p_input->>'description')>12000
   or nullif(p_input->>'occurredAt','') is null or p_input->>'severity' is null or p_input->>'severity' not in ('low','medium','high','critical')
   or length(coalesce(p_input->>'actionTaken',''))>4000 or length(coalesce(p_input->>'jobReference',''))>200
   then raise exception 'HR_INVALID_INPUT'; end if;
  if new_status='resolved' and nullif(btrim(p_input->>'actionTaken'),'') is null then raise exception 'HR_ACTION_REQUIRED'; end if;
  if nullif(p_input->>'responsibleId','') is not null and not exists(select 1 from public.account_access
    where user_id=(p_input->>'responsibleId')::uuid and status='active' and role in ('admin','office_staff')) then raise exception 'HR_INVALID_INPUT'; end if;
  insert into public.ees_hr_incidents(id,employee_id,occurred_at,category,description,vehicle_id,job_reference,severity,status,
   action_taken,responsible_id,followup_date,resolved_at,document_ids,created_by,updated_by)
  values(key,employee,(p_input->>'occurredAt')::timestamptz,p_input->>'category',p_input->>'description',nullif(p_input->>'vehicleId','')::uuid,
   nullif(p_input->>'jobReference',''),p_input->>'severity',new_status,nullif(p_input->>'actionTaken',''),nullif(p_input->>'responsibleId','')::uuid,
   nullif(p_input->>'followupDate','')::date,case when new_status='resolved' then coalesce(i.resolved_at,now()) end,docs,auth.uid(),auth.uid())
  on conflict(id) do update set occurred_at=excluded.occurred_at,category=excluded.category,description=excluded.description,
   vehicle_id=excluded.vehicle_id,job_reference=excluded.job_reference,severity=excluded.severity,status=excluded.status,
   action_taken=excluded.action_taken,responsible_id=excluded.responsible_id,followup_date=excluded.followup_date,resolved_at=excluded.resolved_at,
   document_ids=excluded.document_ids,version=ees_hr_incidents.version+1,updated_by=auth.uid(),updated_at=now()
  returning to_jsonb(ees_hr_incidents) into result;
  insert into public.ees_hr_case_events(incident_id,snapshot,actor_id) values(key,result,auth.uid());
 end if;
 perform public.ees_hr_v7_audit('people_'||p_kind,p_kind,key::text,array(select jsonb_object_keys(p_input)));
 result:=jsonb_build_object('id',key,'version',result->'version');
 insert into public.ees_hr_v7_requests(actor_id,request_id,action,input_hash,result) values(auth.uid(),p_request_id,'people_'||p_kind,md5(p_input::text),result);
 return result;
end $$;
create or replace function public.ees_people_cases(p_kind text,p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb; filtered jsonb; rows jsonb; total integer; employee uuid:=nullif(p_query->>'employeeId','')::uuid;
 today date:=(now() at time zone 'Asia/Bangkok')::date;
 page integer:=greatest(1,coalesce((p_query->>'page')::integer,1));
begin
 if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
 if p_kind='absences' then
  select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('duration',a.end_date-a.start_date+1,
   'employee_name',coalesce(e.preferred_name,d.name),'driver_id',e.driver_id::text,
   'away_today',a.status='approved' and today between a.start_date and a.end_date and a.return_status<>'returned',
   'approved_name',(select display_name from public.account_access where user_id=a.approved_by),
   'events',(select coalesce(jsonb_agg(to_jsonb(ev)||jsonb_build_object('actor_name',(select display_name from public.account_access where user_id=ev.actor_id)) order by ev.recorded_at),'[]') from public.ees_hr_case_events ev where absence_id=a.id))), '[]') into source
  from public.ees_hr_absences a join public.ees_employee_profiles e on e.id=a.employee_id left join public.drivers d on d.id=e.driver_id
  where employee is null or a.employee_id=employee;
 elsif p_kind='incidents' then
  select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('employee_name',coalesce(e.preferred_name,d.name),'driver_id',e.driver_id::text,
   'vehicle_registration',(select vehicle_reg from public.vehicles where id=i.vehicle_id),
   'responsible_name',(select display_name from public.account_access where user_id=i.responsible_id),
   'events',(select coalesce(jsonb_agg(to_jsonb(ev)||jsonb_build_object('actor_name',(select display_name from public.account_access where user_id=ev.actor_id)) order by ev.recorded_at),'[]') from public.ees_hr_case_events ev where incident_id=i.id))), '[]') into source
  from public.ees_hr_incidents i join public.ees_employee_profiles e on e.id=i.employee_id left join public.drivers d on d.id=e.driver_id
  where employee is null or i.employee_id=employee;
 else raise exception 'HR_INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(r),'[]'),count(*) into filtered,total from jsonb_array_elements(source) r where
  (nullif(p_query->>'id','') is null or r->>'id'=(p_query->>'id')::uuid::text)
  and (coalesce(p_query->>'status','all')='all' or r->>'status'=p_query->>'status')
  and (coalesce(p_query->>'search','')='' or concat_ws(' ',r->>'employee_name',r->>'description',r->>'category') ilike '%'||left(p_query->>'search',80)||'%')
  and (coalesce(p_query->>'view','all')='all' or p_query->>'view'='away' and r->>'away_today'='true'
   or p_query->>'view'='returning' and r->>'status'='approved' and r->>'return_status'<>'returned'
     and coalesce(nullif(r->>'return_date','')::date,(r->>'end_date')::date+1) between today and today+7);
 select coalesce(jsonb_agg(r),'[]') into rows from (select r from jsonb_array_elements(filtered) r
  order by coalesce(r->>'occurred_at',r->>'start_date') desc,r->>'id' offset (page-1)*25 limit 25) q;
 return jsonb_build_object('rows',rows,'total',total,'today',today);
end $$;
create or replace function public.ees_people_choices()
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(e.preferred_name,d.name)) order by coalesce(e.preferred_name,d.name)),'[]')
  from public.ees_employee_profiles e left join public.drivers d on d.id=e.driver_id),
  'vehicles',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',vehicle_reg) order by vehicle_reg),'[]') from public.vehicles),
  'responsible',(select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',display_name)),'[]') from public.account_access where status='active' and role in ('admin','office_staff')));
end $$;
create or replace function public.ees_people_public_employee(p_driver_id bigint,p_employee_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; begin
 r:=public.ees_hr_v7_public_employee(p_driver_id,p_employee_id);
 if r is null then return null; end if;
 return r||jsonb_build_object('startDate',(select start_date from public.ees_employee_profiles where id=(r->>'employeeId')::uuid),
 'awayToday',case when public.ees_is_hr_admin() then exists(select 1 from public.ees_hr_absences
  where employee_id=(r->>'employeeId')::uuid and status='approved' and return_status<>'returned'
   and (now() at time zone 'Asia/Bangkok')::date between start_date and end_date) else null end);
end $$;
create or replace function public.ees_people_directory(p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare all_rows jsonb; rows jsonb; total integer; search text:=left(coalesce(p_query->>'search',''),80);
  page integer:=greatest(1,coalesce((p_query->>'page')::integer,1)); size integer:=least(50,greatest(1,coalesce((p_query->>'size')::integer,25)));
  summary jsonb; hr boolean; begin
  if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  hr:=public.ees_is_hr_admin();
  select coalesce(jsonb_agg(r),'[]') into all_rows from (
    select public.ees_people_public_employee(d.id,null) r from public.drivers d
    union all select public.ees_people_public_employee(null,e.id) from public.ees_employee_profiles e where e.driver_id is null
  ) x;
  select jsonb_build_object('total',count(*),'activeEmployees',count(*) filter(where r->>'employmentStatus' in ('active','on_leave')),
    'activeDrivers',count(*) filter(where r->>'operationalActive'='true'),
    'assignments',count(*) filter(where r->'regularVehicle' is not null and r->'regularVehicle'<>'null'::jsonb),
    'unrecordedEmployment',count(*) filter(where r->>'employmentStatus'='not_recorded')) into summary from jsonb_array_elements(all_rows) r;
  if hr then summary:=summary||jsonb_build_object('followupsDue',(select count(*) from public.ees_hr_followups f
    where completed_at is null and due_date<=(current_timestamp at time zone 'Asia/Bangkok')::date
      and not exists(select 1 from public.ees_hr_meetings m left join public.ees_hr_meeting_state s on s.meeting_id=m.id
        where m.id=f.meeting_id and (lower(btrim(m.subject))='test' or s.is_test or s.archived_at is not null))));
  else summary:=summary||jsonb_build_object('followupsDue',null); end if;
  summary:=summary||jsonb_build_object('awayToday',case when hr then (select count(distinct employee_id) from public.ees_hr_absences where status='approved' and return_status<>'returned' and (now() at time zone 'Asia/Bangkok')::date between start_date and end_date) else null end,
    'actionsDue',case when hr then (summary->>'followupsDue')::integer+(select count(*) from public.ees_hr_incidents where status<>'resolved' and followup_date<=(now() at time zone 'Asia/Bangkok')::date) else null end);
  select count(*) into total from jsonb_array_elements(all_rows) r
    where (search='' or concat_ws(' ',r->>'name',r->>'employeeNumber',r->>'jobRole',r->'vehicle'->>'registration') ilike '%'||search||'%')
      and (coalesce(p_query->>'role','all')='all' or r->>'jobRole'=p_query->>'role')
      and (coalesce(p_query->>'kind','all')='all' or r->>'kind'=p_query->>'kind')
      and (coalesce(p_query->>'status','all')='all' or r->>'employmentStatus'=p_query->>'status')
      and (coalesce(p_query->>'vehicleType','all')='all' or r->'vehicle'->>'type'=p_query->>'vehicleType');
  select coalesce(jsonb_agg(r),'[]') into rows from (select r from jsonb_array_elements(all_rows) r
    where (search='' or concat_ws(' ',r->>'name',r->>'employeeNumber',r->>'jobRole',r->'vehicle'->>'registration') ilike '%'||search||'%')
      and (coalesce(p_query->>'role','all')='all' or r->>'jobRole'=p_query->>'role')
      and (coalesce(p_query->>'kind','all')='all' or r->>'kind'=p_query->>'kind')
      and (coalesce(p_query->>'status','all')='all' or r->>'employmentStatus'=p_query->>'status')
      and (coalesce(p_query->>'vehicleType','all')='all' or r->'vehicle'->>'type'=p_query->>'vehicleType')
    order by case when p_query->>'sort'='name-desc' then lower(r->>'name') end desc,
      case when p_query->>'sort'='vehicle' then r->'vehicle'->>'registration' end,
      case when p_query->>'sort'='role' then r->>'jobRole' end,lower(r->>'name'),r->>'id'
    offset (page-1)*size limit size) x;
  return jsonb_build_object('access',public.ees_hr_v7_access(),'rows',rows,'total',total,'summary',summary,'roles',(select coalesce(jsonb_agg(distinct job_role),'[]') from public.ees_employee_profiles where nullif(btrim(job_role),'') is not null),'vehicleTypes',(select coalesce(jsonb_agg(distinct vehicle_type),'[]') from public.vehicles where vehicle_type is not null));
end $$;

create or replace function public.ees_people_profile(p_kind text,p_id text,p_section text default 'overview')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; employee uuid; begin
 r:=public.ees_hr_v7_profile(p_kind,p_id,case when p_section in ('absences','incidents') then 'overview' else p_section end);
 employee:=(r->'employee'->>'employeeId')::uuid;
 r:=jsonb_set(r,'{employee}',public.ees_people_public_employee((r->'employee'->>'driverId')::bigint,employee));
 if p_section in ('absences','incidents') then
  if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  r:=jsonb_set(r,'{section}',to_jsonb(p_section));
  r:=jsonb_set(r,'{data}',case when employee is null then jsonb_build_object('rows','[]'::jsonb,'total',0) else public.ees_people_cases(p_section,jsonb_build_object('employeeId',employee)) end);
 elsif p_section='overview' and public.ees_is_hr_admin() then
  r:=jsonb_set(r,'{data}',r->'data'||jsonb_build_object('timeline',(select coalesce(jsonb_agg(event order by event->>'at' desc),'[]') from (
   select jsonb_build_object('id',ev.id,'type',case when absence_id is not null then 'absence' else 'incident' end,'at',ev.recorded_at,'status',ev.snapshot->>'status') event
    from public.ees_hr_case_events ev where ev.snapshot->>'employee_id'=employee::text
   union all select jsonb_build_object('id',h.id,'type','employment','at',h.recorded_at,'status',h.employment_status) from public.ees_employee_employment_history h where employee_id=employee
   union all select jsonb_build_object('id',m.id,'type','meeting','at',m.created_at,'status',m.category) from public.ees_hr_meetings m where (m.employee_id=employee or m.driver_id=(r->'employee'->>'driverId')::bigint) and lower(btrim(m.subject))<>'test' and not exists(select 1 from public.ees_hr_meeting_state s where s.meeting_id=m.id and (s.is_test or s.archived_at is not null))
   union all select jsonb_build_object('id',d.id,'type','document','at',d.uploaded_at,'status',d.state) from public.ees_employee_documents d where d.employee_id=employee
   union all select jsonb_build_object('id',t.id,'type','training','at',t.recorded_at,'status',t.course) from public.ees_employee_training t where t.employee_id=employee
   union all select jsonb_build_object('id',a.id,'type','assignment','at',a.recorded_at,'status',a.assignment_kind) from public.ees_driver_vehicle_assignments a where a.driver_id=(r->'employee'->>'driverId')::bigint
   union all select jsonb_build_object('id',ev.id,'type','followup','at',ev.recorded_at,'status',ev.action) from public.ees_hr_followup_events ev join public.ees_hr_followups f on f.id=ev.followup_id where f.employee_id=employee or f.driver_id=(r->'employee'->>'driverId')::bigint
  ) q)));
 end if;
 return r;
end $$;
revoke all on function public.ees_people_event_guard(),public.ees_people_case_guard(),public.ees_people_public_employee(bigint,uuid) from public,anon,authenticated;
revoke all on function public.ees_people_ready(),public.ees_people_action(text,jsonb,uuid),public.ees_people_cases(text,jsonb),public.ees_people_choices(),public.ees_people_directory(jsonb),public.ees_people_profile(text,text,text) from public,anon;
grant execute on function public.ees_people_ready(),public.ees_people_action(text,jsonb,uuid),public.ees_people_cases(text,jsonb),public.ees_people_choices(),public.ees_people_directory(jsonb),public.ees_people_profile(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
