const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const XLSX = require('xlsx');
const { PGlite } = require('@electric-sql/pglite');

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.resolve(relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(aliases, request)) return aliases[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(output, filename); }
  finally { Module._load = originalLoad; }
  return loaded.exports;
}

const draft = loadTypeScript('lib/vehicle-financial-draft.ts');
const permissions = loadTypeScript('lib/vehicle-financial-draft-access.ts', {
  '@/lib/authorization': { hasPermission(access, permission) {
    const table = { admin: ['business:read','business:write','business:import','admin:user_management'], office_staff: ['business:read','business:write','business:import'], read_only: ['business:read'] };
    return access?.status === 'active' && table[access.role]?.includes(permission) === true;
  } }
});
const importer = loadTypeScript('lib/vehicle-financial-draft-import.ts', { '@/lib/vehicle-financial-draft': draft });
const accountingPolicy = loadTypeScript('lib/vehicle-financial-accounting-policy.ts', { 'server-only': {} });
const approvedPolicy = { status: 'approved', policyId: 'synthetic-test-policy', version: 'vehicle-finance-v4-v1', approvedBy: 'synthetic-reviewer', approvedAt: '2026-10-26T00:00:00Z', sourceEvidence: ['synthetic-test-only'] };

test('draft endpoints require import/write, review/write, and administrator approval permissions', () => {
  const access = role => ({ role, status: 'active' });
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('read_only'), 'read'), false);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('office_staff'), 'read'), true);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('read_only'), 'import'), false);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('office_staff'), 'import'), true);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('office_staff'), 'validate'), true);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('office_staff'), 'review'), true);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('office_staff'), 'approve'), false);
  assert.equal(permissions.canUseVehicleFinancialDrafts(access('admin'), 'approve'), true);
  assert.equal(permissions.canUseVehicleFinancialDrafts({ ...access('admin'), status: 'suspended' }, 'approve'), false);
});

test('source preview salaries are served only through an authorized server route', () => {
  const component = fs.readFileSync('components/vehicle-financial-drafts.tsx', 'utf8');
  const route = fs.readFileSync('app/api/vehicle-performance-v4/source-previews/route.ts', 'utf8');
  assert.doesNotMatch(component, /from ["']@\/data\/vehicle-performance-v4\/previews\//);
  assert.doesNotMatch(component, /159,?500/);
  assert.match(component, /\/api\/vehicle-performance-v4\/source-previews/);
  assert.match(component, /\{canReview \? <>/);
  assert.match(component, /selectedPreviewMonth/);
  assert.match(component, /c\.manageData/);
  assert.match(component, /manageDataHelp/);
  assert.match(component, /SourceReportRequiredPanel/);
  assert.match(component, /formatVehicleRegistrationDisplay/);
  assert.doesNotMatch(component, /sourcePreviews\?\.map\(report =>/);
  assert.match(route, /requireVerifiedUser/);
  assert.match(route, /canUseVehicleFinancialDrafts\(access, "read"\)/);
  assert.match(route, /Cache-Control.*private, no-store/i);
  assert.match(route, /2026-08\.json/);
  assert.match(route, /2026-09\.json/);
  assert.match(route, /vehicleFinancialV4SourceAvailability/);
  assert.match(route, /reports: verifiedReports/);
});

test('January–July stay source-required while August–September remain the only verified V4 previews', () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/source-availability.json'), 'utf8'));
  const expectedColumns = ['Registration', 'Salary', 'Jobs', 'Trip Payments', 'Expenses', 'Parking Fees', 'Total Received', 'Fuel', 'LPG', 'Maintenance'];
  assert.deepEqual(catalog.standardColumns, expectedColumns);
  assert.equal(catalog.months.length, 9);
  assert.deepEqual(catalog.months.map(month => month.reportingMonth), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'
  ]);
  for (const month of catalog.months.slice(0, 7)) {
    assert.equal(month.previewAvailable, false);
    assert.equal(month.status, 'source_report_required');
    assert.ok(month.requiredFromOwner.length > 0);
    assert.ok(month.legacyInventory.missingCategories.includes('Jobs'));
    assert.ok(month.legacyInventory.missingCategories.includes('Parking Fees'));
    assert.ok(month.legacyInventory.missingCategories.includes('Maintenance'));
  }
  assert.equal(catalog.months[7].previewAvailable, true);
  assert.equal(catalog.months[8].previewAvailable, true);
  assert.equal(catalog.months[8].status, 'source_verified_readonly_salary_provisional');
  assert.equal(catalog.registrationReviewFlags[0].registration, '3ฒล-4565');
  assert.equal(catalog.registrationReviewFlags[0].blocking, false);
  assert.equal(catalog.lpgPolicy.januaryToJuly, 'included_in_fuel_never_deduct_twice');
  assert.equal(catalog.lpgPolicy.augustOnwards, 'separate_from_fuel');
  const component = fs.readFileSync(path.resolve('components/vehicle-financial-drafts.tsx'), 'utf8');
  assert.match(component, /registrationReview/);
  assert.match(component, /3ฒล-4565/);
});

test('XLSX import preserves original cell values, explicit included LPG and DUMMY control rows', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    draft.FINANCIAL_COLUMNS.map(column => column[1]),
    ['8453', '18,000.00', 2, '1,200.50', 100, 0, 25000, 700, '', 25],
    ['DUMMY', '999.00', 0, 0, 0, 0, 0, 0, 0, 0],
    ['Grand Total', '18,999.00', 2, '1,200.50', 100, 0, 25000, 700, 0, 25]
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Monthly');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  assert.deepEqual(importer.listFinancialWorkbookSheets(bytes), ['Monthly']);
  const parsed = importer.parseFinancialWorkbook(bytes, ['Monthly'], { 'Monthly:2': { employeeId: 'employee-1', lpgTreatment: 'included_in_fuel' } });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.controls.length, 1);
  assert.equal(parsed.rows[0].cells[0], '8453');
  assert.equal(parsed.rows[0].cells[8], '');
  assert.deepEqual(parsed.rows[0].rawCells, ['8453', '18,000.00', 2, '1,200.50', 100, 0, 25000, 700, '', 25]);
  assert.equal(parsed.rows[0].lpgTreatment, 'included_in_fuel');
  assert.equal(parsed.controls[0].cells[0], 'Grand Total');
});

test('CSV import maps the fixed report columns and keeps blank LPG unknown', () => {
  const csv = [
    draft.FINANCIAL_COLUMNS.map(column => `"${column[1]}"`).join(','),
    '"ฒอ-8453",18000,1,900,50,0,25000,700,,15'
  ].join('\n');
  const bytes = new TextEncoder().encode(csv);
  const [sheet] = importer.listFinancialWorkbookSheets(bytes);
  const parsed = importer.parseFinancialWorkbook(bytes, [sheet], { [`${sheet}:2`]: { lpgTreatment: 'included_in_fuel' } });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].cells[0], 'ฒอ-8453');
  assert.equal(parsed.rows[0].cells[8], '');
  assert.equal(parsed.rows[0].lpgTreatment, 'included_in_fuel');
});

test('workbook parser rejects signature mismatches, malformed ZIP data, formulas and date-formatted finance cells', () => {
  assert.throws(() => importer.validateFinancialFileSignature(new TextEncoder().encode('not an xlsx'), 'xlsx'), /xlsx_signature_mismatch/);
  assert.throws(() => importer.listFinancialWorkbookSheets(new Uint8Array([0x50,0x4b,0x03,0x04])), /malformed_xlsx/);
  assert.throws(() => importer.validateFinancialFileSignature(new Uint8Array(importer.MAX_FINANCIAL_FILE_BYTES + 1), 'csv'), /file_size_limit/);
  const archiveSheet = XLSX.utils.aoa_to_sheet([draft.FINANCIAL_COLUMNS.map(column => column[1]), ['TEST-1', 0, 1, 0, 0, 0, 100, 0, 0, 0]]);
  const archiveBook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(archiveBook, archiveSheet, 'Monthly');
  const oversizedArchive = new Uint8Array(XLSX.write(archiveBook, { type: 'array', bookType: 'xlsx' }));
  const centralDirectoryOffset = oversizedArchive.findIndex((value, index) => value === 0x50 && oversizedArchive[index + 1] === 0x4b && oversizedArchive[index + 2] === 0x01 && oversizedArchive[index + 3] === 0x02);
  assert.ok(centralDirectoryOffset >= 0);
  new DataView(oversizedArchive.buffer).setUint32(centralDirectoryOffset + 24, importer.MAX_XLSX_UNCOMPRESSED_BYTES + 1, true);
  assert.throws(() => importer.validateFinancialFileSignature(oversizedArchive, 'xlsx'), /xlsx_archive_limits/);

  const formulaCsv = [draft.FINANCIAL_COLUMNS.map(column => column[1]), ['=HYPERLINK("https://example.invalid","bad")', 0, 1, 0, 0, 0, 100, 0, 0, 0]].map(row => row.map(value => JSON.stringify(value)).join(',')).join('\n');
  const parsedCsvFormula = importer.parseFinancialWorkbook(new TextEncoder().encode(formulaCsv), ['Sheet1']);
  assert.ok(parsedCsvFormula.issues.some(issue => issue.startsWith('unsafe_source_cell')));
  const minusFormulaCsv = [draft.FINANCIAL_COLUMNS.map(column => column[1]), ['TEST-1', '-1+HYPERLINK("https://example.invalid","bad")', 1, 0, 0, 0, 100, 0, 0, 0]].map(row => row.map(value => JSON.stringify(value)).join(',')).join('\n');
  const parsedMinusFormulaCsv = importer.parseFinancialWorkbook(new TextEncoder().encode(minusFormulaCsv), ['Sheet1']);
  assert.ok(parsedMinusFormulaCsv.issues.some(issue => issue.startsWith('unsafe_source_cell')));

  const formulaSheet = XLSX.utils.aoa_to_sheet([
    draft.FINANCIAL_COLUMNS.map(column => column[1]),
    ['TEST-1', { t: 'n', f: 'SUM(1,2)', v: 3 }, 1, 0, 0, 0, 100, 0, 0, 0]
  ]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, formulaSheet, 'Monthly');
  const formulaBytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const parsedFormula = importer.parseFinancialWorkbook(formulaBytes, ['Monthly']);
  assert.ok(parsedFormula.issues.some(issue => issue.startsWith('formula_cells_present')));
  assert.ok(parsedFormula.issues.some(issue => issue.startsWith('unsafe_source_cell')));
  assert.equal(typeof parsedFormula.rows[0].cells[1], 'object');

  const dateSheet = XLSX.utils.aoa_to_sheet([
    draft.FINANCIAL_COLUMNS.map(column => column[1]),
    ['TEST-1', { t: 'n', v: 46114, z: 'mm/dd/yyyy' }, 1, 0, 0, 0, 100, 0, 0, 0]
  ]);
  const dateBook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(dateBook, dateSheet, 'Monthly');
  const parsedDate = importer.parseFinancialWorkbook(new Uint8Array(XLSX.write(dateBook, { type: 'array', bookType: 'xlsx' })), ['Monthly']);
  assert.ok(parsedDate.issues.some(issue => issue.startsWith('unsafe_source_cell')));
  assert.equal(typeof parsedDate.rows[0].cells[1], 'object');
});

test('multipart request reader rejects oversized declared and streamed bodies before form parsing', async () => {
  const upload = loadTypeScript('lib/vehicle-financial-upload.ts');
  await assert.rejects(upload.boundedRequestBody(new Request('https://example.test/upload', { method: 'POST', headers: { 'content-length': '100' }, body: 'x' }), 20), /request_too_large/);
  await assert.rejects(upload.boundedRequestBody(new Request('https://example.test/upload', { method: 'POST', body: 'x'.repeat(30) }), 20), /request_too_large/);
});

test('salary and trip payment fields remain separate storage values and historical LPG counts once', () => {
    const storage = loadTypeScript('lib/vehicle-financial-draft-storage.ts', {
    '@/lib/vehicle-financial-draft': draft
  });
  const values = { salary: 1800000, jobs: 12, tripPayments: 450050, expenses: 5000, parking: 0, totalReceived: 5000000, fuel: 70000, lpg: null, maintenance: 12000 };
  const saved = storage.financialValuesToStorage(values);
  assert.equal(saved.salary, 18000);
  assert.equal(saved.trip_payments, 4500.5);
  assert.equal(saved.jobs_completed, 12);
  assert.notEqual(saved.salary, saved.trip_payments);
  const metrics = draft.calculateDraftFinancials(values, 'included_in_fuel', approvedPolicy);
  assert.equal(metrics.directCost, 2337050);
  assert.equal(metrics.lpgTreatment, 'included_in_fuel');
  assert.equal(draft.calculateDraftFinancials(values, 'included_in_fuel', undefined), null);
  assert.equal(storage.hashFinancialDraftContent({ b: 2, a: 1 }), storage.hashFinancialDraftContent({ a: 1, b: 2 }));
});

test('server policy stays disabled without matching fixed-version approval and verified evidence', async () => {
  const policy = fs.readFileSync(path.resolve('lib/vehicle-financial-accounting-policy.ts'), 'utf8');
  const route = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/drafts/route.ts'), 'utf8');
  const approvalRoute = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/accounting-policy/route.ts'), 'utf8');
  const migration = fs.readFileSync(path.resolve('supabase/migrations/20261026090000_vehicle_financial_drafts_v4.sql'), 'utf8');
  const policyStorage = loadTypeScript('lib/vehicle-financial-draft-storage.ts', { '@/lib/vehicle-financial-draft': draft });
  const candidate = accountingPolicy.VEHICLE_FINANCIAL_POLICY_DEFINITION;
  assert.equal(candidate.policyVersion, 'v4-accounting-draft-3');
  assert.equal(candidate.formulaVersion, 'vehicle-finance-v4-v1');
  assert.equal(candidate.ownerConfirmedDefinitions.totalReceived, 'client_transport_service_revenue');
  assert.equal(candidate.ownerConfirmedDefinitions.salary, 'fixed_monthly_base_pay; separate_from_trip_payments');
  assert.equal(candidate.ownerConfirmedDefinitions.tripPayments, 'variable_completed_job_pay; separate_from_salary');
  assert.equal(candidate.ownerConfirmedDefinitions.expenses, 'additional_expenses; separate_from_parking_fees_fuel_lpg_and_maintenance');
  assert.equal(candidate.ownerConfirmedDefinitions.jobs, 'count_only; not_an_expense');
  assert.equal(candidate.candidateFormula.recordedBalance, 'total_received - salary - trip_payments - expenses - parking_fees - fuel - maintenance - lpg_when_separate');
  assert.equal(candidate.candidateFormula.marginPercent, 'recorded_balance / total_received when total_received > 0');
  assert.equal(candidate.lpg.canonicalVehicleRegistration, 'ฒอ-8453');
  assert.match(candidate.lpg.identityRule, /canonical_vehicle_id/);
  assert.equal(candidate.lpg.otherFleetVehicles, 'no_lpg; confirmed_zero_only_when_monthly_roster_is_confirmed');
  assert.equal(candidate.lpg.januaryThroughJuly2026, 'included_in_fuel; do_not_deduct_again');
  assert.equal(candidate.lpg.august2026Onward, 'separate; deduct_lpg_once');
  assert.equal(candidate.lpg.ownerRuleStatus, 'confirmed');
  assert.equal(candidate.lpg.approvalStatus, 'policy_approval_pending');
  assert.equal(candidate.lpg.evidenceStatus, 'source_reconciliation_and_schema_checks_required_before_activation');
  assert.equal(candidate.status, 'draft');
  assert.equal(candidate.activationStatus, 'blocked_pending_policy_approval_source_reconciliation_and_schema_checks');
  assert.equal(policyStorage.hashFinancialDraftContent(candidate), accountingPolicy.VEHICLE_FINANCIAL_POLICY_HASH);
  assert.ok(migration.includes(accountingPolicy.VEHICLE_FINANCIAL_POLICY_HASH));
  const oldManifest = process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256;
  delete process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256;
  const noRowAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  assert.equal(await accountingPolicy.getActiveApprovedVehicleFinancialPolicy(noRowAdmin), null);
  const evidence = Object.fromEntries(accountingPolicy.VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS.map((key, index) => [key, String.fromCharCode(97 + index).repeat(64)]));
  const approval = {
    policy_version: candidate.policyVersion, formula_version: candidate.formulaVersion,
    policy_hash: accountingPolicy.VEHICLE_FINANCIAL_POLICY_HASH, ...evidence,
    approved_by: 'synthetic-admin', approved_at: '2026-10-26T00:00:00Z'
  };
  const manifest = JSON.stringify(evidence);
  process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256 = manifest;
  assert.equal(accountingPolicy.verifiedVehicleFinancialPolicyEvidence().owner_decision_sha256, 'a'.repeat(64));
  assert.equal(accountingPolicy.vehicleFinancialPolicyApprovalMatches(approval, evidence), true);
  assert.equal(accountingPolicy.vehicleFinancialPolicyApprovalMatches({ ...approval, policy_hash: '0'.repeat(64) }, evidence), false);
  const matchingAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: approval, error: null }) }) }) }) };
  assert.equal((await accountingPolicy.getActiveApprovedVehicleFinancialPolicy(matchingAdmin)).status, 'approved');
  process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256 = JSON.stringify({ ...evidence, extra: 'x' });
  assert.equal(await accountingPolicy.getActiveApprovedVehicleFinancialPolicy(matchingAdmin), null);
  if (oldManifest === undefined) delete process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256;
  else process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256 = oldManifest;
  assert.match(policy, /VEHICLE_FINANCIAL_POLICY_HASH/);
  assert.match(route, /await getActiveApprovedVehicleFinancialPolicy\(admin\) \?\? undefined/);
  assert.match(approvalRoute, /export async function POST\(\)/);
  assert.match(approvalRoute, /Accounting-policy activation is disabled for this release/);
  assert.doesNotMatch(approvalRoute, /admin\.rpc\("approve_vehicle_financial_policy"/);
  assert.doesNotMatch(approvalRoute, /body\.(approvedBy|approved_by|actorId|actor_id|evidence)/);
  assert.match(migration, /vehicle_financial_policy_approval_immutable/);
  assert.doesNotMatch(migration.slice(0, migration.indexOf('create function public.approve_vehicle_financial_policy')), /insert into public\.vehicle_financial_policy_approvals/i);
  assert.doesNotMatch(migration, /create table if not exists|create or replace function|create index if not exists/i);
  assert.match(route, /preview\.excludedRows\.map\(row => \(\{ kind: "excluded_dummy"/);
  assert.match(route, /selectedSheets, sourceTotals, sourceControls, expectedVehicleIds, fleetRosterConfirmed/);
  assert.match(route, /validation_snapshot:\s*\{\s*readyForReview: preview\.readyForReview,\s*fleetRosterConfirmed/);
  assert.doesNotMatch(route, /verifiedSourceReference:\s*String\(form\.get\("formulaReference"\)/);
});

test('V4 readiness is visible before legacy records load while migration-dependent actions stay gated', () => {
  const page = fs.readFileSync(path.resolve('app/(dashboard)/vehicle-performance/page.tsx'), 'utf8');
  const draftUi = fs.readFileSync(path.resolve('components/vehicle-financial-drafts.tsx'), 'utf8');
  assert.ok(page.indexOf('id="vehicle-performance-v4"') < page.indexOf('{loading ? <p role="status"'));
  assert.match(page, /href="#vehicle-performance-v4"/);
  assert.match(draftUi, /!metadata\?\.migrationReady \|\| !preview/);
  assert.match(draftUi, /metadata && !metadata\.migrationReady/);
  assert.doesNotMatch(draftUi, /onClick=\{\(\) => void approveAccountingPolicy\(\)\}/);
});

test('August and September source previews retain source dashes and reconcile to printed controls', () => {
  const august = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/previews/2026-08.json'), 'utf8'));
  const september = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/previews/2026-09.json'), 'utf8'));
  const expectedColumns = ['Registration', 'Salary', 'Jobs', 'Trip Payments', 'Expenses', 'Parking Fees', 'Total Received', 'Fuel', 'LPG', 'Maintenance'];
  const amountFields = ['salary', 'jobs', 'tripPayments', 'expenses', 'parkingFees', 'totalReceived', 'fuel', 'lpg', 'maintenance'];
  const cents = value => value == null ? 0n : BigInt(Math.round(Number(value) * 100));
  for (const report of [august, september]) {
    assert.deepEqual(report.columns, expectedColumns);
    assert.equal(report.rowCount, 21);
    assert.equal(report.rows.length, 21);
    assert.equal(new Set(report.rows.map(row => row.registration)).size, 21);
    assert.equal(report.readOnly, true);
    assert.equal(report.liveKpiEligible, false);
    assert.equal(report.publicationEnabled, false);
    assert.ok(!report.rows.some(row => /DUMMY/i.test(row.registration)));
    for (const field of amountFields) {
      const subtotal = report.rows.reduce((sum, row) => sum + cents(row[field]), 0n);
      assert.equal(subtotal.toString(), (cents(report.sourceFooterTotals[field])).toString(), `${report.reportingMonth} ${field} subtotal`);
      assert.equal(Number(report.rowSumReconciliation.differenceByField[field].difference), 0);
    }
    const lpgRows = report.rows.filter(row => Number(row.lpg) > 0);
    assert.deepEqual(lpgRows.map(row => row.registration), ['ฒอ-8453']);
    assert.equal(lpgRows[0].lpgBasis, 'separate_from_fuel');
    assert.ok(report.rows.filter(row => row.registration !== 'ฒอ-8453').every(row => row.lpg === '0'));
    assert.ok(report.rows.some(row => row.sourceDashes.length > 0));
    assert.ok(report.rows.some(row => Object.values(row.sourceDashStatus).includes('unresolved_source_dash')));
  }
  assert.equal(august.salaryStatus, 'august_control_reconciled');
  assert.equal(august.sourceFooterTotals.salary, '159500');
  assert.equal(september.salaryStatus, 'provisional_carried_forward_pending_september_payroll');
  assert.ok(september.sourceNotes.some(note => /payroll evidence/i.test(note)));
});

test('source report PDFs are excluded from Git and Vercel deployment inputs', () => {
  const gitignore = fs.readFileSync(path.resolve('.gitignore'), 'utf8');
  const vercelignore = fs.readFileSync(path.resolve('.vercelignore'), 'utf8');
  assert.match(gitignore, /\/data\/vehicle-performance-v4\/source-reports\//);
  assert.match(vercelignore, /data\/vehicle-performance-v4\/source-reports\//);
  const component = fs.readFileSync(path.resolve('components/vehicle-financial-drafts.tsx'), 'utf8');
  const readOnlySection = component.slice(component.indexOf('function ReadOnlySourcePreview'), component.indexOf('function SourceReportRequiredPanel'));
  assert.match(component, /excluded from live KPIs, rankings and margins/);
  assert.match(component, /sourceFiguresNote/);
  assert.doesNotMatch(readOnlySection, /recordedBalance|marginPercent|calculateDraftFinancials/);
});

test('all source registrations have an established EES vehicle match in the existing reconciliation', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/previews/2026-08.json'), 'utf8'));
  const lines = fs.readFileSync(path.resolve('output/vehicle-performance-reconciliation-2026-jan-jul.csv'), 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const registrationIndex = headers.indexOf('Excel Registration');
  const matchIndex = headers.indexOf('Vehicle Match?');
  const matchedRegistrations = new Set(lines.slice(1).map(line => line.split(',')).filter(row => row[matchIndex] === 'Yes').map(row => row[registrationIndex]));
  const unmatched = report.rows.map(row => row.registration).filter(registration => !matchedRegistrations.has(registration));
  assert.equal(report.rows.length, 21);
  assert.deepEqual(unmatched, []);
});

test('BIGINT driver IDs use exact decimal text and restricted HR cross-check returns only issues', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/20261026090000_vehicle_financial_drafts_v4.sql'), 'utf8');
  const route = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/drafts/route.ts'), 'utf8');
  assert.match(migration, /select d\.id::text,d\.name,d\.active from public\.drivers/);
  assert.match(route, /String\(driver\.driver_id\)/);
  assert.match(route, /verify_vehicle_financial_salary_allocations/);
  assert.match(migration, /returns jsonb[\s\S]*?verify_vehicle_financial_salary_allocations/);
  assert.match(migration, /dated_vehicle_assignment_mismatch/);
  assert.match(migration, /monthly_thb_payroll_required/);
  assert.match(migration, /employee_month_salary_allocation_mismatch/);
  assert.match(migration, /multi_vehicle_salary_allocation_requires_reviewer/);
  assert.match(migration, /revoke all on function public\.verify_vehicle_financial_salary_allocations\(date,jsonb,uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.verify_vehicle_financial_salary_allocations\(date,jsonb,uuid\) to service_role/);
  assert.doesNotMatch(migration.match(/create function public\.verify_vehicle_financial_salary_allocations\([\s\S]*?\n\$\$;/)[0], /preferred_name|legal_name|telephone|p\.id::text|c\.amount.*jsonb_build_object/i);
});

test('legacy gate fails closed on missing or invalid mode and recovery only restores legacy mode', () => {
  const gate = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/legacy-write-gate/route.ts'), 'utf8');
  const recovery = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/legacy-write-gate/recover/route.ts'), 'utf8');
  const data = fs.readFileSync(path.resolve('lib/data.ts'), 'utf8');
  const migration = fs.readFileSync(path.resolve('supabase/migrations/20261026090000_vehicle_financial_drafts_v4.sql'), 'utf8');
  assert.match(gate, /if \(!data\).*write_control_missing/s);
  assert.match(gate, /data\.mode !== "legacy_enabled" && data\.mode !== "v4_only"/);
  assert.match(data, /control\.mode !== "legacy_enabled" && control\.mode !== "v4_only"/);
  assert.match(data, /if \(!response\.ok\) throw new Error/);
  assert.match(recovery, /admin\.rpc\("recover_vehicle_financial_legacy_write_control"/);
  assert.match(recovery, /p_actor_id: user\.id/);
  assert.doesNotMatch(recovery, /body\.(actorId|actor_id|userId|user_id)/);
  assert.match(migration, /vehicle_finance_write_control_missing/);
  assert.match(migration, /vehicle_finance_write_control_invalid/);
  assert.match(migration, /values \('vehicle_monthly_performance','legacy_enabled'/);
  assert.doesNotMatch(migration.match(/create function public\.recover_vehicle_financial_legacy_write_control\([\s\S]*?\n\$\$;/)[0], /'v4_only'\s*,\s*p_actor_id/);
});

test('review route derives actor from verified server user rather than request identity', () => {
  const route = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/drafts/[batchId]/route.ts'), 'utf8');
  const component = fs.readFileSync(path.resolve('components/vehicle-financial-drafts.tsx'), 'utf8');
  assert.match(route, /const user = await requireVerifiedUser\(request\)/);
  assert.match(route, /p_actor_id:\s*user\.id/);
  assert.doesNotMatch(route, /body\.(reviewerId|reviewer_id|actorId|actor_id)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /vehicle_financial_revision_history/);
  assert.match(route, /vehicle_financial_review_approvals/);
  assert.match(route, /action === "supersede" \? expectedCurrent : null/);
  assert.match(route, /action === "approve" \|\| action === "supersede" \? "approve"/);
  assert.match(route, /vehicle_financial_current_approvals/);
  assert.match(route, /maySeeEmployeeAllocationEvidence/);
  assert.match(component, /validation_snapshot\?\.issues/);
  assert.match(component, /detail\.batch\.source_controls/);
});

test('additive schema preserves versions, nullable unknowns, exact row provenance and independent approval', async () => {
  const db = new PGlite();
  const migration = fs.readFileSync(path.resolve('supabase/migrations/20261026090000_vehicle_financial_drafts_v4.sql'), 'utf8');
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      create table public.vehicles(id uuid primary key, vehicle_reg text not null, active boolean not null default true);
      create table public.drivers(id bigint primary key, name text not null, active boolean not null default true);
      create table public.account_access(user_id uuid primary key, role text not null, status text not null);
      create table public.vehicle_monthly_performance(id uuid primary key default gen_random_uuid(), year integer, month integer, vehicle_registration text);
      grant truncate on public.vehicle_monthly_performance to authenticated;
      create table public.ees_driver_vehicle_assignments(
        id uuid primary key default gen_random_uuid(), driver_id bigint not null, vehicle_id uuid not null,
        effective_from date not null, effective_to date, cancelled_at timestamptz, assignment_kind text not null default 'permanent'
      );
      create table public.ees_employee_profiles(
        id uuid primary key default gen_random_uuid(), driver_id bigint unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create table public.ees_employee_compensation(
        id uuid primary key default gen_random_uuid(), employee_id uuid not null, effective_from date not null,
        amount numeric(12,2) not null, currency text not null default 'THB', period text not null, recorded_at timestamptz not null default now()
      );
      insert into auth.users(id) values
        ('00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000002'),
        ('00000000-0000-0000-0000-000000000003'),
        ('00000000-0000-0000-0000-000000000004'),
        ('00000000-0000-0000-0000-000000000005');
      insert into public.account_access values
        ('00000000-0000-0000-0000-000000000001','office_staff','active'),
        ('00000000-0000-0000-0000-000000000002','office_staff','active'),
        ('00000000-0000-0000-0000-000000000003','admin','active'),
        ('00000000-0000-0000-0000-000000000004','admin','active'),
        ('00000000-0000-0000-0000-000000000005','read_only','active');
      insert into public.vehicles(id,vehicle_reg) values
        ('10000000-0000-0000-0000-000000000001','ฒอ-8453'),
        ('10000000-0000-0000-0000-000000000002','กข-1234');
      insert into public.drivers(id,name) values (9007199254740993,'Synthetic driver');
      insert into public.vehicle_monthly_performance(id,year,month,vehicle_registration)
        values ('40000000-0000-0000-0000-000000000001',2026,1,'SYNTHETIC-LEGACY-JAN');
    `);
    await db.exec(migration);
    const policyBeforeApproval = await db.query('select count(*)::integer as count from public.vehicle_financial_policy_approvals');
    assert.equal(policyBeforeApproval.rows[0].count, 0);
    await assert.rejects(db.query("select public.set_vehicle_financial_legacy_write_mode('v4_only','00000000-0000-0000-0000-000000000003','synthetic attempt before policy approval')"), /vehicle_finance_cutover_policy_not_approved/);
    const syntheticEvidenceHashes = ['a','b','c','d','e','f'].map(character => character.repeat(64));
    const policyArgs = [
      accountingPolicy.VEHICLE_FINANCIAL_POLICY_DEFINITION.policyVersion,
      accountingPolicy.VEHICLE_FINANCIAL_POLICY_DEFINITION.formulaVersion,
      accountingPolicy.VEHICLE_FINANCIAL_POLICY_HASH,
      ...syntheticEvidenceHashes,
      '00000000-0000-0000-0000-000000000003'
    ];
    const approvePolicySql = 'select public.approve_vehicle_financial_policy($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::uuid) as result';
    await assert.rejects(db.query(approvePolicySql, [...policyArgs.slice(0, 9), '00000000-0000-0000-0000-000000000001']), /vehicle_finance_policy_admin_required/);
    await assert.rejects(db.query(approvePolicySql, [policyArgs[0],policyArgs[1],'0'.repeat(64),...policyArgs.slice(3)]), /vehicle_finance_policy_version_or_hash_mismatch/);
    const policyApproval = await db.query(approvePolicySql, policyArgs);
    assert.equal(policyApproval.rows[0].result.policy_version, 'v4-accounting-draft-3');
    assert.equal(policyApproval.rows[0].result.approved_by, '00000000-0000-0000-0000-000000000003');
    await assert.rejects(db.query("update public.vehicle_financial_policy_approvals set formula_version='changed'"), /vehicle_finance_history_immutable/);
    await assert.rejects(db.query('delete from public.vehicle_financial_policy_approvals'), /vehicle_finance_history_immutable/);

    await db.exec(`
      insert into public.ees_employee_profiles(id,driver_id,created_at,updated_at)
      values ('30000000-0000-0000-0000-000000000001',9007199254740993,'2025-01-01','2026-06-30');
      insert into public.ees_employee_compensation(employee_id,effective_from,amount,currency,period,recorded_at)
      values ('30000000-0000-0000-0000-000000000001','2026-07-01',18000,'THB','monthly','2026-06-30');
      insert into public.ees_driver_vehicle_assignments(driver_id,vehicle_id,effective_from,effective_to,assignment_kind)
      values (9007199254740993,'10000000-0000-0000-0000-000000000001','2026-07-01','2026-07-16','permanent'),
             (9007199254740993,'10000000-0000-0000-0000-000000000002','2026-07-16',null,'permanent');
    `);
    const driverText = await db.query('select * from public.list_vehicle_financial_draft_drivers()');
    assert.equal(driverText.rows[0].driver_id, '9007199254740993');
    const allocationRows = [
      { source_sheet:'Monthly',source_row:2,driver_id:'9007199254740993',vehicle_id:'10000000-0000-0000-0000-000000000001',source_salary:9000,assignment_from:'2026-07-01',assignment_to:'2026-07-15' },
      { source_sheet:'Monthly',source_row:3,driver_id:'9007199254740993',vehicle_id:'10000000-0000-0000-0000-000000000002',source_salary:9000,assignment_from:'2026-07-16',assignment_to:'2026-07-31' }
    ];
    const verifySalary = async rows => (await db.query('select public.verify_vehicle_financial_salary_allocations($1::date,$2::jsonb,$3::uuid) as result', [
      '2026-07-01',JSON.stringify(rows),'00000000-0000-0000-0000-000000000001'
    ])).rows[0].result;
    const validMultiAllocation = await verifySalary(allocationRows);
    assert.equal(validMultiAllocation.status, 'allocation_review');
    assert.equal(validMultiAllocation.multi_vehicle_rows, 2);
    assert.deepEqual(validMultiAllocation.rows.map(row => row.issue_codes), [
      ['multi_vehicle_salary_allocation_requires_reviewer'],
      ['multi_vehicle_salary_allocation_requires_reviewer']
    ]);
    assert.doesNotMatch(JSON.stringify(validMultiAllocation), /18000|9000|30000000/);
    await db.query("update public.ees_driver_vehicle_assignments set assignment_kind='temporary',effective_to='2026-07-15' where vehicle_id='10000000-0000-0000-0000-000000000001'");
    const inclusiveTemporaryEnd = await verifySalary(allocationRows);
    assert.deepEqual(inclusiveTemporaryEnd.rows.map(row => row.issue_codes), [
      ['multi_vehicle_salary_allocation_requires_reviewer'],
      ['multi_vehicle_salary_allocation_requires_reviewer']
    ]);
    await db.query("update public.ees_driver_vehicle_assignments set assignment_kind='permanent',effective_to='2026-07-16' where vehicle_id='10000000-0000-0000-0000-000000000001'");
    await db.query("update public.ees_employee_compensation set period='daily'");
    const payrollPeriodMismatch = await verifySalary(allocationRows);
    assert.ok(payrollPeriodMismatch.rows.every(row => row.issue_codes.includes('monthly_thb_payroll_required')));
    await db.query("update public.ees_employee_compensation set period='monthly'");
    const payrollMismatch = await verifySalary(allocationRows.map(row => ({ ...row, source_salary: 10000 })));
    assert.ok(payrollMismatch.rows.every(row => row.issue_codes.includes('employee_month_salary_allocation_mismatch')));
    const assignmentMismatch = await verifySalary([{ ...allocationRows[1], assignment_from:'2026-07-15' }]);
    assert.ok(assignmentMismatch.rows[0].issue_codes.includes('dated_vehicle_assignment_mismatch'));
    await db.query("update public.ees_employee_profiles set updated_at='2026-09-01'");
    const identityHistoryMismatch = await verifySalary([allocationRows[0]]);
    assert.ok(identityHistoryMismatch.rows[0].issue_codes.includes('employee_identity_history_requires_review'));
    const noIdentity = await verifySalary([{ ...allocationRows[0], driver_id:'77' }]);
    assert.ok(noIdentity.rows[0].issue_codes.includes('employee_profile_missing'));
    await assert.rejects(db.query('select public.verify_vehicle_financial_salary_allocations($1::date,$2::jsonb,$3::uuid)', [
      '2026-07-01',JSON.stringify(allocationRows),'00000000-0000-0000-0000-000000000005'
    ]), /vehicle_finance_salary_check_forbidden/);
    const batch = {
      reporting_month: '2026-07-01', version: 1, status: 'draft', source_file_name: 'synthetic.xlsx',
      source_sha256: 'a'.repeat(64), source_format: 'xlsx', source_size_bytes: 192,
      idempotency_hash: 'f'.repeat(64),
      source_sheets: ['Monthly'], formula_reference: 'synthetic note, not policy approval',
      source_totals: { salary: 18000, tripPayments: 4500.5 }, source_controls: [{ kind: 'excluded_dummy', sheet: 'Monthly', row: 3, values: ['DUMMY','999.00',0,0,0,0,0,0,'',0] }],
      expected_vehicle_ids: ['10000000-0000-0000-0000-000000000001'],
      validation_snapshot: { readyForReview: true, issues: [] }, content_hash: 'b'.repeat(64),
      historical_correction: { explicitlyRequestedByOwner: true, reason: 'synthetic owner request', baseVersion: 1 },
      salary_verification: null, formula_version: 'vehicle-finance-v4-v1'
    };
    const entry = {
      vehicle_id: '10000000-0000-0000-0000-000000000001', registration_source: '8453', registration_snapshot: 'ฒอ-8453',
      assigned_employee_id: '20000000-0000-0000-0000-000000000001', source_sheet: 'Monthly', source_row: 2,
      source_values: { registration: '8453', salary: '18,000.00', tripPayments: '4,500.50' },
      raw_cells: ['8453','18,000.00',12,'4,500.50',50,10,40000,700,'',20],
      salary: 18000, jobs_completed: 12, trip_payments: 4500.5, expenses: 50, parking_fees: 10,
      total_received: 40000, fuel: 700, lpg: null, lpg_treatment: 'included_in_fuel', maintenance: 20
    };
    const insert = await db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid) as result', [JSON.stringify(batch), JSON.stringify([entry]), '00000000-0000-0000-0000-000000000003']);
    const created = insert.rows[0].result;
    assert.equal(created.version, 1);
    assert.equal(created.status, 'draft');
    const savedControls = await db.query('select source_controls from public.vehicle_financial_import_batches where id=$1', [created.id]);
    assert.equal(savedControls.rows[0].source_controls[0].kind, 'excluded_dummy');
    assert.equal(savedControls.rows[0].source_controls[0].values[0], 'DUMMY');
    const persisted = await db.query('select salary,trip_payments,jobs_completed,lpg,lpg_treatment,source_values,raw_cells from public.vehicle_financial_draft_entries where batch_id=$1', [created.id]);
    assert.equal(persisted.rows[0].salary, '18000.00');
    assert.equal(persisted.rows[0].trip_payments, '4500.50');
    assert.equal(persisted.rows[0].jobs_completed, 12);
    assert.equal(persisted.rows[0].lpg, null);
    assert.equal(persisted.rows[0].lpg_treatment, 'included_in_fuel');
    assert.equal(persisted.rows[0].source_values.salary, '18,000.00');
    assert.deepEqual(persisted.rows[0].raw_cells, []);
    await assert.rejects(db.query('update public.vehicle_financial_draft_entries set salary=0 where batch_id=$1', [created.id]), /vehicle_finance_history_immutable/);
    await assert.rejects(db.query('update public.vehicle_financial_import_batches set source_file_name=\'rewritten.xlsx\' where id=$1', [created.id]), /vehicle_finance_batch_content_immutable/);

    const unknownBatch = { ...batch, version: 2, status: 'draft', idempotency_hash: 'e'.repeat(64), content_hash: 'd'.repeat(64), validation_snapshot: { readyForReview: false, issues: [{ code: 'missing_salary' }] } };
    const unknownEntry = { ...entry, vehicle_id: null, registration_snapshot: null, assigned_employee_id: null, assigned_employee_name_snapshot: null, source_sheet: 'Other', source_row: 9, salary: null, jobs_completed: null, trip_payments: null, expenses: null, parking_fees: null, total_received: null, fuel: null, lpg: null, lpg_treatment: 'unknown', maintenance: null };
    const unknownInsert = await db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid) as result', [JSON.stringify(unknownBatch), JSON.stringify([unknownEntry]), '00000000-0000-0000-0000-000000000001']);
    const needsReview = await db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid) as result', [unknownInsert.rows[0].result.id,'validate','d'.repeat(64),'Unknown values need review','00000000-0000-0000-0000-000000000001']);
    assert.equal(needsReview.rows[0].result.status, 'needs_review');
    const unknownStored = await db.query('select salary,lpg,lpg_treatment from public.vehicle_financial_draft_entries where batch_id=$1', [unknownInsert.rows[0].result.id]);
    assert.equal(unknownStored.rows[0].salary, null);
    assert.equal(unknownStored.rows[0].lpg, null);
    assert.equal(unknownStored.rows[0].lpg_treatment, 'unknown');

    await assert.rejects(db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid)', [JSON.stringify(batch), JSON.stringify([entry]), '00000000-0000-0000-0000-000000000003']), /vehicle_finance_duplicate_import|duplicate key/i);
    await assert.rejects(db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid)', [JSON.stringify({ ...batch, source_sha256: 'e'.repeat(64) }), JSON.stringify([entry]), '00000000-0000-0000-0000-000000000005']), /vehicle_finance_import_forbidden/);

    await assert.rejects(db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid)', [created.id,'submit_review','c'.repeat(64),'stale validation','00000000-0000-0000-0000-000000000003']), /vehicle_finance_content_changed/);
    const validated = await db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid) as result', [created.id,'validate','b'.repeat(64),'Validate source and totals','00000000-0000-0000-0000-000000000003']);
    assert.equal(validated.rows[0].result.status, 'validated');
    await db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid)', [created.id,'submit_review','b'.repeat(64),'Ready for independent review','00000000-0000-0000-0000-000000000003']);
    await assert.rejects(db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid)', [created.id,'approve','b'.repeat(64),'Self approval','00000000-0000-0000-0000-000000000003']), /vehicle_finance_approval_requires_independent_reviewer/);
    await assert.rejects(db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid)', [created.id,'approve','b'.repeat(64),'Staff approval','00000000-0000-0000-0000-000000000002']), /vehicle_finance_approval_forbidden/);
    await db.query('select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid)', [created.id,'approve','b'.repeat(64),'Admin review','00000000-0000-0000-0000-000000000004']);
    const approval = await db.query('select reviewer_id,decision from public.vehicle_financial_review_approvals where batch_id=$1', [created.id]);
    assert.equal(approval.rows[0].reviewer_id, '00000000-0000-0000-0000-000000000004');
    assert.equal(approval.rows[0].decision, 'approved');

    const transitionSql = 'select public.transition_vehicle_financial_draft($1::uuid,$2,$3,$4,$5::uuid,$6::jsonb) as result';
    const stageBatch = async (month, version, hashChar, idempotencyChar, entries) => {
      const candidate = { ...batch, reporting_month: month, version, content_hash: hashChar.repeat(64),
        idempotency_hash: idempotencyChar.repeat(64), historical_correction: null };
      const result = await db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid) as result',
        [JSON.stringify(candidate),JSON.stringify(entries),'00000000-0000-0000-0000-000000000003']);
      const id = result.rows[0].result.id;
      await db.query(transitionSql,[id,'validate',candidate.content_hash,'Synthetic validation','00000000-0000-0000-0000-000000000003',null]);
      await db.query(transitionSql,[id,'submit_review',candidate.content_hash,'Synthetic review','00000000-0000-0000-0000-000000000003',null]);
      return { id, hash: candidate.content_hash };
    };
    const secondVehicle = { ...entry, vehicle_id:'10000000-0000-0000-0000-000000000002',
      registration_source:'SYNTHETIC-2', registration_snapshot:'กข-1234', source_row:3,
      source_values:{ registration:'SYNTHETIC-2',salary:'9,000.00' }, salary:9000,
      lpg:0,lpg_treatment:'separate' };
    const augustFirst = await stageBatch('2026-08-01',1,'1','2',[entry]);
    await db.query(transitionSql,[augustFirst.id,'approve',augustFirst.hash,'First approval','00000000-0000-0000-0000-000000000004',null]);
    const augustNext = await stageBatch('2026-08-01',2,'3','4',[entry,secondVehicle]);
    await assert.rejects(db.query(transitionSql,[augustNext.id,'approve',augustNext.hash,'Overlapping approval','00000000-0000-0000-0000-000000000004',null]), /vehicle_finance_current_approval_conflict/);
    await assert.rejects(db.query(transitionSql,[augustNext.id,'supersede',augustNext.hash,'Stale supersession','00000000-0000-0000-0000-000000000004',
      JSON.stringify({ [entry.vehicle_id]:'00000000-0000-0000-0000-000000000001', [secondVehicle.vehicle_id]:null })]), /vehicle_finance_supersession_snapshot_stale/);
    await db.query(transitionSql,[augustNext.id,'supersede',augustNext.hash,'Reviewed vehicle-level replacement','00000000-0000-0000-0000-000000000004',
      JSON.stringify({ [entry.vehicle_id]:augustFirst.id, [secondVehicle.vehicle_id]:null })]);
    const currentAugust = await db.query("select vehicle_id,batch_id from public.vehicle_financial_current_approvals where reporting_month='2026-08-01' order by vehicle_id");
    assert.equal(currentAugust.rows.length,2);
    assert.ok(currentAugust.rows.every(row => row.batch_id===augustNext.id));
    const augustHistory = await db.query("select action,previous_batch_id from public.vehicle_financial_approval_history where reporting_month='2026-08-01' order by created_at,id");
    assert.equal(augustHistory.rows.length,3);
    assert.ok(augustHistory.rows.some(row => row.action==='superseded' && row.previous_batch_id===augustFirst.id));
    const priorApproval = await db.query('select count(*)::integer as count from public.vehicle_financial_review_approvals where batch_id=$1',[augustFirst.id]);
    assert.equal(priorApproval.rows[0].count,1);
    const formerBatch = await db.query('select status from public.vehicle_financial_import_batches where id=$1',[augustFirst.id]);
    assert.equal(formerBatch.rows[0].status,'approved');
    await assert.rejects(db.query('delete from public.vehicle_financial_approval_history where reporting_month=$1',['2026-08-01']), /vehicle_finance_history_immutable/);
    const augustOldEntry = await db.query('select id from public.vehicle_financial_draft_entries where batch_id=$1',[augustFirst.id]);
    await assert.rejects(db.query('insert into public.vehicle_financial_publications(reporting_month,vehicle_id,entry_id,batch_id,published_by) values($1,$2,$3,$4,$5)',
      ['2026-08-01',entry.vehicle_id,augustOldEntry.rows[0].id,augustFirst.id,'00000000-0000-0000-0000-000000000004']), /vehicle_finance_publication_not_current_approval/);
    const augustCurrentEntry = await db.query('select id from public.vehicle_financial_draft_entries where batch_id=$1 and vehicle_id=$2',[augustNext.id,entry.vehicle_id]);
    await db.query('insert into public.vehicle_financial_publications(reporting_month,vehicle_id,entry_id,batch_id,published_by) values($1,$2,$3,$4,$5)',
      ['2026-08-01',entry.vehicle_id,augustCurrentEntry.rows[0].id,augustNext.id,'00000000-0000-0000-0000-000000000004']);
    const augustLater = await stageBatch('2026-08-01',3,'9','a',[entry]);
    await assert.rejects(db.query(transitionSql,[augustLater.id,'supersede',augustLater.hash,'Published vehicle cannot be superseded','00000000-0000-0000-0000-000000000004',
      JSON.stringify({ [entry.vehicle_id]:augustNext.id })]), /vehicle_finance_approved_vehicle_already_published/);
    const septemberFirst = await stageBatch('2026-09-01',1,'5','6',[entry]);
    const septemberNext = await stageBatch('2026-09-01',2,'7','8',[entry]);
    const concurrent = await Promise.allSettled([
      db.query(transitionSql,[septemberFirst.id,'approve',septemberFirst.hash,'Concurrent A','00000000-0000-0000-0000-000000000004',null]),
      db.query(transitionSql,[septemberNext.id,'approve',septemberNext.hash,'Concurrent B','00000000-0000-0000-0000-000000000004',null])
    ]);
    assert.equal(concurrent.filter(result => result.status==='fulfilled').length,1);
    assert.equal(concurrent.filter(result => result.status==='rejected').length,1);
    const currentSeptember = await db.query("select count(*)::integer as count from public.vehicle_financial_current_approvals where reporting_month='2026-09-01'");
    assert.equal(currentSeptember.rows[0].count,1);

    const publication = { reporting_month: '2026-07-01', vehicle_id: '10000000-0000-0000-0000-000000000001', entry_id: persisted.rows[0].id, batch_id: created.id, published_by: '00000000-0000-0000-0000-000000000004' };
    const entryRow = await db.query('select id from public.vehicle_financial_draft_entries where batch_id=$1', [created.id]);
    publication.entry_id = entryRow.rows[0].id;
    await db.query('insert into public.vehicle_financial_publications(reporting_month,vehicle_id,entry_id,batch_id,published_by) values($1,$2,$3,$4,$5)', Object.values(publication));
    await assert.rejects(db.query('insert into public.vehicle_financial_publications(reporting_month,vehicle_id,entry_id,batch_id,published_by) values($1,$2,$3,$4,$5)', Object.values(publication)), /vehicle_financial_publications_reporting_month_vehicle_id_key|duplicate key/i);
    await assert.rejects(db.query("insert into public.vehicle_financial_publications(reporting_month,vehicle_id,entry_id,batch_id,published_by) values('2026-08-01',$1,$2,$3,$4)", [publication.vehicle_id, publication.entry_id, publication.batch_id, publication.published_by]), /vehicle_finance_publication_reference_mismatch/);

    const access = await db.query("select has_function_privilege('authenticated','public.create_vehicle_financial_draft(jsonb,jsonb,uuid)','execute') as can_insert");
    assert.equal(access.rows[0].can_insert, false);
    const directAccess = await db.query("select has_table_privilege('authenticated','public.vehicle_financial_import_batches','select') as can_read, has_table_privilege('authenticated','public.vehicle_financial_import_batches','insert') as can_write");
    assert.deepEqual(directAccess.rows[0], { can_read: false, can_write: false });
    const publicationGrant = await db.query("select has_table_privilege('service_role','public.vehicle_financial_publications','insert') as can_publish");
    assert.equal(publicationGrant.rows[0].can_publish, false);
    const truncateGrant = await db.query("select has_table_privilege('authenticated','public.vehicle_monthly_performance','TRUNCATE') as can_truncate");
    assert.equal(truncateGrant.rows[0].can_truncate,false);
    const defaultMode = await db.query("select mode from public.vehicle_financial_write_control where control_key='vehicle_monthly_performance'");
    assert.equal(defaultMode.rows[0].mode, 'legacy_enabled');
    const untouchedLegacy = await db.query("select year,month,vehicle_registration from public.vehicle_monthly_performance where id='40000000-0000-0000-0000-000000000001'");
    assert.deepEqual(untouchedLegacy.rows[0], { year: 2026, month: 1, vehicle_registration: 'SYNTHETIC-LEGACY-JAN' });
    await db.query("update public.vehicle_monthly_performance set vehicle_registration='SYNTHETIC-LEGACY-JAN-EDITED' where id='40000000-0000-0000-0000-000000000001'");
    await db.query("delete from public.vehicle_monthly_performance where id='40000000-0000-0000-0000-000000000001'");
    await db.query("insert into public.vehicle_monthly_performance(year,month,vehicle_registration) values(2026,7,'TEST-DEFAULT')");
    const writeMode = await db.query("select public.set_vehicle_financial_legacy_write_mode('v4_only','00000000-0000-0000-0000-000000000004','synthetic test cutover') as result");
    assert.equal(writeMode.rows[0].result.mode, 'v4_only');
    await assert.rejects(db.query("insert into public.vehicle_monthly_performance(year,month,vehicle_registration) values(2026,8,'TEST-1')"), /vehicle_finance_legacy_write_disabled/);
    await db.query("select public.set_vehicle_financial_legacy_write_mode('legacy_enabled','00000000-0000-0000-0000-000000000004','synthetic rollback')");
    await db.query("insert into public.vehicle_monthly_performance(year,month,vehicle_registration) values(2026,8,'TEST-1')");
    await db.query("delete from public.vehicle_financial_write_control where control_key='vehicle_monthly_performance'");
    await assert.rejects(db.query("insert into public.vehicle_monthly_performance(year,month,vehicle_registration) values(2026,9,'TEST-MISSING-GATE')"), /vehicle_finance_write_control_missing/);
    await db.query("select public.recover_vehicle_financial_legacy_write_control($1::uuid,$2::text)", ['00000000-0000-0000-0000-000000000004','c'.repeat(64)]);
    const controlConstraint = await db.query("select conname from pg_constraint where conrelid='public.vehicle_financial_write_control'::regclass and pg_get_constraintdef(oid) like '%legacy_enabled%'");
    assert.equal(controlConstraint.rows.length, 1);
    await db.exec(`alter table public.vehicle_financial_write_control drop constraint ${controlConstraint.rows[0].conname}`);
    await db.query("update public.vehicle_financial_write_control set mode='corrupt' where control_key='vehicle_monthly_performance'");
    await assert.rejects(db.query("insert into public.vehicle_monthly_performance(year,month,vehicle_registration) values(2026,10,'TEST-INVALID-GATE')"), /vehicle_finance_write_control_invalid/);
    await db.query("select public.recover_vehicle_financial_legacy_write_control($1::uuid,$2::text)", ['00000000-0000-0000-0000-000000000004','d'.repeat(64)]);
    const recoveredMode = await db.query("select mode from public.vehicle_financial_write_control where control_key='vehicle_monthly_performance'");
    assert.equal(recoveredMode.rows[0].mode, 'legacy_enabled');
    await db.query("insert into public.vehicle_monthly_performance(year,month,vehicle_registration) values(2026,10,'TEST-RECOVERED')");
    const rls = await db.query("select relrowsecurity from pg_class where oid='public.vehicle_financial_draft_entries'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
    const securedFunctions = await db.query(`select
      has_function_privilege('anon','public.approve_vehicle_financial_policy(text,text,text,text,text,text,text,text,text,uuid)','execute') as anon_policy,
      has_function_privilege('authenticated','public.recover_vehicle_financial_legacy_write_control(uuid,text)','execute') as user_recovery,
      has_function_privilege('service_role','public.recover_vehicle_financial_legacy_write_control(uuid,text)','execute') as service_recovery,
      has_function_privilege('authenticated','public.verify_vehicle_financial_salary_allocations(date,jsonb,uuid)','execute') as user_hr_check,
      has_function_privilege('service_role','public.verify_vehicle_financial_salary_allocations(date,jsonb,uuid)','execute') as service_hr_check`);
    assert.deepEqual(securedFunctions.rows[0], { anon_policy: false, user_recovery: false, service_recovery: true, user_hr_check: false, service_hr_check: true });
  } finally { await db.close(); }
});
