const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { randomUUID } = require("node:crypto");

test("private paperwork intake requires staff review before verification and keeps revisions", async () => {
  const db = new PGlite();
  const office = randomUUID(), manager = randomUUID(), readonly = randomUUID(), driver = randomUUID(), booking = randomUUID(), client = randomUUID();
  await db.exec(`
    create schema auth; create schema storage; create role authenticated; create role anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.account_access(user_id uuid primary key,role text,status text,display_name text);
    create table public.driver_accounts(auth_user_id uuid,active boolean);
    create function public.is_office_account() returns boolean language sql stable security definer as $$select exists(select 1 from public.account_access where user_id=auth.uid() and status='active') and not exists(select 1 from public.driver_accounts where auth_user_id=auth.uid() and active)$$;
    create function public.current_account_role() returns text language sql stable security definer as $$select role from public.account_access where user_id=auth.uid() and status='active'$$;
    create table public.booking_diary(id uuid primary key,booking_date date,client_id uuid,pickup text,dropoff text,pickup_location_id uuid,dropoff_location_id uuid,driver text,driver_id bigint,vehicle text,vehicle_id uuid,vehicle_registration text,trailer_registration text,job_order_number text,status text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated;
    grant execute on function auth.uid(),public.is_office_account(),public.current_account_role() to authenticated;
    grant select on public.booking_diary to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy synthetic_older_broad_storage_policy on storage.objects for all to authenticated using(true) with check(true);
  `);
  for (const [id,role] of [[office,"office_staff"],[manager,"admin"],[readonly,"read_only"],[driver,"office_staff"]]) {
    await db.query("insert into auth.users(id) values($1)",[id]);
    await db.query("insert into account_access values($1,$2,'active',$3)",[id,role,`Synthetic ${role}`]);
  }
  await db.query("insert into driver_accounts values($1,true)",[driver]);
  await db.query("insert into booking_diary(id,booking_date,client_id,pickup,dropoff,driver,vehicle_registration,job_order_number,status) values($1,'2026-10-31',$2,'Depot','Port','Demo Driver','DEMO-1','SIM-1','completed')",[booking,client]);
  await db.exec(fs.readFileSync("supabase/migrations/20261030100000_finance_verification_foundation.sql","utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20261031100000_finance_paperwork_intake.sql","utf8"));
  const observed = {booking_date:"2026-10-31",client_id:client,pickup:"Depot",dropoff:"Port",driver:"Demo Driver",vehicle_registration:"DEMO-1",job_order_number:"SIM-1"};
  const checklist = (id) => ({green_job_order:{required:true,received:true,reference:id,not_applicable_reason:""},parking_receipt:{required:false,received:false,reference:"",not_applicable_reason:"No parking used"},toll_receipt:{required:false,received:false,reference:"",not_applicable_reason:"No toll road used"}});
  async function as(id) { await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`); }
  async function root() { await db.exec("reset role; reset request.jwt.claim.sub"); }
  async function reserve(revision=null) { return (await db.query("select id,object_key,status from public.finance_reserve_paperwork($1,'green_job_order','order.pdf','application/pdf',12,$2)",[booking,revision])).rows[0]; }
  async function verify(id,dropoff="Port") { return db.query("select status,handover_status from public.finance_submit_verification($1,$2::jsonb,$3::jsonb,'Paper compared')",[booking,JSON.stringify({...observed,dropoff}),JSON.stringify(checklist(id))]); }
  try {
    assert.equal((await db.query("select public from storage.buckets where id='ees-finance-paperwork'")).rows[0].public,false);
    await as(readonly); await assert.rejects(reserve(),/FINANCE_PAPERWORK_PERMISSION_REQUIRED/);
    await as(driver); await assert.rejects(reserve(),/FINANCE_PAPERWORK_PERMISSION_REQUIRED/);
    await as(office);
    const first=await reserve();
    assert.match(first.object_key,new RegExp(`^${booking}/`));
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata) values('ees-finance-paperwork','wrong-key','{}')"),/row-level security/);
    await assert.rejects(verify(first.id),/FINANCE_REVIEWED_DOCUMENT_REQUIRED/);
    await assert.rejects(db.query("select id from public.finance_finalize_paperwork($1)",[first.id]),/FINANCE_PAPERWORK_UPLOAD_INCOMPLETE/);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('ees-finance-paperwork',$1,$2)",[first.object_key,JSON.stringify({size:12,mimetype:"application/pdf"})]);
    assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning id",[first.object_key])).rows.length,0);
    assert.equal((await db.query("delete from storage.objects where name=$1 returning id",[first.object_key])).rows.length,0);
    await as(readonly);assert.equal((await db.query("select id from storage.objects where name=$1",[first.object_key])).rows.length,0);
    assert.equal((await db.query("select id from finance_paperwork_documents where id=$1",[first.id])).rows.length,0);
    await as(office);
    await db.query("select id from public.finance_finalize_paperwork($1)",[first.id]);
    await assert.rejects(verify(first.id),/FINANCE_REVIEWED_DOCUMENT_REQUIRED/);
    await as(readonly);await assert.rejects(db.query("select id from finance_review_paperwork($1,true,'Cabinet A','Checked')",[first.id]),/FINANCE_PAPERWORK_PERMISSION_REQUIRED/);
    await as(driver);await assert.rejects(db.query("select id from finance_review_paperwork($1,true,'Cabinet A','Checked')",[first.id]),/FINANCE_PAPERWORK_PERMISSION_REQUIRED/);
    assert.equal((await db.query("select id from storage.objects where name=$1",[first.object_key])).rows.length,0);
    await as(office);
    await db.query("select id from public.finance_review_paperwork($1,true,'Cabinet A / folder 1','Original checked')",[first.id]);
    let result=await verify(first.id);assert.equal(result.rows[0].status,"verified");assert.equal(result.rows[0].handover_status,"ready");
    const second=await reserve(first.id);assert.notEqual(first.object_key,second.object_key);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('ees-finance-paperwork',$1,$2)",[second.object_key,JSON.stringify({size:12,mimetype:"application/pdf"})]);
    await db.query("select id from public.finance_finalize_paperwork($1)",[second.id]);
    await db.query("select id from public.finance_review_paperwork($1,true,'Cabinet A / folder 2','Revised original checked')",[second.id]);
    assert.equal((await db.query("select status from finance_job_verifications where booking_id=$1",[booking])).rows[0].status,"needs_recheck");
    await assert.rejects(verify(first.id),/FINANCE_REVIEWED_DOCUMENT_REQUIRED/);
    result=await verify(second.id);assert.equal(result.rows[0].status,"verified");
    result=await verify(second.id,"Other Port");assert.equal(result.rows[0].status,"discrepancy");
    const discrepancy=(await db.query("select id from finance_discrepancies where status='open'")).rows[0].id;
    await assert.rejects(db.query("select id from finance_resolve_discrepancy($1,'Checked original paperwork')",[discrepancy]),/MANAGEMENT_REVIEW_PERMISSION_REQUIRED/);
    await as(manager);await assert.rejects(db.query("select id from finance_resolve_discrepancy($1,'Checked original paperwork')",[discrepancy]),/MANAGEMENT_REVIEW_PERMISSION_REQUIRED/);
    await root();await db.query("insert into finance_role_grants(user_id,capability) values($1,'management_reviewer')",[manager]);
    await as(manager);await db.query("select id from finance_resolve_discrepancy($1,'Checked original paperwork')",[discrepancy]);
    assert.equal((await db.query("select status from finance_job_verifications where booking_id=$1",[booking])).rows[0].status,"needs_recheck");
    await as(office);result=await verify(second.id);assert.equal(result.rows[0].status,"verified");
    await assert.rejects(db.query("delete from finance_paperwork_events"),/permission denied/);
    await root();assert.equal(Number((await db.query("select count(*) n from finance_paperwork_events")).rows[0].n),7);
  } finally { await db.close(); }
});
