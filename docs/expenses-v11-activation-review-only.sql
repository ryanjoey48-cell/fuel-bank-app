-- NOT APPLIED. Final activation only after owner-approved TEST installation and acceptance review.
-- Setting this marker is an operator acknowledgement, not a substitute for checking the SQL editor project.
-- The approved test project is EES Development, never the main/production project.
begin;
do $$ begin
 if current_setting('ees.expenses.approved_test_project_ref',true) is distinct from 'wpmnjfncaoogssgpqxek' then
  raise exception 'Verify the approved test project and set ees.expenses.approved_test_project_ref in this SQL session first.';
 end if;
 if not exists(select 1 from public.expenses_config where schema_version=2) then raise exception 'V1.1 migration is required'; end if;
 if not exists(select 1 from storage.buckets where id='expenses-receipts' and public=false) then raise exception 'Private receipt bucket is required'; end if;
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity) then raise exception 'Storage RLS must already be enabled'; end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='expenses_receipts_server_only' and permissive='RESTRICTIVE') then raise exception 'Private receipt restriction is required'; end if;
end $$;
update public.expenses_config set enabled=true where id=true and schema_version=2;
commit;
-- To pause future writes after a separately authorised operator decision:
-- update public.expenses_config set enabled=false where id=true;
-- This retains every expense, original and audit record. It does not erase test history.
