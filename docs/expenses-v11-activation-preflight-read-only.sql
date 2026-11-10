-- READ ONLY. Run in the explicitly approved TEST project's SQL editor after checking its identity.
-- No financial, fleet or authentication row values are returned.
select table_schema,table_name,column_name,data_type
from information_schema.columns
where (table_schema='public' and table_name in ('vehicles','account_access','driver_accounts','expenses_config','expenses_entries','expenses_attachments','expenses_audit','expenses_templates'))
order by table_schema,table_name,ordinal_position;

select to_regprocedure('public.is_office_account()') is not null as office_auth_function,
       to_regprocedure('auth.uid()') is not null as authenticated_identity,
       to_regprocedure('public.expenses_command(text,jsonb)') is not null as expense_command,
       to_regprocedure('public.expenses_finish_upload(uuid,uuid)') is not null as receipt_finalisation;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where (schemaname='public' and tablename like 'expenses_%')
or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;

select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname like 'expenses_%') or (n.nspname='storage' and c.relname='objects');

select grantee,table_schema,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name like 'expenses_%' and grantee in ('anon','authenticated','service_role')
order by table_name,grantee,privilege_type;

select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='expenses-receipts';
