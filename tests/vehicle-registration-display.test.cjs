const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.resolve(relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(aliases, request)) return aliases[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(output, filename); }
  finally { Module._load = originalLoad; }
  return loaded.exports;
}

const utils = loadTypeScript('lib/utils.ts');
const identity = loadTypeScript('lib/vehicle-identity.ts', { '@/lib/utils': utils });

test('registration display never applies thousands separators or numeric coercion', () => {
  const examples = [
    ['61-2835', '61-2835'],
    ['61-6672', '61-6672'],
    ['62-4337', '62-4337'],
    ['68-7154', '68-7154'],
    ['700-4145', '700-4145'],
    ['701-1654', '701-1654'],
    ['79-5318', '79-5318'],
    ['ฒอ-8453', 'ฒอ-8453'],
    ['3ฒน-9565', '3ฒน-9565'],
    ['3ฒล-4565', '3ฒล-4565'],
    ['0700-4145', '0700-4145']
  ];
  for (const [input, expected] of examples) {
    assert.equal(identity.formatVehicleRegistrationDisplay(input), expected);
    assert.doesNotMatch(identity.formatVehicleRegistrationDisplay(input), /,/);
  }
  assert.equal(identity.formatVehicleRegistrationDisplay('  ฒอ-8453  '), 'ฒอ-8453');
});

test('registration search and sort preserve Thai characters and leading zeros', () => {
  assert.match(identity.vehicleRegistrationSearchText('ฒอ-8453'), /ฒอ-8453/i);
  assert.ok(identity.vehicleRegistrationSearchText('ฒอ-8453').includes('8453'));
  assert.ok(identity.compareVehicleRegistrations('0700-4145', '700-4145') < 0);
  assert.ok(identity.compareVehicleRegistrations('61-2835', '61-6672') < 0);
  assert.ok(identity.compareVehicleRegistrations('ฒอ-8453', '3ฒน-9565') !== 0);
  const sorted = ['79-5318', '0700-4145', 'ฒอ-8453', '61-2835'].sort(identity.compareVehicleRegistrations);
  assert.deepEqual(sorted[0], '0700-4145');
  assert.ok(sorted.includes('ฒอ-8453'));
});

test('canonical matching still resolves aliases without display commas', () => {
  assert.equal(identity.canonicalizeKnownVehicleRegistration('8453'), 'ฒอ-8453');
  assert.ok(identity.knownVehicleRegistrationAliases('ฒอ-8453').includes('8453'));
  assert.ok(identity.knownVehicleRegistrationAliases('3ฒล-4565').includes('4565'));
});

test('August and September preview JSON keep source registrations without commas', () => {
  for (const month of ['2026-08', '2026-09']) {
    const report = JSON.parse(fs.readFileSync(path.resolve(`data/vehicle-performance-v4/previews/${month}.json`), 'utf8'));
    assert.equal(report.rows.length, 21);
    for (const row of report.rows) {
      assert.equal(identity.formatVehicleRegistrationDisplay(row.registration), row.registration);
      assert.doesNotMatch(row.registration, /,/);
      assert.doesNotMatch(identity.formatVehicleRegistrationDisplay(row.registration), /,/);
    }
    assert.ok(report.rows.some(row => row.registration === 'ฒอ-8453'));
    assert.ok(report.rows.some(row => row.registration === '3ฒล-4565'));
    assert.ok(report.rows.some(row => row.registration === '61-2835'));
  }
});

test('V4 read-only UI displays registrations as identifiers and never formats them as money', () => {
  const component = fs.readFileSync(path.resolve('components/vehicle-financial-drafts.tsx'), 'utf8');
  assert.match(component, /formatVehicleRegistrationDisplay/);
  assert.match(component, /formatSourceAmount\(/);
  assert.match(component, /amountFor = \(field/);
  const previewFn = component.slice(component.indexOf('function ReadOnlySourcePreview'), component.indexOf('function SourceReportRequiredPanel'));
  assert.match(previewFn, /match\.displayRegistration|formatVehicleRegistrationDisplay\(row\.registration\)/);
  assert.doesNotMatch(previewFn, /formatSourceAmount\(row\.registration\)/);
  assert.match(previewFn, /if \(field === "registration"\) return null;/);
  assert.match(previewFn, /sticky left-0/);
  assert.match(component, /manageDataHelp/);
  assert.match(component, /resolveV4SourceVehicleMatch/);
  assert.match(component, /buildVehicleFinancialV4ManagementAnalysis/);
  assert.match(previewFn, /sourceFooterShort/);
  assert.match(previewFn, /text-right tabular-nums/);
  assert.doesNotMatch(previewFn, /max-h-\[min\(36rem/);
});
