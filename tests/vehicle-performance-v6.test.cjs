const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { lib } = require('./helpers/invoice-compare.cjs');
const f = lib('vehicle-performance-financial.ts');
const server = lib('vehicle-performance-adjustments-server.ts');
const { loadRoute } = require('./helpers/vehicle-v6-route.cjs');
const api = loadRoute();
const sources = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();
const fresh = () => { fs.mkdirSync('tmp/vehicle-v6-tests', { recursive: true }); process.env.EES_VEHICLE_FINANCIAL_STORE_DIR = fs.mkdtempSync(path.resolve('tmp/vehicle-v6-tests/store-')); return process.env.EES_VEHICLE_FINANCIAL_STORE_DIR; };
const request = (method, body, token = 'vp6-admin') => new Request('http://localhost/api/vehicle-performance-v5', { method, headers: token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
const put = (changes, token) => api.PUT(request('PUT', { changes }, token));
const change = (report, registration, field, value, kind = value == null ? 'unknown' : 'amount') => ({ year: report.year, month: report.month, registration, field, value, kind, expected: report.rows.some(r => r.registration === registration) ? f.financialCellVersion(report, report.rows.find(r => r.registration === registration), field) : report.sourceSha256 });

test('V8 owner-approved projection reports balances for all 21 vehicles including blank costs', () => {
  const august = sources[0];
  const projected = f.v6ReportsAsDashboardProjection([august], [8]);
  assert.equal(projected.records.length, 21);
  assert.equal(projected.fuelRows.length, 21);
  assert.equal(projected.meta.length, 21);
  const hero = f.v6FleetHeroTotals(august);
  assert.equal(hero.revenueBaht, 3581914);
  assert.equal(Math.round(hero.balanceBaht * 100), 180509700);
  assert.equal(Number(hero.marginPercent.toFixed(2)), 50.39);
  assert.equal(hero.vehicleCount, 21);
  assert.equal(hero.provisional, false);
  assert.equal(hero.incompleteCount, 0);
  assert.ok(projected.meta.every(row => Number.isFinite(row.recordedBalanceBaht)));
  const review = projected.meta.find(row => row.registration === '3ฒล-4565');
  assert.equal(review.status, 'review');
  assert.equal(review.sourceRevenueBlank, true);
  assert.equal(review.marginPercent, null);
  assert.ok(Number.isFinite(review.recordedBalanceBaht));
  const reported = projected.meta.find(row => row.status === 'reported');
  assert.ok(reported);
  const record = projected.records.find(row => row.vehicle_registration === reported.registration);
  const fuel = projected.fuelRows.find(r => r.vehicleRegistration === reported.registration).fuelSpend;
  assert.ok(Math.abs(record.gross_revenue - record.salary_cost - record.trip_income - record.other_expenses - record.lpg_cost - fuel - reported.recordedBalanceBaht) < 0.001);
});

test('all 21 rows and immutable August/September source controls remain exact', () => {
  const expected = [
    ['159500', '666', '314550', '47415', '42130', '3581914', '1178269.90', '7292.10', '27660', 180509700, 50.39],
    ['159500', '643', '299650', '45574', '46740', '3819401', '1341198.80', '7962.31', '104690', 181408589, 47.50]
  ];
  for (const [i, report] of sources.entries()) {
    assert.equal(report.rows.length, 21);
    assert.equal(new Set(report.rows.map(row => row.registration)).size, 21);
    f.SOURCE_FIELDS.forEach((field, n) => assert.equal(f.satang(report.controls[field]), f.satang(expected[i][n]), field));
    const fleet = f.operationalFleetFinancials(report);
    assert.equal(fleet.balance, expected[i][9]);
    assert.equal(Number(fleet.margin.toFixed(2)), expected[i][10]);
    assert.ok(report.rows.every(row => Number.isFinite(f.reportedVehicleFinancials(row).balance)));
    assert.ok(report.rows.some(row => row.registration === '3ฒล-4565'));
    const blanks = report.rows.flatMap(row => f.COST_FIELDS.filter(field => row.cells[field].value == null));
    assert.ok(blanks.length > 0);
    for (const row of report.rows) {
      for (const field of f.COST_FIELDS) {
        if (row.cells[field].status === 'unknown') assert.equal(row.cells[field].value, null);
      }
    }
  }
});

test('exact seven-cost formula treats blank as zero contribution without rewriting source; zero stays zero', () => {
  const row = structuredClone(sources[0].rows.find(row => row.registration === 'ฒอ-8453'));
  for (const field of f.COST_FIELDS) row.cells[field] = { value: '0.10', status: 'recorded', sourceDash: false };
  row.cells.totalReceived = { value: '10.00', status: 'recorded', sourceDash: false };
  row.cells.jobs = { value: '99999', status: 'recorded', sourceDash: false };
  const m = f.operationalVehicleFinancials(row);
  assert.equal(m.knownCosts, 70); assert.equal(m.balance, 930); assert.equal(m.margin, 93); assert.equal(m.reportingStatus, 'reported');
  row.cells.maintenance = { value: null, status: 'unknown', sourceDash: true };
  const blank = f.operationalVehicleFinancials(row);
  assert.equal(blank.balance, 940);
  assert.equal(blank.confirmed, true);
  assert.deepEqual(blank.sourceUnreportedCosts, ['maintenance']);
  assert.equal(row.cells.maintenance.value, null);
  assert.equal(row.cells.maintenance.status, 'unknown');
  row.cells.maintenance = { value: '0.00', status: 'recorded_zero', sourceDash: true };
  assert.equal(f.operationalVehicleFinancials(row).balance, 940);
  assert.equal(f.operationalVehicleFinancials(row).sourceUnreportedCosts.length, 0);
  row.cells.totalReceived = { value: null, status: 'unknown', sourceDash: true };
  const noRevenue = f.operationalVehicleFinancials(row);
  assert.equal(noRevenue.balance, -60);
  assert.equal(noRevenue.margin, null);
  assert.equal(noRevenue.fuelPercent, null);
  assert.equal(noRevenue.sourceRevenueBlank, true);
});

test('validated amounts retain two decimals, whole jobs, blank unknowns, and safe precision', () => {
  assert.equal(f.normalizeFinancialInput('maintenance', '0'), '0.00');
  assert.equal(f.normalizeFinancialInput('maintenance', ''), null);
  assert.equal(f.normalizeFinancialInput('maintenance', '1234.5'), '1234.50');
  assert.equal(f.normalizeFinancialInput('jobs', '002'), '2');
  for (const bad of ['-1', '1.111', '1e3', 'NaN', 'Infinity', '1,000', '100000001']) assert.throws(() => f.normalizeFinancialInput('maintenance', bad));
  assert.throws(() => f.normalizeFinancialInput('jobs', '1.5'));
});

test('save, disk reread and process restart use effective values; months and source files stay independent', async () => {
  const dir = fresh(), original = JSON.stringify(sources);
  const report = sources[0], registration = '79-5318';
  const previous = report.rows.find(r => r.registration === registration).cells.maintenance.value;
  const response = await put([change(report, registration, 'maintenance', '123.45')]);
  assert.equal(response.status, 200); const payload = await response.json();
  assert.equal(payload.savedCount, 1);
  const saved = payload.reports[0].rows.find(r => r.registration === registration);
  assert.equal(saved.cells.maintenance.value, '123.45');
  assert.equal(f.operationalFleetFinancials(payload.reports[0]).balance, f.operationalFleetFinancials(report).balance + (previous == null ? 0 : f.satang(previous)) - 12345);
  assert.deepEqual(payload.reports[1], sources[1]);
  assert.equal(JSON.stringify(sources), original);
  const entry = payload.history[0];
  assert.equal(entry.previousValue, previous); assert.equal(entry.value, '123.45'); assert.equal(entry.year, 2026); assert.equal(entry.month, 8);
  assert.equal(entry.userId, 'vp6-admin-fixture-user'); assert.ok(Date.parse(entry.createdAt)); assert.equal(entry.registration, registration); assert.equal(entry.field, 'maintenance');
  assert.equal((await server.readVehicleFinancialWorkspace()).reports[0].rows.find(r => r.registration === registration).cells.maintenance.value, '123.45');
  const child = spawnSync(process.execPath, ['-e', "require('./tests/helpers/invoice-compare.cjs').lib('vehicle-performance-adjustments-server.ts').readVehicleFinancialWorkspace().then(w=>console.log(w.reports[0].rows.find(r=>r.registration==='79-5318').cells.maintenance.value))"], { cwd: process.cwd(), env: { ...process.env, EES_VEHICLE_FINANCIAL_STORE_DIR: dir }, encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), '123.45');
});

test('explicit zero, cleared costs and N/A persist; non-LPG vehicles require no forced zeros', async () => {
  fresh(); let report = sources[0]; const registration = '79-5318';
  for (const [value, kind, status] of [['0.00', 'amount', 'recorded_zero'], [null, 'unknown', 'unknown'], [null, 'not_applicable', 'not_applicable']]) {
    const response = await put([change(report, registration, 'maintenance', value, kind)]);
    assert.equal(response.status, 200); report = (await response.json()).reports[0];
    const row = report.rows.find(r => r.registration === registration);
    assert.equal(row.cells.maintenance.status, status);
    assert.equal(row.cells.maintenance.value, kind === 'unknown' ? null : '0.00');
  }
  assert.equal((await put([change(report, registration, 'lpg', '1.00')])).status, 400);
  assert.equal((await put([change(report, registration, 'totalReceived', null, 'not_applicable')])).status, 400);
  assert.equal((await put([change(report, 'ฒอ-8453', 'lpg', '5.50')])).status, 200);
});

test('blank August revenue for 3ฒล-4565 contributes zero and stays Review; saved revenue takes precedence', async () => {
  fresh(); const registration = '3ฒล-4565';
  const source = sources[0].rows.find(r => r.registration === registration);
  const baseline = f.operationalVehicleFinancials(source);
  assert.equal(baseline.revenue, 0);
  assert.equal(baseline.margin, null);
  assert.equal(baseline.reportingStatus, 'review');
  assert.ok(Number.isFinite(baseline.balance));
  assert.equal(source.cells.totalReceived.value, null);
  const changes = [change(sources[0], registration, 'totalReceived', '10000.00')];
  for (const field of f.COST_FIELDS.filter(field => source.cells[field].status === 'unknown')) changes.push(change(sources[0], registration, field, null, 'not_applicable'));
  const response = await put(changes); assert.equal(response.status, 200);
  const row = (await response.json()).reports[0].rows.find(r => r.registration === registration);
  assert.equal(row.identityReview, true);
  assert.equal(f.operationalVehicleFinancials(row).reportingStatus, 'review');
  assert.ok(f.operationalVehicleFinancials(row).balance < 1000000);
});

test('per-cell optimistic conflicts prevent lost edits across users/processes, while independent cells merge', async () => {
  fresh(); const report = sources[0], reg = '79-5318';
  const responses = await Promise.all([put([change(report, reg, 'maintenance', '1.00')]), put([change(report, reg, 'maintenance', '2.00')])]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const conflict = await responses.find(r => r.status === 409).json(); assert.deepEqual(conflict.cells, [f.financialCellKey(8, reg, 'maintenance')]);
  assert.equal((await put([change(report, reg, 'expenses', '3.00')])).status, 200);
  assert.equal((await put([change(sources[1], reg, 'maintenance', '4.00')])).status, 200);
  assert.equal((await server.readVehicleFinancialWorkspace()).history.length, 3);
});

test('invalid batches are atomic and cannot write arbitrary fields, identities, years or fractions of jobs', async () => {
  fresh(); const original = await server.readVehicleFinancialWorkspace();
  for (const bad of [change(sources[0], '79-5318', 'jobs', '1.5'), { ...change(sources[0], '79-5318', 'maintenance', '1.00'), field: '../../file' }, { ...change(sources[0], '79-5318', 'maintenance', '1.00'), year: 2025 }, change(sources[0], 'unknown-registration', 'maintenance', '1.00')]) {
    const response = await put([change(sources[0], '79-5318', 'salary', '1.00'), bad]); assert.equal(response.status, 400);
    assert.deepEqual(await server.readVehicleFinancialWorkspace(), original);
  }
});

test('separate server processes cannot both commit a stale edit to the shared file', async () => {
  const dir = fresh();
  const run = value => new Promise((resolve, reject) => {
    const c = change(sources[0], '79-5318', 'maintenance', value);
    const code = `const s=require('./tests/helpers/invoice-compare.cjs').lib('vehicle-performance-adjustments-server.ts');s.saveVehicleFinancialChanges({changes:[${JSON.stringify(c)}]},'cross-process-fixture').then(()=>console.log(200)).catch(e=>console.log(e.status||500));`;
    const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, EES_VEHICLE_FINANCIAL_STORE_DIR: dir }, cwd: process.cwd(), windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', code => code ? reject(new Error(stderr)) : resolve(Number(stdout.trim())));
  });
  assert.deepEqual((await Promise.all([run('10.00'), run('20.00')])).sort(), [200, 409]);
  assert.equal((await server.readVehicleFinancialWorkspace()).history.length, 1);
});

test('failed atomic replacement preserves saved data and releases its lock for retry', async () => {
  const dir = fresh(); const report = sources[0], reg = '79-5318';
  assert.equal((await put([change(report, reg, 'maintenance', '5.00')])).status, 200);
  const before = fs.readFileSync(path.join(dir, 'adjustments.json'), 'utf8');
  const workspace = await server.readVehicleFinancialWorkspace();
  const promises = require('node:fs/promises'), rename = promises.rename;
  promises.rename = async () => { throw new Error('Isolated disk failure'); };
  try { assert.equal((await put([change(workspace.reports[0], reg, 'maintenance', '6.00')])).status, 500); }
  finally { promises.rename = rename; }
  assert.equal(fs.readFileSync(path.join(dir, 'adjustments.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'adjustments.lock')), false);
  assert.equal((await put([change(workspace.reports[0], reg, 'maintenance', '6.00')])).status, 200);
});

test('server authentication and financial permissions protect reads and every save', async () => {
  fresh(); const changes = [change(sources[0], '79-5318', 'maintenance', '1.00')];
  assert.equal((await api.GET(request('GET', null, null))).status, 401);
  assert.equal((await api.GET(request('GET', null, 'vp6-reader'))).status, 403);
  assert.equal((await put(changes, 'vp6-reader')).status, 403);
  assert.equal((await put(changes, 'vp6-staff')).status, 403);
  assert.equal((await put(changes, 'vp6-suspended')).status, 403);
  assert.equal((await put(changes, null)).status, 401);
  assert.equal((await api.GET(request('GET', null, 'vp6-staff'))).status, 200);
  const response = await put(changes); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
});

test('oversized and malformed save bodies are rejected without changing the store', async () => {
  fresh();
  const before = await server.readVehicleFinancialWorkspace();
  const oversized = request('PUT', { changes: [], padding: 'x'.repeat(200001) });
  assert.equal((await api.PUT(oversized)).status, 413);
  const malformed = new Request('http://localhost/api/vehicle-performance-v5', { method: 'PUT', headers: { Authorization: 'Bearer vp6-admin' }, body: '{invalid' });
  assert.equal((await api.PUT(malformed)).status, 400);
  assert.deepEqual(await server.readVehicleFinancialWorkspace(), before);
});

test('local file writes are disabled on hosted deployments even with the local-workspace switch', () => {
  const old = process.env.VERCEL, flag = process.env.EES_VEHICLE_FINANCIAL_LOCAL_WORKSPACE;
  process.env.VERCEL = '1'; process.env.EES_VEHICLE_FINANCIAL_LOCAL_WORKSPACE = '1';
  try { assert.equal(server.vehicleAdjustmentWritesEnabled(), false); }
  finally { if (old == null) delete process.env.VERCEL; else process.env.VERCEL = old; if (flag == null) delete process.env.EES_VEHICLE_FINANCIAL_LOCAL_WORKSPACE; else process.env.EES_VEHICLE_FINANCIAL_LOCAL_WORKSPACE = flag; }
});
