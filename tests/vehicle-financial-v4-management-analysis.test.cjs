const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath) {
  const filename = path.resolve(relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  loaded._compile(output, filename);
  return loaded.exports;
}

const analysis = loadTypeScript('lib/vehicle-financial-v4-management-analysis.ts');

function row(overrides = {}) {
  return {
    registration: '61-2835',
    salary: '8000',
    jobs: '38',
    tripPayments: '14100',
    expenses: '2030',
    parkingFees: '2595',
    totalReceived: '157765',
    fuel: '66927.4',
    lpg: '0',
    maintenance: '2250',
    sourceDashStatus: { lpg: 'confirmed_zero_by_owner_rule' },
    lpgBasis: 'confirmed_non_lpg_zero',
    ...overrides
  };
}

test('candidate formulas compute revenue, driver cost, operating cost, balance, margin and per-job metrics', () => {
  const metrics = analysis.analyseVehicleManagementRow(row(), '2026-08');
  assert.equal(metrics.clientRevenue, 157765);
  assert.equal(metrics.driverCost, 8000 + 14100);
  assert.equal(metrics.operatingCosts, 66927.4 + 0 + 2030 + 2595 + 2250);
  assert.equal(metrics.totalRecordedCosts, metrics.driverCost + metrics.operatingCosts);
  assert.equal(metrics.indicativeRecordedBalance, metrics.clientRevenue - metrics.totalRecordedCosts);
  assert.ok(Math.abs(metrics.indicativeRecordedMarginPercent - (metrics.indicativeRecordedBalance / metrics.clientRevenue) * 100) < 1e-9);
  assert.ok(Math.abs(metrics.fuelSharePercent - ((66927.4 + 0) / 157765) * 100) < 1e-9);
  assert.equal(metrics.revenuePerJob, 157765 / 38);
  assert.equal(metrics.recordedCostPerJob, metrics.totalRecordedCosts / 38);
  assert.equal(metrics.confidence, 'indicative');
});

test('unknown source amounts stay unknown and withhold definitive vehicle profit', () => {
  const metrics = analysis.analyseVehicleManagementRow(row({ maintenance: null, expenses: null }), '2026-08');
  assert.equal(metrics.operatingCosts, null);
  assert.equal(metrics.totalRecordedCosts, null);
  assert.equal(metrics.indicativeRecordedBalance, null);
  assert.equal(metrics.indicativeRecordedMarginPercent, null);
  assert.equal(metrics.confidence, 'unavailable');
  assert.ok(metrics.incompleteFields.includes('maintenance'));
  assert.ok(metrics.incompleteFields.includes('expenses'));
});

test('division by zero jobs yields unavailable per-job metrics without throwing', () => {
  const metrics = analysis.analyseVehicleManagementRow(row({ jobs: '0' }), '2026-08');
  assert.equal(metrics.revenuePerJob, null);
  assert.equal(metrics.recordedCostPerJob, null);
  assert.ok(metrics.reviewReasons.some(reason => /zero or unknown jobs/i.test(reason)));
});

test('LPG is separate only for ฒอ-8453 from August onward and never double-counted in January–July', () => {
  const august = analysis.analyseVehicleManagementRow(row({
    registration: 'ฒอ-8453',
    lpg: '7292.1',
    lpgBasis: 'separate_from_fuel',
    sourceDashStatus: {}
  }), '2026-08');
  assert.equal(august.fuelAndLpg, 66927.4 + 7292.1);
  assert.ok(august.operatingCosts > 66927.4 + 2030 + 2595 + 2250);

  const july = analysis.analyseVehicleManagementRow(row({
    registration: 'ฒอ-8453',
    lpg: '7292.1',
    lpgBasis: 'included_in_fuel',
    sourceDashStatus: {}
  }), '2026-07');
  assert.equal(july.fuelAndLpg, 66927.4);
  assert.equal(july.operatingCosts, 66927.4 + 0 + 2030 + 2595 + 2250);
});

test('September provisional salary marks confidence without inventing missing values', () => {
  const metrics = analysis.analyseVehicleManagementRow(row(), '2026-09', { salaryProvisional: true });
  assert.equal(metrics.confidence, 'provisional');
  assert.deepEqual(metrics.provisionalFields, ['salary']);
  assert.ok(metrics.reviewReasons.some(reason => /provisional/i.test(reason)));
});

test('August and September footer illustrations preserve printed source totals and month comparisons', () => {
  const august = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/previews/2026-08.json'), 'utf8'));
  const september = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/previews/2026-09.json'), 'utf8'));
  assert.equal(august.rows.length, 21);
  assert.equal(september.rows.length, 21);
  const result = analysis.buildVehicleFinancialV4ManagementAnalysis(september, august);
  assert.equal(result.previous.clientRevenue, 3581914);
  assert.equal(result.current.clientRevenue, 3819401);
  assert.equal(result.current.jobs, Number(september.sourceFooterTotals.jobs));
  assert.equal(result.current.salary, Number(september.sourceFooterTotals.salary));
  assert.match(result.policyNote, /not an approved/i);
  assert.ok(result.comparisons.some(item => item.key === 'clientRevenue' && item.absoluteChange === 3819401 - 3581914));
  assert.equal(result.current.confidence, 'provisional');
  const mapped = result.vehicles.find(item => item.registration === '3ฒล-4565');
  assert.ok(mapped);
  assert.ok(mapped.incompleteFields.length > 0 || mapped.clientRevenue === 0);
});

test('parseManagementSourceAmount never coerces blanks or dashes to zero', () => {
  assert.equal(analysis.parseManagementSourceAmount(null), null);
  assert.equal(analysis.parseManagementSourceAmount(''), null);
  assert.equal(analysis.parseManagementSourceAmount('—'), null);
  assert.equal(analysis.parseManagementSourceAmount('12.5'), 12.5);
});
