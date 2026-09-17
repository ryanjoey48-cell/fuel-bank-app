// Runs only against disposable in-memory PostgreSQL; never connects to Supabase.
const { PGlite } = require('../tmp/grease-qa/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => { const db = new PGlite(); try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select current_setting('test.uid', true)::uuid $$;
      create table public.account_access (user_id uuid, role text, status text);
      create function public.is_account_active() returns boolean language sql stable security definer as $$ select coalesce((select status = 'active' from account_access where user_id = auth.uid()), false) $$;
      create function public.current_account_role() returns text language sql stable security definer as $$ select role from account_access where user_id = auth.uid() and status = 'active' $$;
      create table public.vehicles (id uuid primary key, vehicle_reg text);
      alter table public.vehicles enable row level security;
      create policy fleet_read on public.vehicles for select to authenticated using (true);
      grant usage on schema public, auth to authenticated;
      grant select on public.vehicles to authenticated;
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
      insert into account_access values ('00000000-0000-0000-0000-000000000001','office_staff','active'), ('00000000-0000-0000-0000-000000000002','read_only','active'), ('00000000-0000-0000-0000-000000000003','admin','suspended');
      insert into vehicles values ('10000000-0000-0000-0000-000000000001','TEST');
    `);

    await db.exec(`
      alter table public.vehicles add column vehicle_type text;
      create function public.is_account_admin() returns boolean language sql stable security definer as $$ select public.is_account_active() and public.current_account_role()='admin' $$;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert,delete on storage.objects to authenticated;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20260914090000_add_maintenance.sql','utf8'));
    const tables = (await db.query("select tablename from pg_tables where schemaname='public' and tablename like 'maintenance_%'")).rows;
    assert.equal(tables.length,6);
    assert.equal((await db.query("select public from storage.buckets where id='maintenance-receipts'")).rows[0].public,false);
    await db.exec("set test.uid='00000000-0000-0000-0000-000000000001'; set role authenticated;");
    assert.equal((await db.query('select * from maintenance_records')).rows.length,0);
    const payload = {id:'20000000-0000-0000-0000-000000000001',vehicle_id:'10000000-0000-0000-0000-000000000001',service_date:'2026-01-01',odometer:1000,receipt_total:25};
    const items = [{id:'30000000-0000-0000-0000-000000000001',description:'Grease',category:'grease',quantity:2.5,unit_price:10,reminder_months:12}];
    await db.query('select save_maintenance_record($1::jsonb,$2::jsonb,null)',[JSON.stringify(payload),JSON.stringify(items)]);
    let record=(await db.query('select * from maintenance_records')).rows[0];
    assert.equal(Number(record.calculated_total),25);
    await assert.rejects(db.query('select save_maintenance_record($1::jsonb,$2::jsonb,null)',[JSON.stringify(payload),JSON.stringify(items)]),/MAINTENANCE_CONFLICT/);
    await db.query('select save_maintenance_record($1::jsonb,$2::jsonb,$3)',[JSON.stringify(payload),JSON.stringify(items),record.updated_at]);
    record=(await db.query('select * from maintenance_records')).rows[0];
    assert.equal((await db.query('select * from maintenance_audit')).rows.length,1);
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)',['maintenance-receipts',payload.id+'/receipt.pdf']);
    await db.query('insert into maintenance_attachments(record_id,file_path,original_filename,mime_type,size_bytes) values ($1,$2,$3,$4,8)',[payload.id,payload.id+'/receipt.pdf','receipt.pdf','application/pdf']);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)',['other-bucket',payload.id+'/receipt.pdf']));
    await db.exec("reset role; set test.uid='00000000-0000-0000-0000-000000000002'; set role authenticated;");
    assert.equal((await db.query('select * from maintenance_records')).rows.length,1);
    await assert.rejects(db.query('select delete_maintenance_record($1,$2)',[payload.id,record.updated_at]),/MAINTENANCE_FORBIDDEN/);
    await db.exec("reset role; update account_access set role='admin' where user_id='00000000-0000-0000-0000-000000000001'; set test.uid='00000000-0000-0000-0000-000000000001'; set role authenticated;");
    const req={id:'40000000-0000-0000-0000-000000000001',name:'Annual grease',category:'grease',frequency_months:12,warning_days:30,warning_km:1000,active:true};
    await db.query('select save_maintenance_requirement($1::jsonb,$2::uuid[],null)',[JSON.stringify(req),[payload.vehicle_id]]);
    assert.equal((await db.query('select * from maintenance_requirement_vehicles')).rows.length,1);
    await db.query('select delete_maintenance_record($1,$2)',[payload.id,record.updated_at]);
    assert.equal((await db.query('select is_deleted from maintenance_records')).rows[0].is_deleted,true);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from maintenance_records'));
    console.log('PASS: all 6 tables, RPC create/edit/conflict/delete/requirement, totals, audit, empty reads, RLS, private bucket and attachment policies. No live database used.');
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
