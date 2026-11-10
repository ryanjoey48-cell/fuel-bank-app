const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const formatSource = fs.readFileSync("lib/finance-format.ts", "utf8");
const formatModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(formatSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(formatModule, formatModule.exports);

test("THB formatter preserves cents and renders absent or invalid amounts as unknown", () => {
  const { formatThb } = formatModule.exports;
  assert.equal(formatThb(1234.5), "฿1,234.50");
  assert.equal(formatThb("0"), "฿0.00");
  assert.equal(formatThb(null), "—");
  assert.equal(formatThb("not-a-number"), "—");
});

test("Finance billing screens use readable currency and route/date separators in both languages", () => {
  const pages = [
    "app/(dashboard)/weekly-billing/page.tsx",
    "app/(dashboard)/finance-cost-pricing/page.tsx",
    "app/(dashboard)/invoice-approval/page.tsx"
  ].map((file) => fs.readFileSync(file, "utf8"));
  for (const page of pages) {
    assert.match(page, /formatThb/);
    assert.doesNotMatch(page, /\?{4,}|\?\$\{|pickup\} \? \{|week\} \? \{/);
    assert.doesNotMatch(page, /""/);
  }
  assert.match(pages[0], /อนุมัติใบแจ้งหนี้/);
  assert.match(pages[0], /ชุดเอกสาร/);
  assert.match(pages[1], /วางบิลรายสัปดาห์/);
});

test("Finance demo shows historical collections separately from customer selling price", () => {
  const model = fs.readFileSync("lib/finance-demo-centre.ts", "utf8");
  const workspace = fs.readFileSync("components/finance-centre-workspace.tsx", "utf8");
  assert.match(model, /collection: \{ amount: row\.totalCollected, source: "workbook", confirmed: false \}/);
  assert.match(model, /job!\.collection\.confirmed = true/);
  assert.match(model, /customerTotal\(job: Booking\)/);
  assert.match(workspace, /Recorded total collected · source workbook/);
  assert.match(workspace, /never sets the customer selling price/);
});

test("owner walkthrough reserves returned paperwork and verification for Admin", () => {
  const model = fs.readFileSync("lib/finance-demo-centre.ts", "utf8");
  const workspace = fs.readFileSync("components/finance-centre-workspace.tsx", "utf8");
  const picker = fs.readFileSync("components/finance-booking-diary-picker.tsx", "utf8");
  assert.match(model, /export type Role = "office" \| "admin"/);
  assert.match(workspace, /admin: \{ en: "Admin"/);
  assert.match(workspace, /canAdd=\{canAddDiaryWorkOrder && hydrateReady && !accessLoading\}/);
  assert.match(workspace, /canUseFinanceAdminIntake\(access, role, isFinanceFixtureMode\(\)\)/);
  assert.match(picker, /Admin access required/);
});
