const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const access = h.lib('finance-intake-access.ts');

function load(file, deps) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', js)(module, module.exports, name => deps[name] || require(name));
  return module.exports;
}

test('pricing administration cannot be unlocked by a selected client-side role outside the isolated fixture', () => {
  for (const role of ['admin', 'super_admin', 'approver', 'finance', 'office']) assert.equal(access.canManageFinancePricing(null, role, false), false);
  assert.equal(access.canManageFinancePricing({ role: 'admin', status: 'active' }, 'office', false), true);
  assert.equal(access.canManageFinancePricing({ role: 'admin', status: 'suspended' }, 'super_admin', false), false);
  assert.equal(access.canManageFinancePricing(null, 'admin', true), true);
  assert.equal(access.canManageFinancePricing(null, 'office', true), false);
});

test('server access uses the administrator verifier; the fixture exception is development-only and credential-free', async () => {
  let calls = 0;
  const request = new Request('http://localhost/api/finance-pricing-admin/access');
  const guard = load('lib/finance-pricing-admin-server.ts', { '@/lib/admin-user-management-server': { requireAdminAccess: async received => { calls++; assert.equal(received, request); throw Object.assign(new Error('Administrator permission required'), { status: 403 }); } } });
  const fixture = { NODE_ENV: 'development', EES_FINANCE_DEMO_ONLY: '1', NEXT_PUBLIC_EES_FINANCE_FIXTURE: '1' };
  assert.equal(guard.isIsolatedFinancePricingFixture(fixture), true);
  for (const patch of [{ NODE_ENV: 'production' }, { EES_FINANCE_DEMO_ONLY: undefined }, { NEXT_PUBLIC_EES_FINANCE_FIXTURE: undefined }, { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid' }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-key' }, { SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' }, { NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL: '1' }]) assert.equal(guard.isIsolatedFinancePricingFixture({ ...fixture, ...patch }), false);
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await assert.rejects(guard.requireFinancePricingAdminAccess(request), error => error.status === 403); assert.equal(calls, 1); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test('access endpoint preserves denied/error statuses and never returns an allowed response on failure', async () => {
  class AdminApiError extends Error { constructor(status) { super('Denied'); this.status = status; } }
  const route = authorize => load('app/api/finance-pricing-admin/access/route.ts', { '@/lib/admin-user-management-server': { AdminApiError }, '@/lib/finance-pricing-admin-server': { requireFinancePricingAdminAccess: authorize } });
  const request = new Request('http://localhost/api/finance-pricing-admin/access');
  for (const status of [401, 403]) { const response = await route(async () => { throw new AdminApiError(status); }).GET(request); assert.equal(response.status, status); assert.equal((await response.json()).allowed, undefined); }
  const ok = await route(async () => ({ allowed: true, fixture: false })).GET(request);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal((await ok.json()).allowed, true);
  assert.equal((await route(async () => { throw new Error('Connection failed'); }).GET(request)).status, 500);
});

test('moving pricing presentation does not bypass missing-price review/approval or enable official issuance', () => {
  let state = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), { id: 'v61-unpriced', client_id: 'v61-client', client_name: 'Isolated fixture', booking_date: '2026-11-09', pickup: 'Fixture pickup', dropoff: 'Fixture delivery' }, 'V61-8001', 'admin');
  state = f.applyAction(state, { type: 'sheet_create', clientId: 'v61-client' }, 'finance');
  const sheetId = state.billingSheets.at(-1).id;
  state = f.applyAction(state, { type: 'sheet_add_paper', sheetId, workOrder: 'V61-8001' }, 'finance');
  assert.equal(f.sheetSummary(state, state.billingSheets[0]).missingPrices, 1);
  assert.throws(() => f.applyAction(state, { type: 'sheet_mark_ready', sheetId }, 'finance'), /FINANCE_SHEET_NOT_READY/);
  assert.throws(() => f.applyAction(state, { type: 'sheet_approve', sheetId }, 'approver'));
  assert.equal(h.lib('finance-issuance-gate.ts').isOfficialIssuanceEnabled(), false);
});
