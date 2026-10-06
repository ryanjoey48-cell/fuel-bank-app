const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, deps = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => { if (name === './driver-route-options') return load('components/driver/driver-route-options.tsx', { react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); if (name === './driver-disclosure') return load('components/driver/driver-disclosure.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); assert.ok(name in deps, `Missing dependency ${name}`); return deps[name]; }, module, module.exports);
  return module.exports;
}
const routes = load('components/driver/driver-route-options.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') });
const vehicleLabels = load('lib/driver-vehicle-types.ts');
test('portal vehicle labels translate every supported enum without changing the existing option values', () => {
  for (const option of vehicleLabels.DRIVER_VEHICLE_TYPE_OPTIONS) {
    for (const language of ['en', 'th']) {
      const label = vehicleLabels.getPortalVehicleTypeLabel(option.value, language);
      assert.ok(label); assert.ok(!label.includes('_'));
    }
  }
  assert.equal(vehicleLabels.getPortalVehicleTypeLabel('FOUR_WHEEL_TRUCK', 'en'), '4-Wheel Truck');
  assert.equal(vehicleLabels.getPortalVehicleTypeLabel('FOUR_WHEEL_TRUCK', 'th'), 'รถบรรทุก 4 ล้อ');
  for (const value of [null, undefined, 'UNKNOWN_INTERNAL_TYPE']) assert.equal(vehicleLabels.getPortalVehicleTypeLabel(value, 'en'), '');
  assert.equal(vehicleLabels.getDriverVehicleTypeLabel('FOUR_WHEEL_TRUCK'), '4 Wheel Truck');
});
const portal = load('lib/driver-portal.ts');
const job = { id: 'test-job', bookingDate: '2026-10-02', pickupTime: '10:00', clientName: 'Test customer', pickupName: 'Pickup', pickupAddress: 'Complete pickup address ถนนทดสอบ 123', dropoffName: 'Delivery', dropoffAddress: 'Complete delivery address ถนนปลายทาง 456', vehicleRegistration: '1998', vehicleType: 'FOUR_WHEEL_TRUCK', trailerRegistration: null, jobOrderNumber: 'TEST-1' };
const depot = { name: 'Depot', address: 'Depot address' };
function detailMarkup(language, stage) {
  let stateIndex = 0;
  const events = portal.DRIVER_JOB_EVENT_TYPES.slice(0, stage).map((eventType, index) => ({ id: String(index), eventType, eventTime: '2026-10-02T03:00:00Z', latitude: index === 0 ? 13 : null, longitude: index === 0 ? 100 : null }));
  const hooks = { ...React, useState(initial) { const index = stateIndex++; return [index === 0 ? events : index === 1 ? false : initial, () => {}]; }, useCallback: (fn) => fn, useEffect: () => {}, useRef: (value) => ({ current: value }) };
  const icons = Object.fromEntries(['ArrowDown', 'ArrowLeft', 'ChevronRight', 'Check', 'Clock3', 'ExternalLink', 'MapPin', 'Navigation2', 'Phone', 'RefreshCw', 'Truck'].map((name) => [name, () => null]));
  const { DriverJobDetail } = load('components/driver/driver-job-detail.tsx', {
    react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': icons,
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/lib/language-provider': { useLanguage: () => ({ language }) },
    '@/lib/driver-portal': portal, '@/lib/driver-vehicle-types': vehicleLabels
  });
  return renderToStaticMarkup(React.createElement(DriverJobDetail, { job, depot }));
}
for (const language of ['en', 'th']) {
  test(`detail retains original Maps URLs plus smart navigation, full addresses and Atip contact in ${language}`, () => {
    const html = detailMarkup(language, 0);
    const actual = [...html.matchAll(/href="(https:\/\/www\.google\.com\/maps[^\"]+)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
    const urls = {pickup:portal.buildDriverDirectionsUrl(job,'pickup',depot),delivery:portal.buildDriverDirectionsUrl(job,'delivery',depot),current:portal.buildDriverDirectionsUrl(job,'current',depot),depot:portal.buildDriverDirectionsUrl(job,'depot',depot),pickupToDropoff:portal.buildDriverDirectionsUrl(job,'pickup-to-dropoff',depot)}; assert.deepEqual(actual, [urls.pickup,...routes.driverNavigationRoutes(urls,'pickup').map(route=>route.href)]);
    assert.ok(html.includes('Navigation options') || html.includes('ตัวเลือกการนำทาง')); assert.ok(!html.includes('<fieldset')); assert.ok(!html.includes('aria-pressed'));
    assert.ok(html.includes(job.pickupAddress)); assert.ok(html.includes(job.dropoffAddress));
    assert.ok(html.includes('tel:+66657896654')); assert.ok(html.includes('Atip Punpanung'));
    assert.ok(html.includes(vehicleLabels.getPortalVehicleTypeLabel(job.vehicleType, language)));
    assert.ok(!html.includes('FOUR_WHEEL_TRUCK'));
  });
}
test('active detail places one next action before horizontal progress and retains timestamps', () => {
  const html = detailMarkup('en', 1);
  assert.ok(html.includes('id="job-next-action"')); assert.ok(html.indexOf('id="job-next-action"') < html.indexOf('id="job-progress"'));
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.ok(html.includes('GPS')); assert.ok(html.includes('dateTime="2026-10-02T03:00:00Z"'));
  assert.ok(html.includes('Leave pickup')); assert.ok(html.includes('bg-slate-200'));
});
test('completed detail retains all events and Maps but never renders a fixed next-action CTA', () => {
  const html = detailMarkup('en', 4);
  assert.ok(!html.includes('bottom-[calc(52px+env(safe-area-inset-bottom))]'));
  assert.ok(!html.includes('aria-current="step"')); assert.ok(html.includes('bg-emerald-100'));
  assert.equal((html.match(/<time /g) || []).length, 4);
  assert.equal((html.match(/target="_blank"/g) || []).length, 6);
});
test('responsive drawer lock restores the exact previous page overflow when closed', () => {
  let cleanup;
  const previousDocument = global.document;
  global.document = { body: { style: { overflow: 'auto' } } };
  try {
    const { useModalScrollLock } = load('lib/use-modal-scroll-lock.ts', { react: { useEffect: (effect) => { cleanup = effect(); } } });
    useModalScrollLock(false); assert.equal(global.document.body.style.overflow, 'auto');
    useModalScrollLock(true); assert.equal(global.document.body.style.overflow, 'hidden');
    cleanup(); assert.equal(global.document.body.style.overflow, 'auto');
  } finally { global.document = previousDocument; }
});
test('mobile refinements stay scoped and navigation preserves safe-area padding', () => {
  const css = read('app/globals.css');
  assert.ok(css.includes('@media (max-width: 639px)'));
  for (const scope of ['.driver-summary-metrics', '.driver-profile', '.driver-history', '.operations-header', '.operations-job-drawer', '.office-summary']) assert.ok(css.includes(scope));
  assert.ok(read('components/driver/driver-navigation.tsx').includes('min-h-[48px]'));
  assert.ok(read('components/driver/driver-navigation.tsx').includes('pb-[env(safe-area-inset-bottom)]'));
  assert.ok(read('app/driver/(protected)/layout.tsx').includes('pb-[calc(3.5rem+env(safe-area-inset-bottom))]'));
  assert.ok(read('components/admin/driver-operations-history.tsx').includes('data.page+1'));
});
