const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const runtime = require('react/jsx-runtime');
function load(file, deps = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => { if (name === './driver-route-options') return load('components/driver/driver-route-options.tsx', { react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); if (name === './driver-disclosure') return load('components/driver/driver-disclosure.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  return module.exports;
}
const portal = load('lib/driver-portal.ts');
const vehicles = load('lib/driver-vehicle-types.ts');
const job = { id: 'own-job', bookingDate: '2026-10-06', pickupTime: null, clientName: 'PIONEERS', pickupName: 'GLOBAL', dropoffName: 'ท่าเรือ', pickupAddress: 'JM4H+MVF ตำบลบางพลีใหญ่ สมุทรปราการ', dropoffAddress: 'ท่าเรือคลองเตย กรุงเทพมหานคร', vehicleRegistration: '1998', vehicleType: 'FOUR_WHEEL_TRUCK', jobOrderNumber: 'EES-123', trailerRegistration: '456' };
const depot = { name: 'Depot', address: 'Depot address' };
const { selectedDriverRoute, driverNavigationRoutes, DriverRouteOptions } = load('components/driver/driver-route-options.tsx', { react: React, 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react') });
test('intent selections preserve all five existing Maps routes and verified place IDs', () => {
  const verified = { ...job, locationsVerified: true, pickupLat: 13.1, pickupLng: 100.1, dropoffLat: 13.2, dropoffLng: 100.2, pickupPlaceId: 'places/pickup-id', dropoffPlaceId: 'places/delivery-id' };
  const base = { ...depot, latitude: 13, longitude: 100, placeId: 'places/depot-id' };
  const urls = Object.fromEntries(['current', 'depot', 'pickup', 'delivery', 'pickupToDropoff'].map(key => [key, portal.buildDriverDirectionsUrl(verified, key === 'pickupToDropoff' ? 'pickup-to-dropoff' : key, base)]));
  for (const [start, destination, via, key] of [['current','pickup',false,'pickup'], ['current','delivery',false,'delivery'], ['current','delivery',true,'current'], ['depot','delivery',false,'depot'], ['pickup','delivery',false,'pickupToDropoff']]) assert.equal(selectedDriverRoute(urls,start,destination,via),urls[key]);
  const selected = new URL(selectedDriverRoute(urls,'depot','pickup',false));
  assert.equal(selected.searchParams.get('origin'),'13,100');
  assert.equal(selected.searchParams.get('origin_place_id'),'depot-id');
  assert.equal(selected.searchParams.get('destination'),'13.2,100.2');
  assert.equal(selected.searchParams.get('destination_place_id'),'delivery-id');
  assert.equal(selected.searchParams.get('waypoints'),'13.1,100.1');
  assert.equal(selected.searchParams.get('waypoint_place_ids'),'pickup-id');
  assert.equal(new URL(selectedDriverRoute(urls,'current','delivery',false)).searchParams.has('origin'),false);
});
test('missing routes cannot invent a destination or loop pickup back to itself', () => {
  const empty = {current:null,depot:null,pickup:null,delivery:null,pickupToDropoff:null};
  for (const start of ['current','depot','pickup']) for (const destination of ['pickup','delivery']) assert.equal(selectedDriverRoute(empty,start,destination,false),null);
  assert.equal(selectedDriverRoute({...empty,pickupToDropoff:'https://www.google.com/maps/dir/?destination=delivery'},'pickup','pickup',false),null);
});
function render(language, stage, overrides = {}) {
  const states = [portal.DRIVER_JOB_EVENT_TYPES.slice(0, stage).map((eventType, i) => ({ eventType, eventTime: `2026-10-06T0${i + 1}:00:00Z`, latitude: i ? null : 13, longitude: i ? null : 100 })), false, false, false, null, null, false];
  for (const [key, value] of Object.entries(overrides)) states[Number(key)] = value;
  let index = 0;
  const hooks = { ...React, useState(initial) { const i = index++; return [i in states ? states[i] : initial, value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }) };
  const { DriverJobDetail } = load('components/driver/driver-job-detail.tsx', { react: hooks, 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react'), 'next/link': ({ children, ...props }) => React.createElement('a', props, children), '@/lib/language-provider': { useLanguage: () => ({ language }) }, '@/lib/driver-portal': portal, '@/lib/driver-operations': load('lib/driver-operations.ts'), 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/lib/driver-vehicle-types': vehicles });
  const tree = DriverJobDetail({ job, depot });
  return { tree, states, html: renderToStaticMarkup(tree) };
}
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
for (const language of ['en', 'th']) for (let stage = 0; stage <= 4; stage++) {
  test(`active UI and Maps follow the existing stage ${stage} in ${language}`, () => {
    const { html, tree } = render(language, stage);
    assert.ok(html.includes(job.clientName)); assert.ok(html.includes(job.vehicleRegistration));
    assert.ok(html.includes(job.pickupAddress)); assert.ok(html.includes(job.dropoffAddress));
    assert.ok(html.includes('tel:+66657896654')); assert.ok(html.includes('Atip Punpanung'));
    const links = nodes(tree).filter(n => n.type === 'a' && n.props.target === '_blank');
    const extra = ['depot', 'current', 'pickup', 'delivery', 'pickup-to-dropoff'].map(mode => portal.buildDriverDirectionsUrl(job, mode, depot));
    const options = nodes(tree).find(n => n.props?.urls); assert.deepEqual(Object.values(options.props.urls), extra); assert.equal(options.props.defaultDestination, stage < 2 ? 'pickup' : 'delivery');
    assert.equal((html.match(/aria-current="step"/g) || []).length, stage < 4 ? 1 : 0);
    assert.equal((html.match(/<time /g) || []).length, stage);
    assert.equal((html.match(/<details/g) || []).length, 4);
    assert.ok(!html.includes('<details open'));
    const section = nodes(tree).find(n => n.type === 'section' && n.props['aria-labelledby'] === 'job-next-action');
    const action = nodes(section).find(n => n.type === 'button');
    if (stage < 4) {
      assert.ok(action); assert.equal(links[0].props.href, portal.buildDriverDirectionsUrl(job, stage < 2 ? 'pickup' : 'delivery', depot));
      assert.ok(html.includes(language === 'en' ? 'Navigate to' : 'นำทางไป'));
      assert.ok(html.indexOf('id="job-next-action"') < html.indexOf('id="job-progress"'));
    } else { assert.equal(action, undefined); assert.ok(html.includes(language === 'en' ? 'Job completed' : 'จบงานแล้ว')); }
  });
}
test('loading/error states hide actions and primary navigation, retaining refresh', () => {
  for (const overrides of [{1: true}, {2: true}]) {
    const { tree } = render('en', 0, overrides);
    const section = nodes(tree).find(n => n.type === 'section' && n.props['aria-labelledby'] === 'job-next-action');
    assert.equal(nodes(section).filter(n => n.type === 'button').length, 0);
    assert.equal(nodes(tree).filter(n => n.type === 'a' && n.props.target === '_blank').length, 0); assert.ok(nodes(tree).some(n => n.props?.urls));
  }
});
test('sequential save payload, timestamp update and completion confirmation remain intact', async () => {
  const previous = global.fetch;
  try {
    for (let stage = 0; stage < 4; stage++) {
      const calls = [];
      global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ event: { eventType: portal.DRIVER_JOB_EVENT_TYPES[stage], eventTime: '2026-10-06T08:00:00Z' } }) }; };
      const { tree, states } = render('en', stage);
      const section = nodes(tree).find(n => n.type === 'section' && n.props['aria-labelledby'] === 'job-next-action');
      nodes(section).find(n => n.type === 'button').props.onClick();
      await new Promise(setImmediate);
      if (stage === 3) { assert.equal(states[6], true); assert.equal(calls.length, 0); }
      else {
        assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/driver/jobs/own-job/events');
        assert.deepEqual(JSON.parse(calls[0].init.body), { eventType: portal.DRIVER_JOB_EVENT_TYPES[stage], latitude: null, longitude: null });
        assert.equal(states[0].length, stage + 1); assert.equal(states[0][stage].eventTime, '2026-10-06T08:00:00Z');
      }
    }
  } finally { global.fetch = previous; }
});
test('completion sends the final event only after confirmation and rejects duplicate taps', async () => {
  const previous = global.fetch;
  try {
    const calls = [];
    global.fetch = async (url, init) => { calls.push({url, init}); return {ok:true,json:async()=>({event:{eventType:'job_completed',eventTime:'2026-10-06T08:00:00Z'}})}; };
    const { tree, states } = render('en', 3, {6:true});
    const confirmation = nodes(tree).find(n => typeof n.type === 'function' && n.props.onConfirm);
    assert.ok(confirmation); confirmation.props.onConfirm(); confirmation.props.onConfirm();
    await new Promise(setImmediate);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].init.body), {eventType:'job_completed',latitude:null,longitude:null});
    assert.equal(states[0].length, 4); assert.equal(states[6], false);
  } finally { global.fetch = previous; }
});

test('one-tap navigation preserves all routes, sorts current destination first and has no configuration controls', () => {
const urls = {pickup:portal.buildDriverDirectionsUrl(job,'pickup',depot),delivery:portal.buildDriverDirectionsUrl(job,'delivery',depot),current:portal.buildDriverDirectionsUrl(job,'current',depot),depot:portal.buildDriverDirectionsUrl(job,'depot',depot),pickupToDropoff:portal.buildDriverDirectionsUrl(job,'pickup-to-dropoff',depot)};
for(const destination of ['pickup','delivery']){const options=driverNavigationRoutes(urls,destination);assert.equal(options.length,6);assert.equal(options[0].href,urls[destination]);for(const href of Object.values(urls))assert.ok(options.some(option=>option.href===href));for(const language of ['en','th']){const html=renderToStaticMarkup(React.createElement(DriverRouteOptions,{language,pickupName:job.pickupName,deliveryName:job.dropoffName,defaultDestination:destination,urls}));assert.equal((html.match(/target="_blank"/g)||[]).length,6);assert.ok(!html.includes('<button'));assert.ok(!html.includes('<input'));assert.ok(!html.includes('<fieldset'));assert.ok(!html.includes('aria-pressed'));}}
assert.deepEqual(driverNavigationRoutes({pickup:null,delivery:null,current:null,depot:null,pickupToDropoff:null},'pickup'),[]);
});
