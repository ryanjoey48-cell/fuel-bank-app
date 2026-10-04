const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, deps = {}) {
  const loadedModule = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => { assert.ok(name in deps, name); return deps[name]; }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const runtime = require('react/jsx-runtime');
const ops = load('lib/driver-operations.ts');
const vehicles = load('lib/driver-vehicle-types.ts');
const art = load('components/driver/driver-logistics-art.tsx', { react: React, 'react/jsx-runtime': runtime });
const ui = load('components/driver/driver-ui.tsx', { react: React, 'react/jsx-runtime': runtime, 'next/image': () => null });
const jobs = [
  { id: 'next', bookingDate: '2026-10-05', pickupTime: null, clientName: 'Live customer', pickupName: 'Live pickup', dropoffName: 'Live delivery', vehicleRegistration: '1998', vehicleType: 'FOUR_WHEEL_TRUCK' },
  { id: 'upcoming', bookingDate: '2026-10-06', pickupTime: '11:30', clientName: 'Future customer', pickupName: 'Future pickup', dropoffName: 'Future delivery', vehicleRegistration: '2001' }
];
function home(language, eventsByJob = {}) {
  const { DriverHome } = load('components/driver/driver-home.tsx', {
    react: { ...React, useState: () => [{ displayName: 'Live driver' }, () => {}] },
    'react/jsx-runtime': runtime,
    'lucide-react': Object.fromEntries(['CalendarDays', 'ChevronRight', 'Clock3', 'Truck', 'MapPin', 'Check'].map((name) => [name, () => null])),
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/image': ({ fill, priority, sizes, ...props }) => React.createElement('img', { ...props, 'data-fill': fill, 'data-priority': priority, sizes }),
    '@/lib/language-provider': { useLanguage: () => ({ language }) },
    '@/lib/driver-operations': ops, '@/lib/driver-vehicle-types': vehicles,
    './driver-ui': ui, './driver-logistics-art': art
  });
  return renderToStaticMarkup(React.createElement(DriverHome, { driverName: 'Official name', jobs, today: '2026-10-03', eventsByJob }));
}
for (const language of ['en', 'th']) test('reference layout preserves live identity, plate, job and upcoming data: ' + language, () => {
  const html = home(language);
  for (const value of ['Live driver', '1998', 'Live customer', 'Live pickup', 'Live delivery', 'Future customer', 'Future pickup', 'Future delivery', '2001', '11:30']) assert.ok(html.includes(value), value);
  assert.ok(html.includes(vehicles.getPortalVehicleTypeLabel('FOUR_WHEEL_TRUCK', language)));
  assert.ok(html.includes('THAILAND')); assert.ok(html.includes('ประเทศไทย'));
  for (const job of jobs) assert.equal((html.match(new RegExp('href="/driver/jobs/' + job.id + '"', 'g')) || []).length, 1);
  assert.ok(html.includes(ui.driverJobAction(language, 'ready')));
  assert.ok(html.includes('lg:max-w-[1280px]')); assert.ok(html.includes('lg:hidden'));
  assert.ok(!html.includes('backdrop-blur-sm'));
  assert.ok(html.includes('src="/driver-hero-bg.png"'));
  assert.ok(html.includes('alt="" aria-hidden="true"'));
  assert.ok(html.includes('object-cover')); assert.ok(html.includes('sm:object-[center_52%]'));
  assert.ok(html.includes('flex-col')); assert.ok(html.includes('sm:flex-row'));
  assert.ok(!html.includes('<svg'));
});
test('current status still selects Continue job without changing the next job route', () => {
  const html = home('en', { next: [{ eventType: 'pickup_arrived', eventTime: '2026-10-05T03:00:00Z' }] });
  assert.ok(html.includes('CURRENT JOB')); assert.ok(html.includes('Continue job')); assert.ok(html.includes('At pickup'));
  assert.ok(html.indexOf('/driver/jobs/next') < html.indexOf('/driver/jobs/upcoming'));
});
for (const language of ['en', 'th']) test('mobile density keeps live vehicle chip, desktop plate and comfortable job action: ' + language, () => {
  const html = home(language);
  assert.ok(html.includes('min-h-[204px]'));
  assert.ok(html.includes('sm:min-h-[248px]'));
  assert.ok(html.includes('lg:min-h-[272px]'));
  assert.ok(html.includes('hidden sm:block sm:self-auto'));
  const chip = html.match(/<div class="inline-flex max-w-full[^>]*sm:hidden"[^>]*>(.*?)<\/div>/s);
  assert.ok(chip, 'mobile-only chip exists');
  assert.ok(chip[1].includes('1998'));
  assert.ok(chip[1].includes(vehicles.getPortalVehicleTypeLabel('FOUR_WHEEL_TRUCK', language)));
  assert.ok(chip[1].includes('min-w-0 break-words'));
  assert.ok(html.includes('inline-flex min-h-11 shrink-0'), 'job action retains 44px minimum height');
  assert.ok(html.includes('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'), 'route columns can shrink without overflow');
  assert.ok(html.includes('mt-3 pb-6 sm:mt-6'), 'Upcoming moves closer on mobile only');
  assert.ok(html.includes('px-4 py-2.5 sm:py-3.5'), 'upcoming rows retain tablet spacing');
  const layout = fs.readFileSync(path.join(__dirname, '..', 'app/driver/(protected)/layout.tsx'), 'utf8');
  assert.ok(layout.includes('pb-[calc(4.5rem+env(safe-area-inset-bottom))]'), 'bottom navigation clearance stays in protected layout');
});
test('inline artwork is inaccessible decoration with collision-free SVG gradient IDs', () => {
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(art.DriverLogisticsArt), React.createElement(art.DriverLogisticsArt)));
  assert.equal((html.match(/aria-hidden="true"/g) || []).length, 2);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, value] of html.matchAll(/url\(#([^\)]+)\)/g)) assert.ok(ids.includes(value));
  assert.ok(html.includes('EES</text>')); assert.ok(html.includes('pointer-events-none')); assert.ok(!html.includes('<image'));
});
