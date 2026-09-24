-- PRE-STAGE-2 read-only metadata capture.
-- Run each statement in the Supabase SQL Editor and export every result grid.

select
  now() as captured_at,
  current_database() as database_name,
  current_user as executing_role,
  version() as postgres_version;

select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_schema,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.is_identity,
  c.identity_generation,
  c.is_generated,
  c.generation_expression
from information_schema.columns c
where (c.table_schema = 'public' and c.table_name in (
  'vehicle_insurance_compliance',
  'vehicle_insurance_documents',
  'vehicle_insurance_compliance_view'
)) or (c.table_schema = 'storage' and c.table_name in ('buckets', 'objects'))
order by c.table_schema, c.table_name, c.ordinal_position;

select
  n.nspname as table_schema,
  cls.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  con.condeferrable,
  con.condeferred,
  con.convalidated,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_namespace n on n.oid = cls.relnamespace
where (n.nspname = 'public' and cls.relname in (
  'vehicle_insurance_compliance',
  'vehicle_insurance_documents',
  'vehicle_insurance_compliance_view'
)) or (n.nspname = 'storage' and cls.relname in ('buckets', 'objects'))
order by n.nspname, cls.relname, con.conname;

select
  schemaname,
  tablename,
  indexname,
  tablespace,
  indexdef
from pg_indexes
where (schemaname = 'public' and tablename in (
  'vehicle_insurance_compliance',
  'vehicle_insurance_documents'
)) or (schemaname = 'storage' and tablename in ('buckets', 'objects'))
order by schemaname, tablename, indexname;

select
  n.nspname as view_schema,
  cls.relname as view_name,
  pg_get_viewdef(cls.oid, true) as view_definition,
  cls.reloptions as view_options
from pg_class cls
join pg_namespace n on n.oid = cls.relnamespace
where n.nspname = 'public'
  and cls.relname = 'vehicle_insurance_compliance_view'
  and cls.relkind in ('v', 'm');

select
  event_object_schema,
  event_object_table,
  trigger_name,
  event_manipulation,
  action_timing,
  action_orientation,
  action_condition,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in (
    'vehicle_insurance_compliance',
    'vehicle_insurance_documents'
  )
order by event_object_table, trigger_name, event_manipulation;

select
  n.nspname as table_schema,
  cls.relname as table_name,
  trg.tgname as trigger_name,
  pg_get_triggerdef(trg.oid, true) as trigger_definition,
  pn.nspname as function_schema,
  proc.proname as function_name,
  pg_get_function_identity_arguments(proc.oid) as function_arguments,
  pg_get_functiondef(proc.oid) as function_definition
from pg_trigger trg
join pg_class cls on cls.oid = trg.tgrelid
join pg_namespace n on n.oid = cls.relnamespace
join pg_proc proc on proc.oid = trg.tgfoid
join pg_namespace pn on pn.oid = proc.pronamespace
where not trg.tgisinternal
  and ((n.nspname = 'public' and cls.relname in (
    'vehicle_insurance_compliance',
    'vehicle_insurance_documents'
  )) or (n.nspname = 'storage' and cls.relname in ('buckets', 'objects')))
order by n.nspname, cls.relname, trg.tgname;

select
  n.nspname as function_schema,
  proc.proname as function_name,
  pg_get_function_identity_arguments(proc.oid) as function_arguments,
  pg_get_function_result(proc.oid) as result_type,
  proc.prosecdef as security_definer,
  proc.provolatile as volatility,
  pg_get_userbyid(proc.proowner) as function_owner,
  pg_get_functiondef(proc.oid) as function_definition
from pg_proc proc
join pg_namespace n on n.oid = proc.pronamespace
where n.nspname = 'public'
order by proc.proname, pg_get_function_identity_arguments(proc.oid);

select
  grantor,
  grantee,
  specific_schema,
  routine_name,
  privilege_type,
  is_grantable
from information_schema.routine_privileges
where specific_schema = 'public'
order by routine_name, grantee, privilege_type;

select
  grantor,
  grantee,
  table_schema,
  table_name,
  privilege_type,
  is_grantable,
  with_hierarchy
from information_schema.role_table_grants
where (table_schema = 'public' and table_name in (
  'vehicle_insurance_compliance',
  'vehicle_insurance_documents',
  'vehicle_insurance_compliance_view'
)) or (table_schema = 'storage' and table_name in ('buckets', 'objects'))
order by table_schema, table_name, grantee, privilege_type;

select
  n.nspname as table_schema,
  cls.relname as table_name,
  cls.relrowsecurity as rls_enabled,
  cls.relforcerowsecurity as rls_forced
from pg_class cls
join pg_namespace n on n.oid = cls.relnamespace
where cls.relkind in ('r', 'p')
  and ((n.nspname = 'public' and cls.relname in (
    'vehicle_insurance_compliance',
    'vehicle_insurance_documents'
  )) or (n.nspname = 'storage' and cls.relname in ('buckets', 'objects')))
order by n.nspname, cls.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where (schemaname = 'public' and tablename in (
  'vehicle_insurance_compliance',
  'vehicle_insurance_documents'
)) or (schemaname = 'storage' and tablename in ('buckets', 'objects'))
order by schemaname, tablename, policyname;

select *
from storage.buckets
where id = 'insurance-documents' or name = 'insurance-documents';

select *
from storage.objects
where bucket_id = 'insurance-documents'
order by name;
