const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function loadRoute(relativePath, dependencies = {}) {
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
    if (Object.hasOwn(dependencies, request)) return dependencies[request];
    if (request.startsWith('@/lib/')) return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(output, filename); }
  finally { Module._load = originalLoad; }
  return loaded.exports;
}

test('preview release lock rejects every V4 financial write before authentication or database access', async () => {
  const lock = loadRoute('lib/vehicle-financial-v4-release-lock.ts');
  assert.equal(lock.isVehicleFinancialV4WriteLocked(), true);
  const dependencies = { '@/lib/vehicle-financial-v4-release-lock': lock };
  const endpoints = [
    ['app/api/vehicle-performance-v4/drafts/route.ts', 'POST'],
    ['app/api/vehicle-performance-v4/drafts/[batchId]/route.ts', 'PATCH'],
    ['app/api/vehicle-performance-v4/legacy-write-gate/recover/route.ts', 'POST'],
    ['app/api/vehicle-performance-v4/accounting-policy/route.ts', 'POST']
  ];
  const routes = fs.readdirSync('app/api/vehicle-performance-v4', { recursive: true })
    .filter(name => name.endsWith('route.ts'))
    .map(name => path.join('app/api/vehicle-performance-v4', name));
  const declaredWrites = routes.flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    return [...source.matchAll(/export async function (POST|PUT|PATCH|DELETE)\(/g)]
      .map(match => [file.replaceAll('\\', '/'), match[1]]);
  });
  assert.deepEqual(declaredWrites.sort(), endpoints.slice().sort());
  for (const [file, method] of endpoints) {
    const route = loadRoute(file, dependencies);
    const response = await route[method](new Request('https://example.test/api/vehicle-performance-v4', { method }), {
      params: Promise.resolve({ batchId: '00000000-0000-4000-8000-000000000000' })
    });
    assert.equal(response.status, 403, `${method} ${file}`);
    if (file.includes('accounting-policy')) continue;
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal((await response.json()).errorCode, 'v4_financial_writes_disabled');
  }
  const metadataRoute = fs.readFileSync('app/api/vehicle-performance-v4/drafts/route.ts', 'utf8');
  const component = fs.readFileSync('components/vehicle-financial-drafts.tsx', 'utf8');
  assert.match(metadataRoute, /writesEnabled: migrationReady && !isVehicleFinancialV4WriteLocked\(\)/);
  assert.match(component, /disabled=\{!metadata\?\.writesEnabled \|\| !canImport/);
  assert.equal((component.match(/disabled=\{!metadata\?\.writesEnabled \|\| busy \|\| !reviewReason\.trim\(\)\}/g) ?? []).length, 3);
});
