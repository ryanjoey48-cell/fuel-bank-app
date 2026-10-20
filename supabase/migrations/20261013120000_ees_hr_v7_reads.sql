begin;
create or replace function public.ees_hr_v7_vehicle_json(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',id,'registration',vehicle_reg,'type',vehicle_type,
    'model',vehicle_model,'name',vehicle_name) from public.vehicles where id=p_id;
$$;
create or replace function public.ees_hr_v7_access(p_driver_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  return jsonb_build_object('ready',true,'hr',public.ees_is_hr_admin(),
    'operate',public.ees_hr_v7_operate(p_driver_id),'admin',public.ees_is_hr_admin() and public.current_account_role()='admin',
    'storageReady',public.ees_hr_v7_storage_ready(),'userId',auth.uid());
end $$;
create or replace function public.ees_hr_v7_public_employee(p_driver_id bigint,p_employee_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.drivers%rowtype; e public.ees_employee_profiles%rowtype; cover uuid; follow date;
  today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;
begin
  if p_employee_id is not null then select * into e from public.ees_employee_profiles where id=p_employee_id; p_driver_id:=e.driver_id;
  elsif p_driver_id is not null then select * into e from public.ees_employee_profiles where driver_id=p_driver_id; end if;
  if p_driver_id is not null then
    select * into d from public.drivers where id=p_driver_id;
    if not found then return null; end if;
    if d.active then select vehicle_id into cover from public.ees_driver_vehicle_assignments where driver_id=d.id
      and assignment_kind='temporary' and effective_from<=today and (effective_to is null or effective_to>=today)
      and closed_at is null and cancelled_at is null order by effective_from desc,recorded_at desc limit 1; end if;
  elsif e.id is null then return null; end if;
  if public.ees_is_hr_admin() then
    select min(f.due_date) into follow from public.ees_hr_followups f where f.completed_at is null
      and (f.employee_id=e.id or f.driver_id=d.id) and not exists(select 1 from public.ees_hr_meetings m
        left join public.ees_hr_meeting_state s on s.meeting_id=m.id where m.id=f.meeting_id
        and (lower(btrim(m.subject))='test' or s.is_test or s.archived_at is not null));
  end if;
  return jsonb_build_object('id',case when d.id is not null then d.id::text else e.id::text end,
    'kind',case when d.id is not null then 'driver' else 'employee' end,'driverId',d.id::text,'employeeId',e.id,
    'name',coalesce(e.preferred_name,d.name),'employeeNumber',e.employee_number,
    'employmentStatus',coalesce(e.employment_status,'not_recorded'),'operationalActive',d.active,
    'jobRole',e.job_role,'department',e.department,'vehicle',public.ees_hr_v7_vehicle_json(coalesce(cover,d.assigned_vehicle_id)),
    'regularVehicle',public.ees_hr_v7_vehicle_json(d.assigned_vehicle_id),
    'documentStatus',case when public.ees_hr_v7_operate(d.id) and d.id is not null then public.ees_hr_v7_licence_status(d.id,coalesce(cover,d.assigned_vehicle_id)) else null end,
    'nextFollowup',follow,'operate',public.ees_hr_v7_operate(d.id));
end $$;

create or replace function public.ees_hr_v7_directory(p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare all_rows jsonb; rows jsonb; total integer; search text:=left(coalesce(p_query->>'search',''),80);
  page integer:=greatest(1,coalesce((p_query->>'page')::integer,1)); size integer:=least(50,greatest(1,coalesce((p_query->>'size')::integer,25)));
  summary jsonb; hr boolean; begin
  if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  hr:=public.ees_is_hr_admin();
  select coalesce(jsonb_agg(r),'[]') into all_rows from (
    select public.ees_hr_v7_public_employee(d.id,null) r from public.drivers d
    union all select public.ees_hr_v7_public_employee(null,e.id) from public.ees_employee_profiles e where e.driver_id is null
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
  select count(*) into total from jsonb_array_elements(all_rows) r
    where (search='' or concat_ws(' ',r->>'name',r->>'employeeNumber',r->>'jobRole',r->'vehicle'->>'registration') ilike '%'||search||'%')
      and (coalesce(p_query->>'status','all')='all' or r->>'employmentStatus'=p_query->>'status')
      and (coalesce(p_query->>'vehicleType','all')='all' or r->'vehicle'->>'type'=p_query->>'vehicleType');
  select coalesce(jsonb_agg(r),'[]') into rows from (select r from jsonb_array_elements(all_rows) r
    where (search='' or concat_ws(' ',r->>'name',r->>'employeeNumber',r->>'jobRole',r->'vehicle'->>'registration') ilike '%'||search||'%')
      and (coalesce(p_query->>'status','all')='all' or r->>'employmentStatus'=p_query->>'status')
      and (coalesce(p_query->>'vehicleType','all')='all' or r->'vehicle'->>'type'=p_query->>'vehicleType')
    order by case when p_query->>'sort'='name-desc' then lower(r->>'name') end desc,
      case when p_query->>'sort'='vehicle' then r->'vehicle'->>'registration' end,
      case when p_query->>'sort'='role' then r->>'jobRole' end,lower(r->>'name'),r->>'id'
    offset (page-1)*size limit size) x;
  return jsonb_build_object('access',public.ees_hr_v7_access(),'rows',rows,'total',total,'summary',summary);
end $$;

create or replace function public.ees_hr_v7_meeting(p_id uuid,p_allow_test boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.ees_hr_meetings%rowtype; result jsonb; begin
  if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  select * into m from public.ees_hr_meetings where id=p_id;
  if not found then raise exception 'HR_NOT_FOUND'; end if;
  if lower(btrim(m.subject))='test' or exists(select 1 from public.ees_hr_meeting_state where meeting_id=p_id and (is_test or archived_at is not null)) then
    if not p_allow_test or public.current_account_role()<>'admin' then raise exception 'HR_NOT_FOUND'; end if;
  end if;
  result:=to_jsonb(m)||jsonb_build_object('driver_id',m.driver_id::text,
    'employee_name',coalesce((select preferred_name from public.ees_employee_profiles where id=m.employee_id),
      (select name from public.drivers where id=m.driver_id)),
    'author_name',coalesce(m.author_name_snapshot,(select display_name from public.account_access where user_id=m.created_by)),
    'addenda',(select coalesce(jsonb_agg(to_jsonb(a) order by created_at),'[]') from public.ees_hr_meeting_addenda a where meeting_id=p_id),
    'followup',(select to_jsonb(f)||jsonb_build_object('driver_id',f.driver_id::text) from public.ees_hr_followups f where meeting_id=p_id));
  return result;
end $$;

create or replace function public.ees_hr_v7_followups(p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total integer; status text:=coalesce(p_query->>'status','all');
  driver_key bigint:=nullif(p_query->>'driverId','')::bigint; employee_key uuid:=nullif(p_query->>'employeeId','')::uuid;
  today date:=(current_timestamp at time zone 'Asia/Bangkok')::date; begin
  if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  select count(*) into total from public.ees_hr_followups f where (driver_key is null and employee_key is null or f.driver_id=driver_key or f.employee_id=employee_key)
    and (status='all' or status=case when completed_at is not null then 'completed' when due_date<today then 'overdue' when due_date=today then 'due_today' else 'upcoming' end)
    and not exists(select 1 from public.ees_hr_meetings m left join public.ees_hr_meeting_state s on s.meeting_id=m.id
      where m.id=f.meeting_id and (lower(btrim(m.subject))='test' or s.is_test or s.archived_at is not null));
  select coalesce(jsonb_agg(r),'[]') into rows from (select to_jsonb(f)||jsonb_build_object('driver_id',f.driver_id::text,
    'employee_name',coalesce(e.preferred_name,d.name),'responsible_name',(select display_name from public.account_access where user_id=f.responsible_id),
    'events',(select coalesce(jsonb_agg(to_jsonb(ev) order by recorded_at),'[]') from public.ees_hr_followup_events ev where followup_id=f.id)) r
    from public.ees_hr_followups f left join public.ees_employee_profiles e on e.id=f.employee_id left join public.drivers d on d.id=coalesce(f.driver_id,e.driver_id)
    where (driver_key is null and employee_key is null or f.driver_id=driver_key or f.employee_id=employee_key)
      and (status='all' or status=case when completed_at is not null then 'completed' when due_date<today then 'overdue' when due_date=today then 'due_today' else 'upcoming' end)
      and not exists(select 1 from public.ees_hr_meetings m left join public.ees_hr_meeting_state s on s.meeting_id=m.id
        where m.id=f.meeting_id and (lower(btrim(m.subject))='test' or s.is_test or s.archived_at is not null))
    order by f.completed_at nulls first,f.due_date,f.id offset greatest(0,coalesce((p_query->>'page')::integer,1)-1)*25 limit 25) x;
  return jsonb_build_object('rows',rows,'total',total);
end $$;

create or replace function public.ees_hr_v7_profile(p_kind text,p_id text,p_section text default 'overview')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare driver_key bigint; employee_key uuid; public_row jsonb; data jsonb:='{}'; actor jsonb;
begin
  if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if p_kind='driver' then driver_key:=p_id::bigint;
    select id into employee_key from public.ees_employee_profiles where driver_id=driver_key;
  elsif p_kind='employee' then employee_key:=p_id::uuid;
    select driver_id into driver_key from public.ees_employee_profiles where id=employee_key;
  else raise exception 'HR_INVALID_ID'; end if;
  public_row:=public.ees_hr_v7_public_employee(driver_key,employee_key);
  if public_row is null then raise exception 'HR_NOT_FOUND'; end if;
  actor:=public.ees_hr_v7_access(driver_key);
  if p_section in ('personnel','meetings','documents','followups') and not public.ees_is_hr_admin()
    then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if p_section='personnel' then
    data:=jsonb_build_object('profile',(select to_jsonb(e)||jsonb_build_object('driver_id',e.driver_id::text) from public.ees_employee_profiles e where id=employee_key),
      'private',(select to_jsonb(e) from public.ees_employee_private e where employee_id=employee_key),
      'compensation',(select coalesce(jsonb_agg(to_jsonb(c) order by effective_from desc,recorded_at desc),'[]') from public.ees_employee_compensation c where employee_id=employee_key),
      'employmentHistory',(select coalesce(jsonb_agg(to_jsonb(h) order by recorded_at desc),'[]') from public.ees_employee_employment_history h where employee_id=employee_key));
  elsif p_section='assignments' then
    if not public.ees_hr_v7_operate(driver_key) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    data:=jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('driver_id',a.driver_id::text,
      'vehicle',public.ees_hr_v7_vehicle_json(a.vehicle_id),'author_name',(select display_name from public.account_access where user_id=a.recorded_by))
      order by effective_from desc,recorded_at desc),'[]') from public.ees_driver_vehicle_assignments a where driver_id=driver_key),
      'vehicles',(select coalesce(jsonb_agg(public.ees_hr_v7_vehicle_json(id) order by vehicle_reg),'[]') from public.vehicles where active));
  elsif p_section='meetings' then
    data:=jsonb_build_object('meetings',(select coalesce(jsonb_agg(public.ees_hr_v7_meeting(m.id) order by meeting_date desc,created_at desc),'[]')
      from public.ees_hr_meetings m where (m.driver_id=driver_key or m.employee_id=employee_key)
      and lower(btrim(m.subject))<>'test' and not exists(select 1 from public.ees_hr_meeting_state s where s.meeting_id=m.id and (s.is_test or s.archived_at is not null))));
  elsif p_section='followups' then data:=public.ees_hr_v7_followups(jsonb_build_object('driverId',driver_key::text,'employeeId',employee_key));
  elsif p_section='documents' then
    data:=jsonb_build_object('documents',(select coalesce(jsonb_agg(to_jsonb(d)-'object_key' order by uploaded_at desc),'[]') from public.ees_employee_documents d where employee_id=employee_key),
      'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by category,approved_at desc),'[]') from public.ees_hr_document_policies p where active),
      'licences',(select coalesce(jsonb_agg(to_jsonb(l) order by issue_date desc,recorded_at desc),'[]') from public.ees_employee_licences l where employee_id=employee_key),
      'licenceRules',(select coalesce(jsonb_agg(to_jsonb(r) order by reviewed_at desc),'[]') from public.ees_licence_vehicle_rules r where active),
      'vehicleTypes',(select coalesce(jsonb_agg(distinct vehicle_type),'[]') from public.vehicles where vehicle_type is not null));
  elsif p_section='training' then
    if not public.ees_hr_v7_operate(driver_key) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    data:=jsonb_build_object('training',(select coalesce(jsonb_agg(case when public.ees_is_hr_admin() then to_jsonb(t)
      else jsonb_build_object('id',t.id,'course',t.course,'completed_on',t.completed_on,'expires_on',t.expires_on,'hasCertificate',t.certificate_id is not null) end order by completed_on desc),'[]')
      from public.ees_employee_training t where employee_id=employee_key));
    if to_regclass('public.vehicle_safety_inspections') is not null then
      data:=data||jsonb_build_object('safety',(select coalesce(jsonb_agg(r),'[]') from (
        select jsonb_build_object('id',id,'date',inspection_date,'status',overall_status) r from public.vehicle_safety_inspections
        where driver_id=driver_key order by inspection_date desc limit 20) q));
    end if;
  elsif p_section<>'overview' then raise exception 'HR_INVALID_SECTION'; end if;
  return jsonb_build_object('access',actor,'employee',public_row,'section',p_section,'data',data);
end $$;

create or replace function public.ees_hr_v7_lookups(p_kind text,p_driver_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if p_kind='vehicles' then
    if not public.ees_hr_v7_operate(p_driver_id) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    return (select coalesce(jsonb_agg(public.ees_hr_v7_vehicle_json(id) order by vehicle_reg),'[]') from public.vehicles where active);
  end if;
  if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if p_kind='responsible' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',h.user_id,'name',a.display_name) order by a.display_name),'[]')
      from public.ees_hr_admins h join public.account_access a on a.user_id=h.user_id where h.active and a.status='active' and a.role in ('admin','office_staff'));
  elsif p_kind='staff' then
    if public.current_account_role()<>'admin' then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('id',a.user_id,'name',a.display_name,'manager',m.active,'driverIds',m.driver_ids) order by a.display_name),'[]')
      from public.account_access a left join public.ees_operational_managers m on m.user_id=a.user_id
      where a.status='active' and a.role in ('admin','office_staff') and not exists(select 1 from public.driver_accounts where auth_user_id=a.user_id and active));
  elsif p_kind='unlinked_drivers' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id::text,'name',d.name) order by d.name),'[]') from public.drivers d
      where not exists(select 1 from public.ees_employee_profiles where driver_id=d.id));
  elsif p_kind='test_meetings' then
    if public.current_account_role()<>'admin' then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'driverId',m.driver_id::text,'employeeId',m.employee_id,'date',m.meeting_date,
      'subject',m.subject,'name',coalesce(e.preferred_name,d.name),'archivedAt',s.archived_at) order by m.created_at desc),'[]')
      from public.ees_hr_meetings m left join public.drivers d on d.id=m.driver_id left join public.ees_employee_profiles e on e.id=m.employee_id
      left join public.ees_hr_meeting_state s on s.meeting_id=m.id where lower(btrim(m.subject))='test' or s.is_test);
  end if;
  raise exception 'HR_INVALID_ACTION';
end $$;

revoke all on function public.ees_hr_v7_vehicle_json(uuid),public.ees_hr_v7_public_employee(bigint,uuid) from public,anon,authenticated;
revoke all on function public.ees_hr_v7_access(bigint),public.ees_hr_v7_directory(jsonb),
  public.ees_hr_v7_meeting(uuid,boolean),public.ees_hr_v7_followups(jsonb),public.ees_hr_v7_profile(text,text,text),public.ees_hr_v7_lookups(text,bigint) from public,anon;
grant execute on function public.ees_hr_v7_access(bigint),public.ees_hr_v7_directory(jsonb),
  public.ees_hr_v7_meeting(uuid,boolean),public.ees_hr_v7_followups(jsonb),public.ees_hr_v7_profile(text,text,text),public.ees_hr_v7_lookups(text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
