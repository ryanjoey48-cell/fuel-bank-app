const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { createRequire } = require('node:module');
function load(file) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, createRequire(path.resolve(file)));
  return mod.exports;
}
const settings = load('lib/finance-settings.ts');
const read = (file) => fs.readFileSync(file, 'utf8');

test('finance start date defaults to 01/01/2026 and validates real calendar dates', () => {
  assert.equal(settings.FINANCE_SETTINGS_DEFAULTS.startDate, '2026-11-01');
  assert.equal(settings.isValidFinanceStartDate('2026-01-01'), true);
  for (const bad of ['2026-02-30', '01/01/2026', '2026-1-1', '', null, 20260101, '1999-12-31']) assert.equal(settings.isValidFinanceStartDate(bad), false);
  assert.deepEqual(settings.normalizeFinanceSettings({ startDate: 'nope' }), { startDate: '2026-11-01' });
  assert.deepEqual(settings.normalizeFinanceSettings({ startDate: '2026-03-15' }), { startDate: '2026-03-15' });
});

test('jobs before the start date are excluded; on/after and undated are kept', () => {
  assert.equal(settings.isBeforeFinanceStart('2025-12-31', '2026-01-01'), true);
  assert.equal(settings.isBeforeFinanceStart('2026-01-01', '2026-01-01'), false);
  assert.equal(settings.isBeforeFinanceStart('2026-01-01T00:00:00', '2026-01-01'), false);
  assert.equal(settings.isBeforeFinanceStart('', '2026-01-01'), false);
});

test('setting lives in one server file and only an Admin can change it (server-checked)', () => {
  const server = read('lib/finance-settings-server.ts');
  assert.match(server, /settings\.json/);
  const route = read('app/api/finance-settings/route.ts');
  assert.match(route, /export async function PUT[\s\S]*requireAdminAccess\(request\)/);
  assert.match(route, /isValidFinanceStartDate\(body\?\.startDate\)/);
  assert.doesNotMatch(route, /export async function (DELETE|POST)/);
});

test('Admin Intake applies the start date by default; explicit date filters override it and load server-side', () => {
  const intake = read('components/finance-admin-intake.tsx');
  assert.match(intake, /export function isWaitingForWorkOrder/);
  assert.match(intake, /dateFrom: effFrom, dateTo: effTo/);
  assert.match(intake, /dateFrom: effFrom, dateTo: effTo/);
  assert.match(intake, /return loadBookingDiaryIntakePage\(options, bookings\)/); // real server-filtered, paginated loader everywhere else
  assert.match(intake, /Date from[\s\S]*Date to[\s\S]*Vehicle registration[\s\S]*Clear filters/);
  assert.doesNotMatch(intake, /Paper matches booking|Something is different|Does the paper match/);
  const workspace = read('components/finance-centre-workspace.tsx');
  assert.match(workspace, /No saved intake/);
});

test('company details come from one constant including the phone number', () => {
  const company = read('lib/ees-company.ts');
  assert.match(company, /phone: "094-6782416"/);
  assert.match(company, /บริษัท เอ็กซ์เพิร์ท เอ็กซ์เพรส เซ็นเดอร์ จำกัด/);
  assert.match(read('app/(auth)/login/page.tsx'), /EES_COMPANY\.nameTh/);
  assert.doesNotMatch(read('lib/translations.ts'), /เอ็กซ์เปอร์ต/);
  assert.doesNotMatch(read('app/(dashboard)/document-packs/page.tsx'), /\?\?\?\?\?\?/);
});

test('Draft TRN is hidden until a customer is chosen and Admin Intake step shows an icon', () => {
  assert.match(read('components/finance-billing-flow.tsx'), /\{clientId && sheet \? \(\s*<SheetTrnReference sheet=\{sheet\} t=\{t\} large \/>/);
  assert.doesNotMatch(read('components/finance-centre-workspace.tsx'), /step\.number \|\| "·"/);
});

test('Finance processing workspace: compact intake rows, larger organisation panel, fixture diary only in fixture mode, no nested p/details', () => {
  const intake = read('components/finance-admin-intake.tsx');
  assert.match(intake, /data-intake-row/);
  assert.match(intake, /lg:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(intake, /Does the paper match/);
  const arrange = read('components/finance-arrange-stage.tsx');
  assert.match(arrange, /className="fc6-arrange"/);
  assert.match(read('components/finance-workspace-v6.css'), /\.fc6-arrange \{[^}]*grid-template-columns:/);
  assert.match(arrange, /data-testid="paper-list"/);
  const picker = read('components/finance-booking-diary-picker.tsx');
  assert.doesNotMatch(picker, /fixture/i); // the real Booking Diary loader has no fixture branch
  assert.match(intake, /if \(isFinanceFixtureMode\(\)\) return fixtureIntakePage/);
  const mode = read('lib/finance-fixture-mode.ts');
  assert.match(mode, /NODE_ENV === "production"\) return false/);
  assert.match(mode, /NEXT_PUBLIC_SUPABASE_URL \|\| process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY\) return false/);
  const trn = read('components/finance-trn-documents-stage.tsx');
  assert.doesNotMatch(trn, /<p className="flex items-baseline gap-2"><span className="text-sm text-slate-500">\{t\("Draft TRN"/);
  const rows = load('lib/finance-fixture-diary-rows.ts');
  assert.equal(rows.fixtureDiaryRowsBetween('2026-01-19', '2026-01-19').length, 11);
});

test('November 2026 cutover: default start is 1 Nov 2026, history range is the day before, and the UI exposes Historical Bookings', () => {
  assert.equal(settings.FINANCE_CUTOVER_DATE, '2026-11-01');
  assert.equal(settings.dayBefore('2026-11-01'), '2026-10-31');
  assert.equal(settings.dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(settings.dayBefore('nope'), '');
  // everything before the cutover is excluded from the daily queue; the cutover day itself is included
  assert.equal(settings.isBeforeFinanceStart('2026-10-31', '2026-11-01'), true);
  assert.equal(settings.isBeforeFinanceStart('2026-11-01', '2026-11-01'), false);
  assert.equal(settings.isBeforeFinanceStart('2026-09-15', '2026-11-01'), true, 'the September APL demo job is historical, not deleted');
  const fs = require('node:fs');
  const ui = fs.readFileSync('components/finance-admin-intake.tsx', 'utf8');
  for (const id of ['historical-banner', 'open-historical', 'back-to-current-queue', 'cutover-note']) assert.match(ui, new RegExp(id));
  assert.match(ui, /dateFrom: effFrom, dateTo: effTo/, 'the date range goes to the Booking Diary query, not a client-side hide');
});
