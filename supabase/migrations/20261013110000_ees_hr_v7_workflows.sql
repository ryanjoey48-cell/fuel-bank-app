-- Review-only, apply after the V7 foundation. No production execution by the app.
begin;
alter table public.ees_driver_vehicle_assignments add column if not exists closed_by uuid;
alter table public.ees_driver_vehicle_assignments add column if not exists closed_at timestamptz;
alter table public.ees_driver_vehicle_assignments add column if not exists cancelled_at timestamptz;
alter table public.ees_driver_vehicle_assignments add column if not exists cancellation_reason text;
create table if not exists public.ees_hr_v7_requests (
  actor_id uuid not null, request_id uuid not null, action text not null,
  input_hash text not null, result jsonb not null, recorded_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table public.ees_hr_v7_requests enable row level security;
revoke all on public.ees_hr_v7_requests from public,anon,authenticated;

create or replace function public.ees_hr_v7_audit(p_action text,p_type text,p_id text,p_fields text[] default '{}')
returns void language sql security definer set search_path='' as $$
  insert into public.ees_hr_audit(actor_id,action,entity_type,entity_id,changed_fields)
  values(auth.uid(),p_action,p_type,p_id,p_fields);
$$;
create or replace function public.ees_hr_v7_driver_guard()
returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' then raise exception 'HR_DRIVER_RETAIN' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.assigned_vehicle_id is distinct from old.assigned_vehicle_id
    or new.vehicle_reg is distinct from old.vehicle_reg or new.vehicle_type is distinct from old.vehicle_type
    or new.vehicle_model is distinct from old.vehicle_model) then
    if current_setting('ees_hr_v7.assignment_driver',true) is distinct from new.id::text
      or not public.ees_hr_v7_operate(new.id) then
      raise exception 'HR_USE_ASSIGNMENT_WORKFLOW' using errcode='42501';
    end if;
  elsif tg_op='INSERT' and (new.assigned_vehicle_id is not null or nullif(new.vehicle_reg,'') is not null) then
    raise exception 'HR_USE_ASSIGNMENT_WORKFLOW' using errcode='42501';
  end if;
  if tg_op='UPDATE' and auth.role()='authenticated'
    and (new.name is distinct from old.name or new.active is distinct from old.active)
    and not public.ees_hr_v7_operate(new.id) then
    raise exception 'HR_FORBIDDEN' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists ees_hr_v7_driver_guard on public.drivers;
create trigger ees_hr_v7_driver_guard before insert or update or delete on public.drivers
for each row execute function public.ees_hr_v7_driver_guard();

create or replace function public.ees_hr_v7_assignment_guard()
returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' then raise exception 'HR_ASSIGNMENT_RETAIN' using errcode='42501'; end if;
  if current_setting('ees_hr_v7.assignment_driver',true) is distinct from new.driver_id::text
    or not public.ees_hr_v7_operate(new.driver_id) then
    raise exception 'HR_USE_ASSIGNMENT_WORKFLOW' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.driver_id is distinct from old.driver_id or new.vehicle_id is distinct from old.vehicle_id
    or new.effective_from is distinct from old.effective_from or new.assignment_kind is distinct from old.assignment_kind
    or new.reason is distinct from old.reason or new.notes is distinct from old.notes
    or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at) then
    raise exception 'HR_ASSIGNMENT_RETAIN' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists ees_hr_v7_assignment_guard on public.ees_driver_vehicle_assignments;
create trigger ees_hr_v7_assignment_guard before insert or update or delete on public.ees_driver_vehicle_assignments
for each row execute function public.ees_hr_v7_assignment_guard();
alter table public.ees_driver_vehicle_assignments enable row level security;
drop policy if exists ees_hr_v7_assignment_read on public.ees_driver_vehicle_assignments;
create policy ees_hr_v7_assignment_read on public.ees_driver_vehicle_assignments for select to authenticated
using(public.ees_hr_v7_operate(driver_id));
drop policy if exists ees_hr_v7_assignment_guard_policy on public.ees_driver_vehicle_assignments;
create policy ees_hr_v7_assignment_guard_policy on public.ees_driver_vehicle_assignments as restrictive for all to authenticated
using(public.ees_hr_v7_operate(driver_id)) with check(public.ees_hr_v7_operate(driver_id));
revoke insert,update,delete on public.ees_driver_vehicle_assignments from public,anon,authenticated;
grant select on public.ees_driver_vehicle_assignments to authenticated;

create or replace function public.ees_hr_v7_licence_status(p_driver_id bigint,p_vehicle_id uuid default null)
returns text language plpgsql stable security definer set search_path='' as $$
declare e uuid; l public.ees_employee_licences%rowtype; vtype text; allowed boolean;
  today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
begin
  select id into e from public.ees_employee_profiles where driver_id=p_driver_id;
  select * into l from public.ees_employee_licences where employee_id=e and issue_date<=today
    order by issue_date desc,recorded_at desc,id desc limit 1;
  if not found then return 'not_recorded'; end if;
  if l.expiry_date<today then return 'expired'; end if;
  if l.verification_status<>'verified' then return 'unverified'; end if;
  if p_vehicle_id is not null then
    select vehicle_type into vtype from public.vehicles where id=p_vehicle_id;
    select compatible into allowed from public.ees_licence_vehicle_rules
      where active and lower(category)=lower(l.category) and lower(vehicle_type)=lower(vtype)
      and nullif(btrim(reliable_source),'') is not null order by reviewed_at desc,id desc limit 1;
    if found and not allowed then return 'incompatible'; end if;
    if not found then return 'needs_review'; end if;
  end if;
  if l.expiry_date<=today+30 then return 'expiring'; end if;
  return 'recorded_current';
end $$;

create or replace function public.ees_hr_v7_change_driver_vehicle(
  p_driver_id bigint,p_vehicle_id uuid,p_effective_from date,p_assignment_kind text,
  p_reason text,p_notes text default null,p_effective_to date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drivers%rowtype; v public.vehicles%rowtype; prior uuid; previous_reg text;
  entry_id uuid; today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date; licence text; dtype text;
begin
  if not public.ees_hr_v7_operate(p_driver_id) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if p_assignment_kind not in ('permanent','temporary') or p_effective_from is null
    or nullif(btrim(p_reason),'') is null or char_length(p_reason)>250
    or char_length(coalesce(p_notes,''))>4000 then raise exception 'HR_INVALID_ASSIGNMENT'; end if;
  if p_effective_to is not null and (p_assignment_kind<>'temporary' or p_effective_to<p_effective_from)
    then raise exception 'HR_INVALID_DATE'; end if;
  if p_assignment_kind='permanent' and p_effective_from>today then raise exception 'HR_FUTURE_PERMANENT'; end if;
  select * into d from public.drivers where id=p_driver_id for update;
  if not found or d.active is not true then raise exception 'HR_DRIVER_INACTIVE'; end if;
  -- Consistent vehicle lock ordering serializes same-truck changes safely.
  perform id from public.vehicles where id in (p_vehicle_id,d.assigned_vehicle_id) order by id for update;
  select * into v from public.vehicles where id=p_vehicle_id;
  if not found or v.active is not true then raise exception 'HR_VEHICLE_UNAVAILABLE'; end if;
  if d.assigned_vehicle_id=p_vehicle_id then raise exception 'HR_ASSIGNMENT_UNCHANGED'; end if;
  licence := public.ees_hr_v7_licence_status(p_driver_id,p_vehicle_id);
  if licence in ('expired','incompatible') then raise exception 'HR_LICENCE_BLOCKED'; end if;
  if exists(select 1 from public.drivers other where other.id<>p_driver_id
    and other.active and other.assigned_vehicle_id=p_vehicle_id) then raise exception 'HR_VEHICLE_IN_USE'; end if;
  if exists(select 1 from public.ees_driver_vehicle_assignments a
    where a.assignment_kind='temporary' and a.cancelled_at is null and (a.driver_id=p_driver_id or a.vehicle_id=p_vehicle_id)
      and not (a.closed_at is not null and a.effective_to=today and p_effective_from=today)
      and daterange(a.effective_from,case when a.effective_to is null then null else a.effective_to+1 end,'[)')
        && daterange(p_effective_from,case when p_assignment_kind='temporary' and p_effective_to is not null then p_effective_to+1 else null end,'[)'))
    then raise exception 'HR_ASSIGNMENT_OVERLAP'; end if;
  perform set_config('ees_hr_v7.assignment_driver',p_driver_id::text,true);
  select vehicle_reg into previous_reg from public.vehicles where id=d.assigned_vehicle_id;
  if p_assignment_kind='permanent' then
    if (select count(*) from public.ees_driver_vehicle_assignments
      where driver_id=p_driver_id and assignment_kind='permanent' and effective_to is null)>1
      then raise exception 'HR_ASSIGNMENT_REVIEW'; end if;
    select id into prior from public.ees_driver_vehicle_assignments where driver_id=p_driver_id
      and assignment_kind='permanent' and effective_to is null for update;
    if prior is not null and exists(select 1 from public.ees_driver_vehicle_assignments
      where id=prior and effective_from>p_effective_from) then raise exception 'HR_ASSIGNMENT_OVERLAP'; end if;
    if exists(select 1 from public.ees_driver_vehicle_assignments where driver_id=p_driver_id
      and assignment_kind='permanent' and effective_to is not null
      and daterange(effective_from,effective_to,'[)') && daterange(p_effective_from,null,'[)'))
      then raise exception 'HR_ASSIGNMENT_OVERLAP'; end if;
    update public.ees_driver_vehicle_assignments set effective_to=p_effective_from,
      closed_by=auth.uid(),closed_at=now() where id=prior;
    dtype := case regexp_replace(upper(coalesce(v.vehicle_type,'')),'[^A-Z0-9]+','_','g')
      when 'FOUR_WHEEL_TRUCK' then 'FOUR_WHEEL_TRUCK' when '4_WHEELER' then 'FOUR_WHEEL_TRUCK'
      when '4_WHEEL_TRUCK' then 'FOUR_WHEEL_TRUCK' when 'SIX_WHEEL_TRUCK' then 'SIX_WHEEL_TRUCK'
      when '6_WHEELER' then 'SIX_WHEEL_TRUCK' when 'EIGHTEEN_WHEELER' then 'EIGHTEEN_WHEELER'
      when '18_WHEELER' then 'EIGHTEEN_WHEELER' when 'SIX_PLUS_SIX_WHEELER' then 'SIX_PLUS_SIX_WHEELER'
      when '6_6_WHEELER' then 'SIX_PLUS_SIX_WHEELER' else null end;
    update public.drivers set assigned_vehicle_id=v.id,vehicle_reg=v.vehicle_reg,
      vehicle_type=dtype,vehicle_model=v.vehicle_model where id=p_driver_id;
  end if;
  insert into public.ees_driver_vehicle_assignments(driver_id,vehicle_id,effective_from,effective_to,
    assignment_kind,reason,notes,recorded_by,previous_vehicle_reg)
  values(p_driver_id,p_vehicle_id,p_effective_from,p_effective_to,p_assignment_kind,btrim(p_reason),
    nullif(p_notes,''),auth.uid(),previous_reg) returning id into entry_id;
  perform public.ees_hr_v7_audit('vehicle_assignment','driver',p_driver_id::text,array['assignment']);
  return jsonb_build_object('id',entry_id,'driverId',p_driver_id::text,'licenceStatus',licence);
end $$;

-- Forward the existing RPC without guessing/changing its published return type
-- or argument order. An unfamiliar return contract aborts this transaction.
do $$ declare p record; result text; body text; found_count integer:=0; begin
  for p in select * from pg_proc where pronamespace='public'::regnamespace
    and proname='ees_change_driver_vehicle' and prokind='f' loop
    if p.proargnames @> array['p_driver_id','p_vehicle_id','p_effective_from','p_assignment_kind','p_reason','p_notes','p_effective_to'] then
      found_count:=found_count+1; result:=pg_get_function_result(p.oid);
      body:='declare r jsonb; begin r:=public.ees_hr_v7_change_driver_vehicle(p_driver_id,p_vehicle_id,p_effective_from,p_assignment_kind,p_reason,p_notes,p_effective_to); ';
      if result='void' then body:=body||'return; end';
      elsif result='jsonb' then body:=body||'return r; end';
      elsif result='json' then body:=body||'return r::json; end';
      elsif p.prorettype='public.ees_driver_vehicle_assignments'::regtype then
        body:=body||'return (select a from public.ees_driver_vehicle_assignments a where a.id=(r->>''id'')::uuid); end';
      else raise exception 'HR_LEGACY_ASSIGNMENT_RETURN_REVIEW'; end if;
      execute format('create or replace function public.ees_change_driver_vehicle(%s) returns %s language plpgsql security definer set search_path='''' as %L',pg_get_function_arguments(p.oid),result,body);
    end if;
  end loop;
  if found_count<>1 then raise exception 'HR_LEGACY_ASSIGNMENT_SIGNATURE_REVIEW'; end if;
end $$;

create or replace function public.ees_hr_v7_meeting_insert()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if new.driver_id is null and new.employee_id is null then raise exception 'HR_PROFILE_REQUIRED'; end if;
  if new.driver_id is not null and not exists(select 1 from public.drivers where id=new.driver_id)
    then raise exception 'HR_NOT_FOUND'; end if;
  if new.employee_id is not null and new.driver_id is not null and not exists(
    select 1 from public.ees_employee_profiles where id=new.employee_id and driver_id=new.driver_id)
    then raise exception 'HR_IDENTITY_MISMATCH'; end if;
  new.created_by:=auth.uid();
  select display_name into new.author_name_snapshot from public.account_access where user_id=auth.uid();
  if nullif(btrim(new.subject),'') is null or nullif(btrim(new.attendees),'') is null
    or nullif(btrim(new.discussion),'') is null then raise exception 'HR_MEETING_REQUIRED'; end if;
  return new;
end $$;
drop trigger if exists ees_hr_v7_meeting_insert on public.ees_hr_meetings;
create trigger ees_hr_v7_meeting_insert before insert on public.ees_hr_meetings
for each row execute function public.ees_hr_v7_meeting_insert();

create or replace function public.ees_hr_v7_meeting_followup()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.follow_up_date is not null then
    insert into public.ees_hr_followups(employee_id,driver_id,meeting_id,due_date,required_action,created_by)
    values(new.employee_id,new.driver_id,new.id,new.follow_up_date,
      coalesce(nullif(new.agreed_actions,''),new.subject),auth.uid());
  end if;
  perform public.ees_hr_v7_audit('meeting_created','meeting',new.id::text,array['original_record']);
  return new;
end $$;
drop trigger if exists ees_hr_v7_meeting_followup on public.ees_hr_meetings;
create trigger ees_hr_v7_meeting_followup after insert on public.ees_hr_meetings
for each row execute function public.ees_hr_v7_meeting_followup();

-- Existing schedules are retained, with no inferred responsible staff and no
-- modification of original meetings. Test subjects require explicit review.
insert into public.ees_hr_followups(employee_id,driver_id,meeting_id,due_date,required_action,created_by)
select m.employee_id,m.driver_id,m.id,m.follow_up_date,
  coalesce(nullif(m.agreed_actions,''),m.subject),m.created_by
from public.ees_hr_meetings m where m.follow_up_date is not null
  and lower(btrim(m.subject))<>'test'
on conflict(meeting_id) do nothing;

create or replace function public.ees_hr_v7_action(p_action text,p_input jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); today date:=(clock_timestamp() at time zone 'Asia/Bangkok')::date;
  driver_key bigint:=nullif(p_input->>'driverId','')::bigint;
  employee_key uuid:=nullif(p_input->>'employeeId','')::uuid;
  row_key uuid:=nullif(p_input->>'id','')::uuid;
  e public.ees_employee_profiles%rowtype; d public.drivers%rowtype;
  m public.ees_hr_meetings%rowtype; f public.ees_hr_followups%rowtype;
  doc public.ees_employee_documents%rowtype; policy public.ees_hr_document_policies%rowtype;
  old_doc public.ees_employee_documents%rowtype; result jsonb;
  status text; starts date; ends date; reason text; display_value text; target_user uuid;
  request public.ees_hr_v7_requests%rowtype; text_key text; version_no integer; group_key uuid;
begin
  if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if p_action in ('save_driver','deactivate_driver','change_vehicle','end_cover') then
    if not public.ees_hr_v7_operate(driver_key) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  elsif not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
    select * into request from public.ees_hr_v7_requests where actor_id=actor and request_id=p_request_id;
    if found then
      if request.action<>p_action or request.input_hash<>md5(p_input::text) then raise exception 'HR_REQUEST_REUSED'; end if;
      return request.result;
    end if;
  end if;
  if employee_key is not null then
    select * into e from public.ees_employee_profiles where id=employee_key for update;
    if not found then raise exception 'HR_NOT_FOUND'; end if;
    if driver_key is not null and e.driver_id is distinct from driver_key then raise exception 'HR_IDENTITY_MISMATCH'; end if;
    driver_key:=e.driver_id;
  elsif driver_key is not null then
    perform id from public.drivers where id=driver_key for update;
    if not found then raise exception 'HR_NOT_FOUND'; end if;
    select * into e from public.ees_employee_profiles where driver_id=driver_key;
    employee_key:=e.id;
  end if;

  if p_action='save_employee' then
    status:=coalesce(p_input->>'employmentStatus',e.employment_status,'not_recorded');
    starts:=case when p_input?'startDate' then nullif(p_input->>'startDate','')::date else e.start_date end;
    ends:=case when p_input?'endDate' then nullif(p_input->>'endDate','')::date else e.end_date end;
    if status not in ('not_recorded','active','on_leave','left') or (starts is not null and ends<starts)
      or (status='active' and starts>today) or (status='left' and (ends is null or ends>today)) then raise exception 'HR_INVALID_EMPLOYMENT'; end if;
    display_value:=case when p_input?'preferredName' then nullif(btrim(p_input->>'preferredName'),'') else e.preferred_name end;
    if driver_key is null and display_value is null then raise exception 'HR_NAME_REQUIRED'; end if;
    if char_length(coalesce(display_value,''))>200 or char_length(coalesce(p_input->>'address',''))>4000
      then raise exception 'HR_INVALID_TEXT'; end if;
    if employee_key is null then
      insert into public.ees_employee_profiles(driver_id,preferred_name,employee_number,job_role,department,
        employment_status,start_date,end_date,created_by,updated_by)
      values(driver_key,display_value,nullif(p_input->>'employeeNumber',''),nullif(p_input->>'jobRole',''),nullif(p_input->>'department',''),
        status,starts,ends,actor,actor) returning id into employee_key;
    else
      update public.ees_employee_profiles set preferred_name=display_value,
        employee_number=case when p_input?'employeeNumber' then nullif(p_input->>'employeeNumber','') else employee_number end,
        job_role=case when p_input?'jobRole' then nullif(p_input->>'jobRole','') else job_role end,
        department=case when p_input?'department' then nullif(p_input->>'department','') else department end,employment_status=status,
        start_date=starts,end_date=ends,updated_by=actor,updated_at=now() where id=employee_key;
    end if;
    insert into public.ees_employee_private(employee_id,legal_name_th,english_name,telephone,address,
      emergency_contact,emergency_phone,employment_notes,updated_by)
    values(employee_key,nullif(p_input->>'legalNameTh',''),nullif(p_input->>'englishName',''),nullif(p_input->>'telephone',''),
      nullif(p_input->>'address',''),nullif(p_input->>'emergencyContact',''),nullif(p_input->>'emergencyPhone',''),nullif(p_input->>'employmentNotes',''),actor)
    on conflict(employee_id) do update set
      legal_name_th=case when p_input?'legalNameTh' then excluded.legal_name_th else public.ees_employee_private.legal_name_th end,
      english_name=case when p_input?'englishName' then excluded.english_name else public.ees_employee_private.english_name end,
      telephone=case when p_input?'telephone' then excluded.telephone else public.ees_employee_private.telephone end,
      address=case when p_input?'address' then excluded.address else public.ees_employee_private.address end,
      emergency_contact=case when p_input?'emergencyContact' then excluded.emergency_contact else public.ees_employee_private.emergency_contact end,
      emergency_phone=case when p_input?'emergencyPhone' then excluded.emergency_phone else public.ees_employee_private.emergency_phone end,
      employment_notes=case when p_input?'employmentNotes' then excluded.employment_notes else public.ees_employee_private.employment_notes end,updated_by=actor,updated_at=now();
    if e.id is null or status is distinct from e.employment_status then
      reason:=nullif(btrim(p_input->>'statusReason'),'');
      if reason is null then raise exception 'HR_REASON_REQUIRED'; end if;
      insert into public.ees_employee_employment_history(employee_id,employment_status,effective_on,reason,recorded_by)
        values(employee_key,status,coalesce(ends,starts,today),reason,actor);
    end if;
    if driver_key is not null then
      if status='left' then
        if exists(select 1 from public.ees_driver_vehicle_assignments where driver_id=driver_key
          and assignment_kind='permanent' and effective_to is null and effective_from>ends) then raise exception 'HR_ASSIGNMENT_REVIEW'; end if;
        perform set_config('ees_hr_v7.assignment_driver',driver_key::text,true);
        update public.ees_driver_vehicle_assignments set effective_to=ends,closed_by=actor,closed_at=now()
          where driver_id=driver_key and effective_from<=ends and (effective_to is null or effective_to>ends);
        update public.ees_driver_vehicle_assignments set cancelled_at=now(),cancellation_reason='employment_ended',closed_by=actor
          where driver_id=driver_key and assignment_kind='temporary' and effective_from>ends and cancelled_at is null;
        update public.drivers set assigned_vehicle_id=null,vehicle_reg='',vehicle_type=null,vehicle_model=null,active=false where id=driver_key;
      elsif status in ('active','on_leave') then update public.drivers set active=(status='active') where id=driver_key; end if;
      if display_value is not null then update public.drivers set name=display_value where id=driver_key; end if;
    end if;
    result:=jsonb_build_object('id',employee_key,'employeeId',employee_key,'driverId',driver_key::text);

  elsif p_action='save_compensation' then
    if employee_key is null then raise exception 'HR_PROFILE_REQUIRED'; end if;
    reason:=nullif(btrim(p_input->>'reason'),'');
    if reason is null or nullif(p_input->>'amount','') is null then raise exception 'HR_REASON_REQUIRED'; end if;
    insert into public.ees_employee_compensation(employee_id,effective_from,amount,currency,period,reason,recorded_by)
      values(employee_key,(p_input->>'effectiveFrom')::date,(p_input->>'amount')::numeric,'THB',p_input->>'period',reason,actor)
      returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='save_driver' then
    display_value:=nullif(btrim(p_input->>'name'),'');
    if display_value is null or char_length(display_value)>200 then raise exception 'HR_NAME_REQUIRED'; end if;
    if exists(select 1 from public.drivers where id is distinct from driver_key and active
      and lower(btrim(public.drivers.name))=lower(display_value)) then raise exception 'HR_DUPLICATE_DRIVER'; end if;
    if driver_key is null then
      insert into public.drivers(name,vehicle_reg,active,user_id) values(display_value,'',true,actor) returning id into driver_key;
      if e.id is not null then
        update public.ees_employee_profiles set driver_id=driver_key where id=e.id;
      end if;
    else update public.drivers set name=display_value,active=coalesce((p_input->>'active')::boolean,active) where id=driver_key; end if;
    if e.id is not null then update public.ees_employee_profiles set preferred_name=display_value,updated_by=actor,updated_at=now() where id=e.id; end if;
    if nullif(p_input->>'vehicleId','') is not null then
      perform public.ees_hr_v7_change_driver_vehicle(driver_key,(p_input->>'vehicleId')::uuid,today,'permanent',coalesce(p_input->>'reason','operational'),null,null);
    end if;
    result:=jsonb_build_object('id',driver_key::text,'driverId',driver_key::text);

  elsif p_action='deactivate_driver' then
    update public.drivers set active=false where id=driver_key;
    result:=jsonb_build_object('id',driver_key::text,'retained',true);

  elsif p_action='change_vehicle' then
    result:=public.ees_hr_v7_change_driver_vehicle(driver_key,(p_input->>'vehicleId')::uuid,(p_input->>'date')::date,
      p_input->>'kind',p_input->>'reason',p_input->>'notes',nullif(p_input->>'endDate','')::date);

  elsif p_action='end_cover' then
    select * into strict d from public.drivers where id=driver_key for update;
    if not exists(select 1 from public.ees_driver_vehicle_assignments where id=row_key and driver_id=driver_key
      and assignment_kind='temporary' and effective_from<=coalesce(nullif(p_input->>'date','')::date,today)
      and (effective_to is null or effective_to>=today)) then raise exception 'HR_NOT_FOUND'; end if;
    perform set_config('ees_hr_v7.assignment_driver',driver_key::text,true);
    update public.ees_driver_vehicle_assignments set effective_to=coalesce(nullif(p_input->>'date','')::date,today),
      closed_by=actor,closed_at=now() where id=row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='link_driver' then
    if employee_key is null or e.driver_id is not null then raise exception 'HR_IDENTITY_MISMATCH'; end if;
    driver_key:=(p_input->>'linkDriverId')::bigint;
    if not exists(select 1 from public.drivers where id=driver_key) or exists(select 1 from public.ees_employee_profiles where driver_id=driver_key)
      then raise exception 'HR_IDENTITY_MISMATCH'; end if;
    update public.ees_employee_profiles set driver_id=driver_key,updated_by=actor,updated_at=now() where id=employee_key;
    result:=jsonb_build_object('id',employee_key,'driverId',driver_key::text);

  elsif p_action='record_meeting' then
    insert into public.ees_hr_meetings(employee_id,driver_id,meeting_date,category,subject,attendees,discussion,
      employee_response,agreed_actions,follow_up_date,acknowledgement,created_by)
    values(employee_key,driver_key,(p_input->>'date')::date,p_input->>'category',p_input->>'subject',p_input->>'attendees',p_input->>'discussion',
      nullif(p_input->>'response',''),nullif(p_input->>'actions',''),nullif(p_input->>'followup','')::date,p_input->>'acknowledgement',actor)
      returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='add_meeting_addendum' then
    if nullif(btrim(p_input->>'reason'),'') is null or nullif(btrim(p_input->>'content'),'') is null then raise exception 'HR_REASON_REQUIRED'; end if;
    insert into public.ees_hr_meeting_addenda(meeting_id,kind,reason,content,acknowledgement,created_by)
      values((p_input->>'meetingId')::uuid,p_input->>'kind',p_input->>'reason',p_input->>'content',nullif(p_input->>'acknowledgement',''),actor)
      returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='save_followup' then
    target_user:=nullif(p_input->>'responsibleId','')::uuid;
    if target_user is not null and not exists(select 1 from public.ees_hr_admins h join public.account_access a on a.user_id=h.user_id
      where h.user_id=target_user and h.active and a.status='active' and a.role in ('admin','office_staff')) then raise exception 'HR_RESPONSIBLE_INVALID'; end if;
    if nullif(btrim(p_input->>'requiredAction'),'') is null then raise exception 'HR_ACTION_REQUIRED'; end if;
    if row_key is null then
      insert into public.ees_hr_followups(employee_id,driver_id,meeting_id,due_date,responsible_id,required_action,created_by)
      values(employee_key,driver_key,nullif(p_input->>'meetingId','')::uuid,(p_input->>'dueDate')::date,target_user,p_input->>'requiredAction',actor)
      returning id into row_key;
    else
      update public.ees_hr_followups set due_date=(p_input->>'dueDate')::date,responsible_id=target_user,required_action=p_input->>'requiredAction'
      where id=row_key and completed_at is null;
      if not found then raise exception 'HR_NOT_FOUND'; end if;
    end if;
    insert into public.ees_hr_followup_events(followup_id,action,actor_id) values(row_key,'scheduled',actor);
    result:=jsonb_build_object('id',row_key);

  elsif p_action in ('complete_followup','reopen_followup') then
    reason:=nullif(btrim(p_input->>'outcome'),''); if reason is null then raise exception 'HR_OUTCOME_REQUIRED'; end if;
    select * into f from public.ees_hr_followups where id=row_key for update;
    if not found then raise exception 'HR_NOT_FOUND'; end if;
    if p_action='complete_followup' and f.completed_at is not null then raise exception 'HR_FOLLOWUP_COMPLETED'; end if;
    if p_action='reopen_followup' and f.completed_at is null then raise exception 'HR_FOLLOWUP_OPEN'; end if;
    update public.ees_hr_followups set completed_at=case when p_action='complete_followup' then now() else null end,
      completed_by=case when p_action='complete_followup' then actor else null end,
      outcome_notes=case when p_action='complete_followup' then reason else null end where id=row_key;
    insert into public.ees_hr_followup_events(followup_id,action,outcome_notes,actor_id) values(row_key,p_action,reason,actor);
    result:=jsonb_build_object('id',row_key);

  elsif p_action='save_document_policy' then
    if nullif(btrim(p_input->>'purpose'),'') is null or nullif(btrim(p_input->>'lawfulBasis'),'') is null
      or nullif(btrim(p_input->>'reference'),'') is null or p_input->>'approved'<>'true' then raise exception 'HR_POLICY_REQUIRED'; end if;
    update public.ees_hr_document_policies set active=false where category=p_input->>'category' and active;
    insert into public.ees_hr_document_policies(category,processing_purpose,documented_lawful_basis,retention_days,policy_reference,approved_by)
      values(p_input->>'category',p_input->>'purpose',p_input->>'lawfulBasis',(p_input->>'retentionDays')::integer,p_input->>'reference',actor)
      returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='prepare_document' then
    if employee_key is null then raise exception 'HR_PROFILE_REQUIRED'; end if;
    if not public.ees_hr_v7_storage_ready() then raise exception 'HR_STORAGE_NOT_READY'; end if;
    select * into policy from public.ees_hr_document_policies where id=(p_input->>'policyId')::uuid
      and active and category=p_input->>'category';
    if not found then raise exception 'HR_POLICY_REQUIRED'; end if;
    if p_input->>'mimeType' not in ('image/jpeg','image/png','image/heic','image/heif','application/pdf')
      or (p_input->>'sizeBytes')::bigint not between 1 and 10485760 then raise exception 'HR_INVALID_FILE'; end if;
    group_key:=gen_random_uuid(); version_no:=1;
    if nullif(p_input->>'replacesId','') is not null then
      select * into old_doc from public.ees_employee_documents where id=(p_input->>'replacesId')::uuid for update;
      if not found or old_doc.employee_id<>employee_key or old_doc.category<>policy.category
        or old_doc.state not in ('ready','retired') then raise exception 'HR_IDENTITY_MISMATCH'; end if;
      group_key:=old_doc.version_group;
      perform pg_advisory_xact_lock(hashtextextended(group_key::text,0));
      select coalesce(max(version),0)+1 into version_no from public.ees_employee_documents where version_group=group_key;
    end if;
    text_key:=employee_key::text||'/'||gen_random_uuid()::text||'.'||case p_input->>'mimeType'
      when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'application/pdf' then 'pdf' else 'heic' end;
    insert into public.ees_employee_documents(employee_id,category,description,original_filename,mime_type,size_bytes,
      object_key,version_group,version,replaces_id,issue_date,expiry_date,policy_id,processing_purpose,documented_lawful_basis,retain_until,uploaded_by)
    values(employee_key,policy.category,nullif(p_input->>'description',''),p_input->>'filename',p_input->>'mimeType',(p_input->>'sizeBytes')::bigint,
      text_key,group_key,version_no,old_doc.id,nullif(p_input->>'issueDate','')::date,nullif(p_input->>'expiryDate','')::date,
      policy.id,policy.processing_purpose,policy.documented_lawful_basis,today+policy.retention_days,actor)
      returning id into row_key;
    result:=jsonb_build_object('id',row_key,'objectKey',text_key);

  elsif p_action in ('finish_document','finish_purge') then
    raise exception 'HR_SERVER_FINALIZATION_REQUIRED' using errcode='42501';

  elsif p_action in ('fail_document','retire_document','hold_document','prepare_purge') then
    select * into doc from public.ees_employee_documents where id=row_key for update;
    if not found then raise exception 'HR_NOT_FOUND'; end if;
    if nullif(btrim(p_input->>'reason'),'') is null then raise exception 'HR_REASON_REQUIRED'; end if;
    if p_action='fail_document' then
      if doc.state<>'pending' or doc.uploaded_by<>actor then raise exception 'HR_DOCUMENT_STATE'; end if;
      update public.ees_employee_documents set state='failed' where id=row_key;
    elsif p_action='retire_document' then
      if doc.state<>'ready' then raise exception 'HR_DOCUMENT_STATE'; end if;
      update public.ees_employee_documents set state='retired',retired_at=now(),retirement_reason=p_input->>'reason' where id=row_key;
    elsif p_action='hold_document' then
      update public.ees_employee_documents set legal_hold=coalesce((p_input->>'hold')::boolean,true),legal_hold_reason=p_input->>'reason' where id=row_key;
    else
      if doc.state not in ('retired','purge_pending') or doc.legal_hold or doc.retain_until>today then raise exception 'HR_RETENTION_REQUIRED'; end if;
      update public.ees_employee_documents set state='purge_pending',purge_reason=p_input->>'reason' where id=row_key;
    end if;
    result:=jsonb_build_object('id',row_key,'objectKey',doc.object_key);

  elsif p_action='save_licence' then
    if employee_key is null then raise exception 'HR_PROFILE_REQUIRED'; end if;
    if nullif(btrim(p_input->>'category'),'') is null or nullif(btrim(p_input->>'number'),'') is null then raise exception 'HR_LICENCE_REQUIRED'; end if;
    status:=coalesce(p_input->>'verificationStatus','unverified');
    if status='verified' then
      if not exists(select 1 from public.ees_employee_documents where id=nullif(p_input->>'frontId','')::uuid and employee_id=employee_key and category='driving_licence' and state='ready')
        or not exists(select 1 from public.ees_employee_documents where id=nullif(p_input->>'backId','')::uuid and employee_id=employee_key and category='driving_licence' and state='ready')
        then raise exception 'HR_LICENCE_PROOF_REQUIRED'; end if;
    end if;
    insert into public.ees_employee_licences(employee_id,category,licence_number,issue_date,expiry_date,
      front_document_id,back_document_id,verification_status,verified_by,verified_at,recorded_by)
    values(employee_key,p_input->>'category',p_input->>'number',(p_input->>'issueDate')::date,(p_input->>'expiryDate')::date,
      nullif(p_input->>'frontId','')::uuid,nullif(p_input->>'backId','')::uuid,status,
      case when status='verified' then actor else null end,case when status='verified' then now() else null end,actor)
      returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='save_licence_rule' then
    if nullif(btrim(p_input->>'source'),'') is null or nullif(btrim(p_input->>'category'),'') is null
      or nullif(btrim(p_input->>'vehicleType'),'') is null then raise exception 'HR_RULE_SOURCE_REQUIRED'; end if;
    insert into public.ees_licence_vehicle_rules(category,vehicle_type,compatible,reliable_source,reviewed_by)
      values(p_input->>'category',p_input->>'vehicleType',(p_input->>'compatible')::boolean,p_input->>'source',actor) returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action='save_training' then
    if employee_key is null then raise exception 'HR_PROFILE_REQUIRED'; end if;
    if nullif(btrim(p_input->>'course'),'') is null then raise exception 'HR_ACTION_REQUIRED'; end if;
    if nullif(p_input->>'certificateId','') is not null and not exists(select 1 from public.ees_employee_documents
      where id=(p_input->>'certificateId')::uuid and employee_id=employee_key and state='ready' and category in ('training','safety'))
      then raise exception 'HR_IDENTITY_MISMATCH'; end if;
    insert into public.ees_employee_training(employee_id,course,completed_on,expires_on,certificate_id,notes,recorded_by)
      values(employee_key,p_input->>'course',(p_input->>'completedOn')::date,nullif(p_input->>'expiresOn','')::date,
        nullif(p_input->>'certificateId','')::uuid,nullif(p_input->>'notes',''),actor) returning id into row_key;
    result:=jsonb_build_object('id',row_key);

  elsif p_action in ('identify_test_meeting','archive_test_meeting') then
    if public.current_account_role()<>'admin' then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    select * into m from public.ees_hr_meetings where id=row_key;
    if not found or lower(btrim(m.subject))<>'test' or nullif(btrim(p_input->>'reason'),'') is null then raise exception 'HR_TEST_RECORD_REQUIRED'; end if;
    insert into public.ees_hr_meeting_state(meeting_id,is_test,archived_at,reason,recorded_by)
      values(row_key,true,case when p_action='archive_test_meeting' then now() else null end,p_input->>'reason',actor)
    on conflict(meeting_id) do update set is_test=true,archived_at=excluded.archived_at,reason=excluded.reason,recorded_by=actor,recorded_at=now();
    result:=jsonb_build_object('id',row_key,'retained',true);

  elsif p_action='grant_manager' then
    if public.current_account_role()<>'admin' then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
    target_user:=(p_input->>'userId')::uuid;
    if not exists(select 1 from public.account_access where user_id=target_user and status='active' and role in ('admin','office_staff'))
      or exists(select 1 from public.driver_accounts where auth_user_id=target_user and active) then raise exception 'HR_RESPONSIBLE_INVALID'; end if;
    insert into public.ees_operational_managers(user_id,active,driver_ids,granted_by)
      values(target_user,coalesce((p_input->>'active')::boolean,true),case when p_input->>'allDrivers'='true' then null
        else array(select value::bigint from jsonb_array_elements_text(p_input->'driverIds')) end,actor)
    on conflict(user_id) do update set active=excluded.active,driver_ids=excluded.driver_ids,granted_by=actor,granted_at=now();
    result:=jsonb_build_object('id',target_user);

  else raise exception 'HR_INVALID_ACTION'; end if;
  perform public.ees_hr_v7_audit(p_action,case when employee_key is null then 'driver' else 'employee' end,
    coalesce(employee_key::text,driver_key::text,row_key::text,result->>'id'),array['audited_change']);
  if p_request_id is not null then insert into public.ees_hr_v7_requests(actor_id,request_id,action,input_hash,result)
    values(actor,p_request_id,p_action,md5(p_input::text),result); end if;
  return result;
end $$;

-- Storage finalization is server-only: callers cannot fake a validated upload.
create or replace function public.ees_hr_v7_finalize_document(p_id uuid,p_actor uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.ees_employee_documents%rowtype; begin
  if auth.role()<>'service_role' or not exists(select 1 from public.ees_hr_admins h join public.account_access a on a.user_id=h.user_id
    where h.user_id=p_actor and h.active and a.status='active' and a.role in ('admin','office_staff'))
    or exists(select 1 from public.driver_accounts where auth_user_id=p_actor and active) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  select * into d from public.ees_employee_documents where id=p_id for update;
  if not found then raise exception 'HR_NOT_FOUND'; end if;
  if p_operation='ready' then
    if d.state<>'pending' or d.uploaded_by<>p_actor or not exists(select 1 from storage.objects
      where bucket_id='ees-employee-documents' and name=d.object_key) then raise exception 'HR_DOCUMENT_STATE'; end if;
    update public.ees_employee_documents set state='ready' where id=p_id;
    update public.ees_employee_documents set state='retired',retired_at=now() where id=d.replaces_id and state='ready';
  elsif p_operation='purged' then
    if d.state<>'purge_pending' or d.legal_hold or d.retain_until>(clock_timestamp() at time zone 'Asia/Bangkok')::date
      or exists(select 1 from storage.objects where bucket_id='ees-employee-documents' and name=d.object_key) then raise exception 'HR_RETENTION_REQUIRED'; end if;
    update public.ees_employee_documents set state='purged',purged_at=now(),original_filename='[purged]',description=null where id=p_id;
  else raise exception 'HR_INVALID_ACTION'; end if;
  insert into public.ees_hr_audit(actor_id,action,entity_type,entity_id,changed_fields)
    values(p_actor,'document_'||p_operation,'document',p_id::text,array['state']);
  return jsonb_build_object('id',p_id,'state',p_operation);
end $$;

-- Internal helpers never become unrestricted data API entry points.
revoke all on function public.ees_hr_v7_audit(text,text,text,text[]),public.ees_hr_v7_licence_status(bigint,uuid),
  public.ees_hr_v7_change_driver_vehicle(bigint,uuid,date,text,text,text,date),
  public.ees_hr_v7_finalize_document(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.ees_hr_v7_action(text,jsonb,uuid) from public,anon;
grant execute on function public.ees_hr_v7_action(text,jsonb,uuid) to authenticated;
grant execute on function public.ees_hr_v7_finalize_document(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
