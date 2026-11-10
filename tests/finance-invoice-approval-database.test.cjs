const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");

test("invoice approval separates preparer and approver, invalidates on change, and packs preserve order", async () => {
  const db = new PGlite();
  const office = randomUUID(), finance = randomUUID(), boss = randomUUID(), pricing = randomUUID(), client = randomUUID();
  const jobs = [randomUUID(), randomUUID()];
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
    for (const [id, role] of [[office, "office_staff"], [finance, "office_staff"], [boss, "admin"], [pricing, "office_staff"]]) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query("insert into account_access values($1,$2,'active',$3)", [id, role, role]);
    }
    await db.query("insert into clients values($1,'Mass Demo')", [client]);
    for (let i = 0; i < jobs.length; i++) {
      await db.query(
        "insert into booking_diary(id,booking_id,booking_date,client_id,pickup,dropoff,driver,vehicle,vehicle_registration,job_order_number,status) values($1,$2,'2026-01-05',$3,'Depot','Port','Demo Driver','Truck','DEMO-1',$4,'completed')",
        [jobs[i], `B-${i + 1}`, client, `WO-${i + 1}`]
      );
    }
    for (const file of [
      "20261030100000_finance_verification_foundation.sql",
      "20261031100000_finance_paperwork_intake.sql",
      "20261102100000_finance_expenses_pricing.sql",
      "20261103100000_finance_weekly_billing_drafts.sql",
      "20261104100000_finance_invoice_approval_packs.sql"
    ]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));

    await db.query(
      "insert into finance_role_grants(user_id,capability) values($1,'finance_reviewer'),($2,'invoice_approver'),($3,'pricing_approver'),($3,'expense_approver')",
      [finance, boss, pricing]
    );
    for (let i = 0; i < jobs.length; i++) {
      const snapshot = { booking_date: "2026-01-05", client_id: client, pickup: "Depot", dropoff: "Port", job_order_number: `WO-${i + 1}` };
      await db.query(
        "insert into finance_job_verifications(booking_id,status,handover_status,booking_snapshot,observed_details,document_checklist,checked_fields,checked_by) values($1,'verified','ready','{}','{}','{}','{}',$2)",
        [jobs[i], office]
      );
      const docs = await db.query(
        "insert into finance_paperwork_documents(booking_id,kind,object_key,original_filename,mime_type,size_bytes,status,physical_location,uploaded_by,reviewed_by,reviewed_at) values($1,'green_job_order',$2,$3,'application/pdf',1234,'reviewed',$4,$5,$5,now()) returning id",
        [jobs[i], `${jobs[i]}/green`, `green-${i + 1}.pdf`, i === 0 ? "Shelf A-1" : "Shelf A-2", office]
      );
      assert.ok(docs.rows[0].id);
      const price = (await db.query(
        "insert into finance_job_price_revisions(booking_id,client_id,source,original_price_thb,selling_price_thb,override_reason,booking_snapshot,created_by) values($1,$2,'manual',null,$3,'Agreed demo price',$4,$5) returning id",
        [jobs[i], client, i === 0 ? 3000 : 5000, JSON.stringify(snapshot), finance]
      )).rows[0].id;
      await db.query("insert into finance_pricing_decisions(revision_id,decision,reason,decided_by) values($1,'approved','Reviewed demo price',$2)", [price, pricing]);
    }

    await as(boss);
    await assert.rejects(db.query("select id from finance_create_weekly_draft($1,'2026-01-05',$2::uuid[])", [client, jobs]), /FINANCE_REVIEWER_REQUIRED/);
    await as(finance);
    const draft = (await db.query("select id,revision_number from finance_create_weekly_draft($1,'2026-01-05',$2::uuid[])", [client, jobs])).rows[0];
    const submission = (await db.query("select id,submission_number,status from finance_submit_invoice_draft($1,1)", [draft.id])).rows[0];
    assert.equal(submission.status, "pending");
    assert.equal(submission.submission_number, 1);
    await assert.rejects(db.query("select id from finance_submit_invoice_draft($1,1)", [draft.id]), /INVOICE_SUBMISSION_PENDING/);
    await assert.rejects(
      db.query("select id from finance_decide_invoice_submission($1,true,'Self approval must be blocked')", [submission.id]),
      /INVOICE_APPROVER_REQUIRED/
    );

    await as(boss);
    await assert.rejects(
      db.query("select id from finance_decide_invoice_submission($1,true,'Too short')", [submission.id]),
      /APPROVAL_REASON_REQUIRED/
    );
    const decision = (await db.query(
      "select id,decision from finance_decide_invoice_submission($1,true,'Manager reviewed bookings prices and paperwork')",
      [submission.id]
    )).rows[0];
    assert.equal(decision.decision, "approved");
    await assert.rejects(
      db.query("select id from finance_decide_invoice_submission($1,true,'Duplicate approval attempt blocked')", [submission.id]),
      /PENDING_SUBMISSION_REQUIRED/
    );

    await as(finance);
    const pack = (await db.query("select id,pack_number,status,hold_reasons from finance_prepare_document_pack($1)", [submission.id])).rows[0];
    assert.equal(pack.pack_number, 1);
    assert.equal(pack.status, "prepared");
    assert.deepEqual(
      (await db.query("select booking_id from finance_document_pack_lines where pack_id=$1 order by position", [pack.id])).rows.map((row) => row.booking_id),
      jobs
    );
    assert.equal((await db.query("select count(*) n from finance_document_pack_checklists where pack_id=$1", [pack.id])).rows[0].n, 2);
    assert.equal((await db.query("select count(*) n from information_schema.columns where table_name in ('finance_invoice_submissions','finance_document_packs') and column_name in ('trn_number','invoice_number')")).rows[0].n, 0);

    await root();
    await db.query("update booking_diary set pickup='Changed Depot' where id=$1", [jobs[0]]);
    await as(finance);
    assert.equal((await db.query("select status from finance_invoice_submissions where id=$1", [submission.id])).rows[0].status, "invalidated");
    assert.equal((await db.query("select status from finance_document_packs where id=$1", [pack.id])).rows[0].status, "superseded");
    await assert.rejects(db.query("select id from finance_prepare_document_pack($1)", [submission.id]), /APPROVED_SUBMISSION_REQUIRED/);

    await root();
    await db.query("update booking_diary set pickup='Depot' where id=$1", [jobs[0]]);
    // Booking edits force office re-verification before a draft can be amended again.
    await db.query("update finance_job_verifications set status='verified', handover_status='ready' where booking_id=$1", [jobs[0]]);
    await as(finance);
    const revised = (await db.query("select revision_number from finance_amend_weekly_draft($1,$2::uuid[],1)", [draft.id, jobs])).rows[0];
    assert.equal(revised.revision_number, 2);
    const resubmit = (await db.query("select id,submission_number,status from finance_submit_invoice_draft($1,2)", [draft.id])).rows[0];
    assert.equal(resubmit.submission_number, 2);
    assert.equal(resubmit.status, "pending");

    await as(boss);
    await db.query("select id from finance_decide_invoice_submission($1,false,'Reject for missing filing note review')", [resubmit.id]);
    assert.equal((await db.query("select status from finance_invoice_submissions where id=$1", [resubmit.id])).rows[0].status, "rejected");

    await as(finance);
    const third = (await db.query("select id,submission_number from finance_submit_invoice_draft($1,2)", [draft.id])).rows[0];
    assert.equal(third.submission_number, 3);
    await as(boss);
    await db.query("select id from finance_decide_invoice_submission($1,true,'Approved after rejection and resubmission')", [third.id]);
    await as(finance);
    const secondPack = (await db.query("select pack_number,status from finance_prepare_document_pack($1)", [third.id])).rows[0];
    assert.equal(secondPack.pack_number, 2);
    assert.equal(secondPack.status, "prepared");

    await as(office);
    assert.equal((await db.query("select id from finance_invoice_submissions where draft_id=$1", [draft.id])).rows.length, 0);
    await assert.rejects(db.query("delete from finance_approval_events where draft_id=$1", [draft.id]), /permission denied|FINANCE_APPEND_ONLY/);
    await root();
    await assert.rejects(db.query("delete from finance_invoice_decisions where submission_id=$1", [third.id]), /FINANCE_APPEND_ONLY/);
    assert.ok((await db.query("select count(*) n from finance_approval_events where draft_id=$1", [draft.id])).rows[0].n >= 6);
  } finally {
    await db.close();
  }
});
