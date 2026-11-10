const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { randomUUID } = require("node:crypto");

test("finance migration enforces verification, management resolution and booking invalidation in isolated Postgres", async () => {
  const db = new PGlite();
  const office = randomUUID(), manager = randomUUID(), readonly = randomUUID(), driver = randomUUID(), booking = randomUUID(), client = randomUUID();
  await db.exec(`
    create schema auth; create role authenticated; create role anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.account_access(user_id uuid primary key,role text,status text,display_name text);
    create table public.driver_accounts(auth_user_id uuid,active boolean);
    create function public.is_office_account() returns boolean language sql stable security definer as $$select exists(select 1 from public.account_access where user_id=auth.uid() and status='active') and not exists(select 1 from public.driver_accounts where auth_user_id=auth.uid() and active)$$;
    create function public.current_account_role() returns text language sql stable security definer as $$select role from public.account_access where user_id=auth.uid() and status='active'$$;
    create table public.booking_diary(id uuid primary key,booking_date date,client_id uuid,pickup text,dropoff text,pickup_location_id uuid,dropoff_location_id uuid,driver text,driver_id bigint,vehicle text,vehicle_id uuid,vehicle_registration text,trailer_registration text,job_order_number text,status text);
    grant usage on schema public,auth to authenticated;
    grant execute on function auth.uid(),public.is_office_account(),public.current_account_role() to authenticated;
    grant select,update,delete on public.booking_diary to authenticated;
  `);
  for (const [id, role] of [[office,"office_staff"],[manager,"admin"],[readonly,"read_only"],[driver,"office_staff"]]) {
    await db.query("insert into auth.users(id) values($1)",[id]);
    await db.query("insert into account_access(user_id,role,status,display_name) values($1,$2,'active',$3)",[id,role,`Synthetic ${role}`]);
  }
  await db.query("insert into driver_accounts values($1,true)",[driver]);
  await db.query("insert into booking_diary(id,booking_date,client_id,pickup,dropoff,driver,vehicle_registration,job_order_number,status) values($1,'2026-10-29',$2,'Depot','Port','Demo Driver','DEMO-1','SIM-1','completed')",[booking,client]);
  await db.exec(fs.readFileSync("supabase/migrations/20261030100000_finance_verification_foundation.sql","utf8"));
  const observed = { booking_date:"2026-10-29",client_id:client,pickup:"Depot",dropoff:"Port",driver:"Demo Driver",vehicle_registration:"DEMO-1",job_order_number:"SIM-1" };
  const documents = { green_job_order:{required:true,received:true,reference:"paper-1",not_applicable_reason:""},parking_receipt:{required:true,received:true,reference:"paper-2",not_applicable_reason:""},toll_receipt:{required:true,received:true,reference:"photo-3",not_applicable_reason:""} };
  async function as(user) { await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`); }
  async function owner() { await db.exec("reset role; reset request.jwt.claim.sub"); }
  async function verify(details=observed, checklist=documents) { return db.query("select status,handover_status from public.finance_submit_verification($1,$2::jsonb,$3::jsonb,$4)",[booking,JSON.stringify(details),JSON.stringify(checklist),"Paper checked"]); }
  try {
    await as(readonly); await assert.rejects(verify(),/FINANCE_OFFICE_PERMISSION_REQUIRED/);
    await as(driver); await assert.rejects(verify(),/FINANCE_OFFICE_PERMISSION_REQUIRED/);
    await as(office); let result=await verify(); assert.equal(result.rows[0].status,"verified"); assert.equal(result.rows[0].handover_status,"ready");
    assert.equal((await db.query("select pickup,dropoff,job_order_number from booking_diary where id=$1",[booking])).rows[0].dropoff,"Port");
    await assert.rejects(verify(observed,{...documents,parking_receipt:{required:false,received:false,reference:"",not_applicable_reason:""}}),/DOCUMENT_NOT_APPLICABLE_REASON_REQUIRED/);
    await assert.rejects(verify(observed,{...documents,green_job_order:{required:false,received:false,reference:"",not_applicable_reason:"Not required"}}),/SIGNED_JOB_ORDER_REQUIRED/);
    await assert.rejects(db.query("insert into public.finance_audit_events(booking_id,actor_name,event_type,details) values($1,'Fake','booking_deleted','{}')",[booking]),/permission denied/);
    await as(readonly); assert.equal((await db.query("select * from public.finance_job_verifications")).rows.length,1);
    await as(driver); assert.equal((await db.query("select * from public.finance_job_verifications")).rows.length,0);
    await as(office);
    result=await verify(observed,{...documents,green_job_order:{required:true,received:false,reference:"",not_applicable_reason:""}}); assert.equal(result.rows[0].status,"missing_paperwork");
    result=await verify({...observed,dropoff:"Other Port"}); assert.equal(result.rows[0].status,"discrepancy");
    const discrepancy=(await db.query("select id from public.finance_discrepancies where status='open'")).rows[0].id;
    await assert.rejects(verify(observed),/OPEN_DISCREPANCY_REQUIRES_MANAGEMENT/);
    await assert.rejects(db.query("select public.finance_resolve_discrepancy($1,$2)",[discrepancy,"Checked paper with driver"]),/MANAGEMENT_REVIEW_PERMISSION_REQUIRED/);
    await as(manager); await assert.rejects(db.query("select public.finance_resolve_discrepancy($1,$2)",[discrepancy,"Checked paper with driver"]),/MANAGEMENT_REVIEW_PERMISSION_REQUIRED/);
    await owner(); await db.query("insert into public.finance_role_grants(user_id,capability) values($1,'management_reviewer'),($2,'management_reviewer')",[manager,readonly]);
    await as(readonly); await assert.rejects(db.query("select public.finance_resolve_discrepancy($1,$2)",[discrepancy,"Checked paper with driver"]),/MANAGEMENT_REVIEW_PERMISSION_REQUIRED/);
    await as(manager); await db.query("select public.finance_resolve_discrepancy($1,$2)",[discrepancy,"Corrected destination confirmed by manager"]);
    result=await db.query("select status,handover_status from public.finance_job_verifications where booking_id=$1",[booking]); assert.equal(result.rows[0].status,"needs_recheck"); assert.equal(result.rows[0].handover_status,"blocked");
    await as(office); result=await verify(); assert.equal(result.rows[0].status,"verified");
    await db.query("update public.booking_diary set driver_id=42 where id=$1",[booking]);
    result=await db.query("select status,handover_status from public.finance_job_verifications where booking_id=$1",[booking]); assert.equal(result.rows[0].status,"needs_recheck"); assert.equal(result.rows[0].handover_status,"blocked");
    await db.query("update public.booking_diary set dropoff='Revised Port' where id=$1",[booking]);
    await db.query("delete from public.booking_diary where id=$1",[booking]);
    assert.equal((await db.query("select count(*) as n from public.booking_diary where id=$1",[booking])).rows[0].n,0);
    await assert.rejects(db.query("delete from public.finance_audit_events"),/permission denied/);
    await owner(); assert.equal(Number((await db.query("select count(*) as n from public.finance_audit_events")).rows[0].n),7);
  } finally { await db.close(); }
});
