// Local browser regression only. All accounts and service responses are isolated test fixtures.
// No production credentials, database queries or writes are permitted from this browser context.
const { chromium } = require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lib } = require('./helpers/invoice-compare.cjs');
const reports = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();
const output = path.resolve('output/vehicle-performance-v5');
fs.mkdirSync(output, { recursive: true });
const origin = process.env.VEHICLE_V5_TEST_ORIGIN || 'http://localhost:3000';

async function prepare(context, role = 'super_admin') {
  await context.addInitScript(() => {
    const result = { data: [], error: null, count: 0 };
    const query = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => resolve(result) : () => query });
    const session = { access_token: 'isolated-vp5-test-token', user: { id: 'vp5-fixture-admin', email: 'fixture@example.test' } };
    const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => 'ok' };
    globalThis.__fuelBankSupabaseBrowserClient = {
      auth: { getSession: async () => ({ data: { session }, error: null }), getUser: async () => ({ data: { user: session.user }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      from: () => query, rpc: () => query, channel: () => channel, removeChannel: async () => 'ok'
    };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !url.href.startsWith('data:') && !url.href.startsWith('blob:')) return route.abort();
    if (url.pathname === '/api/vehicle-performance-v5') return route.fulfill({ json: { reports, writesEnabled: false } });
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { access: { userId: 'vp5-fixture-admin', email: 'fixture@example.test', displayName: 'Local fixture', role, status: 'active', lastAccessChangedAt: null }, permissions: [] } });
    if (url.pathname === '/api/auth/login-routing') return route.fulfill({ json: { accountType: 'office', destination: '/dashboard' } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { rows: [], batches: [], users: [], notifications: [], migrationReady: false, writesEnabled: false } });
    return route.continue();
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  await prepare(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(30000);
  try {
    await page.goto(origin + '/vehicle-performance', { waitUntil: 'domcontentloaded', timeout: 180000 });
    const root = page.getByTestId('vehicle-financial-v5');
    await root.waitFor({ timeout: 120000 });
    const table = page.getByTestId('financial-vehicle-table');
    assert.equal(await table.locator('tbody tr').count(), 21);
    assert.match(await root.innerText(), /1,814,085.89/);
    assert.match(await root.innerText(), /0 \/ 21 \/ 0/);
    await page.screenshot({ path: path.join(output, 'september-desktop.png'), fullPage: true });
    console.log('September default: 21 vehicles, provisional payroll, exact fleet control PASS');

    await page.locator('#vehicle-performance-month').selectOption('8');
    await root.getByText('฿1,805,097.00', { exact: true }).first().waitFor();
    assert.equal(await table.locator('tbody tr').count(), 21);
    assert.match(await root.innerText(), /7 \/ 13 \/ 1/);
    assert.match(await root.innerText(), /23,920.00/);
    assert.equal(await table.locator('tbody tr').last().getAttribute('data-registration'), '3ฒล-4565');
    await page.screenshot({ path: path.join(output, 'august-desktop.png'), fullPage: true });
    console.log('August controls, completeness and unknown-revenue bridge PASS');

    for (const sort of ['balance', 'revenue', 'jobs', 'margin', 'knownCosts']) {
      await root.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption(sort);
      assert.equal(await table.locator('tbody tr').last().getAttribute('data-registration'), '3ฒล-4565');
    }
    await root.getByRole('checkbox', { name: 'Ascending', exact: true }).check();
    assert.equal(await table.locator('tbody tr').last().getAttribute('data-registration'), '3ฒล-4565');
    await root.getByRole('combobox', { name: 'Status filter', exact: true }).selectOption('confirmed');
    assert.equal(await table.locator('tbody tr').count(), 7);
    await root.getByRole('combobox', { name: 'Status filter', exact: true }).selectOption('all');
    await page.locator('#vehicle-performance-search').fill('79-5318');
    assert.equal(await table.locator('tbody tr').count(), 1);
    await table.getByRole('button', { name: 'Details', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /79-5318/);
    await page.screenshot({ path: path.join(output, 'vehicle-details.png'), fullPage: true });
    const individualDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download vehicle PDF', exact: true }).click();
    await (await individualDownload).saveAs(path.join(output, 'august-79-5318.pdf'));
    await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.locator('#vehicle-performance-search').fill('');
    await table.locator('tr[data-registration="3ฒล-4565"]').getByRole('button', { name: 'Details', exact: true }).click();
    assert.match(await dialog.innerText(), /Balance cannot be calculated/);
    assert.match(await dialog.innerText(), /Registration identity verification required/);
    await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
    console.log('Search, all sorting metrics, status filter and vehicle details PASS');

    const fleetDownload = page.waitForEvent('download');
    await root.getByRole('button', { name: 'Download fleet PDF', exact: true }).click();
    await (await fleetDownload).saveAs(path.join(output, 'august-fleet.pdf'));
    await page.getByRole('tab', { name: 'Monthly Performance', exact: true }).click();
    await page.getByTestId('financial-comparison').waitFor();
    assert.match(await page.getByTestId('financial-comparison').innerText(), /8,988.89/);
    await page.screenshot({ path: path.join(output, 'monthly-comparison.png'), fullPage: true });
    console.log('Monthly comparison and fleet/individual PDF downloads PASS');

    await page.getByRole('tab', { name: 'Financial Reports', exact: true }).click();
    await root.waitFor();
    assert.equal(await page.locator('#vehicle-performance-v4').getAttribute('open'), null);
    await page.locator('#vehicle-performance-month').selectOption('9');
    await page.locator('#vehicle-performance-search').fill('79-5318');
    await table.getByRole('button', { name: 'Details', exact: true }).click();
    assert.match(await dialog.innerText(), /251,007.00/);
    assert.match(await dialog.innerText(), /24,054.00/);
    await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.locator('#vehicle-performance-search').fill('');
    await page.locator('#vehicle-performance-month').selectOption('8');
    console.log('Financial Reports and comparable previous-month vehicle movement PASS');

    await page.getByRole('tab', { name: 'Manage Data', exact: true }).click();
    const queue = page.getByTestId('financial-missing-queue');
    await queue.waitFor();
    await queue.getByRole('button', { name: 'Local adjustment', exact: true }).first().click();
    await root.getByRole('textbox', { name: 'Verified amount (THB)', exact: true }).fill('100.25');
    await root.getByRole('textbox', { name: 'Reason and supporting evidence', exact: true }).fill('Isolated browser test receipt; never production');
    await root.getByRole('button', { name: 'Save local adjustment', exact: true }).click();
    assert.match(await root.innerText(), /Isolated browser test receipt/);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await root.waitFor();
    await page.locator('#vehicle-performance-month').selectOption('8');
    await page.getByRole('tab', { name: 'Manage Data', exact: true }).click();
    assert.match(await root.innerText(), /Isolated browser test receipt/);
    assert.match(await root.innerText(), /1,805,097.00/);
    console.log('Local correction persistence and immutable source totals PASS');

    await page.getByRole('tab', { name: 'Fleet Overview', exact: true }).click();
    await page.locator('#vehicle-performance-month').selectOption('9');
    const sepDownload = page.waitForEvent('download');
    await root.getByRole('button', { name: 'Download fleet PDF', exact: true }).click();
    await (await sepDownload).saveAs(path.join(output, 'september-fleet.pdf'));
    await page.locator('#vehicle-performance-month').selectOption('1');
    assert.equal(await root.count(), 0);
    await page.locator('#vehicle-performance-month').selectOption('9');
    await root.waitFor();
    console.log('Historical month switching preserved PASS');

    await page.evaluate(() => localStorage.setItem('fuel-bank-language', 'th'));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await root.waitFor();
    await root.getByText('ผลการเงินรายรถที่กระทบยอดแล้ว', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'september-thai.png'), fullPage: true });
    const thaiDownload = page.waitForEvent('download');
    await root.getByRole('button', { name: 'ดาวน์โหลด PDF ทั้งกองรถ', exact: true }).click();
    await (await thaiDownload).saveAs(path.join(output, 'september-fleet-th.pdf'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile-thai.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'tables scroll inside the page rather than overflowing the viewport');
    console.log('Thai language, Thai PDF and mobile layout PASS');

    const viewer = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await prepare(viewer, 'office_staff');
    const restricted = await viewer.newPage();
    await restricted.goto(origin + '/vehicle-performance', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await restricted.getByTestId('vehicle-financial-v5').waitFor();
    await restricted.getByRole('tab', { name: 'Manage Data', exact: true }).click();
    assert.equal(await restricted.getByRole('button', { name: 'Local adjustment', exact: true }).count(), 0);
    await viewer.close();
    const deniedContext = await browser.newContext();
    await prepare(deniedContext, 'read_only');
    const deniedPage = await deniedContext.newPage();
    await deniedPage.goto(origin + '/vehicle-performance', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await deniedPage.getByTestId('financial-access-denied').waitFor();
    assert.equal(await deniedPage.getByTestId('vehicle-financial-v5').count(), 0);
    await deniedContext.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify({ origin, fixture: true, passed: true, errors, pdfs: 4 }, null, 2));
    console.log('Read-only adjustment controls and browser console PASS');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error) + '\n' + await page.locator('body').innerText().catch(() => ''));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
