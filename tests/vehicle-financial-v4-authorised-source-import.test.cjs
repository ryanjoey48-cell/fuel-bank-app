const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function loadTypeScript(relativePath) {
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
    if (request === 'next/server') return nextServer;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(output, filename);
    return loaded.exports;
  } finally {
    Module._load = originalLoad;
  }
}

test('narrow authorised source import stays disabled by default and allowlists only Aug/Sep', () => {
  const previousImport = process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT;
  const previousToken = process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN;
  const previousUnlock = process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED;
  try {
    delete process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT;
    delete process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN;
    delete process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED;

    const gate = loadTypeScript('lib/vehicle-financial-v4-authorised-source-import.ts');
    assert.equal(gate.isVehicleFinancialV4AuthorisedSourceImportEnabled(), false);
    assert.equal(gate.isAuthorisedImportMonth('2026-08'), true);
    assert.equal(gate.isAuthorisedImportMonth('2026-09'), true);
    assert.equal(gate.isAuthorisedImportMonth('2026-07'), false);

    process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT = 'true';
    process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN = 'test-token-value-32chars-minimum!!';
    const enabled = loadTypeScript('lib/vehicle-financial-v4-authorised-source-import.ts');
    assert.equal(enabled.isVehicleFinancialV4AuthorisedSourceImportEnabled(), true);
    assert.equal(enabled.authorisedSourceImportTokenMatches('test-token-value-32chars-minimum!!'), true);
    assert.equal(enabled.authorisedSourceImportTokenMatches('wrong-token'), false);

    const routeSource = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/authorised-source-import/route.ts'), 'utf8');
    assert.match(routeSource, /isVehicleFinancialV4AuthorisedSourceImportEnabled/);
    assert.match(routeSource, /isVehicleFinancialV4WriteLocked\(\)/);
    assert.match(routeSource, /canUseVehicleFinancialDrafts\(access, "approve"\)/);
    assert.match(routeSource, /buildVehicleFinancialV4SourceImport/);
    assert.match(routeSource, /v4_general_writes_must_remain_locked/);
    assert.match(routeSource, /!authorisedSourceImportTokenConfigured\(\)/);
    assert.match(routeSource, /authorisedSourceImportTokenMatches/);
    assert.doesNotMatch(routeSource, /if \(authorisedSourceImportTokenConfigured\(\)\)/);
    assert.doesNotMatch(routeSource, /isVehicleFinancialV4WriteLocked\(\) === false[\s\S]*create_vehicle_financial_draft/);
  } finally {
    if (previousImport === undefined) delete process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT;
    else process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT = previousImport;
    if (previousToken === undefined) delete process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN;
    else process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN = previousToken;
    if (previousUnlock === undefined) delete process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED;
    else process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED = previousUnlock;
  }
});

test('Release A keeps general financial writes locked while source-previews remain read-only', () => {
  const lockSource = fs.readFileSync(path.resolve('lib/vehicle-financial-v4-release-lock.ts'), 'utf8');
  assert.match(lockSource, /VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED !== "true"/);
  const previews = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/source-previews/route.ts'), 'utf8');
  assert.match(previews, /export async function GET/);
  assert.doesNotMatch(previews, /export async function POST/);
  assert.match(previews, /canUseVehicleFinancialDrafts\(access, "read"\)/);
  const drafts = fs.readFileSync(path.resolve('app/api/vehicle-performance-v4/drafts/route.ts'), 'utf8');
  assert.match(drafts, /if \(isVehicleFinancialV4WriteLocked\(\)\) return disabledVehicleFinancialV4WriteResponse\(\);/);
});
