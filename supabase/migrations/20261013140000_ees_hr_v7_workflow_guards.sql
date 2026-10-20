-- FOR REVIEW ONLY. Forward corrections after the three applied V7 migrations.
-- No existing employee records are changed. Guards apply to future writes.
begin;
-- Patch only the approval predicate in the existing action body, preserving any
-- manually corrected personnel expressions. Abort on an unexpected definition.
do $$ declare definition text;
  old_status text:='elsif status in (''active'',''on_leave'') then update public.drivers set active=(status=''active'') where id=driver_key; end if;';
  new_status text:='elsif status in (''active'',''on_leave'') and (e.id is null or status is distinct from e.employment_status) then update public.drivers set active=(status=''active'') where id=driver_key; end if;';
  old_name text:='if display_value is not null then update public.drivers set name=display_value where id=driver_key; end if;';
  new_name text:='if p_input?''preferredName'' and display_value is not null then update public.drivers set name=display_value where id=driver_key; end if;';
begin
  definition:=pg_get_functiondef('public.ees_hr_v7_action(text,jsonb,uuid)'::regprocedure);
  if position('or p_input->>''approved''<>''true''' in definition)>0 then
    definition:=replace(definition,'or p_input->>''approved''<>''true''','or coalesce(p_input->>''approved'',''false'')<>''true''');
  elsif position('or coalesce(p_input->>''approved'',''false'')<>''true''' in definition)=0 then
    raise exception 'HR_V7_REVIEW_POLICY_APPROVAL_DEFINITION';
  end if;
  if position(old_status in definition)>0 then definition:=replace(definition,old_status,new_status);
  elsif position(new_status in definition)=0 then raise exception 'HR_V7_REVIEW_EMPLOYMENT_SYNC_DEFINITION'; end if;
  if position(old_name in definition)>0 then definition:=replace(definition,old_name,new_name);
  elsif position(new_name in definition)=0 then raise exception 'HR_V7_REVIEW_NAME_SYNC_DEFINITION'; end if;
  execute definition;
end $$;
create or replace function public.ees_hr_v7_future_write_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='drivers' then
    if tg_op='UPDATE' and new.active and not old.active and exists(
      select 1 from public.ees_employee_profiles e where e.driver_id=new.id and e.employment_status='left')
      then raise exception 'HR_INVALID_EMPLOYMENT'; end if;
  elsif tg_table_name='ees_licence_vehicle_rules' then
    if new.reliable_source !~* '^https://([a-z0-9-]+\.)*dlt\.go\.th(/|$)'
      then raise exception 'HR_RULE_SOURCE_REQUIRED'; end if;
  elsif tg_table_name='ees_employee_documents' then
    -- A purge already in progress cannot accept a new hold while its bytes are
    -- being removed outside PostgreSQL. A hold must be applied before purging.
    if tg_op='UPDATE' and old.state='purge_pending' and new.legal_hold is distinct from old.legal_hold
      then raise exception 'HR_DOCUMENT_STATE'; end if;
  elsif tg_table_name='ees_employee_profiles' then
    if new.driver_id is not null and (tg_op='INSERT' or new.driver_id is distinct from old.driver_id)
      and not public.ees_is_hr_admin() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  end if;
  return new;
end $$;
drop trigger if exists ees_hr_v7_departure_guard on public.drivers;
create trigger ees_hr_v7_departure_guard before update on public.drivers
for each row execute function public.ees_hr_v7_future_write_guard();
drop trigger if exists ees_hr_v7_rule_source_guard on public.ees_licence_vehicle_rules;
create trigger ees_hr_v7_rule_source_guard before insert or update on public.ees_licence_vehicle_rules
for each row execute function public.ees_hr_v7_future_write_guard();
drop trigger if exists ees_hr_v7_purge_hold_guard on public.ees_employee_documents;
create trigger ees_hr_v7_purge_hold_guard before update on public.ees_employee_documents
for each row execute function public.ees_hr_v7_future_write_guard();
drop trigger if exists ees_hr_v7_employee_link_guard on public.ees_employee_profiles;
create trigger ees_hr_v7_employee_link_guard before insert or update on public.ees_employee_profiles
for each row execute function public.ees_hr_v7_future_write_guard();
revoke all on function public.ees_hr_v7_future_write_guard() from public,anon,authenticated;
-- The application may read existing records, but must not write using an
-- older action definition or an incomplete release. No personnel data is read.
create or replace function public.ees_hr_v7_release_ready()
returns boolean language plpgsql stable security definer set search_path='' as $$ begin
  if not public.ees_hr_v7_office_read() then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;
  return (select count(*)=5 from pg_catalog.pg_trigger where not tgisinternal and tgenabled<>'D'
    and tgname in ('ees_hr_v7_departure_guard','ees_hr_v7_rule_source_guard','ees_hr_v7_purge_hold_guard','ees_hr_v7_employee_link_guard','ees_hr_v7_driver_guard'))
    and position('profileCompleteness' in pg_get_functiondef('public.ees_hr_v7_public_employee(bigint,uuid)'::regprocedure))>0
    and position('''certificates''' in pg_get_functiondef('public.ees_hr_v7_profile(text,text,text)'::regprocedure))>0
    and position('status is distinct from e.employment_status' in pg_get_functiondef('public.ees_hr_v7_action(text,jsonb,uuid)'::regprocedure))>0;
end $$;
revoke all on function public.ees_hr_v7_release_ready() from public,anon;
grant execute on function public.ees_hr_v7_release_ready() to authenticated;
notify pgrst,'reload schema';
commit;
