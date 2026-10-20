from pathlib import Path
root=Path('supabase/migrations')
source=(root/'20261013120000_ees_hr_v7_reads.sql').read_text(encoding='utf-8')
def function(name):
    start=source.index('create or replace function public.'+name+'(')
    return source[start:source.index('end $$;',start)+len('end $$;')]
follow=function('ees_hr_v7_followups')
profile=function('ees_hr_v7_profile')
profile=profile.replace("elsif p_section<>'overview' then raise exception 'HR_INVALID_SECTION'; end if;", """elsif p_section='overview' and public.ees_is_hr_admin() then
    data:=jsonb_build_object('profile',(select to_jsonb(e)||jsonb_build_object('driver_id',e.driver_id::text) from public.ees_employee_profiles e where id=employee_key),
      'private',(select jsonb_build_object('legal_name_th',e.legal_name_th,'english_name',e.english_name) from public.ees_employee_private e where employee_id=employee_key));
  elsif p_section<>'overview' then raise exception 'HR_INVALID_SECTION'; end if;""")
profile=profile.replace("if not public.ees_hr_v7_operate(driver_key) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;\n    data:=jsonb_build_object('training'", "if not public.ees_is_hr_admin() and (driver_key is null or not public.ees_hr_v7_operate(driver_key)) then raise exception 'HR_FORBIDDEN' using errcode='42501'; end if;\n    data:=jsonb_build_object('training'")
profile=profile.replace("if to_regclass('public.vehicle_safety_inspections') is not null then", """if public.ees_is_hr_admin() then
      data:=data||jsonb_build_object('certificates',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'description',d.description,'version',d.version,'category',d.category) order by uploaded_at desc),'[]')
        from public.ees_employee_documents d where d.employee_id=employee_key and d.state='ready' and d.category in ('training','safety')));
    end if;
    if to_regclass('public.vehicle_safety_inspections') is not null then""")
directory=function('ees_hr_v7_directory')
directory=directory.replace("and (coalesce(p_query->>'status','all')", "and (coalesce(p_query->>'kind','all')='all' or r->>'kind'=p_query->>'kind')\n      and (coalesce(p_query->>'status','all')")
directory=directory.replace("'summary',summary)","'summary',summary,'vehicleTypes',(select coalesce(jsonb_agg(distinct vehicle_type),'[]') from public.vehicles where vehicle_type is not null))")
public=function('ees_hr_v7_public_employee')
public=public.replace("'nextFollowup',follow", """'personnelRecorded',e.id is not null,
    'profileCompleteness',case when public.ees_is_hr_admin() then (
      select jsonb_build_object('recorded',count(*) filter(where value),'total',8) from (values
        (nullif(btrim(e.preferred_name),'') is not null),(nullif(btrim(e.employee_number),'') is not null),
        (e.employment_status<>'not_recorded'),(e.start_date is not null),
        (exists(select 1 from public.ees_employee_private p where employee_id=e.id and nullif(btrim(p.legal_name_th),'') is not null)),
        (exists(select 1 from public.ees_employee_private p where employee_id=e.id and nullif(btrim(p.telephone),'') is not null)),
        (exists(select 1 from public.ees_employee_private p where employee_id=e.id and nullif(btrim(p.emergency_contact),'') is not null)),
        (exists(select 1 from public.ees_employee_private p where employee_id=e.id and nullif(btrim(p.emergency_phone),'') is not null))
      ) fields(value)) else null end,'nextFollowup',follow""")
sql="""-- FOR REVIEW: run only this forward correction after the three applied V7 migrations.
-- No employee rows are updated/deleted. Replaces affected read functions only.
-- Fixes qualified follow-up ordering, HR overview, office training, and directory filters.
begin;
"""+'\n\n'.join([public,directory,follow,profile])+"""
notify pgrst,'reload schema';
commit;
"""
(root/'20261013130000_ees_hr_v7_read_corrections.sql').write_text(sql,encoding='utf-8')
