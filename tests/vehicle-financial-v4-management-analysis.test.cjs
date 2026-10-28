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

function completeFleet(count, balanceBase = 10000) {
  return Array.from({ length: count }, (_, index) => row({
    registration: `70-${1000 + index}`,
    totalReceived: String(balanceBase + (count - index) * 1000),
    salary: '5000',
    tripPayments: '1000',
    expenses: '100',
    parkingFees: '100',
    fuel: '1000',
    maintenance: '100',
    jobs: '10'
  }));
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
  assert.equal(metrics.balanceEligible, true);
});

test('unknown source amounts stay unknown and withhold definitive vehicle profit', () => {
  const metrics = analysis.analyseVehicleManagementRow(row({ maintenance: null, expenses: null }), '2026-08');
  assert.equal(metrics.operatingCosts, null);
  assert.equal(metrics.totalRecordedCosts, null);
  assert.equal(metrics.indicativeRecordedBalance, null);
  assert.equal(metrics.indicativeRecordedMarginPercent, null);
  assert.equal(metrics.confidence, 'unavailable');
  assert.equal(metrics.balanceEligible, false);
  assert.ok(metrics.incompleteFields.includes('maintenance'));
  assert.ok(metrics.incompleteFields.includes('expenses'));
});

test('blank maintenance remains unknown and is not treated as a confirmed expense', () => {
  const metrics = analysis.analyseVehicleManagementRow(row({ maintenance: null }), '2026-08');
  assert.equal(metrics.maintenance, null);
  assert.equal(metrics.balanceEligible, false);
  assert.equal(metrics.indicativeRecordedBalance, null);
  const result = analysis.buildVehicleFinancialV4ManagementAnalysis({
    reportingMonth: '2026-08',
    rows: [row({ maintenance: null })],
    sourceFooterTotals: {
      salary: '8000', jobs: '38', tripPayments: '14100', expenses: '2030', parkingFees: '2595',
      totalReceived: '157765', fuel: '66927.4', lpg: '0', maintenance: '2250'
    }
  });
  assert.ok(result.reviewIssues.some(issue => issue.code === 'maintenance_unknown'));
  assert.equal(result.strongestBalance.length, 0);
  assert.equal(result.weakestBalance.length, 0);
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

test('incomplete vehicles are excluded from balance rankings and never recycle into both lists', () => {
  const rows = [
    ...completeFleet(7, 50000),
    row({ registration: '701-1654-incomplete', maintenance: null, totalReceived: '999999' })
  ];
  const ranks = analysis.selectDisjointBalanceRanks(
    rows.map(item => analysis.analyseVehicleManagementRow(item, '2026-08')),
    5
  );
  assert.equal(ranks.eligible.length, 7);
  assert.equal(ranks.strongest.length, 3);
  assert.equal(ranks.weakest.length, 3);
  const strong = new Set(ranks.strongest.map(item => item.registration));
  const weak = ranks.weakest.map(item => item.registration);
  assert.equal(weak.some(registration => strong.has(registration)), false);
  assert.equal(ranks.strongest.some(item => item.registration === '701-1654-incomplete'), false);
  assert.equal(ranks.weakest.some(item => item.registration === '701-1654-incomplete'), false);
});

test('fewer than five eligible vehicles shortens lists instead of fabricating overlap', () => {
  const metrics = completeFleet(4).map(item => analysis.analyseVehicleManagementRow(item, '2026-08'));
  const ranks = analysis.selectDisjointBalanceRanks(metrics, 5);
  assert.equal(ranks.strongest.length, 2);
  assert.equal(ranks.weakest.length, 2);
  const overlap = ranks.strongest.filter(item => ranks.weakest.some(other => other.registration === item.registration));
  assert.equal(overlap.length, 0);
});

test('tie handling keeps deterministic registration order without overlap', () => {
  const tied = [
    row({ registration: 'B-100', totalReceived: '20000', salary: '1000', tripPayments: '0', expenses: '0', parkingFees: '0', fuel: '0', maintenance: '0', jobs: '1' }),
    row({ registration: 'A-100', totalReceived: '20000', salary: '1000', tripPayments: '0', expenses: '0', parkingFees: '0', fuel: '0', maintenance: '0', jobs: '1' }),
    row({ registration: 'C-100', totalReceived: '10000', salary: '1000', tripPayments: '0', expenses: '0', parkingFees: '0', fuel: '0', maintenance: '0', jobs: '1' }),
    row({ registration: 'D-100', totalReceived: '5000', salary: '1000', tripPayments: '0', expenses: '0', parkingFees: '0', fuel: '0', maintenance: '0', jobs: '1' })
  ].map(item => analysis.analyseVehicleManagementRow(item, '2026-08'));
  const ranks = analysis.selectDisjointBalanceRanks(tied, 5);
  assert.deepEqual(ranks.strongest.map(item => item.registration), ['A-100', 'B-100']);
  assert.deepEqual(ranks.weakest.map(item => item.registration), ['D-100', 'C-100']);
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
  assert.equal(result.previous.salary, 159500);
  assert.equal(result.current.maintenance, 104690);
  assert.equal(result.previous.maintenance, 27660);
  assert.match(result.policyNote, /not an approved/i);
  assert.ok(result.comparisons.some(item => item.key === 'clientRevenue' && item.absoluteChange === 3819401 - 3581914));
  assert.ok(result.comparisons.some(item => item.key === 'salary'));
  assert.ok(result.comparisons.some(item => item.key === 'tripPayments'));
  assert.ok(result.comparisons.some(item => item.key === 'expenses'));
  assert.ok(result.comparisons.some(item => item.key === 'parkingFees'));
  assert.ok(result.comparisons.some(item => item.key === 'revenuePerJob'));
  assert.equal(result.current.confidence, 'provisional');
  assert.ok(result.costIncreaseInsights[0].key === 'maintenance' || result.costIncreaseInsights.some(item => item.key === 'maintenance'));
  const mapped = result.vehicles.find(item => item.registration === '3ฒล-4565');
  assert.ok(mapped);
  assert.ok(mapped.incompleteFields.length > 0 || mapped.clientRevenue === 0);
  assert.equal(mapped.balanceEligible, false);

  const augustOnly = analysis.buildVehicleFinancialV4ManagementAnalysis(august);
  const strongSet = new Set(augustOnly.strongestBalance.map(item => item.registration));
  assert.equal(augustOnly.rankingMeta.eligibleCompleteVehicles, 7);
  assert.equal(augustOnly.strongestBalance.length, 3);
  assert.equal(augustOnly.weakestBalance.length, 3);
  assert.equal(augustOnly.weakestBalance.some(item => strongSet.has(item.registration)), false);
  assert.equal(augustOnly.strongestBalance.some(item => item.registration === '701-1654') && augustOnly.weakestBalance.some(item => item.registration === '701-1654'), false);

  const zeroRevenue = augustOnly.reviewIssues.find(item => item.registration === '3ฒล-4565' && item.code === 'zero_revenue_with_fuel');
  assert.ok(zeroRevenue);
  assert.match(zeroRevenue.evidence, /do not assume misconduct/i);
});

test('parseManagementSourceAmount never coerces blanks or dashes to zero', () => {
  assert.equal(analysis.parseManagementSourceAmount(null), null);
  assert.equal(analysis.parseManagementSourceAmount(''), null);
  assert.equal(analysis.parseManagementSourceAmount('—'), null);
  assert.equal(analysis.parseManagementSourceAmount('12.5'), 12.5);
});
