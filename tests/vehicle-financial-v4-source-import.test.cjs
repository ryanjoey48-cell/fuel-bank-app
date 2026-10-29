const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function loadTypeScript(relativePath, stubs = {}) {
  const filename = path.resolve(relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true }
  }).outputText;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    if (request === 'next/server') return nextServer;
    if (request.startsWith('@/lib/')) {
      return loadTypeScript(request.replace('@/lib/', 'lib/') + '.ts', stubs);
    }
    if (String(request).includes('source-vehicle-mappings.json') || String(request).endsWith('.json')) {
      const candidates = [
        path.resolve(path.dirname(parent.filename), request),
        path.resolve('data/vehicle-performance-v4/source-vehicle-mappings.json')
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        }
      }
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

const importModule = loadTypeScript('lib/vehicle-financial-v4-source-import.ts');
const mappingCatalog = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/source-vehicle-mappings.json'), 'utf8'));
const mapped4565 = mappingCatalog.mappings[0];

function loadPreview(month) {
  return JSON.parse(fs.readFileSync(path.resolve(`data/vehicle-performance-v4/previews/${month}.json`), 'utf8'));
}

test('Aug/Sep import payloads preserve 42 rows, nine controls, unknowns, 4565 mapping and Sep provisional salary', () => {
  const august = loadPreview('2026-08');
  const september = loadPreview('2026-09');
  const vehicles = [{ id: mapped4565.canonicalVehicleId, vehicle_reg: mapped4565.canonicalRegistration }];
  const augustBuilt = importModule.buildVehicleFinancialV4SourceImport(august, { vehicles });
  const septemberBuilt = importModule.buildVehicleFinancialV4SourceImport(september, { vehicles });

  importModule.assertSourceImportReconciliation(august, augustBuilt);
  importModule.assertSourceImportReconciliation(september, septemberBuilt);

  assert.equal(august.rows.length, 21);
  assert.equal(september.rows.length, 21);
  assert.equal(augustBuilt.entries.length + septemberBuilt.entries.length, 42);

  assert.equal(augustBuilt.reconciliation.controlTotals.totalReceived, 3581914);
  assert.equal(augustBuilt.reconciliation.controlTotals.maintenance, 27660);
  assert.equal(augustBuilt.reconciliation.controlTotals.lpg, 7292.1);
  assert.equal(augustBuilt.reconciliation.controlTotals.salary, 159500);

  assert.equal(septemberBuilt.reconciliation.controlTotals.totalReceived, 3819401);
  assert.equal(septemberBuilt.reconciliation.controlTotals.maintenance, 104690);
  assert.equal(septemberBuilt.reconciliation.controlTotals.lpg, 7962.31);
  assert.equal(septemberBuilt.reconciliation.controlTotals.salary, 159500);

  assert.equal(augustBuilt.reconciliation.mapped4565VehicleId, mapped4565.canonicalVehicleId);
  assert.equal(septemberBuilt.reconciliation.mapped4565VehicleId, mapped4565.canonicalVehicleId);

  const incomplete = augustBuilt.entries.filter(entry => entry.maintenance == null);
  assert.ok(incomplete.length >= 10);
  assert.ok(incomplete.every(entry => entry.maintenance === null));

  const lpg = augustBuilt.entries.find(entry => /8453/.test(entry.registration_source));
  assert.equal(lpg.lpg_treatment, 'separate');
  assert.equal(lpg.lpg, 7292.1);

  assert.equal(augustBuilt.batch.salary_verification, null);
  assert.equal(septemberBuilt.batch.salary_verification.status, 'provisional');
  assert.equal(septemberBuilt.batch.validation_snapshot.liveKpiEligible, false);
  assert.equal(septemberBuilt.batch.validation_snapshot.publicationEnabled, false);
});

test('idempotent import hashes are stable for the same preview content and diverge across months', () => {
  const august = loadPreview('2026-08');
  const september = loadPreview('2026-09');
  const first = importModule.buildVehicleFinancialV4SourceImport(august);
  const second = importModule.buildVehicleFinancialV4SourceImport(august);
  const sep = importModule.buildVehicleFinancialV4SourceImport(september);
  assert.equal(first.batch.idempotency_hash, second.batch.idempotency_hash);
  assert.equal(first.batch.content_hash, second.batch.content_hash);
  assert.notEqual(first.batch.idempotency_hash, sep.batch.idempotency_hash);
});

test('parsePreviewAmount never coerces blanks or dashes to zero', () => {
  assert.equal(importModule.parsePreviewAmount(null), null);
  assert.equal(importModule.parsePreviewAmount(''), null);
  assert.equal(importModule.parsePreviewAmount('—'), null);
  assert.equal(importModule.parsePreviewAmount('0'), 0);
  assert.equal(importModule.parsePreviewAmount('7292.1'), 7292.1);
});

test('synthetic PGlite import stores Aug/Sep drafts without touching Jan–Jul legacy KPI rows', async () => {
  const august = loadPreview('2026-08');
  const september = loadPreview('2026-09');
  const vehicles = [{ id: mapped4565.canonicalVehicleId, vehicle_reg: mapped4565.canonicalRegistration }];
  const augustBuilt = importModule.buildVehicleFinancialV4SourceImport(august, { vehicles });
  const septemberBuilt = importModule.buildVehicleFinancialV4SourceImport(september, { vehicles });

  for (const built of [augustBuilt, septemberBuilt]) {
    for (const entry of built.entries) {
      if (!entry.vehicle_id) {
        entry.vehicle_id = crypto.randomUUID();
        entry.registration_snapshot = entry.registration_snapshot || entry.registration_source;
      }
    }
    built.batch.expected_vehicle_ids = [...new Set(built.entries.map(entry => entry.vehicle_id))];
  }

  const db = new PGlite();
  const migration = fs.readFileSync(path.resolve('supabase/migrations/20261026090000_vehicle_financial_drafts_v4.sql'), 'utf8');
  const actor = '00000000-0000-0000-0000-000000000003';
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
      create table public.vehicle_monthly_performance(
        id uuid primary key default gen_random_uuid(), year integer, month integer, vehicle_registration text,
        salary_cost numeric not null default 0, trip_income numeric not null default 0,
        other_expenses numeric not null default 0, gross_revenue numeric not null default 0, lpg_cost numeric not null default 0
      );
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
      insert into auth.users(id) values ('${actor}');
      insert into public.account_access values ('${actor}','admin','active');
      insert into public.drivers(id,name) values (1,'Synthetic');
      insert into public.vehicle_monthly_performance(id,year,month,vehicle_registration,gross_revenue)
        values ('40000000-0000-0000-0000-000000000001',2026,1,'LEGACY-JAN',111);
      insert into public.vehicle_monthly_performance(id,year,month,vehicle_registration,gross_revenue)
        values ('40000000-0000-0000-0000-000000000007',2026,7,'LEGACY-JUL',777);
    `);

    const allVehicles = new Map();
    for (const entry of [...augustBuilt.entries, ...septemberBuilt.entries]) {
      allVehicles.set(entry.vehicle_id, entry.registration_snapshot || entry.registration_source);
    }
    for (const [id, reg] of allVehicles.entries()) {
      await db.query('insert into public.vehicles(id, vehicle_reg) values($1,$2)', [id, reg]);
    }
    await db.exec(migration);

    const augustInsert = await db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid) as result', [
      JSON.stringify(augustBuilt.batch), JSON.stringify(augustBuilt.entries), actor
    ]);
    const septemberInsert = await db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid) as result', [
      JSON.stringify(septemberBuilt.batch), JSON.stringify(septemberBuilt.entries), actor
    ]);
    assert.equal(augustInsert.rows[0].result.status, 'draft');
    assert.equal(septemberInsert.rows[0].result.status, 'draft');

    await assert.rejects(db.query('select public.create_vehicle_financial_draft($1::jsonb,$2::jsonb,$3::uuid)', [
      JSON.stringify(augustBuilt.batch), JSON.stringify(augustBuilt.entries), actor
    ]), /vehicle_finance_duplicate_import|duplicate key/i);

    const counts = await db.query('select count(*)::int as count from public.vehicle_financial_draft_entries');
    assert.equal(counts.rows[0].count, 42);

    const unknownMaint = await db.query("select count(*)::int as count from public.vehicle_financial_draft_entries where maintenance is null");
    assert.ok(unknownMaint.rows[0].count > 0);

    const zeroCoercion = await db.query(`
      select count(*)::int as count
      from public.vehicle_financial_draft_entries e
      join public.vehicle_financial_import_batches b on b.id = e.batch_id
      where b.reporting_month = '2026-08-01'
        and e.registration_source like '%4565%'
        and e.trip_payments is null
        and e.expenses is null
        and e.maintenance is null
    `);
    assert.equal(zeroCoercion.rows[0].count, 1);

    const sepSalary = await db.query("select salary_verification->>'status' as status from public.vehicle_financial_import_batches where reporting_month='2026-09-01'");
    assert.equal(sepSalary.rows[0].status, 'provisional');

    const legacy = await db.query('select month, vehicle_registration, gross_revenue::text as gross from public.vehicle_monthly_performance order by month');
    assert.deepEqual(legacy.rows, [
      { month: 1, vehicle_registration: 'LEGACY-JAN', gross: '111' },
      { month: 7, vehicle_registration: 'LEGACY-JUL', gross: '777' }
    ]);
  } finally {
    await db.close();
  }
});

test('Fleet Overview baseline and legacy KPI helpers still exclude Aug/Sep and coerce null to zero', () => {
  const page = fs.readFileSync(path.resolve('app/(dashboard)/vehicle-performance/page.tsx'), 'utf8');
  assert.match(page, /VEHICLE_PERFORMANCE_BASELINE_MONTHS = \[1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(page, /Legacy Fleet filters · January–July stored KPIs/);
  assert.doesNotMatch(page, /VEHICLE_PERFORMANCE_BASELINE_MONTHS = \[1, 2, 3, 4, 5, 6, 7, 8, 9\]/);

  const data = fs.readFileSync(path.resolve('lib/data.ts'), 'utf8');
  assert.match(data, /salary_cost: Number\(row\.salary_cost \|\| 0\)/);
  assert.match(data, /gross_revenue: Number\(row\.gross_revenue \|\| 0\)/);

  const performance = fs.readFileSync(path.resolve('lib/vehicle-performance.ts'), 'utf8');
  assert.match(performance, /const grossRevenue = Number\(input\.grossRevenue \|\| 0\);/);
  assert.match(performance, /const recordedBalance = grossRevenue - totalDirectCosts;/);

  const drafts = fs.readFileSync(path.resolve('components/vehicle-financial-drafts.tsx'), 'utf8');
  assert.match(drafts, /Legacy Fleet Overview uses January–July stored KPIs/);
});

test('V4 write lock stays closed by default and opens only with explicit env unlock', () => {
  const previous = process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED;
  try {
    delete process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED;
    const locked = loadTypeScript('lib/vehicle-financial-v4-release-lock.ts');
    assert.equal(locked.isVehicleFinancialV4WriteLocked(), true);

    process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED = 'true';
    const unlocked = loadTypeScript('lib/vehicle-financial-v4-release-lock.ts');
    assert.equal(unlocked.isVehicleFinancialV4WriteLocked(), false);

    process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED = 'false';
    const stillLocked = loadTypeScript('lib/vehicle-financial-v4-release-lock.ts');
    assert.equal(stillLocked.isVehicleFinancialV4WriteLocked(), true);

    const source = fs.readFileSync(path.resolve('lib/vehicle-financial-v4-release-lock.ts'), 'utf8');
    assert.match(source, /VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED !== "true"/);
  } finally {
    if (previous === undefined) delete process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED;
    else process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED = previous;
  }
});
