const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');
function harness({ sessionProvider, timeoutMs = 12000 } = {}) {
  const source = fs.readFileSync('lib/supabase.ts', 'utf8');
  const body = source.slice(source.indexOf('function createAuthorizedFetch('), source.indexOf('function fetchInputUrl('));
  let session = { access_token: 'signed-in-token' }, error = null;
  const calls = [];
  const deadlineSource = fs.readFileSync("lib/request-deadline.ts", "utf8");
  const deadlineModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(deadlineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: deadlineModule.exports, AbortController, Response, setTimeout, clearTimeout });
  const context = { withRequestDeadline: (operation, signal) => deadlineModule.exports.withRequestDeadline(operation, signal, timeoutMs), completeJsonResponse: deadlineModule.exports.completeJsonResponse, Headers, supabaseAnonKey: 'anon-key', fetch: async (input, init) => { calls.push(init.headers); return new Response("{}", {status:200,headers:{"content-type":"application/json"}}); } };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { calls, request: context.createAuthorizedFetch({ getSession: sessionProvider ?? (async () => ({ data: { session }, error })) }), session: value => { session = value; }, error: value => { error = value; } };
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

test('a pending authentication lookup is bounded before any database request is sent', async () => {
  const h = harness({ sessionProvider: () => new Promise(() => {}), timeoutMs: 10 });
  await assert.rejects(h.request('/rest/v1/vehicle_service_logs', {}), /timed out/);
  assert.equal(h.calls.length, 0);
});
