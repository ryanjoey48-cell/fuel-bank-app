const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');
function harness() {
  const source = fs.readFileSync('lib/supabase.ts', 'utf8');
  const body = source.slice(source.indexOf('function createAuthorizedFetch('), source.indexOf('function fetchInputUrl('));
  let session = { access_token: 'signed-in-token' }, error = null;
  const calls = [];
  const context = { Headers, supabaseAnonKey: 'anon-key', fetch: async (input, init) => { calls.push(init.headers); return {}; } };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { calls, request: context.createAuthorizedFetch({ getSession: async () => ({ data: { session }, error }) }), session: value => { session = value; }, error: value => { error = value; } };
}
test('database default anonymous header is replaced by current user token', async () => {
  const h = harness();
  await h.request('/rest/v1/vehicle_monthly_performance', { headers: { Authorization: 'Bearer anon-key' } });
  assert.equal(h.calls[0].get('Authorization'), 'Bearer signed-in-token');
  assert.equal(h.calls[0].get('apikey'), 'anon-key');
});
test('requests follow sign-out, sign-in and refreshed sessions', async () => {
  const h = harness();
  h.session(null); await h.request('/rest/v1/test', {});
  h.session({ access_token: 'new-token' }); await h.request('/rest/v1/test', { headers: { Authorization: 'Bearer anon-key' } });
  assert.equal(h.calls[0].get('Authorization'), 'Bearer anon-key');
  assert.equal(h.calls[1].get('Authorization'), 'Bearer new-token');
});
test('session failures reject instead of silently reading as anonymous', async () => {
  const h = harness(); h.error(new Error('refresh failed'));
  await assert.rejects(h.request('/rest/v1/test', {}), /refresh failed/);
  assert.equal(h.calls.length, 0);
});
test('explicit non-default authorization is preserved', async () => {
  const h = harness(); await h.request('/storage/v1/test', { headers: { Authorization: 'Bearer explicit-token' } });
  assert.equal(h.calls[0].get('Authorization'), 'Bearer explicit-token');
});
