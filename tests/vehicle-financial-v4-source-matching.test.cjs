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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      resolveJsonModule: true,
      esModuleInterop: true
    }
  }).outputText;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(aliases, request)) return aliases[request];
    if (request.endsWith('.json') || request.includes('source-vehicle-mappings')) {
      const jsonPath = request.startsWith('.') || request.startsWith('/') || /^[A-Za-z]:/.test(request)
        ? path.resolve(path.dirname(parent.filename), request)
        : path.resolve(request);
      const resolved = fs.existsSync(jsonPath) ? jsonPath : path.resolve('data/vehicle-performance-v4/source-vehicle-mappings.json');
      return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(output, filename); }
  finally { Module._load = originalLoad; }
  return loaded.exports;
}

const utils = loadTypeScript('lib/utils.ts');
const identity = loadTypeScript('lib/vehicle-identity.ts', { '@/lib/utils': utils });
const matching = loadTypeScript('lib/vehicle-financial-v4-source-matching.ts', {
  '@/lib/vehicle-identity': identity,
  '../data/vehicle-performance-v4/source-vehicle-mappings.json': JSON.parse(
    fs.readFileSync(path.resolve('data/vehicle-performance-v4/source-vehicle-mappings.json'), 'utf8')
  )
});

const OPERATIONAL_G = {
  id: '39f2dd25-0796-4297-8948-c5f639d6590e',
  vehicle_reg: '3ฒล-4565'
};
const DUPLICATE_AUNITE_G = {
  id: '4fdab7a0-4b26-4a56-a9c8-003191efd0fd',
  vehicle_reg: '3ฒล-4565'
};
const OTHER = { id: 'veh-8453', vehicle_reg: 'ฒอ-8453' };

test('explicit V4 mapping resolves 3ฒล-4565 to operational vehicle G despite duplicate directory rows', () => {
  const match = matching.resolveV4SourceVehicleMatch('3ฒล-4565', [DUPLICATE_AUNITE_G, OPERATIONAL_G, OTHER]);
  assert.equal(match.status, 'matched');
  assert.equal(match.mappingApplied, true);
  assert.equal(match.ownerConfirmed, true);
  assert.equal(match.vehicleId, OPERATIONAL_G.id);
  assert.equal(match.displayRegistration, '3ฒล-4565');
  assert.equal(match.canonicalRegistration, '3ฒล-4565');
  assert.ok(!match.candidateVehicleIds.includes(DUPLICATE_AUNITE_G.id));
});

test('explicit mapping also accepts the abbreviated source alias 4565 without becoming a general last-four rule', () => {
  const match = matching.resolveV4SourceVehicleMatch('4565', [OPERATIONAL_G, DUPLICATE_AUNITE_G]);
  assert.equal(match.status, 'matched');
  assert.equal(match.vehicleId, OPERATIONAL_G.id);
  assert.equal(matching.resolveV4SourceVehicleMatch('ABC-4565', [OPERATIONAL_G, DUPLICATE_AUNITE_G]).status, 'missing');
  assert.equal(matching.resolveV4SourceVehicleMatch('4ฒล-4565', [OPERATIONAL_G, DUPLICATE_AUNITE_G]).status, 'missing');
});

test('August and September source rows for 3ฒล-4565 match through the explicit V4 mapping', () => {
  for (const month of ['2026-08', '2026-09']) {
    const report = JSON.parse(fs.readFileSync(path.resolve(`data/vehicle-performance-v4/previews/${month}.json`), 'utf8'));
    assert.equal(report.rows.length, 21);
    const row = report.rows.find(item => item.registration === '3ฒล-4565');
    assert.ok(row, `${month} must include 3ฒล-4565`);
    const match = matching.resolveV4SourceVehicleMatch(row.registration, [DUPLICATE_AUNITE_G, OPERATIONAL_G, OTHER]);
    assert.equal(match.status, 'matched');
    assert.equal(match.vehicleId, OPERATIONAL_G.id);
    assert.equal(match.displayRegistration, '3ฒล-4565');
  }
});

test('without an explicit mapping, duplicate same-registration rows stay ambiguous', () => {
  const vehicles = [
    { id: 'a', vehicle_reg: '61-2835' },
    { id: 'b', vehicle_reg: '61-2835' }
  ];
  const match = matching.resolveV4SourceVehicleMatch('61-2835', vehicles);
  assert.equal(match.status, 'ambiguous');
  assert.equal(match.mappingApplied, false);
  assert.equal(match.vehicleId, null);
});

test('mapping catalog forbids general last-four matching and preserves financial preview integrity', () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve('data/vehicle-performance-v4/source-vehicle-mappings.json'), 'utf8'));
  assert.equal(catalog.policy.noGeneralLastFourMatching, true);
  assert.equal(catalog.policy.doNotCreateVehicles, true);
  assert.equal(catalog.mappings[0].canonicalVehicleId, OPERATIONAL_G.id);
  assert.deepEqual(catalog.mappings[0].ignoredDuplicateVehicleIds, [DUPLICATE_AUNITE_G.id]);
  for (const month of ['2026-08', '2026-09']) {
    const report = JSON.parse(fs.readFileSync(path.resolve(`data/vehicle-performance-v4/previews/${month}.json`), 'utf8'));
    assert.equal(report.rows.length, 21);
    assert.ok(report.sourceFooterTotals.totalReceived);
    assert.ok(report.sourceFooterTotals.salary);
  }
});
