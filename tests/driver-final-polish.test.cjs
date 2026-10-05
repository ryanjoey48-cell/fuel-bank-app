const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const runtime = require('react/jsx-runtime');
function load(file, deps = {}) {
  const m = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name === './driver-disclosure') return load('components/driver/driver-disclosure.tsx', { 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react') });
    assert.ok(name in deps, name); return deps[name];
  }, m, m.exports);
  return m.exports;
}
const portal = load('lib/driver-portal.ts');
const vehicles = load('lib/driver-vehicle-types.ts');
const job = { id: 'test', bookingDate: '2026-10-12', pickupTime: null, clientName: 'PIONEERS', pickupName: 'ศูนย์กระจายสินค้าบางพลีและคลังสินค้าระหว่างประเทศ', dropoffName: 'ท่าเรือคลองเตยจุดรับส่งสินค้าระหว่างประเทศ', pickupAddress: '123 ถนนบางนา ตำบลบางพลีใหญ่ สมุทรปราการ', dropoffAddress: 'ท่าเรือคลองเตย กรุงเทพมหานคร', vehicleRegistration: '1998', vehicleType: 'FOUR_WHEEL_TRUCK', jobOrderNumber: null, trailerRegistration: null };
function render(language, stage, extra = {}) {
  const events = portal.DRIVER_JOB_EVENT_TYPES.slice(0, stage).map((eventType, index) => ({ eventType, eventTime: `2026-10-12T0${index + 1}:00:00Z`, latitude: 13.75, longitude: 100.5 }));
  let index = 0;
  const state = [events, false, false, false, null, null, null, false];
  const hooks = { ...React, useState: initial => [index < state.length ? state[index++] : initial, () => {}], useEffect: () => {}, useCallback: fn => fn, useRef: value => ({ current: value }) };
  const { DriverJobDetail } = load('components/driver/driver-job-detail.tsx', { react: hooks, 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react'), 'next/link': ({ children, ...props }) => React.createElement('a', props, children), '@/lib/language-provider': { useLanguage: () => ({ language }) }, '@/lib/driver-portal': portal, '@/lib/driver-vehicle-types': vehicles });
  return renderToStaticMarkup(DriverJobDetail({ job: { ...job, ...extra }, depot: { name: 'Depot', address: 'Bangkok' } }));
}
for (const language of ['en', 'th']) for (let stage = 0; stage <= 4; stage++) test(`workflow polish retains stage, recorded times, full route names and collapsed utilities: ${language} ${stage}`, () => {
  const html = render(language, stage);
  assert.ok(html.includes(job.pickupName)); assert.ok(html.includes(job.dropoffName));
  assert.ok(!html.includes('truncate'));
  const progress = html.match(/<section aria-labelledby="job-progress"[\s\S]*?<\/section>/)[0];
  assert.equal((progress.match(/<time /g) || []).length, stage);
  assert.equal((html.match(/id="job-progress"/g)||[]).length, 1);
  assert.ok(html.indexOf('id="job-progress"')<html.indexOf('id="job-next-action"'));
  assert.equal((html.match(/aria-current="step"/g) || []).length, stage < 4 ? 1 : 0);
  assert.equal((html.match(/<details/g) || []).length, 3); assert.ok(!html.includes('<details open'));
  assert.ok(!html.includes(language === 'en' ? '>Job order<' : '>เลขงาน<'));
  assert.ok(!html.includes(language === 'en' ? '>Trailer<' : '>หางพ่วง<'));
  if (stage < 4) assert.ok(html.includes(language === 'en' ? `STEP ${stage + 1} OF 4` : `ขั้นตอน ${stage + 1} จาก 4`));
  else assert.ok((html.match(/href="\/driver"/g) || []).length >= 2);
});
test('populated optional Job Order and Trailer remain accessible', () => {
  const html = render('en', 0, { jobOrderNumber: 'JOB-42', trailerRegistration: 'ABC-456' });
  assert.ok(html.includes('Job order')); assert.ok(html.includes('JOB-42')); assert.ok(html.includes('Trailer')); assert.ok(html.includes('ABC-456'));
});
test('a cached photo stays visible after loading; changed photo URLs get fresh image state', () => {
  let index = 0;
  const values = [false, false], effects = [];
  const hooks = { ...React, useState: initial => { const i = index++; return [i in values ? values[i] : initial, value => { values[i] = value; }]; }, useEffect: callback => effects.push(callback) };
  const { DriverAvatar } = load('components/driver/driver-ui.tsx', { react: hooks, 'react/jsx-runtime': runtime });
  const avatar = DriverAvatar({ src: 'signed-photo-1', name: 'Joey Ryan' });
  const photo = avatar.props.children.find(child => child && typeof child.type === 'function');
  assert.equal(photo.key, 'signed-photo-1');
  const image = photo.type(photo.props);
  image.props.onLoad();
  effects.forEach(effect => effect());
  index = 0;
  assert.ok(photo.type(photo.props).props.className.includes('opacity-100'));
  assert.equal(DriverAvatar({ src: 'signed-photo-2', name: 'Joey Ryan' }).props.children.find(child => child && typeof child.type === 'function').key, 'signed-photo-2');
  assert.equal(DriverAvatar({ src: null, name: 'Joey Ryan' }).props.children[1], null);
});

test('three visible icon shortcuts follow Navigate only during travel; other route capabilities stay available', () => {for(const stage of [0,1,2,3,4]){const html=render('en',stage);const task=html.match(/<section class="driver-surface[\s\S]*?<\/section>/)[0];const shortcuts=task.match(/aria-label="Route options"[\s\S]*?<\/div>/);assert.equal(Boolean(shortcuts),stage===0||stage===2);if(shortcuts){assert.equal((shortcuts[0].match(/target="_blank"/g)||[]).length,3);assert.ok(task.indexOf('Navigate to')<task.indexOf('aria-label="Route options"'));assert.ok(task.indexOf('aria-label="Route options"')<task.indexOf('driver-primary-action'));}for(const mode of ['depot','current','pickup','delivery','pickup-to-dropoff']){const url=portal.buildDriverDirectionsUrl(job,mode,{name:'Depot',address:'Bangkok'}).replaceAll('&','&amp;');assert.ok(html.includes(url),'Missing '+mode+' at stage '+stage);}assert.ok(!html.includes('<span>Route options</span>'));}});
