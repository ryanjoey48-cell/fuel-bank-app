/**
 * Validates docs/proposed/PROPOSED-migration-finance-records-shared-storage.sql in an IN-MEMORY PGlite database only.
 * Nothing here touches Supabase, any environment variable or any real database; the proposal is NOT applied anywhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const PROPOSED = 'docs/proposed/PROPOSED-migration-finance-records-shared-storage.sql';
const PREREQUISITES = ['20261030100000_finance_verification_foundation.sql', '20261031100000_finance_paperwork_intake.sql', '20261102100000_finance_expenses_pricing.sql'];

async function boot() {
  const db = new PGlite();
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
  for (const file of PREREQUISITES) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(fs.readFileSync(PROPOSED, 'utf8'));
  return db;
}

test('the proposal is additive, outside supabase/migrations, and says it is not applied', () => {
  const sql = fs.readFileSync(PROPOSED, 'utf8');
  assert.match(sql, /PROPOSED — NOT APPLIED — REVIEW ONLY/);
  assert.doesNotMatch(sql, /^\s*(drop|truncate)\s/im);
  assert.doesNotMatch(sql, /alter table public\.(finance_role_grants|booking_diary|clients|finance_[a-z_]+)\s+(drop|alter column|rename)/i);
  assert.ok(!fs.readdirSync('supabase/migrations').some((name) => /records_shared_storage/i.test(name)), 'must never be placed in supabase/migrations');
  assert.match(fs.readFileSync('docs/finance-records-shared-storage-plan.md', 'utf8'), /NOT APPLIED/);
});

test('invariants hold in an in-memory database: one work order per sheet, blank≠zero, locked sheets, immutable history', async () => {
  const db = await boot();
  try {
    const admin = randomUUID(), reviewer = randomUUID(), approver = randomUUID(), superAdmin = randomUUID(), office = randomUUID();
    const client = randomUUID(), other = randomUUID();
    const bookings = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const as = (id) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
    const root = () => db.exec('reset role; reset request.jwt.claim.sub');
    for (const [id, role] of [[admin, 'admin'], [reviewer, 'office_staff'], [approver, 'office_staff'], [superAdmin, 'super_admin'], [office, 'office_staff']]) {
      await db.query('insert into auth.users(id) values($1)', [id]);
      await db.query("insert into account_access values($1,$2,'active',$3)", [id, role, role]);
    }
    await db.query("insert into finance_role_grants(user_id,capability) values($1,'finance_reviewer'),($2,'invoice_approver')", [reviewer, approver]);
    await db.query("insert into clients values($1,'Fixture A'),($2,'Fixture B')", [client, other]);
    for (const [index, id] of bookings.entries()) {
      await db.query('insert into finance_intake_records(booking_id,client_id,work_order_number,booking_snapshot,created_by,updated_by) values($1,$2,$3,$4,$5,$5)',
        [id, index < 3 ? client : other, ['219', '220', '253', '3628.1'][index], JSON.stringify({ pickup: 'Fixture' }), admin]);
    }
    // a green-paper number identifies one booking
    await assert.rejects(db.query("insert into finance_intake_records(booking_id,client_id,work_order_number,booking_snapshot,created_by,updated_by) values($1,$2,' 219 ','{}',$3,$3)", [randomUUID(), client, admin]), /finance_intake_one_booking_per_work_order/);
    // blank receipt = no row; a recorded zero is allowed; negatives are not
    await db.query("insert into finance_intake_receipts values($1,'parking',0),($1,'toll',35.25)", [bookings[0]]);
    await assert.rejects(db.query("insert into finance_intake_receipts values($1,'parking',-1)", [bookings[1]]), /check/);
    assert.equal((await db.query('select count(*)::int n from finance_intake_receipts where booking_id=$1', [bookings[1]])).rows[0].n, 0);
    // a flagged intake needs a note
    await assert.rejects(db.query("update finance_intake_records set intake_check='flagged', intake_note='' where booking_id=$1", [bookings[0]]), /finance_intake_flag_needs_note/);

    const sheet = (await db.query("insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,'DRAFT-2026-001',$2) returning id", [client, reviewer])).rows[0].id;
    const sheet2 = (await db.query("insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,'DRAFT-2026-002',$2) returning id", [client, reviewer])).rows[0].id;
    for (const [index, booking] of bookings.slice(0, 3).entries()) await db.query('insert into finance_billing_sheet_papers values($1,$2,$3)', [sheet, index + 1, booking]);
    // the same work order cannot reach a second sheet
    await assert.rejects(db.query('insert into finance_billing_sheet_papers values($1,1,$2)', [sheet2, bookings[0]]), /FINANCE_WO_ALREADY_ALLOCATED/);
    assert.equal((await db.query('select count(*)::int n from finance_work_order_allocations')).rows[0].n, 3);
    // paper order is only an order: positions are unique per sheet
    await assert.rejects(db.query('insert into finance_billing_sheet_papers values($1,1,$2)', [sheet2, bookings[3]]).then(() => db.query('insert into finance_billing_sheet_papers values($1,1,$2)', [sheet2, bookings[3]])), /duplicate|unique|already/i);

    // transport: blank is NULL (never zero); zero and half-set rows are rejected
    await db.query("insert into finance_billing_sheet_lines(sheet_id,booking_id) values($1,$2)", [sheet, bookings[0]]);
    await db.query("update finance_billing_sheet_lines set transport_amount_thb=2200, transport_source='manual' where sheet_id=$1 and booking_id=$2", [sheet, bookings[0]]);
    await assert.rejects(db.query("update finance_billing_sheet_lines set transport_amount_thb=0, transport_source='manual' where sheet_id=$1 and booking_id=$2", [sheet, bookings[0]]), /check/);
    await assert.rejects(db.query("update finance_billing_sheet_lines set transport_source=null where sheet_id=$1 and booking_id=$2", [sheet, bookings[0]]), /finance_line_amount_has_source/);
    // extras: 'bill' needs a positive amount, 'not_billable' has none
    await db.query("insert into finance_billing_sheet_extras(sheet_id,booking_id,kind,decision,amount_thb) values($1,$2,'container_pickup','bill',200)", [sheet, bookings[0]]);
    await db.query("insert into finance_billing_sheet_extras(sheet_id,booking_id,kind,decision) values($1,$2,'parking','not_billable')", [sheet, bookings[1]]);
    await assert.rejects(db.query("insert into finance_billing_sheet_extras(sheet_id,booking_id,kind,decision,amount_thb) values($1,$2,'toll','bill',0)", [sheet, bookings[2]]), /finance_extra_amount_matches_decision/);
    await assert.rejects(db.query("insert into finance_billing_sheet_extras(sheet_id,booking_id,kind,decision,amount_thb) values($1,$2,'toll','not_billable',10)", [sheet, bookings[2]]), /finance_extra_amount_matches_decision/);

    // lifecycle: no skipping stages; a locked sheet cannot be edited; reopening restores editing
    await assert.rejects(db.query("update finance_billing_sheets set status='issued' where id=$1", [sheet]), /FINANCE_SHEET_STATUS_TRANSITION|finance_sheet_issued_has_trn/);
    await db.query("update finance_billing_sheets set status='ready_for_review', confirmed_by=$2, confirmed_at=now() where id=$1", [sheet, reviewer]);
    await assert.rejects(db.query("update finance_billing_sheet_lines set transport_amount_thb=1 where sheet_id=$1", [sheet]), /FINANCE_SHEET_LOCKED/);
    await assert.rejects(db.query('delete from finance_billing_sheet_papers where sheet_id=$1 and position=3', [sheet]), /FINANCE_SHEET_LOCKED/);

    // reopen: reviewer only, reason required, amounts unchanged, recorded in the history
    const totalBefore = JSON.stringify((await db.query('select sheet_id,booking_id,transport_amount_thb from finance_billing_sheet_lines order by booking_id')).rows);
    await as(office);
    await assert.rejects(db.query("select finance_reopen_sheet($1,'Customer asked to re-check')", [sheet]), /FINANCE_REVIEWER_REQUIRED/);
    await as(reviewer);
    await assert.rejects(db.query("select finance_reopen_sheet($1,'x')", [sheet]), /FINANCE_REASON_REQUIRED/);
    await db.query("select finance_reopen_sheet($1,'Customer asked to re-check the container charge')", [sheet]);
    await root();
    assert.equal((await db.query('select status from finance_billing_sheets where id=$1', [sheet])).rows[0].status, 'needs_correction');
    assert.equal(JSON.stringify((await db.query('select sheet_id,booking_id,transport_amount_thb from finance_billing_sheet_lines order by booking_id')).rows), totalBefore);
    assert.match(JSON.stringify((await db.query("select details from finance_billing_sheet_events where event_type='reopened'")).rows), /re-check the container charge/);
    await db.query("update finance_billing_sheet_lines set transport_amount_thb=2300 where sheet_id=$1 and booking_id=$2", [sheet, bookings[0]]); // editable again

    // history is append-only
    await assert.rejects(db.query("update finance_billing_sheet_events set details='{}' where event_type='reopened'"), /./);
    await assert.rejects(db.query("delete from finance_billing_sheet_events"), /./);
    const revision = (await db.query("insert into finance_billing_sheet_revisions(sheet_id,revision_number,action,snapshot,snapshot_sha256,total_thb,created_by) values($1,1,'confirmed','{}',repeat('a',64),17400,$2) returning id", [sheet, reviewer])).rows[0].id;
    await assert.rejects(db.query('update finance_billing_sheet_revisions set total_thb=1 where id=$1', [revision]), /./);
    await assert.rejects(db.query('delete from finance_billing_sheet_revisions where id=$1', [revision]), /./);
    // cancelling a draft releases its work orders; an unknown sheet cannot be deleted
    await db.query("update finance_billing_sheets set status='cancelled' where id=$1", [sheet]);
    assert.equal((await db.query('select count(*)::int n from finance_work_order_allocations where sheet_id=$1', [sheet])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from finance_work_order_allocations where sheet_id=$1', [sheet2])).rows[0].n, 1); // other sheets keep theirs
    await assert.rejects(db.query('delete from finance_billing_sheets where id=$1', [sheet]), /FINANCE_SHEET_NOT_DELETABLE/);
  } finally { await db.close(); }
});

test('official TRNs: refused until a super admin verifies the register; sequential, unique, immutable once issued', async () => {
  const db = await boot();
  try {
    const admin = randomUUID(), approver = randomUUID(), superAdmin = randomUUID(), office = randomUUID(), client = randomUUID();
    const as = (id) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
    const root = () => db.exec('reset role; reset request.jwt.claim.sub');
    for (const [id, role] of [[admin, 'admin'], [approver, 'office_staff'], [superAdmin, 'super_admin'], [office, 'office_staff']]) {
      await db.query('insert into auth.users(id) values($1)', [id]);
      await db.query("insert into account_access values($1,$2,'active',$3)", [id, role, role]);
    }
    await db.query("insert into finance_role_grants(user_id,capability) values($1,'invoice_approver')", [approver]);
    await db.query("insert into clients values($1,'Fixture A')", [client]);
    const makeApprovedSheet = async (label, workOrder) => {
      const booking = randomUUID();
      await db.query('insert into finance_intake_records(booking_id,client_id,work_order_number,booking_snapshot,created_by,updated_by) values($1,$2,$3,$4,$5,$5)', [booking, client, workOrder, '{}', admin]);
      const id = (await db.query('insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,$2,$3) returning id', [client, label, admin])).rows[0].id;
      await db.query('insert into finance_billing_sheet_papers values($1,1,$2)', [id, booking]);
      for (const status of ['ready_for_review', 'awaiting_approval', 'approved']) await db.query('update finance_billing_sheets set status=$2 where id=$1', [id, status]);
      return { id, booking };
    };
    const a = await makeApprovedSheet('DRAFT-A', 'A-1');
    const b = await makeApprovedSheet('DRAFT-B', 'B-1');

    await as(approver);
    // 1) no verified register → no number, ever
    await assert.rejects(db.query('select finance_allocate_trn($1, 2026)', [a.id]), /FINANCE_TRN_REGISTER_NOT_VERIFIED/);
    // 2) only a super admin can verify the historical high-water mark (and needs real evidence text)
    await assert.rejects(db.query("select finance_verify_trn_register(2026, 650, 'Checked against the invoice book')"), /FINANCE_SUPER_ADMIN_REQUIRED/);
    await as(superAdmin);
    await assert.rejects(db.query("select finance_verify_trn_register(2026, 650, 'short')"), /check/);
    await db.query("select finance_verify_trn_register(2026, 650, 'Checked against the signed invoice book by the finance manager')");
    // 3) only an invoice approver can allocate, and only for an approved sheet
    await as(office);
    await assert.rejects(db.query('select finance_allocate_trn($1, 2026)', [a.id]), /FINANCE_INVOICE_APPROVER_REQUIRED/);
    await as(approver);
    const draft = await (async () => { await root(); const id = (await db.query("insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,'DRAFT-C',$2) returning id", [client, admin])).rows[0].id; await as(approver); return id; })();
    await assert.rejects(db.query('select finance_allocate_trn($1, 2026)', [draft]), /FINANCE_SHEET_NOT_APPROVED/);
    // 4) numbers continue the verified sequence, exactly once each
    assert.equal((await db.query('select finance_allocate_trn($1, 2026) trn', [a.id])).rows[0].trn, 'TRN651/2026');
    assert.equal((await db.query('select finance_allocate_trn($1, 2026) trn', [b.id])).rows[0].trn, 'TRN652/2026');
    await assert.rejects(db.query('select finance_allocate_trn($1, 2026)', [a.id]), /FINANCE_SHEET_NOT_APPROVED/); // already issued
    await root();
    const issued = (await db.query("select s.status, r.trn_text, r.origin from finance_billing_sheets s join finance_trn_register r on r.id=s.trn_id order by r.trn_number")).rows;
    assert.deepEqual(issued.map((row) => [row.status, row.trn_text, row.origin]), [['issued', 'TRN651/2026', 'allocated'], ['issued', 'TRN652/2026', 'allocated']]);
    await assert.rejects(db.query("insert into finance_trn_register(trn_year,trn_number,status,origin,sheet_id) values(2026,651,'issued','allocated',$1)", [a.id]), /unique|duplicate/i);
    // 5) an issued sheet and its work orders can never change or move
    await assert.rejects(db.query("update finance_billing_sheets set status='needs_correction' where id=$1", [a.id]), /FINANCE_ISSUED_IMMUTABLE/);
    await assert.rejects(db.query('delete from finance_billing_sheet_papers where sheet_id=$1', [a.id]), /FINANCE_SHEET_LOCKED/);
    await assert.rejects(db.query('delete from finance_billing_sheets where id=$1', [a.id]), /FINANCE_SHEET_NOT_DELETABLE/);
    const other = (await db.query("insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,'DRAFT-D',$2) returning id", [client, admin])).rows[0].id;
    await assert.rejects(db.query('insert into finance_billing_sheet_papers values($1,1,$2)', [other, a.booking]), /FINANCE_WO_ALREADY_ALLOCATED/);
    // 6) the allocator is serialised by a per-year advisory lock
    const source = (await db.query("select pg_get_functiondef('public.finance_allocate_trn(uuid,integer)'::regprocedure) def")).rows[0].def;
    assert.match(source, /pg_advisory_xact_lock/);
    assert.match(source, /FINANCE_TRN_REGISTER_NOT_VERIFIED/);
  } finally { await db.close(); }
});

test('row level security: office accounts read, nobody writes tables directly, activity history is finance-only', async () => {
  const db = await boot();
  try {
    const office = randomUUID(), reviewer = randomUUID(), client = randomUUID();
    const as = (id) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
    const root = () => db.exec('reset role; reset request.jwt.claim.sub');
    for (const id of [office, reviewer]) { await db.query('insert into auth.users(id) values($1)', [id]); await db.query("insert into account_access values($1,'office_staff','active','x')", [id]); }
    await db.query("insert into finance_role_grants(user_id,capability) values($1,'finance_reviewer')", [reviewer]);
    await db.query("insert into clients values($1,'Fixture A')", [client]);
    const sheet = (await db.query("insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,'DRAFT-1',$2) returning id", [client, office])).rows[0].id;
    await db.query("insert into finance_billing_sheet_events(sheet_id,event_type) values($1,'created')", [sheet]);
    const tables = (await db.query("select tablename from pg_tables where schemaname='public' and tablename in ('finance_intake_records','finance_intake_receipts','finance_trn_register_verifications','finance_trn_register','finance_billing_sheets','finance_billing_sheet_papers','finance_work_order_allocations','finance_billing_sheet_lines','finance_billing_sheet_extras','finance_billing_sheet_revisions','finance_billing_sheet_approvals','finance_billing_sheet_events')")).rows.map((row) => row.tablename);
    assert.equal(tables.length, 12);
    for (const name of tables) {
      assert.equal((await db.query('select relrowsecurity r from pg_class where oid=$1::regclass', [`public.${name}`])).rows[0].r, true, `${name} RLS`);
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok', ['authenticated', `public.${name}`, privilege])).rows[0].ok, false, `${name} ${privilege}`);
    }
    await as(office);
    assert.equal((await db.query('select count(*)::int n from finance_billing_sheets')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from finance_billing_sheet_events')).rows[0].n, 0); // office-only: no activity history
    await assert.rejects(db.query("insert into finance_billing_sheets(client_id,draft_identifier,created_by) values($1,'X',$2)", [client, office]), /permission denied/);
    await as(reviewer);
    assert.equal((await db.query('select count(*)::int n from finance_billing_sheet_events')).rows[0].n, 1);
    await root();
  } finally { await db.close(); }
});
