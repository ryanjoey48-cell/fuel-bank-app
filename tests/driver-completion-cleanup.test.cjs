const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, deps = {}) {
  const m = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name === './driver-route-options') return load('components/driver/driver-route-options.tsx', deps);
    if (name === './driver-disclosure') return load('components/driver/driver-disclosure.tsx', deps);
    return name in deps ? deps[name] : require(name);
  }, m, m.exports);
  return m.exports;
}
const portal = load('lib/driver-portal.ts');
const ops = load('lib/driver-operations.ts');
const today = '2026-10-06';
const job = (id, date, time) => ({ id, clientName: 'Job ' + id, bookingDate: date, pickupTime: time, driverId: 'own', pickupName: 'QMB', dropoffName: 'BKK', vehicleRegistration: '1998' });
const jobs = [job('A', today, '09:00'), job('B', today, '16:00'), job('C', '2026-10-07', '09:00')];
const events = {};
const languageDeps = language => ({ '@/lib/language-provider': { useLanguage: () => ({ language }) } });
const components = {
  ...languageDeps('en'),
  react: { ...React, useState: () => [null, () => {}] },
  'next/link': ({ children, ...props }) => React.createElement('a', props, children),
  'next/image': ({ fill, priority, ...props }) => React.createElement('img', props),
  '@/lib/driver-operations': ops,
  '@/lib/driver-vehicle-types': load('lib/driver-vehicle-types.ts'),
  './driver-ui': load('components/driver/driver-ui.tsx')
};
const home = load('components/driver/driver-home.tsx', components);
const history = load('components/driver/driver-history.tsx', components);
const work = { async driverHomeWork(session, day) { assert.equal(session.driverId, 'own'); assert.equal(day, today); return jobs.map(job => ({ job, events: events[job.id] || [] })); }, async driverHistoryWork() { return { rows: jobs.filter(j => events[j.id]?.some(e => e.eventType === 'job_completed')).map(job => ({ job, events: events[job.id] })), hasMore: false }; } };
const pageDeps = { 'next/navigation': { redirect() { throw Error('unexpected redirect'); } }, '@/lib/driver-portal-server': { bangkokDateKey: () => today, getDriverPortalSession: async () => ({ driverId: 'own', driverName: 'Joey Ryan' }) }, '@/lib/driver-work-server': work, '@/components/driver/driver-home': home, '@/components/driver/driver-navigation': { DriverAutoRefresh: () => null }, '@/components/driver/driver-history': history };
const homePage = load('app/driver/(protected)/page.tsx', pageDeps);
const historyPage = load('app/driver/(protected)/history/page.tsx', pageDeps);
function complete(id) { events[id] = portal.DRIVER_JOB_EVENT_TYPES.map((eventType, i) => ({ id: String(i), eventType, eventTime: `2026-10-06T07:${53+i}:00Z`, latitude: id === 'A' ? 13.1 : null, longitude: id === 'A' ? 100.1 : null })); }

test('fresh server renders follow A + B today / C tomorrow through both completions', async () => {
  assert.equal(homePage.dynamic, 'force-dynamic'); assert.equal(historyPage.dynamic, 'force-dynamic');
  let html = renderToStaticMarkup(await homePage.default());
  assert.ok(html.replace(/<[^>]*>/g,'').includes('2 jobs remaining today')); assert.equal((html.match(/href="\/driver\/jobs\/A"/g)||[]).length,1);assert.ok(html.includes('>Today<'));assert.ok(html.includes('>Tomorrow<'));
  complete('A'); html = renderToStaticMarkup(await homePage.default());
  assert.ok(html.replace(/<[^>]*>/g,'').includes('1 job remaining today')); assert.ok(!html.includes('/driver/jobs/A')); assert.equal((html.match(/href="\/driver\/jobs\/B"/g)||[]).length,1);assert.ok(!html.includes('>Today<'));assert.ok(html.includes('>Tomorrow<'));
  complete('B'); html = renderToStaticMarkup(await homePage.default());
  assert.ok(html.includes('No more jobs today'));assert.ok(!html.includes('/driver/jobs/A'));assert.ok(!html.includes('/driver/jobs/B'));assert.equal((html.match(/href="\/driver\/jobs\/C"/g)||[]).length,1);assert.ok(html.includes('Tomorrow'));
  const historyHtml = renderToStaticMarkup(await historyPage.default({ searchParams: Promise.resolve({}) }));
  assert.ok(historyHtml.includes('Job A'));assert.ok(historyHtml.includes('Job B'));assert.ok(!historyHtml.includes('Job C'));assert.equal(events.A.at(-1).eventTime,'2026-10-06T07:56:00Z');assert.equal(events.A.at(-1).latitude,13.1);assert.equal(events.B.at(-1).latitude,null);
});

for (const language of ['en', 'th']) for (let stage = 0; stage <= 4; stage++) test(`collapsed routes and persisted completed data remain available: ${language} stage ${stage}`, () => {
  let index = 0;
  const saved = portal.DRIVER_JOB_EVENT_TYPES.slice(0, stage).map((eventType, i) => ({ eventType, eventTime: `2026-10-06T07:${53+i}:00Z`, latitude: 13.1, longitude: 100.1 }));
  const states = [saved, false, false, false, null, null, null, false];
  const hooks = { ...React, useState: initial => [index < states.length ? states[index++] : initial, () => {}], useEffect() {}, useCallback: fn => fn, useRef: current => ({ current }) };
  const { DriverJobDetail } = load('components/driver/driver-job-detail.tsx', { ...languageDeps(language), react: hooks, '@/lib/driver-portal': portal, '@/lib/driver-vehicle-types': components['@/lib/driver-vehicle-types'] });
  const html = renderToStaticMarkup(DriverJobDetail({ job: jobs[0], depot: { name: 'EES Depot', address: 'Depot address' } }));
  assert.equal((html.match(/id="job-route-options"/g)||[]).length,1); assert.ok(!html.includes('<details open')); assert.ok(!html.includes('grid-cols-3'));
  if(stage===4) { assert.ok(html.includes('dateTime="2026-10-06T07:56:00Z"')); assert.ok(html.includes('GPS'));assert.ok(html.includes(language==='en'?'Job completed':'จบงานแล้ว'));assert.ok(html.includes('driver-completed-back'));assert.ok(!html.includes('disabled=""'));assert.equal((html.match(/href="\/driver"/g)||[]).length,2); }
});

test('Driver service worker ignores old cached RSC/API responses without changing Office caching', async () => {
  const handlers={},fetches=[],cacheReads=[];
  vm.runInNewContext(read('public/sw.js'), { URL, self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>{handlers[name]=fn}},caches:{match:async request=>{cacheReads.push(request.url);return 'STALE'}},fetch:async(request,options)=>{fetches.push({request,options});return 'FRESH'} });
  for(const route of ['/driver','/driver?_rsc=old','/driver/history?_rsc=old','/driver/jobs/A','/api/driver/jobs/A/events','/api/driver/profile']) {
    let response;handlers.fetch({request:{method:'GET',mode:'cors',url:'https://app.test'+route},respondWith:value=>{response=value}});assert.equal(await response,'FRESH');assert.equal(fetches.at(-1).options.cache,'no-store');
  }
  assert.equal(cacheReads.length,0);
  let response;handlers.fetch({request:{method:'GET',mode:'cors',url:'https://app.test/booking-diary?query=office'},respondWith:value=>{response=value}});assert.equal(await response,'STALE');assert.equal(cacheReads.length,1);
});
