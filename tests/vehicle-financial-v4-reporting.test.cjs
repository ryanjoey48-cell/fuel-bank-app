const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath, stubs = {}) {
  const filename = path.resolve(relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    if (request.startsWith('@/lib/')) {
      return loadTypeScript(request.replace('@/lib/', 'lib/') + '.ts', stubs);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(output, filename);
    return loaded.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const reporting = loadTypeScript('lib/vehicle-financial-v4-reporting.ts');

const batch = {
  id: 'batch-aug',
  reportingMonth: '2026-08-01',
  version: 1,
  status: 'draft',
  sourceFileName: 'EES_August_2026.pdf',
  sourceSha256: 'a'.repeat(64),
  salaryVerification: null
};

function entry(overrides = {}) {
  return {
    id: 'e1',
    batch_id: 'batch-aug',
    vehicle_id: '39f2dd25-0796-4297-8948-c5f639d6590e',
    registration_source: 'ฒอ-8453',
    registration_snapshot: 'ฒอ-8453',
    source_sheet: 'Sheet1',
    source_row: 1,
    salary: 6500,
    jobs_completed: 10,
    trip_payments: 1000,
    expenses: 100,
    parking_fees: 50,
    total_received: 20000,
    fuel: 5000,
    lpg: 7292.1,
    lpg_treatment: 'separate',
    maintenance: 200,
    ...overrides
  };
}

test('Release C months keep Jan–Jul legacy and Aug/Sep V4 draft windows', () => {
  assert.deepEqual([...reporting.VEHICLE_PERFORMANCE_LEGACY_MONTHS], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...reporting.VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS], [8, 9]);
  assert.deepEqual([...reporting.VEHICLE_PERFORMANCE_REPORTING_MONTHS], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('unknown maintenance stays incomplete and balance remains null', () => {
  const row = reporting.mapV4DraftEntryToReportingRow(entry({ maintenance: null }), batch);
  assert.equal(row.financiallyComplete, false);
  assert.ok(row.incompleteFields.includes('maintenance'));
  assert.equal(row.indicativeRecordedBalance, null);
  assert.equal(row.maintenance, null);
  assert.equal(row.publicationLabel, 'stored_draft_not_published');
});

test('complete 8453 row keeps separate LPG and can rank', () => {
  const row = reporting.mapV4DraftEntryToReportingRow(entry(), batch);
  assert.equal(row.financiallyComplete, true);
  assert.equal(row.lpg, 7292.1);
  assert.equal(row.lpgTreatment, 'separate');
  const expectedCosts = 6500 + 1000 + 100 + 50 + 5000 + 7292.1 + 200;
  assert.equal(row.indicativeRecordedBalance, 20000 - expectedCosts);
  const ranked = reporting.rankCompleteV4Rows([row]);
  assert.equal(ranked.length, 1);
});

test('September provisional salary is labelled and incomplete rows are excluded from confirmed legacy projection', () => {
  const sepBatch = {
    ...batch,
    id: 'batch-sep',
    reportingMonth: '2026-09-01',
    salaryVerification: { status: 'provisional', note: 'pending payroll' }
  };
  const complete = reporting.mapV4DraftEntryToReportingRow(entry({ batch_id: 'batch-sep' }), sepBatch);
  const incomplete = reporting.mapV4DraftEntryToReportingRow(entry({
    batch_id: 'batch-sep',
    registration_source: '3ฒล-4565',
    registration_snapshot: '3ฒล-4565',
    maintenance: null,
    lpg: 0,
    lpg_treatment: 'separate'
  }), sepBatch);
  assert.equal(complete.salaryProvisional, true);
  assert.equal(incomplete.financiallyComplete, false);
  const projected = reporting.completeV4RowsAsLegacyCompatible([complete, incomplete]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].vehicle_registration, 'ฒอ-8453');
  assert.match(projected[0].notes, /provisional|not published/i);
});

test('ten-column headers and unknown formatting preserve dashes', () => {
  assert.deepEqual(reporting.tenColumnHeaders()[0], 'Registration');
  assert.equal(reporting.tenColumnHeaders().length, 10);
  const incomplete = reporting.mapV4DraftEntryToReportingRow(entry({ expenses: null }), batch);
  const values = reporting.v4RowToTenColumnValues(incomplete);
  assert.equal(values[4], '—');
  assert.equal(reporting.formatNullableAmount(7292.1), '7,292.10');
  assert.equal(reporting.formatNullableAmount(3581914), '3,581,914');
  assert.equal(reporting.formatNullableAmount(null), '—');
});

test('reporting-source route is GET-only and stays write-locked', () => {
  const route = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/reporting-source/route.ts'), 'utf8');
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.match(route, /canUseVehicleFinancialDrafts\(access, "read"\)/);
  assert.match(route, /writesEnabled: false/);
  assert.match(route, /liveKpiEligible: false/);
  const lock = fs.readFileSync(path.resolve('lib/vehicle-financial-v4-release-lock.ts'), 'utf8');
  assert.match(lock, /VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED !== "true"/);
});

test('page reporting months include Aug/Sep without writing into legacy KPI helpers', () => {
  const page = fs.readFileSync(path.resolve('app/(dashboard)/vehicle-performance/page.tsx'), 'utf8');
  assert.match(page, /VEHICLE_PERFORMANCE_REPORTING_MONTHS|VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS/);
  assert.match(page, /reporting-source/);
  assert.match(page, /stored_draft_not_published|not published/);
  assert.doesNotMatch(page, /from\("vehicle_monthly_performance"\).*insert/);
});

test('Fleet Overview sends Bearer token to reporting-source like Financial Reports', () => {
  const page = fs.readFileSync(path.resolve('app/(dashboard)/vehicle-performance/page.tsx'), 'utf8');
  assert.match(page, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(page, /reporting-source/);
  assert.match(page, /VEHICLE_PERFORMANCE_REPORTING_MONTHS\.map/);
  assert.match(page, /v4RowsAsFleetDisplayRows/);
  assert.match(page, /selectingOnlyV4Months/);
});

test('Fleet Overview no longer mounts a separate August–September draft table section', () => {
  const page = fs.readFileSync(path.resolve('app/(dashboard)/vehicle-performance/page.tsx'), 'utf8');
  assert.doesNotMatch(page, /Ten-column stored drafts/);
  assert.doesNotMatch(page, /August–September V4 draft source/);
  assert.doesNotMatch(page, /August–September draft vehicles/);
  assert.match(page, /id="vehicle-performance-table"/);
  assert.match(page, /selectingOnlyV4Months \?/);
  assert.match(page, /formatNullableBaht/);
  assert.match(page, /partialCoverageActive/);
  assert.match(page, /Confirmed balance/);
});

test('August–September fleet table avoids fake rank badges and repeated month subtitles', () => {
  const page = fs.readFileSync(path.resolve('app/(dashboard)/vehicle-performance/page.tsx'), 'utf8');
  assert.match(page, /Fleet vehicle list/);
  assert.doesNotMatch(page, /monthLabel\(row\.month\)\} financial report/);
  const augSepBlock = page.split('selectingOnlyV4Months ? (')[2] || page.split('{selectingOnlyV4Months ? (')[1] || '';
  assert.match(page, /Registration/);
  assert.match(page, /incomplete rows are not ranked as profit/);
  assert.doesNotMatch(augSepBlock.slice(0, 4500), /index \+ 1/);
  assert.doesNotMatch(augSepBlock.slice(0, 4500), /Rank \/ vehicle/);
});

test('incomplete V4 display rows keep null balance and do not coerce maintenance to zero', () => {
  const incomplete = reporting.mapV4DraftEntryToReportingRow(entry({ maintenance: null }), batch);
  const display = reporting.v4RowsAsFleetDisplayRows([incomplete]);
  assert.equal(display.length, 1);
  assert.equal(display[0].financiallyComplete, false);
  assert.equal(display[0].maintenance, null);
  assert.equal(display[0].recordedBalance, null);
  assert.equal(display[0].marginPercent, null);
  assert.equal(display[0].grossRevenue, 20000);
});
