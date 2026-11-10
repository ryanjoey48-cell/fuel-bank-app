const { chromium } = require(['C:/Users/joery/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright', 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright'].find(require('node:fs').existsSync));
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { lib } = require('./helpers/invoice-compare.cjs');
const f = lib('vehicle-performance-financial.ts'), sources = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();
const { loadRoute } = require('./helpers/vehicle-v6-route.cjs');
fs.mkdirSync('tmp/vehicle-v10-browser-stores', { recursive: true });
const store = fs.mkdtempSync(path.resolve('tmp/vehicle-v10-browser-stores/run-'));
process.env.EES_VEHICLE_FINANCIAL_STORE_DIR = store;
const handlers = loadRoute(), origin = process.env.VEHICLE_V10_TEST_ORIGIN || 'http://127.0.0.1:3000';
const output = path.resolve('output/vehicle-performance-v10'); fs.mkdirSync(output, { recursive: true });
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
const fleetRegs = [
  '61-2835', '61-6672', '62-1085', '62-4337', '64-0359', '64-5954', '64-5956', '74-8969',
  '78-6996', '79-2945', '700-4145', '700-6659', '701-1654', '701-5145', '79-5318',
  '3ฒน-9565', '3ฒล-4565', 'ฒอ-8453', '63-3543', '64-8665', '68-7154'
];
const legacyRecords = [];
for (let month = 1; month <= 7; month++) {
  for (const registration of fleetRegs) {
    if (month <= 2 && registration === '701-5145') continue;
    legacyRecords.push({
      id: `v10-${month}-${registration}`, user_id: 'vp6-admin-fixture-user', year: 2026, month,
      vehicle_registration: registration, salary_cost: 1000, trip_income: 200, other_expenses: 50,
      gross_revenue: 10000 + month * 100, lpg_cost: 0, notes: 'V10 fixture',
      created_at: '2026-01-01', updated_at: '2026-01-01', created_by: null, updated_by: null
    });
  }
}
async function prepare(context, bridgeUrl) {
  const token = 'vp6-admin';
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
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { access: { userId: token + '-fixture-user', email: 'fixture@example.test', displayName: 'Isolated fixture', role: 'super_admin', status: 'active', lastAccessChangedAt: null }, permissions: [] } });
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
  try {
    await page.goto(origin + '/vehicle-performance', { waitUntil: 'domcontentloaded' });
    await page.locator('#vehicle-performance-month').waitFor({ timeout: 180000 });

    const tabs = await page.getByRole('tablist', { name: 'Vehicle Performance sections' }).innerText();
    assert.match(tabs, /Fleet Overview/);
    assert.match(tabs, /Monthly Performance/);
    assert.match(tabs, /Financial Reports/);
    assert.match(tabs, /Manage Data/);
    assert.doesNotMatch(tabs, /Trip Performance/i);

    await page.locator('#vehicle-performance-month').selectOption('1');
    await page.getByTestId('vehicle-performance-kpi-strip').waitFor();
    const january = await page.locator('body').innerText();
    assert.match(january, /20 eligible/i);
    assert.doesNotMatch(january, /Partial — 1 vehicle missing|Partial - 1 vehicle missing/i);
    assert.doesNotMatch(january, /701-5145/);
    await page.screenshot({ path: path.join(output, 'january-desktop.png'), fullPage: true });
    console.log('January eligibility PASS');

    await page.locator('#vehicle-performance-month').selectOption('2');
    const february = await page.locator('body').innerText();
    assert.match(february, /20 eligible/i);
    assert.doesNotMatch(february, /Partial - 1 vehicle missing/i);
    await page.screenshot({ path: path.join(output, 'february-desktop.png'), fullPage: true });
    console.log('February eligibility PASS');

    await page.locator('#vehicle-performance-month').selectOption('7');
    await page.getByTestId('fleet-highlights').waitFor();
    await page.screenshot({ path: path.join(output, 'july-desktop.png'), fullPage: true });

    await page.locator('#vehicle-performance-month').selectOption('8');
    assert.equal(await page.locator('#vehicle-performance-table tbody tr').count(), 21);
    assert.match(await page.locator('body').innerText(), /21 vehicles reported/i);
    await page.screenshot({ path: path.join(output, 'august-desktop.png'), fullPage: true });

    await page.locator('#vehicle-performance-month').selectOption('9');
    assert.match(await page.locator('body').innerText(), /September payroll note/i);
    await page.screenshot({ path: path.join(output, 'september-desktop.png'), fullPage: true });

    await page.locator('#vehicle-performance-month').selectOption('');
    await page.getByTestId('vehicle-performance-kpi-strip').waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /Trip Performance/i);
    await page.screenshot({ path: path.join(output, 'all-months-desktop.png'), fullPage: true });
    await page.locator('#vehicle-performance-table').screenshot({ path: path.join(output, 'ranking-desktop.png') });

    await page.getByRole('tab', { name: 'Monthly Performance', exact: true }).click();
    await page.locator('text=Month-by-month fleet results').waitFor();
    const monthly = await page.locator('body').innerText();
    assert.match(monthly, /20 \/ 20|20\/20/);
    assert.doesNotMatch(monthly, /Partial - 1 vehicle missing/);
    await page.screenshot({ path: path.join(output, 'monthly-desktop.png'), fullPage: true });
    console.log('Monthly Performance coverage PASS');

    await page.getByRole('tab', { name: 'Fleet Overview', exact: true }).click();
    await page.locator('#vehicle-performance-month').selectOption('7');
    await page.locator('#vehicle-performance-table tbody tr').filter({ hasText: '701-5145' }).first().click();
    await page.locator('#vehicle-detail').waitFor();
    const detail = await page.locator('#vehicle-detail').innerText();
    assert.match(detail, /Not in fleet/i);
    await page.screenshot({ path: path.join(output, 'vehicle-detail-desktop.png'), fullPage: true });

    await page.locator('#vehicle-performance-month').selectOption('8');
    await page.getByRole('tab', { name: 'Manage Data', exact: true }).click();
    await page.getByTestId('vehicle-financial-v6').waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(output, 'manage-data-desktop.png'), fullPage: true });
    const registration = '79-5318';
    const base = sources[0].rows.find(r => r.registration === registration);
    const amount = (Number(base.cells.maintenance.value || 0) + 25).toFixed(2);
    const cell = page.getByTestId('financial-vehicle-table').locator('tbody tr').filter({ has: page.locator('th[scope="row"]').filter({ hasText: registration }) }).locator('input[data-vp-field="maintenance"]');
    await cell.fill(amount);
    const response = page.waitForResponse(r => r.url().includes('/api/vehicle-performance-v5') && r.request().method() === 'PUT');
    await page.getByTestId('vehicle-financial-v6').getByRole('button', { name: 'Save Changes', exact: true }).click();
    assert.equal((await response).status(), 200);
    console.log('Manage Data save PASS');

    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({
      passed: true, origin, putCount, errors,
      augustBalance: f.v6FleetHeroTotals(sources[0]).balanceBaht,
      septemberBalance: f.v6FleetHeroTotals(sources[1]).balanceBaht
    }, null, 2));
    console.log('PASS: V10 trip removal + historical fleet eligibility');
  } catch (error) {
    console.error(error);
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => bridge.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
