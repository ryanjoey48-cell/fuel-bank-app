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
  new Function('require', 'module', 'exports', js)((name) => { if (name === './driver-disclosure') return load('components/driver/driver-disclosure.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  return module.exports;
}
const portal = load('lib/driver-portal.ts');
const vehicles = load('lib/driver-vehicle-types.ts');
const job = { id: 'own-job', bookingDate: '2026-10-06', pickupTime: null, clientName: 'PIONEERS', pickupName: 'GLOBAL', dropoffName: 'ท่าเรือ', pickupAddress: 'JM4H+MVF ตำบลบางพลีใหญ่ สมุทรปราการ', dropoffAddress: 'ท่าเรือคลองเตย กรุงเทพมหานคร', vehicleRegistration: '1998', vehicleType: 'FOUR_WHEEL_TRUCK', jobOrderNumber: 'EES-123', trailerRegistration: '456' };
const depot = { name: 'Depot', address: 'Depot address' };
function render(language, stage, overrides = {}) {
  const states = [portal.DRIVER_JOB_EVENT_TYPES.slice(0, stage).map((eventType, i) => ({ eventType, eventTime: `2026-10-06T0${i + 1}:00:00Z`, latitude: i ? null : 13, longitude: i ? null : 100 })), false, false, false, null, null, false];
  for (const [key, value] of Object.entries(overrides)) states[Number(key)] = value;
  let index = 0;
  const hooks = { ...React, useState(initial) { const i = index++; return [i in states ? states[i] : initial, value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }) };
  const { DriverJobDetail } = load('components/driver/driver-job-detail.tsx', { react: hooks, 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react'), 'next/link': ({ children, ...props }) => React.createElement('a', props, children), '@/lib/language-provider': { useLanguage: () => ({ language }) }, '@/lib/driver-portal': portal, '@/lib/driver-vehicle-types': vehicles });
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
    assert.deepEqual(links.slice(stage < 4 ? 1 : 0).map(n => n.props.href), extra);
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
    assert.equal(nodes(tree).filter(n => n.type === 'a' && n.props.target === '_blank').length, 5);
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
