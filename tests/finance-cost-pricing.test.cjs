const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function load(file) { const m = { exports: {} }; new Function("module", "exports", ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports); return m.exports; }
const model = load("lib/finance-cost-pricing.ts"), copy = load("lib/finance-cost-pricing-copy.ts").costPricingCopy;
const expense = (id, delta) => ({ id, amount_delta: delta });
const revision = (id, at) => ({ id, created_at: at });

test("all expense categories and Thai and English interface terms are present", () => {
  assert.deepEqual(model.expenseCategories, ["driver_trip", "toll", "parking", "overtime", "container_pickup", "overnight", "other"]);
  for (const language of ["en", "th"]) {
    for (const key of ["title", "expenses", "pricing", "receipt", "missingReason", "overrideReason", "approval", "ready", "blocked", "saveFailed", "invalidAmount", "reasonRequired"]) assert.ok(copy[language][key], `${language}.${key}`);
    for (const category of model.expenseCategories) assert.ok(copy[language].categories[category]);
  }
});
test("THB amounts require whole satang and approved expense totals keep corrections separate", () => {
  assert.equal(model.parseThb("123.45"), 123.45);
  for (const amount of ["12.345", "-1", "1e3", "", "10000000000"]) assert.throws(() => model.parseThb(amount), /INVALID_THB_AMOUNT/);
  assert.equal(model.expenseTotal([expense("a", 100), expense("b", -25), expense("c", 50)], [{ event_id: "a", decision: "approved" }, { event_id: "b", decision: "approved" }]), 75);
});
test("effective customer price is chosen by route, customer and booking date", () => {
  const rows = [
    { id: "old", client_id: "a", route_key: "Depot → Port", effective_from: "2026-01-01" },
    { id: "current", client_id: "a", route_key: "Depot → Port", effective_from: "2026-07-01" },
    { id: "future", client_id: "a", route_key: "Depot → Port", effective_from: "2027-01-01" },
    { id: "other", client_id: "b", route_key: "Depot → Port", effective_from: "2026-07-01" }
  ];
  assert.equal(model.effectivePriceList(rows, "a", "Depot → Port", "2026-09-01").id, "current");
  assert.equal(model.effectivePriceList(rows, "a", "Other", "2026-09-01"), null);
});
test("finance readiness blocks verification holds, latest unapproved price and unapproved expenses", () => {
  const prices = [revision("old", "2026-01-01"), revision("new", "2026-09-01")];
  const decisions = [{ revision_id: "old", decision: "approved" }, { revision_id: "new", decision: "approved" }];
  const expenses = [expense("one", 100)];
  const approved = [{ event_id: "one", decision: "approved" }];
  assert.equal(model.pricingReady(true, false, prices, decisions, expenses, approved), true);
  assert.equal(model.pricingReady(false, false, prices, decisions, expenses, approved), false);
  assert.equal(model.pricingReady(true, true, prices, decisions, expenses, approved), false);
  assert.equal(model.pricingReady(true, false, prices, decisions.slice(0, 1), expenses, approved), false);
  assert.equal(model.pricingReady(true, false, prices, decisions, expenses, []), false);
});
test("real screen remains in dashboard and calls only finance RPCs for mutations", () => {
  const page = fs.readFileSync("app/(dashboard)/finance-cost-pricing/page.tsx", "utf8");
  assert.match(page, /fetchBookingDiaryEntries/);
  assert.match(page, /finance_record_expense/);
  assert.match(page, /finance_propose_job_price/);
  assert.match(page, /finance_decide_job_price/);
  assert.doesNotMatch(page, /service_role|supabaseAdmin|\.insert\(|\.update\(/);
});
