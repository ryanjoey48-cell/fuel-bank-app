// Disposable PostgreSQL verification. Install @electric-sql/pglite in tmp/grease-qa first.
const { PGlite } = require('../tmp/grease-qa/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite();
  try {
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
    await db.exec(fs.readFileSync('supabase/migrations/20260914090000_add_grease_maintenance.sql', 'utf8'));
    const user = async id => db.exec(`reset role; set test.uid = '00000000-0000-0000-0000-00000000000${id}'; set role authenticated;`);
    await user(1);
    const input = `insert into grease_maintenance_records(vehicle_id,service_date,items,total_cost,created_by) values ('10000000-0000-0000-0000-000000000001','2024-02-29','[{"description":"Grease","quantity":1.01,"unit_cost":0.5},{"description":"Labour","quantity":null,"unit_cost":100}]',999,'00000000-0000-0000-0000-000000000002') returning *`;
    const record = (await db.query(input)).rows[0];
    assert.equal(record.next_due_date.toISOString().slice(0,10), '2025-02-28');
    assert.equal(Number(record.total_cost), 100.51);
    assert.equal(record.created_by, '00000000-0000-0000-0000-000000000001');
    await assert.rejects(db.exec(`insert into grease_maintenance_records(vehicle_id,service_date) values ('10000000-0000-0000-0000-000000000001',current_date + 2)`));
    await assert.rejects(db.exec(`update grease_maintenance_records set items='[{"description":"Bad","quantity":-1}]'`));
    await assert.rejects(db.exec(`update grease_maintenance_records set items='[{"description":"Bad","unit_cost":"NaN"}]'`));
    await assert.rejects(db.exec(`update grease_maintenance_records set items='[{"description":"Bad","quantity":0.001}]'`));
    await assert.rejects(db.exec(`update grease_maintenance_records set vehicle_id='10000000-0000-0000-0000-000000000099'`));
    await user(2);
    assert.equal((await db.query('select * from grease_maintenance_records')).rows.length, 1);
    await assert.rejects(db.exec(input));
    assert.equal((await db.query('update grease_maintenance_records set is_void=true returning id')).rows.length, 0);
    await user(3);
    assert.equal((await db.query('select * from grease_maintenance_records')).rows.length, 0);
    await assert.rejects(db.exec(input));
    await user(1);
    await assert.rejects(db.exec('delete from grease_maintenance_records'));
    const edited = (await db.query(`update grease_maintenance_records set is_void=true, created_at='2000-01-01', created_by='00000000-0000-0000-0000-000000000002', updated_by='00000000-0000-0000-0000-000000000002' returning *`)).rows[0];
    assert.equal(edited.created_at.toISOString(), record.created_at.toISOString());
    assert.equal(edited.created_by, record.created_by); assert.equal(edited.updated_by, record.created_by);
    assert.equal(edited.is_void, true);
    await db.exec('update grease_maintenance_records set is_void=false');
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.exec('select * from grease_maintenance_records'));
    await db.exec('reset role;');
    assert.equal((await db.query('select * from vehicles')).rows.length, 1);
    console.log('PASS: additive migration, leap date, totals, validation, audit protection, staff/read-only/suspended/anonymous RLS, void/restore, and delete protection. No live database used.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
