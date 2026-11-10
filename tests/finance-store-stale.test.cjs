const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');

// The store resolves its folder from process.cwd() at load time, so run it from a throw-away directory: the real
// .ees-local/finance-test/state.json is never touched by this test.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ees-finance-stale-'));
const realCwd = process.cwd();
process.chdir(temp);
const server = h.lib('finance-local-store-server.ts');
const persistence = h.lib('finance-local-persistence.ts');
const demo = h.lib('finance-demo-centre.ts');
process.chdir(realCwd);

const spaces = () => persistence.createEmptyFinanceWorkspaces();

test('stale-write protection: a second tab cannot silently overwrite a newer save', async () => {
  assert.equal(server.financeLocalStoreRoot().startsWith(temp), true);
  // Tab A and tab B both loaded "nothing yet" (first save uses a null base).
  const a1 = await server.writeFinanceLocalStoreChecked(spaces(), 'office', 'owner', null);
  assert.ok(a1.savedAt);
  // Tab A continues from its own saved version.
  await new Promise((r) => setTimeout(r, 5));
  const a2 = await server.writeFinanceLocalStoreChecked(spaces(), 'office', 'owner', a1.savedAt);
  assert.notEqual(a2.savedAt, a1.savedAt);
  // Tab B still holds a1: its save is refused with the current version, and the file is unchanged.
  const before = fs.readFileSync(path.join(temp, '.ees-local', 'finance-test', 'state.json'), 'utf8');
  await assert.rejects(server.writeFinanceLocalStoreChecked(spaces(), 'office', 'owner', a1.savedAt), (error) => error instanceof server.FinanceStaleWriteError && error.currentSavedAt === a2.savedAt);
  assert.equal(fs.readFileSync(path.join(temp, '.ees-local', 'finance-test', 'state.json'), 'utf8'), before);
});

test('stale-write protection: simultaneous saves are serialised, exactly one wins', async () => {
  const base = await server.writeFinanceLocalStoreChecked(spaces(), 'office', 'owner', undefined);
  await new Promise((r) => setTimeout(r, 5));
  const results = await Promise.allSettled([
    server.writeFinanceLocalStoreChecked(spaces(), 'office', 'owner', base.savedAt),
    server.writeFinanceLocalStoreChecked(spaces(), 'office', 'owner', base.savedAt)
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof server.FinanceStaleWriteError).length, 1);
});

test('stale-write protection: saved data survives a "restart" (re-read from disk) unchanged', async () => {
  const ws = spaces();
  ws.owner = { ...ws.owner, simulatedTrnLast: 651 };
  const saved = await server.writeFinanceLocalStoreChecked(ws, 'office', 'owner', undefined);
  const again = await server.readFinanceLocalStore();
  assert.equal(again.savedAt, saved.savedAt);
  assert.equal(again.workspaces.owner.simulatedTrnLast, 651);
  assert.ok(demo);
});

test('client and route wire the check (409 → conflict, autosave stops)', () => {
  const route = fs.readFileSync(path.join(h.root, 'app/api/finance-local-store/route.ts'), 'utf8');
  assert.match(route, /status: 409/);
  assert.match(route, /baseSavedAt/);
  const save = fs.readFileSync(path.join(h.root, 'lib/finance-local-save.ts'), 'utf8');
  assert.match(save, /response\.status === 409/);
  const provider = fs.readFileSync(path.join(h.root, 'components/finance-fixture-provider.tsx'), 'utf8');
  assert.match(provider, /conflict\.current/);
});
