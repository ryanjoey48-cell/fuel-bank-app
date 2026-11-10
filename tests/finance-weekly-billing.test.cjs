const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function load(file) { const m={exports:{}}; new Function("module","exports",ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports); return m.exports; }
const billing=load("lib/finance-weekly-billing.ts");
const copy=load("lib/finance-weekly-billing-copy.ts").weeklyBillingCopy;
const booking=(id,client_id,date,job_order_number)=>({id,client_id,booking_date:date,job_order_number});

test("Thailand local date chooses Monday through Sunday across UTC and year boundaries", () => {
  assert.equal(billing.thailandWeekStart(new Date("2026-11-01T18:30:00Z")),"2026-11-02");
  assert.equal(billing.thailandWeekStart(new Date("2026-11-01T16:30:00Z")),"2026-10-26");
  assert.equal(billing.thailandWeekStart("2027-01-01"),"2026-12-28");
  assert.equal(billing.thailandWeekEnd("2026-12-28"),"2027-01-03");
  assert.throws(()=>billing.thailandWeekEnd("2026-11-03"),/BILLING_WEEK_MUST_START_MONDAY/);
  assert.throws(()=>billing.thailandWeekStart("2026-02-30"),/INVALID_BILLING_DATE/);
});
test("customer and week grouping keeps bookings distinct and ordered", () => {
  const rows=[booking("b","A","2026-11-08","WO-2"),booking("c","B","2026-11-03","WO-3"),booking("a","A","2026-11-02","WO-1"),booking("d","A","2026-11-09","WO-4")];
  assert.deepEqual(billing.customerWeekBookings(rows,"A","2026-11-02").map((row)=>row.id),["a","b"]);
});
test("draft totals use integer satang and reject duplicate, held and invalid lines", () => {
  const rows=[{booking:{id:"a"},ready:true,selling_price_thb:8000.1},{booking:{id:"b"},ready:true,selling_price_thb:24200.2},{booking:{id:"c"},ready:false,selling_price_thb:null}];
  assert.equal(billing.draftTotalCents(rows,["a","b"]),3220030);
  assert.throws(()=>billing.draftTotalCents(rows,["a","a"]),/INVALID_DRAFT_SELECTION/);
  assert.throws(()=>billing.draftTotalCents(rows,["c"]),/BILLING_JOB_NOT_READY/);
  assert.throws(()=>billing.draftTotalCents(rows,["a","missing"]),/BILLING_JOB_NOT_READY/);
  assert.throws(()=>billing.thbToCents(0.001),/INVALID_BILLING_AMOUNT/);
});
test("billing candidate lookup is read-only and preserves booking UUID association", async () => {
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{ready:args.p_booking_id==="a",hold:args.p_booking_id==="a"?null:"price_approval",selling_price_thb:1000,price_revision_id:"p",allocated_draft_id:null},error:null};}};
  const result=await billing.loadBillingCandidates(client,[booking("a","A","2026-11-02","WO-1"),booking("b","A","2026-11-03","WO-2")],"draft-1");
  assert.deepEqual(result.map((row)=>[row.booking.id,row.ready]),[["a",true],["b",false]]);
  assert.deepEqual(calls.map((call)=>call[0]),["finance_billing_candidate","finance_billing_candidate"]);
  assert.ok(calls.every((call)=>call[1].p_draft_id==="draft-1"));
});
test("every weekly action, hold and error has English and Thai copy", () => {
  for (const lang of ["en","th"]) {
    for (const key of ["title","customer","week","workOrder","route","driver","vehicle","sellingPrice","priceSource","sourcePrice","overrideReason","breakdown","total","select","remove","up","down","create","revise","cancel","stale","history","conflict","unchanged","saveError","demoWarning","paperwork","verification"]) assert.ok(copy[lang][key],`${lang}.${key}`);
    for (const hold of ["booking_missing","allocated","management_hold","paperwork_or_verification","price_missing","price_approval","expense_approval","booking_or_price_changed"]) assert.ok(copy[lang].holds[hold],`${lang}.${hold}`);
  }
  const page=fs.readFileSync("app/(dashboard)/weekly-billing/page.tsx","utf8");
  assert.match(page,/finance_create_weekly_draft/);
  assert.match(page,/finance_amend_weekly_draft/);
  assert.match(page,/p_expected_revision/);
  assert.doesNotMatch(page,/service_role|supabaseAdmin|issue_trn|invoice_issuance/);
});
