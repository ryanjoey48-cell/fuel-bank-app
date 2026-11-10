const { chromium } = require(['C:/Users/joery/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright', 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright'].find(require('node:fs').existsSync));
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { lib } = require('./helpers/invoice-compare.cjs');
const f = lib('vehicle-performance-financial.ts'), sources = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();
const { loadRoute } = require('./helpers/vehicle-v6-route.cjs');
fs.mkdirSync('tmp/vehicle-v9-browser-stores', { recursive: true });
const store = fs.mkdtempSync(path.resolve('tmp/vehicle-v9-browser-stores/run-'));
process.env.EES_VEHICLE_FINANCIAL_STORE_DIR = store;
assert.ok(!store.includes('.ees-local'));
const handlers = loadRoute(), origin = process.env.VEHICLE_V9_TEST_ORIGIN || process.env.VEHICLE_V8_TEST_ORIGIN || 'http://127.0.0.1:3000';
const output = path.resolve('output/vehicle-performance-v9'); fs.mkdirSync(output, { recursive: true });
let putCount = 0;
const bridge = http.createServer(async (req, res) => {
  try {
    if (req.url !== '/api/vehicle-performance-v5' || !['GET', 'PUT'].includes(req.method)) { res.writeHead(404).end(); return; }
    const parts = []; for await (const chunk of req) parts.push(chunk);
    const request = new Request('http://isolated-test/api/vehicle-performance-v5', { method: req.method, headers: req.headers, ...(req.method === 'PUT' ? { body: Buffer.concat(parts).toString('utf8') } : {}) });
    const response = await handlers[req.method](request);
    if (req.method === 'PUT' && response.ok) putCount++;
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error) })); }
});
const legacyRecords = Array.from({ length: 7 }, (_, i) => ({
  id: 'legacy-v9-' + i, user_id: 'vp6-admin-fixture-user', year: 2026, month: i + 1, vehicle_registration: 'V9-LEGACY',
  salary_cost: 1000, trip_income: 200, other_expenses: 50, gross_revenue: 10000 + (i + 1) * 100, lpg_cost: 0,
  notes: 'Isolated January–July fixture', created_at: '2026-01-01', updated_at: '2026-01-01', created_by: null, updated_by: null
}));
async function prepare(context, bridgeUrl, role = 'super_admin') {
  const token = role === 'office_staff' ? 'vp6-staff' : role === 'read_only' ? 'vp6-reader' : 'vp6-admin';
  await context.addInitScript(({ token, records }) => {
    const session = { access_token: token, user: { id: token + '-fixture-user', email: 'fixture@example.test' } };
    const query = (table) => {
      const q = new Proxy({}, {
        get: (_, key) => key === 'then'
          ? resolve => resolve({ data: table === 'vehicle_monthly_performance' ? records : [], error: null, count: 0 })
          : (...args) => { if (['insert', 'update', 'upsert', 'delete'].includes(String(key))) throw new Error('No legacy financial writes are allowed in this test'); return q; }
      });
      return q;
    };
    const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => 'ok' };
    globalThis.__fuelBankSupabaseBrowserClient = {
      auth: { getSession: async () => ({ data: { session }, error: null }), getUser: async () => ({ data: { user: session.user }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      from: query, rpc: () => query('none'), channel: () => channel, removeChannel: async () => 'ok'
    };
  }, { token, records: legacyRecords });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
    if (url.pathname === '/api/vehicle-performance-v5') {
      const response = await route.fetch({ url: bridgeUrl + '/api/vehicle-performance-v5', headers: { ...route.request().headers(), authorization: 'Bearer ' + token }, timeout: 120000 });
      return route.fulfill({ response });
    }
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { access: { userId: token + '-fixture-user', email: 'fixture@example.test', displayName: 'Isolated fixture', role, status: 'active', lastAccessChangedAt: null }, permissions: [] } });
    if (url.pathname === '/api/auth/login-routing') return route.fulfill({ json: { accountType: 'office', destination: '/dashboard' } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { rows: [], batches: [], users: [], notifications: [], migrationReady: false, writesEnabled: false } });
    return route.continue();
  });
}
(async () => {
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const bridgeUrl = 'http://127.0.0.1:' + bridge.address().port;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  await prepare(context, bridgeUrl);
  const page = await context.newPage(); const errors = [];
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(300000);
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.stack || error.message); });
  page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept(); });
  const openManage = async () => {
    await page.getByRole('tab', { name: 'Manage Data', exact: true }).click();
    await page.getByTestId('vehicle-financial-v6').waitFor({ timeout: 120000 });
  };
  const root = () => page.getByTestId('vehicle-financial-v6');
  const table = () => page.getByTestId('financial-vehicle-table');
  const row = reg => table().locator('tbody tr').filter({ has: page.locator('th[scope="row"]').filter({ hasText: reg }) });
  const cell = (reg, field) => row(reg).locator(`input[data-vp-field="${field}"]`);
  const save = async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/vehicle-performance-v5') && r.request().method() === 'PUT');
    await root().getByRole('button', { name: 'Save Changes', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForFunction(() => document.querySelector('[data-testid="financial-save-status"]')?.textContent === 'All changes saved');
  };
  const stale = /incomplete costs excluded from confirmed balance|Confirmed balance appears only when all required costs|Missing expenses\/maintenance stay as —\. Incomplete rows do not create confirmed profit|not yet approved as published profit/i;
  try {
    await page.goto(origin + '/vehicle-performance', { waitUntil: 'domcontentloaded' });
    await page.locator('#vehicle-performance-month').waitFor({ timeout: 180000 });

    await page.locator('#vehicle-performance-month').selectOption('1');
    await page.getByTestId('vehicle-performance-kpi-strip').waitFor();
    assert.match(await page.locator('#vehicle-performance-table').innerText(), /V9-LEGACY/);
    await page.screenshot({ path: path.join(output, 'january-desktop.png'), fullPage: true });
    console.log('January PASS');

    await page.locator('#vehicle-performance-month').selectOption('7');
    await page.getByTestId('fleet-highlights').waitFor();
    await page.screenshot({ path: path.join(output, 'july-desktop.png'), fullPage: true });
    console.log('July PASS');

    await page.locator('#vehicle-performance-month').selectOption('8');
    await page.getByTestId('vehicle-performance-kpi-strip').waitFor();
    const augustBody = await page.locator('body').innerText();
    assert.doesNotMatch(augustBody, stale);
    assert.match(augustBody, /21 vehicles reported/i);
    assert.match(await page.getByTestId('vehicle-performance-kpi-strip').innerText(), /1\.81M|1,805,097/);
    assert.equal(await page.locator('#vehicle-performance-table tbody tr').count(), 21);
    await page.screenshot({ path: path.join(output, 'august-desktop.png'), fullPage: true });
    console.log('August PASS');

    await page.locator('#vehicle-performance-month').selectOption('9');
    const septemberBody = await page.locator('body').innerText();
    assert.doesNotMatch(septemberBody, stale);
    assert.match(septemberBody, /September payroll note/i);
    assert.match(await page.getByTestId('vehicle-performance-kpi-strip').innerText(), /1\.81M|1,814,085/);
    assert.equal(await page.locator('#vehicle-performance-table tbody tr').count(), 21);
    await page.screenshot({ path: path.join(output, 'september-desktop.png'), fullPage: true });
    console.log('September PASS');

    await page.locator('#vehicle-performance-month').selectOption('');
    await page.getByTestId('vehicle-performance-kpi-strip').waitFor();
    const allBody = await page.locator('body').innerText();
    assert.doesNotMatch(allBody, stale);
    assert.doesNotMatch(allBody, /Partial coverage · Aug\/Sep incomplete costs/i);
    assert.match(allBody, /vehicles reported/i);
    assert.match(allBody, /Jan–Jul published \+ Aug–Sep owner-approved reporting|complete ·/i);
    await page.getByTestId('fleet-highlights').waitFor();
    await page.locator('#vehicle-performance-table').waitFor();
    const balanceSort = page.locator('#vehicle-performance-table').getByRole('button', { name: /^Balance/ });
    await balanceSort.click();
    assert.match(await balanceSort.innerText(), /↑|↓/);
    await page.screenshot({ path: path.join(output, 'all-months-desktop.png'), fullPage: true });
    console.log('All Loaded Months PASS');

    await page.getByRole('tab', { name: 'Monthly Performance', exact: true }).click();
    await page.locator('text=Month-by-month fleet results').waitFor();
    const monthly = await page.locator('body').innerText();
    assert.match(monthly, /August|Aug/i);
    assert.match(monthly, /September|Sep/i);
    assert.doesNotMatch(monthly, /Aug\/Sep incomplete costs excluded/i);
    await page.locator('summary').filter({ hasText: 'Trend explorer' }).click();
    const trendSelect = page.locator('select').filter({ has: page.locator('option[value="fuelPercent"]') });
    await trendSelect.waitFor({ state: 'visible' });
    await trendSelect.selectOption('fuelPercent');
    assert.equal(await trendSelect.inputValue(), 'fuelPercent');
    console.log('Monthly Performance + Trend fuel % PASS');

    await page.getByRole('tab', { name: 'Fleet Overview', exact: true }).click();
    await page.locator('#vehicle-performance-month').selectOption('8');
    await openManage();
    const registration = '79-5318';
    const base = sources[0].rows.find(r => r.registration === registration);
    const before = Number(base.cells.maintenance.value || 0);
    const amount = (before + 50).toFixed(2);
    await cell(registration, 'maintenance').fill(amount);
    await save();
    await page.getByRole('button', { name: 'Back to Fleet Overview', exact: true }).click();
    await page.getByTestId('vehicle-performance-kpi-strip').waitFor();
    assert.match(await page.locator('#vehicle-performance-table').innerText(), /Adjusted/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#vehicle-performance-month').selectOption('8');
    await openManage();
    assert.equal(await cell(registration, 'maintenance').inputValue(), amount);
    console.log('Save persistence PASS');

    assert.deepEqual(errors, []);
    const august = f.v6FleetHeroTotals(sources[0]);
    const september = f.v6FleetHeroTotals(sources[1]);
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({
      passed: true, origin, isolatedStore: store, putCount, errors,
      augustBalance: august.balanceBaht, augustMargin: Number(august.marginPercent.toFixed(2)),
      septemberBalance: september.balanceBaht, septemberMargin: Number(september.marginPercent.toFixed(2)),
      combinedBalanceSatang: Math.round(august.balanceBaht * 100) + Math.round(september.balanceBaht * 100)
    }, null, 2));
    console.log('PASS: V9 final polish and all-month consistency');
  } catch (error) {
    console.error(error);
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => bridge.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
