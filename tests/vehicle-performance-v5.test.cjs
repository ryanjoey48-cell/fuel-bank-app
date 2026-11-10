const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { lib } = require('./helpers/invoice-compare.cjs');
const f = lib('vehicle-performance-financial.ts');
const { loadVehicleSourceReports } = lib('vehicle-performance-source-reports.ts');
const reports = loadVehicleSourceReports();

test('all 42 source rows have unique registrations and nine exact published controls', () => {
  for (const report of reports) {
    assert.equal(report.rows.length, 21);
    assert.equal(new Set(report.rows.map(r => r.registration)).size, 21);
    const fleet = f.fleetFinancials(report);
    assert.equal(fleet.reconciled, true);
    assert.ok(fleet.differences.every(d => d.difference === 0));
  }
  assert.equal(f.fleetFinancials(reports[0]).aggregateBalance, 180509700);
  assert.equal(f.fleetFinancials(reports[1]).aggregateBalance, 181408589);
});

test('all source dash cells stay unknown except documented non-LPG applicability', () => {
  for (const report of reports) for (const row of report.rows) {
    for (const field of f.SOURCE_FIELDS) {
      const cell = row.cells[field];
      if (cell.sourceDash) {
        if (field === 'lpg' && row.registration !== 'ฒอ-8453') {
          assert.equal(cell.status, 'not_applicable'); assert.equal(cell.value, '0');
        } else { assert.equal(cell.status, 'unknown'); assert.equal(cell.value, null); }
      }
    }
  }
  const row = reports[0].rows.find(r => r.registration === '3ฒล-4565');
  assert.equal(row.cells.jobs.status, 'recorded_zero');
  assert.equal(row.cells.totalReceived.status, 'unknown');
  assert.equal(row.identityReview, true);
  const result = f.vehicleFinancials(row);
  assert.equal(result.balance, null); assert.equal(result.knownCosts, 2392000);
  assert.equal(result.status, 'revenue_unconfirmed');
  assert.equal(f.fleetFinancials(reports[0]).balanceBridge, 2392000);
});

test('August completeness and September salary verification prevent false confirmed profit', () => {
  const august = f.fleetFinancials(reports[0]);
  assert.equal(august.confirmedCount, 7);
  assert.equal(august.provisionalCount, 13);
  assert.equal(august.unconfirmedRevenueCount, 1);
  const september = f.fleetFinancials(reports[1]);
  assert.equal(september.confirmedCount, 0);
  assert.equal(september.provisionalCount, 21);
  assert.ok(reports[1].rows.every(r => r.salaryProvisional));
  assert.equal(august.totals.salary, 15950000);
  assert.equal(september.totals.salary, 15950000);
});

test('79-5318 deducts each of seven categories exactly once with precise decimals', () => {
  const row = reports[1].rows.find(r => r.registration === '79-5318');
  const result = f.vehicleFinancials(row);
  assert.equal(result.knownCosts, 13328900);
  assert.equal(result.balance, 14546700);
  assert.equal(result.revenuePerJob, 714759);
  assert.equal(result.costPerJob, 341767);
  const lpg = reports[1].rows.find(r => r.registration === 'ฒอ-8453');
  assert.equal(f.vehicleFinancials(lpg).knownCosts, 2557231);
  assert.equal(f.vehicleFinancials(lpg).balance, 3649669);
  assert.equal(f.satang('0.105'), 11);
  assert.equal(f.satang('1341198.80'), 134119880);
  assert.equal(f.decimal(-2392000), '-23920.00');
});

test('unknown costs yield a provisional balance; explicit zeros can be confirmed', () => {
  const row = structuredClone(reports[0].rows[0]);
  assert.equal(f.vehicleFinancials(row).status, 'provisional');
  for (const field of f.COST_FIELDS) row.cells[field] = { value: '0', status: 'recorded_zero', sourceDash: false };
  assert.equal(f.vehicleFinancials(row).status, 'confirmed');
  assert.equal(f.vehicleFinancials(row).balance, 13996000);
  row.cells.salary.value = '200000';
  assert.equal(f.vehicleFinancials(row).balance, -6004000);
});

test('all sorting options place unconfirmed revenue last in both directions', () => {
  for (const key of ['balance', 'revenue', 'jobs', 'margin', 'knownCosts']) for (const ascending of [true, false]) {
    const sorted = f.sortFinancialRows(reports[0].rows, key, ascending);
    assert.equal(sorted.at(-1).registration, '3ฒล-4565');
    assert.equal(sorted.length, 21);
  }
});

test('local adjustments require evidence, preserve source and disallow N/A revenue', () => {
  const report = reports[0];
  const before = JSON.stringify(report);
  const adjustment = { id: 'test', userId: 'admin', month: 8, registration: report.rows[0].registration, field: 'expenses', kind: 'amount', value: '123.45', reason: 'Verified receipt R001', createdAt: '2026-11-09T10:00:00Z', sourceSha256: report.sourceSha256 };
  assert.equal(f.validateAdjustment(adjustment, report), true);
  assert.equal(f.validateAdjustment({ ...adjustment, value: '-1' }, report), false);
  assert.equal(f.validateAdjustment({ ...adjustment, reason: '' }, report), false);
  assert.equal(f.validateAdjustment({ ...adjustment, sourceSha256: 'wrong' }, report), false);
  assert.equal(f.validateAdjustment({ ...adjustment, field: 'salary' }, report), false);
  assert.equal(f.validateAdjustment({ ...adjustment, kind: 'not_applicable', value: null }, report), true);
  assert.equal(f.validateAdjustment({ ...adjustment, registration: '3ฒล-4565', field: 'totalReceived', kind: 'not_applicable', value: null }, report), false);
  assert.equal(JSON.stringify(report), before);
});

test('source files match SHA-256 of the PDFs inspected for this release', () => {
  const crypto = require('node:crypto');
  for (const report of reports) {
    const data = fs.readFileSync(`data/vehicle-performance-v4/source-reports/${report.sourceFile}`);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), report.sourceSha256);
  }
});

test('source route is authorized and private; V6 amendments use only the audited local store', () => {
  const route = fs.readFileSync('app/api/vehicle-performance-v5/route.ts', 'utf8');
  assert.match(route, /requireVerifiedUser\(request\)/);
  assert.match(route, /canUseVehicleFinancialDrafts\(access, 'read'\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /isAdminRole\(access.role\)/);
  assert.match(route, /saveVehicleFinancialChanges/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|DELETE)|\.insert\(|\.update\(|\.upsert\(/);
});

test('source route enforces authentication and financial access before disclosing 42 source rows', async () => {
  const ts = require('typescript');
  class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const filename = 'app/api/vehicle-performance-v5/route.ts';
  function route(mode) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireFixture = name => {
      if (name === 'next/server') return require(name);
      if (name.includes('admin-user-management-server')) return { AdminApiError, requireVerifiedUser: async () => { if (mode === 'unauthenticated') throw new AdminApiError(401, 'Authentication required'); return { id: 'test-only' }; }, createServerSupabaseAdmin: () => ({}), resolveAccountAccess: async () => ({ role: mode }) };
      if (name.includes('vehicle-financial-draft-access')) return { canUseVehicleFinancialDrafts: () => mode === 'authorized' };
      if (name.includes('vehicle-performance-source-reports')) return { loadVehicleSourceReports };
      if (name.includes('vehicle-performance-adjustments-server')) return { readVehicleFinancialWorkspace: async () => ({ reports: loadVehicleSourceReports(), sources: loadVehicleSourceReports(), history: [], writesEnabled: true }) };
      if (name === '@/lib/authorization') return lib('authorization.ts');
      throw new Error(name);
    };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, requireFixture);
    return module.exports;
  }
  const request = new Request('http://localhost:3000/api/vehicle-performance-v5');
  assert.equal((await route('unauthenticated').GET(request)).status, 401);
  assert.equal((await route('read_only').GET(request)).status, 403);
  const response = await route('authorized').GET(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const payload = await response.json();
  assert.equal(payload.reports.flatMap(r => r.rows).length, 42);
  assert.equal(payload.writesEnabled, false);
});
