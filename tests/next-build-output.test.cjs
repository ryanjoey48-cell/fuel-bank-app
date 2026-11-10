const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { createRequire } = require('node:module');
const configPath = path.resolve('next.config.ts');
const compiled = ts.transpileModule(fs.readFileSync(configPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function config(overrides) {
  const mod = { exports: {} };
  const env = { NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'fixture', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', GOOGLE_MAPS_SERVER_API_KEY: 'fixture', NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'fixture', ...overrides };
  new Function('module', 'exports', 'require', 'process', compiled)(mod, mod.exports, createRequire(configPath), { env });
  return mod.exports.default;
}

test('local build/start output is separate from a concurrently running development server', () => {
  assert.equal(config({ NODE_ENV: 'development' }).distDir, '.next');
  assert.equal(config({ NODE_ENV: 'production' }).distDir, '.next-local-production');
  assert.notEqual(config({ NODE_ENV: 'production' }).distDir, config({ NODE_ENV: 'development' }).distDir);
});

test('Vercel retains the standard build output directory', () => {
  assert.equal(config({ NODE_ENV: 'production', VERCEL: '1' }).distDir, '.next');
});

test('existing explicit Finance and QA directories retain precedence in build and development', () => {
  for (const NODE_ENV of ['development', 'production']) {
    assert.equal(config({ NODE_ENV, FUEL_BANK_DIST_DIR: '.next-isolated-fixture' }).distDir, '.next-isolated-fixture');
    assert.equal(config({ NODE_ENV, FUEL_BANK_ISOLATED_BUILD: '1' }).distDir, '.next-maintenance-qa');
  }
});
