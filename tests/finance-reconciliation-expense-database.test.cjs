const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");

test("explicit office expense grant records pre-verification costs without approval or pricing rights", async () => {
  const db = new PGlite();
  const office = randomUUID(), anotherOffice = randomUUID(), finance = randomUUID(), manager = randomUUID();
  const booking = randomUUID(), client = randomUUID();
  const as = (id) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
  const root = () => db.exec("reset role; reset request.jwt.claim.sub");
  try {
    await db.exec(`
      create schema auth; create schema storage; create role authenticated; create role anon;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table account_access(user_id uuid primary key,role text,status text,display_name text);
      create table driver_accounts(auth_user_id uuid,active boolean);
      create function is_office_account() returns boolean language sql stable security definer as $$select exists(select 1 from public.account_access where user_id=auth.uid() and status='active') and not exists(select 1 from public.driver_accounts where auth_user_id=auth.uid() and active)$$;
      create function current_account_role() returns text language sql stable security definer as $$select role from public.account_access where user_id=auth.uid() and status='active'$$;
      create table clients(id uuid primary key,name text);
      create table booking_diary(id uuid primary key,booking_id text,booking_date date,client_id uuid,pickup text,dropoff text,pickup_location_id uuid,dropoff_location_id uuid,driver text,driver_id bigint,vehicle text,vehicle_id uuid,vehicle_registration text,trailer_registration text,job_order_number text,status text);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated;
      grant execute on function auth.uid(),is_office_account(),current_account_role() to authenticated;
      grant select on booking_diary,clients to authenticated;
    `);
    for (const [id,role] of [[office,"office_staff"],[anotherOffice,"office_staff"],[finance,"office_staff"],[manager,"admin"]]) {
      await db.query("insert into auth.users(id) values($1)",[id]);
      await db.query("insert into account_access values($1,$2,'active',$3)",[id,role,role]);
    }
    await db.query("insert into clients values($1,'Demo customer')",[client]);
    await db.query("insert into booking_diary(id,booking_id,booking_date,client_id,pickup,dropoff,driver,vehicle_registration,job_order_number,status) values($1,'DEMO-1','2026-11-02',$2,'Depot','Port','Demo driver','DEMO-1','DEMO-WO-1','completed')",[booking,client]);
    for (const file of ["20261030100000_finance_verification_foundation.sql","20261031100000_finance_paperwork_intake.sql","20261102100000_finance_expenses_pricing.sql","20261103100000_finance_weekly_billing_drafts.sql","20261105100000_finance_reconciliation_expense_recorder.sql"])
      await db.exec(fs.readFileSync(`supabase/migrations/${file}`,"utf8"));
    await as(office);
    await assert.rejects(db.query("select id from finance_record_reconciliation_expense($1,'parking',85.5,'2026-11-02',null,'DEMO-R-1',null,'')",[booking]),/EXPENSE_RECORDER_REQUIRED/);
    await root(); await db.query("insert into finance_role_grants(user_id,capability) values($1,'expense_recorder')",[office]);
    await as(office);
    const event = (await db.query("select id from finance_record_reconciliation_expense($1,'parking',85.5,'2026-11-02',null,'DEMO-R-1',null,'')",[booking])).rows[0].id;
    assert.equal((await db.query("select amount_delta from finance_expense_events where id=$1",[event])).rows[0].amount_delta,"85.50");
    await assert.rejects(db.query("select id from finance_record_reconciliation_expense($1,'toll',1.001,'2026-11-02',null,'DEMO-R-2',null,'')",[booking]),/INVALID_EXPENSE/);
    await assert.rejects(db.query("select id from finance_record_reconciliation_expense($1,'toll',20,'2026-11-02',null,null,null,'')",[booking]),/MISSING_RECEIPT_REASON_REQUIRED/);
    await assert.rejects(db.query("select id from finance_propose_job_price($1,null,1000,'Demo manual price')",[booking]),/FINANCE_REVIEWER_REQUIRED/);
    await assert.rejects(db.query("select event_id from finance_decide_expense($1,true,'Demo expense approved')",[event]),/EXPENSE_APPROVER_REQUIRED/);
    await assert.rejects(db.query("update finance_expense_events set amount_delta=999 where id=$1",[event]),/permission denied/);
    await as(anotherOffice);
    assert.equal((await db.query("select id from finance_expense_events where id=$1",[event])).rows.length,0);
    await as(finance);
    await assert.rejects(db.query("select id from finance_record_reconciliation_expense($1,'parking',20,'2026-11-02',null,'DEMO-R-3',null,'')",[booking]),/EXPENSE_RECORDER_REQUIRED/);
    await root();
    assert.equal((await db.query("select count(*)::int n from finance_cost_price_audit where booking_id=$1",[booking])).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from finance_job_verifications where booking_id=$1",[booking])).rows[0].n,0);
  } finally { await db.close(); }
});
