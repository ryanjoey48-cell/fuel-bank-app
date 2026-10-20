-- Read-only preflight. Run in the intended staging/production SQL editor before applying migration.
select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('maintenance_records','maintenance_items','maintenance_requirements','maintenance_requirement_vehicles','maintenance_attachments','maintenance_audit','vehicles','weekly_mileage','vehicle_service_logs','oil_change_baselines') order by table_name,ordinal_position;
select tablename,policyname,roles,permissive,cmd,qual,with_check from pg_policies where schemaname='public' and tablename like 'maintenance_%' or schemaname='storage' and tablename='objects' order by schemaname,tablename,policyname;
select proname,pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace and proname in ('save_maintenance_record','save_maintenance_requirement','delete_maintenance_record','is_account_active','is_office_account','current_account_role');
select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id='maintenance-receipts';
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.maintenance_records'::regclass,'public.maintenance_items'::regclass,'public.maintenance_requirements'::regclass);
select count(*) as records, count(*) filter(where is_deleted) as voided from public.maintenance_records;
select count(*) as items from public.maintenance_items;
select count(*) as receipt_attachments from public.maintenance_attachments;
select count(*) as corrected_baselines from public.oil_change_baselines;
-- Verify definitions match prerequisites. Do not replay the original standalone creation migration on production.
