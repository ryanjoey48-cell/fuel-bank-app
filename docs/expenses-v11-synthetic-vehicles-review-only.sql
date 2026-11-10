-- NOT APPLIED. Only after explicit owner approval, prerequisite installation and creation of
-- dedicated synthetic office submitter/reviewer accounts through the existing account system.
-- Set ees.expenses.test_submitter_id and ees.expenses.test_reviewer_id to those synthetic account UUIDs.
begin;
do $$ declare submitter uuid; reviewer uuid; begin
 if current_setting('ees.expenses.approved_test_project_ref',true) is distinct from 'wpmnjfncaoogssgpqxek' then raise exception 'Approved Expenses TEST target required'; end if;
 submitter:=nullif(current_setting('ees.expenses.test_submitter_id',true),'')::uuid;
 reviewer:=nullif(current_setting('ees.expenses.test_reviewer_id',true),'')::uuid;
 if submitter is null or reviewer is null or submitter=reviewer then raise exception 'Two distinct synthetic accounts are required'; end if;
 if not exists(select 1 from public.account_access where user_id=submitter and status='active' and role='office_staff' and display_name like 'Expenses V11 fixture%') then raise exception 'A dedicated synthetic office submitter is required'; end if;
 if not exists(select 1 from public.account_access where user_id=reviewer and status='active' and role in ('admin','super_admin') and display_name like 'Expenses V11 fixture%') then raise exception 'A dedicated synthetic manager is required'; end if;
 if exists(select 1 from public.vehicles) then raise exception 'This seed is only for an empty, isolated test Vehicles table; no existing fleet will be changed'; end if;
end $$;
insert into public.vehicles(id,user_id,vehicle_reg,vehicle_name,vehicle_category,vehicle_type,active) values
 ('22000000-0000-4000-8000-000000000001',current_setting('ees.expenses.test_submitter_id')::uuid,'EES-TEST-001','Expenses V11 fixture commercial vehicle','commercial','commercial',true),
 ('22000000-0000-4000-8000-000000000002',current_setting('ees.expenses.test_submitter_id')::uuid,'ทดสอบ-ส่วนตัว','Expenses V11 fixture personal car','personal','personal',true);
commit;
-- This creates no expense, payment, invoice, fuel, maintenance or performance record.
