const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve('lib/vehicle-financial-draft.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { previewFinancialDraft, parseFinancialValue, calculateDraftFinancials, transitionFinancialReport, canonicalLpgVehicleIds, FINANCIAL_COLUMNS } = loaded.exports;
const approvedPolicy = { status: 'approved', policyId: 'synthetic-test-policy', version: 'vehicle-finance-v4-v1', approvedBy: 'synthetic-reviewer', approvedAt: '2026-10-26T00:00:00Z', sourceEvidence: ['synthetic-test-only'] };
function fixture() {
  return {
    reportingMonth: '2026-10', version: 1,
    source: { fileName: 'synthetic.csv', sha256: 'a'.repeat(64), format: 'csv', pdfReviewed: false },
    headers: FINANCIAL_COLUMNS.map(column => column[1]),
    rows: [{ cells: ['TEST-1', '51,234.56', 2, '100.25', 3, 4, 200000, 5, 0, 7], sheet: 'Synthetic', row: 2, employeeId: 'synthetic-employee', lpgTreatment: 'separate' }],
    vehicles: [{ id: 'test-1', registration: 'TEST-1', aliases: ['OLD-1'] }],
    expectedVehicleIds: ['test-1'], existingVersions: [], publishedVehicleIds: [],
    sourceTotals: { salary: '51234.56', jobs: 2, tripPayments: '100.25', expenses: 3, parking: 4, totalReceived: 200000, fuel: 5, lpg: 0, maintenance: 7 },
    formula: approvedPolicy
  };
}
const codes = draft => draft.issues.map(issue => issue.code);
test('strict decimal parsing preserves unknowns without rounding or manufactured zeros', () => {
  for (const value of ['', null, undefined, true, '-', '1,23', '12.345', -1, NaN, Infinity, '1e2', '9007199254740992']) assert.equal(parseFinancialValue(value), null, String(value));
  assert.equal(parseFinancialValue('1,234.56'), 123456);
  assert.equal(parseFinancialValue(0), 0);
  assert.equal(parseFinancialValue('2.5', true), null);
  assert.equal(parseFinancialValue('2.00', true), 2);
});
test('draft computes disjoint costs exactly and never publishes', () => {
  const result = previewFinancialDraft(fixture());
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, 'draft');
  assert.equal(result.canPublish, false);
  assert.equal(result.readyForReview, true);
  assert.equal(result.rows[0].metrics.directCost, 5135381);
  assert.equal(result.rows[0].metrics.recordedBalance, 14864619);
  assert.equal(result.rows[0].metrics.fuelSharePercent, 0.0025);
  assert.equal(result.rows[0].metrics.fuelShareBasis, 'fuel_excludes_lpg');
  assert.equal(result.rows[0].values.salary, 5123456);
  assert.equal(result.rows[0].values.tripPayments, 10025);
});
test('missing salary stays unknown and withholds financial totals', () => {
  const input = fixture(); input.rows[0].cells[1] = '';
  const result = previewFinancialDraft(input);
  assert.equal(result.rows[0].values.salary, null);
  assert.equal(result.totals.salary, null);
  assert.equal(result.rows[0].metrics, null);
  assert.ok(codes(result).includes('source_total_mismatch'));
});
test('free-text formula references cannot authorize balances; zero revenue has no ratios', () => {
  const input = fixture(); input.formula = { version: 'vehicle-finance-v4-v1', verifiedSourceReference: 'unverified note' };
  assert.equal(previewFinancialDraft(input).rows[0].metrics, null);
  assert.ok(codes(previewFinancialDraft(input)).includes('source_relationships_unverified'));
  const values = previewFinancialDraft(fixture()).rows[0].values;
  const result = calculateDraftFinancials({ ...values, totalReceived: 0 }, 'separate', approvedPolicy);
  assert.equal(result.marginPercent, null);
  assert.equal(result.fuelSharePercent, null);
});
test('DUMMY is retained as excluded raw evidence and not counted in salary', () => {
  const input = fixture(); input.rows.push({ cells: ['DUMMY', 99999], sheet: 'Synthetic', row: 3 });
  const result = previewFinancialDraft(input);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.excludedRows[0], input.rows[1]);
  assert.equal(result.totals.salary, 5123456);
});
test('canonical alias duplicates and multi-vehicle salaries are blocked', () => {
  const input = fixture(); input.rows.push({ ...input.rows[0], cells: ['OLD-1', ...input.rows[0].cells.slice(1)], row: 3 });
  assert.ok(codes(previewFinancialDraft(input)).includes('duplicate_vehicle_month'));
  input.vehicles.push({ id: 'test-2', registration: 'TEST-2' });
  input.rows[1].cells[0] = 'TEST-2';
  input.expectedVehicleIds.push('test-2');
  const preview = previewFinancialDraft(input);
  assert.ok(preview.reviewWarnings.some(warning => warning.code === 'salary_allocation_approval_required'));
  assert.ok(codes(preview).includes('salary_assignment_dates_required'));
});
test('coverage, unknown identity, publication conflicts, totals and versions are checked', () => {
  const input = fixture(); input.expectedVehicleIds.push('missing'); input.publishedVehicleIds.push('test-1');
  input.existingVersions.push(1); input.sourceTotals.fuel = '6';
  let result = previewFinancialDraft(input);
  for (const code of ['missing_vehicle', 'vehicle_month_already_published', 'invalid_or_duplicate_version', 'source_total_mismatch']) assert.ok(codes(result).includes(code), code);
  input.rows[0].cells[0] = 'UNKNOWN';
  assert.ok(codes(previewFinancialDraft(input)).includes('unknown_registration'));
  input.rows[0].cells[0] = 'TEST-1'; input.vehicles.push({ id: 'conflict', registration: 'TEST-1' });
  assert.ok(codes(previewFinancialDraft(input)).includes('ambiguous_registration'));
});
test('historical owner review, PDF review, provisional September and provenance block validation', () => {
  const input = fixture(); input.reportingMonth = '2026-07';
  assert.ok(codes(previewFinancialDraft(input)).includes('historical_owner_review_required'));
  input.historicalCorrection = { explicitlyRequestedByOwner: true, reason: 'Owner reviewed source correction', baseVersion: 1, approvedBaseVersion: 1 };
  input.existingVersions = [1];
  input.version = 2;
  assert.deepEqual(previewFinancialDraft(input).issues, []);
  input.reportingMonth = '2026-09'; input.source.format = 'pdf'; input.source.sha256 = '';
  delete input.historicalCorrection;
  input.version = 1; input.existingVersions = [];
  const result = previewFinancialDraft(input);
  for (const code of ['pdf_review_required', 'missing_provenance', 'september_salary_verification_required']) assert.ok(codes(result).includes(code), code);
  assert.equal(result.canPublish, false);
  input.source.format = 'csv'; input.source.sha256 = 'b'.repeat(64);
  input.septemberSalaryVerification = { verified: true, evidence: 'Payroll checked against September source' };
  assert.ok(!codes(previewFinancialDraft(input)).includes('september_salary_verification_required'));
});
test('a first historical baseline is a reviewable proposal only for an empty V4 month', () => {
  const input = fixture(); input.reportingMonth = '2026-07'; input.version = 1;
  input.historicalCorrection = { kind: 'initial_baseline', explicitlyRequestedByOwner: true, reason: 'Owner-approved baseline proposal', evidenceReference: 'source report reference' };
  assert.ok(!codes(previewFinancialDraft(input)).includes('historical_approved_base_version_required'));
  input.existingVersions = [1]; input.version = 2;
  assert.ok(codes(previewFinancialDraft(input)).includes('historical_baseline_requires_empty_month'));
});
test('canonical LPG vehicle ID applies the owner-confirmed historical inclusion rule', () => {
  const input = fixture(); input.reportingMonth = '2026-07';
  input.vehicles = [{ id: 'canonical-lpg-id', registration: 'ฒอ-8453', aliases: ['8453'] }];
  input.expectedVehicleIds = ['canonical-lpg-id']; input.rows[0].cells[0] = '8453'; input.rows[0].cells[8] = ''; input.rows[0].lpgTreatment = undefined;
  input.sourceTotals.lpg = '';
  input.existingVersions = [1]; input.version = 2; input.publishedVehicleIds = ['canonical-lpg-id'];
  input.historicalCorrection = { explicitlyRequestedByOwner: true, reason: 'Owner reviewed source correction', baseVersion: 1, approvedBaseVersion: 1 };
  const historicalDraft = previewFinancialDraft(input);
  assert.ok(!codes(historicalDraft).includes('historical_lpg_included_in_fuel_required'));
  assert.ok(!codes(historicalDraft).includes('vehicle_month_already_published'));
  assert.equal(historicalDraft.rows[0].vehicleId, 'canonical-lpg-id');
  assert.equal(historicalDraft.rows[0].lpgTreatment, 'included_in_fuel');
  input.rows[0].lpgTreatment = 'separate';
  assert.ok(codes(previewFinancialDraft(input)).includes('historical_lpg_included_in_fuel_required'));
  assert.equal(historicalDraft.canPublish, false);
});

test('standard headers support English and Thai and exclude legacy active fields', () => {
  const input = fixture(); input.headers = FINANCIAL_COLUMNS.map(column => column[2]);
  assert.deepEqual(previewFinancialDraft(input).issues, []);
  input.headers.push('Overtime');
  assert.ok(codes(previewFinancialDraft(input)).includes('standard_headers_required'));
});
test('raw evidence and caller data are preserved; missing controls and assignment block validation', () => {
  const input = fixture(); delete input.rows[0].employeeId; delete input.sourceTotals.salary;
  const before = structuredClone(input);
  const result = previewFinancialDraft(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.rows[0].raw, input.rows[0]);
  assert.ok(codes(result).includes('salary_assignment_unverified'));
  assert.ok(codes(result).includes('source_total_required'));
});

test('LPG-only canonical vehicle follows the July/August boundary and counts LPG once', () => {
  const input = fixture();
  input.vehicles = [{ id: 'lpg-canonical-id', registration: 'ฒอ-8453', aliases: ['8453'] }];
  input.expectedVehicleIds = ['lpg-canonical-id']; input.rows[0].cells[0] = '8453';
  input.rows[0].lpgTreatment = undefined;
  input.reportingMonth = '2026-07'; input.version = 2; input.existingVersions = [1];
  input.historicalCorrection = { explicitlyRequestedByOwner: true, reason: 'Owner reviewed source correction', baseVersion: 1, approvedBaseVersion: 1 };
  input.rows[0].cells[8] = '';
  input.sourceTotals.lpg = '';
  const july = previewFinancialDraft(input);
  assert.deepEqual(canonicalLpgVehicleIds(input.vehicles), ['lpg-canonical-id']);
  assert.equal(july.rows[0].vehicleId, 'lpg-canonical-id');
  assert.equal(july.rows[0].lpgTreatment, 'included_in_fuel');
  assert.equal(july.rows[0].values.lpg, null);
  assert.equal(july.rows[0].metrics.directCost, 5135381);
  assert.equal(july.rows[0].metrics.fuelShareBasis, 'fuel_includes_lpg');
  assert.deepEqual(july.issues, []);

  input.reportingMonth = '2026-08'; input.version = 1; input.existingVersions = [];
  input.historicalCorrection = undefined;
  input.rows[0].cells[1] = ''; input.sourceTotals.salary = '';
  input.rows[0].cells[8] = '6'; input.sourceTotals.lpg = 6;
  const august = previewFinancialDraft(input);
  assert.equal(august.rows[0].lpgTreatment, 'separate');
  assert.equal(august.rows[0].values.lpg, 600);
  assert.equal(august.rows[0].metrics, null);
  assert.equal(august.totals.lpg, 600);
  const syntheticAugustValues = { salary: 123456, jobs: 2, tripPayments: 10025, expenses: 300, parking: 400, totalReceived: 20000000, fuel: 500, lpg: 600, maintenance: 700 };
  assert.equal(calculateDraftFinancials(syntheticAugustValues, 'separate', approvedPolicy).directCost, 135981);

  input.rows[0].cells[8] = '';
  input.sourceTotals.lpg = '';
  const unknownAugust = previewFinancialDraft(input);
  assert.equal(unknownAugust.rows[0].values.lpg, null);
  assert.equal(unknownAugust.rows[0].metrics, null);
  assert.ok(codes(unknownAugust).includes('lpg_amount_unknown'));
});

test('confirmed roster marks non-LPG vehicles zero, while an unconfirmed roster stays unknown', () => {
  const input = fixture();
  input.reportingMonth = '2026-10';
  input.vehicles.push({ id: 'test-2', registration: 'TEST-2' });
  input.expectedVehicleIds.push('test-2');
  input.rows.push({ ...structuredClone(input.rows[0]), cells: [...input.rows[0].cells], row: 3, employeeId: 'synthetic-employee-2' });
  input.rows[1].cells[0] = 'TEST-2';
  input.sourceTotals = { salary: 102469.12, jobs: 4, tripPayments: 200.5, expenses: 6, parking: 8, totalReceived: 400000, fuel: 10, lpg: '', maintenance: 14 };
  input.rows[0].cells[8] = '';
  input.rows[1].cells[8] = '';
  input.rows[0].lpgTreatment = undefined;
  input.rows[1].lpgTreatment = undefined;
  const unconfirmed = previewFinancialDraft(input);
  assert.equal(unconfirmed.rows[0].values.lpg, null);
  assert.equal(unconfirmed.rows[0].lpgTreatment, 'unknown');
  assert.equal(unconfirmed.rows[0].metrics, null);
  assert.ok(codes(unconfirmed).includes('lpg_treatment_unverified'));
  assert.equal(unconfirmed.rows[1].values.lpg, null);

  input.fleetRosterConfirmed = true;
  const confirmed = previewFinancialDraft(input);
  assert.equal(confirmed.rows[0].values.lpg, 0);
  assert.equal(confirmed.rows[0].lpgTreatment, 'separate');
  assert.equal(confirmed.rows[1].values.lpg, 0);
  assert.equal(confirmed.rows[1].lpgTreatment, 'separate');
  assert.equal(confirmed.totals.lpg, 0);
  assert.equal(confirmed.rows[0].metrics.directCost, 5135381);
  assert.equal(confirmed.rows[1].metrics.directCost, 5135381);
  assert.deepEqual(confirmed.issues, []);
  assert.equal(confirmed.fleetRosterConfirmed, true);
  assert.equal(confirmed.rows[0].raw.cells[8], '');

  input.rows[0].cells[8] = '1.25';
  input.rows[1].cells[8] = '';
  input.sourceTotals.lpg = '1.25';
  const inventedLpg = previewFinancialDraft(input);
  assert.equal(inventedLpg.rows[0].metrics, null);
  assert.ok(codes(inventedLpg).includes('lpg_recorded_for_non_lpg_vehicle'));
});

test('ambiguous canonical LPG identity remains unknown and blocks validation', () => {
  const input = fixture();
  input.vehicles = [
    { id: 'lpg-a', registration: 'ฒอ-8453', aliases: ['8453'] },
    { id: 'lpg-b', registration: 'ฒอ8453', aliases: ['8453'] }
  ];
  input.expectedVehicleIds = ['lpg-a', 'lpg-b'];
  input.rows[0].cells[0] = '8453'; input.rows[0].cells[8] = ''; input.rows[0].lpgTreatment = undefined;
  input.fleetRosterConfirmed = true; input.sourceTotals.lpg = '';
  const result = previewFinancialDraft(input);
  assert.ok(codes(result).includes('lpg_canonical_vehicle_ambiguous'));
  assert.equal(result.rows[0].values.lpg, null);
  assert.equal(result.rows[0].metrics, null);
});

test('owner candidate formula subtracts each distinct expense once and keeps revenue and jobs separate', () => {
  const values = {
    salary: 1000000, jobs: 12, tripPayments: 125000, expenses: 45000,
    parking: 20000, totalReceived: 10000000, fuel: 300000, lpg: 120000,
    maintenance: 50000
  };
  const includedLpg = calculateDraftFinancials(values, 'included_in_fuel', approvedPolicy);
  assert.equal(includedLpg.directCost, 1540000);
  assert.equal(includedLpg.recordedBalance, 8460000);
  assert.equal(includedLpg.marginPercent, 84.6);
  assert.equal(includedLpg.lpgTreatment, 'included_in_fuel');

  const separateLpg = calculateDraftFinancials(values, 'separate', approvedPolicy);
  assert.equal(separateLpg.directCost, 1660000);
  assert.equal(separateLpg.recordedBalance, 8340000);
  assert.ok(Math.abs(separateLpg.marginPercent - 83.4) < Number.EPSILON * 512);
  assert.equal(values.jobs, 12);
  assert.notEqual(values.salary, values.tripPayments);

  assert.equal(calculateDraftFinancials({ ...values, totalReceived: 0 }, 'separate', approvedPolicy).marginPercent, null);
  assert.equal(calculateDraftFinancials(values, 'unknown', approvedPolicy), null);
  assert.equal(calculateDraftFinancials({ ...values, lpg: null }, 'separate', approvedPolicy), null);
});

test('unknown jobs remain unknown without blocking financial totals; unknown expenses do block profit', () => {
  const input = fixture(); input.rows[0].cells[2] = '';
  const jobsUnknown = previewFinancialDraft(input);
  assert.equal(jobsUnknown.rows[0].values.jobs, null);
  assert.equal(jobsUnknown.rows[0].metrics.recordedBalance, 14864619);
  assert.equal(jobsUnknown.totals.jobs, null);
  input.rows[0].cells[5] = '';
  assert.equal(previewFinancialDraft(input).rows[0].metrics, null);
});

test('multi-vehicle salary allocations require dated non-overlapping assignments and server-side payroll verification', () => {
  const input = fixture();
  input.reportingMonth = '2026-10';
  input.vehicles.push({ id: 'test-2', registration: 'TEST-2' });
  input.expectedVehicleIds.push('test-2');
  input.rows[0].cells[1] = '1,234.50'; input.sourceTotals.salary = '2469';
  input.rows[0].assignmentEffectiveFrom = '2026-10-01'; input.rows[0].assignmentEffectiveTo = '2026-10-15';
  input.rows.push({ ...input.rows[0], cells: ['TEST-2', '1,234.50', 2, '100.25', 3, 4, 200000, 5, 6, 7], row: 3,
    assignmentEffectiveFrom: '2026-10-16', assignmentEffectiveTo: '2026-10-31' });
  input.employeeSalaryEvidence = [{ employeeId: 'synthetic-employee', monthlyBase: '2469', evidenceReference: 'synthetic payroll', assignmentEvidenceReference: 'synthetic roster' }];
  const valid = previewFinancialDraft(input);
  assert.ok(valid.reviewWarnings.some(warning => warning.code === 'salary_allocation_approval_required'));
  assert.ok(!codes(valid).includes('salary_employee_base_mismatch'));
  input.employeeSalaryEvidence[0].monthlyBase = '1000';
  assert.ok(!codes(previewFinancialDraft(input)).includes('salary_employee_base_mismatch'));
  input.employeeSalaryEvidence[0].monthlyBase = '2469';
  input.rows[1].assignmentEffectiveFrom = '2026-10-10';
  assert.ok(codes(previewFinancialDraft(input)).includes('salary_assignment_overlap'));
});

test('historical corrections require owner request and base version, then use distinct review approval', () => {
  const input = fixture(); input.reportingMonth = '2026-01';
  input.existingVersions = [1];
  input.version = 2;
  input.historicalCorrection = { explicitlyRequestedByOwner: true, reason: 'Owner requested corrected source', baseVersion: 1, approvedBaseVersion: 1 };
  assert.deepEqual(previewFinancialDraft(input).issues, []);
  const draft = { reportingMonth: '2026-01', version: 2, authorId: 'author', status: 'draft', contentHash: 'abc', validationPassed: true, validatedContentHash: 'abc',
    historicalCorrection: input.historicalCorrection, reviewerId: undefined, events: [{ status: 'draft', actorId: 'author', at: '2026-10-26T10:00:00Z', contentHash: 'abc' }] };
  const inReview = transitionFinancialReport(draft, 'in_review', { id: 'author', reason: 'Ready for review', at: '2026-10-26T10:01:00Z' });
  assert.equal(inReview.status, 'in_review');
  assert.equal(transitionFinancialReport(inReview, 'approved', { id: 'author', reason: 'self approve', at: '2026-10-26T10:02:00Z', explicitlyRequestedByOwner: true }), null);
  assert.equal(transitionFinancialReport(inReview, 'approved', { id: 'reviewer', reason: 'Owner approved correction', at: '2026-10-26T10:02:00Z' }), null);
  const approved = transitionFinancialReport(inReview, 'approved', { id: 'reviewer', reason: 'Owner approved correction', at: '2026-10-26T10:02:00Z', explicitlyRequestedByOwner: true });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.reviewerId, 'reviewer');
  assert.equal(approved.events.length, 3);
  assert.equal(approved.events[0].status, 'draft');
  assert.equal(transitionFinancialReport(approved, 'in_review', { id: 'author', reason: 'edit old approved version', at: '2026-10-26T10:03:00Z' }), null);
  const invalidated = { ...draft, validatedContentHash: 'old-hash' };
  assert.equal(transitionFinancialReport(invalidated, 'in_review', { id: 'author', reason: 'stale validation', at: '2026-10-26T10:03:00Z' }), null);
});
