const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");

test("weekly drafts use approved job prices, ordered immutable revisions, unique allocations and finance roles", async () => {
  const db = new PGlite();
  const office = randomUUID(), financeA = randomUUID(), financeB = randomUUID(), approver = randomUUID(), client = randomUUID();
  const jobs = [randomUUID(), randomUUID(), randomUUID()];
  const as = (id) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
  const root = () => db.exec("reset role; reset request.jwt.claim.sub");
  try {
    await db.exec(`
      create schema auth; create schema storage; create role authenticated; create role anon;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.account_access(user_id uuid primary key,role text,status text,display_name text);
      create table public.driver_accounts(auth_user_id uuid,active boolean);
      create function public.is_office_account() returns boolean language sql stable security definer as $$select exists(select 1 from public.account_access where user_id=auth.uid() and status='active') and not exists(select 1 from public.driver_accounts where auth_user_id=auth.uid() and active)$$;
      create function public.current_account_role() returns text language sql stable security definer as $$select role from public.account_access where user_id=auth.uid() and status='active'$$;
      create table public.clients(id uuid primary key,name text);
      create table public.booking_diary(id uuid primary key,booking_id text,booking_date date,client_id uuid,pickup text,dropoff text,
        pickup_location_id uuid,dropoff_location_id uuid,driver text,driver_id bigint,vehicle text,vehicle_id uuid,vehicle_registration text,
        trailer_registration text,job_order_number text,status text);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated;
      grant execute on function auth.uid(),public.is_office_account(),public.current_account_role() to authenticated;
      grant select on public.booking_diary,public.clients to authenticated;
    `);
    for (const [id,role] of [[office,"office_staff"],[financeA,"office_staff"],[financeB,"office_staff"],[approver,"admin"]]) {
      await db.query("insert into auth.users(id) values($1)",[id]);
      await db.query("insert into account_access values($1,$2,'active',$3)",[id,role,role]);
    }
    await db.query("insert into clients values($1,'Demo Client')",[client]);
    for (let i=0;i<jobs.length;i++) await db.query("insert into booking_diary(id,booking_id,booking_date,client_id,pickup,dropoff,driver,vehicle,vehicle_registration,job_order_number,status) values($1,$2,'2026-11-02',$3,'Depot','Port','Demo Driver','Truck','DEMO-1',$4,'completed')",[jobs[i],`B-${i+1}`,client,`WO-${i+1}`]);
    for (const file of ["20261030100000_finance_verification_foundation.sql","20261031100000_finance_paperwork_intake.sql","20261102100000_finance_expenses_pricing.sql","20261103100000_finance_weekly_billing_drafts.sql"])
      await db.exec(fs.readFileSync(`supabase/migrations/${file}`,"utf8"));
    await db.query("insert into finance_role_grants(user_id,capability) values($1,'finance_reviewer'),($2,'finance_reviewer'),($3,'pricing_approver')",[financeA,financeB,approver]);
    for (let i=0;i<jobs.length;i++) {
      const snapshot = {booking_date:"2026-11-02",client_id:client,pickup:"Depot",dropoff:"Port",job_order_number:`WO-${i+1}`};
      await db.query("insert into finance_job_verifications(booking_id,status,handover_status,booking_snapshot,observed_details,document_checklist,checked_fields,checked_by) values($1,'verified','ready','{}','{}','{}','{}',$2)",[jobs[i],office]);
      const price=(await db.query("insert into finance_job_price_revisions(booking_id,client_id,source,original_price_thb,selling_price_thb,override_reason,booking_snapshot,created_by) values($1,$2,'manual',null,$3,'Agreed demo price',$4,$5) returning id",[jobs[i],client,(i+1)*1000,JSON.stringify(snapshot),financeA])).rows[0].id;
      await db.query("insert into finance_pricing_decisions(revision_id,decision,reason,decided_by) values($1,'approved','Reviewed demo price',$2)",[price,approver]);
    }
    await as(office);
    await assert.rejects(db.query("select id from finance_create_weekly_draft($1,'2026-11-02',$2::uuid[])",[client,[jobs[0]]]),/FINANCE_REVIEWER_REQUIRED/);
    assert.equal((await db.query("select id from finance_billing_batches")).rows.length,0);
    await as(financeA);
    assert.equal((await db.query("select finance_billing_candidate($1)->>'ready' ready",[jobs[2]])).rows[0].ready,"true");
    const pendingPrice=(await db.query("select id from finance_propose_job_price($1,null,3500,'Revised customer price for demo')",[jobs[2]])).rows[0].id;
    assert.equal((await db.query("select finance_billing_candidate($1)->>'hold' hold",[jobs[2]])).rows[0].hold,"price_approval");
    await as(approver);await db.query("select revision_id from finance_decide_job_price($1,true,'Revised price approved')",[pendingPrice]);
    await as(financeA);
    const pendingExpense=(await db.query("select id from finance_record_expense($1,'driver_trip',100,'2026-11-02',null,null,'Paper receipt pending','Demo trip payment')",[jobs[2]])).rows[0].id;
    assert.equal((await db.query("select finance_billing_candidate($1)->>'hold' hold",[jobs[2]])).rows[0].hold,"expense_approval");
    await root();await db.query("insert into finance_role_grants(user_id,capability) values($1,'expense_approver')",[approver]);
    await as(approver);await db.query("select event_id from finance_decide_expense($1,true,'Receipt exception reviewed')",[pendingExpense]);
    await as(financeA);
    assert.equal((await db.query("select finance_billing_candidate($1)->>'ready' ready",[jobs[2]])).rows[0].ready,"true");
    await assert.rejects(db.query("select id from finance_create_weekly_draft($1,'2026-11-03',$2::uuid[])",[client,[jobs[0]]]),/INVALID_CUSTOMER_OR_WEEK/);
    await assert.rejects(db.query("select id from finance_create_weekly_draft($1,'2026-11-02',$2::uuid[])",[client,[jobs[0],jobs[0]]]),/INVALID_DRAFT_LINES/);
    const initial=(await db.query("select id,draft_identifier,revision_number from finance_create_weekly_draft($1,'2026-11-02',$2::uuid[])",[client,[jobs[0],jobs[1]]])).rows[0];
    assert.match(initial.draft_identifier,/^DRAFT-[A-F0-9]{32}$/);
    assert.equal(initial.revision_number,1);
    await as(office);
    assert.equal((await db.query("select id from finance_draft_trns where id=$1",[initial.id])).rows.length,0);
    await assert.rejects(db.query("select finance_billing_candidate($1)",[jobs[0]]),/FINANCE_REVIEWER_REQUIRED/);
    await as(financeA);
    await assert.rejects(db.query("select id from finance_amend_weekly_draft($1,$2::uuid[],1)",[initial.id,[jobs[0],jobs[1]]]),/DRAFT_UNCHANGED/);
    assert.equal((await db.query("select total_thb from finance_draft_revisions where draft_id=$1",[initial.id])).rows[0].total_thb,"3000.00");
    assert.deepEqual((await db.query("select booking_id from finance_draft_revision_lines where revision_id=(select current_revision_id from finance_draft_trns where id=$1) order by position",[initial.id])).rows.map((row)=>row.booking_id),[jobs[0],jobs[1]]);
    await assert.rejects(db.query("select id from finance_create_weekly_draft($1,'2026-11-02',$2::uuid[])",[client,[jobs[2]]]),/duplicate key/);
    await assert.rejects(db.query("insert into finance_billing_allocations(booking_id,client_id,work_order_number,draft_id,revision_id) select $1,$2,'WO-1',id,current_revision_id from finance_draft_trns where id=$3",[jobs[2],client,initial.id]),/permission denied/);
    await as(financeB);
    const revised=(await db.query("select id,revision_number from finance_amend_weekly_draft($1,$2::uuid[],1)",[initial.id,[jobs[1],jobs[0]]])).rows[0];
    assert.equal(revised.revision_number,2);
    await as(financeA);
    await assert.rejects(db.query("select id from finance_amend_weekly_draft($1,$2::uuid[],1)",[initial.id,[jobs[0]]]),/DRAFT_REVISION_CONFLICT/);
    assert.equal((await db.query("select count(*) n from finance_draft_revisions where draft_id=$1",[initial.id])).rows[0].n,2);
    const third=(await db.query("select revision_number from finance_amend_weekly_draft($1,$2::uuid[],2)",[initial.id,[jobs[0],jobs[2]]])).rows[0];
    assert.equal(third.revision_number,3);
    assert.equal((await db.query("select count(*) n from finance_billing_allocations where booking_id=$1",[jobs[1]])).rows[0].n,0);
    assert.equal((await db.query("select count(*) n from finance_draft_revision_lines where booking_id=$1",[jobs[1]])).rows[0].n,2);
    await root();
    await db.query("update booking_diary set pickup='Changed Depot' where id=$1",[jobs[0]]);
    await as(financeA);
    assert.equal((await db.query("select validation_status from finance_draft_trns where id=$1",[initial.id])).rows[0].validation_status,"stale");
    await assert.rejects(db.query("select id from finance_amend_weekly_draft($1,$2::uuid[],3)",[initial.id,[jobs[0],jobs[2]]]),/BILLING_JOB_NOT_READY/);
    assert.equal((await db.query("select ready from (select (finance_billing_candidate($1,$2)->>'ready')::boolean ready) q",[jobs[0],initial.id])).rows[0].ready,false);
    await assert.rejects(db.query("delete from finance_billing_events where draft_id=$1",[initial.id]),/permission denied/);
    await assert.rejects(db.query("select id from finance_cancel_weekly_draft($1,2,'Cancelled after booking change')",[initial.id]),/DRAFT_REVISION_CONFLICT/);
    await db.query("select id from finance_cancel_weekly_draft($1,3,'Cancelled after booking change')",[initial.id]);
    assert.equal((await db.query("select count(*) n from finance_billing_allocations where draft_id=$1",[initial.id])).rows[0].n,0);
    const replacement=(await db.query("select id,draft_identifier from finance_create_weekly_draft($1,'2026-11-02',$2::uuid[])",[client,[jobs[2]]])).rows[0];
    assert.notEqual(replacement.id,initial.id);
    assert.notEqual(replacement.draft_identifier,initial.draft_identifier);
    await db.query("select id from finance_propose_job_price($1,null,3700,'Further customer price review')",[jobs[2]]);
    assert.equal((await db.query("select validation_status from finance_draft_trns where id=$1",[replacement.id])).rows[0].validation_status,"stale");
    assert.equal((await db.query("select finance_billing_candidate($1,$2)->>'hold' hold",[jobs[2],replacement.id])).rows[0].hold,"price_approval");
    await root();
    assert.equal((await db.query("select count(*) n from finance_billing_events where draft_id=$1",[initial.id])).rows[0].n,5);
    await assert.rejects(db.query("delete from finance_draft_revision_lines where revision_id=$1",[revised.id]),/FINANCE_APPEND_ONLY/);
    assert.equal((await db.query("select count(*) n from information_schema.columns where table_name='finance_draft_trns' and column_name in ('trn_number','invoice_number')")).rows[0].n,0);
  } finally { await db.close(); }
});
