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
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(name => { assert.ok(name in deps, name); return deps[name]; }, m, m.exports);
  return m.exports;
}
const ops = load('lib/driver-operations.ts');
const vehicleLabels = load('lib/driver-vehicle-types.ts');
const ui = load('components/driver/driver-ui.tsx', { react: React, 'react/jsx-runtime': runtime, 'next/image': () => null });
const today = '2026-10-05';
const job = (id, date, time = null) => ({ id, bookingDate: date, pickupTime: time, clientName: id, pickupName: 'ท่าเรือ', dropoffName: 'Asia Mag', vehicleRegistration: '1998', vehicleType: 'FOUR_WHEEL_TRUCK' });
const done = { eventType: 'job_completed', eventTime: '2026-10-05T04:00:00Z' };
function home(language, jobs, eventsByJob = {}, date = today) {
  const { DriverHome } = load('components/driver/driver-home.tsx', {
    react: { ...React, useState: () => [null, () => {}] }, 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react'),
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/image': ({ fill, priority, sizes, ...props }) => React.createElement('img', props),
    '@/lib/language-provider': { useLanguage: () => ({ language }) }, '@/lib/driver-operations': ops,
    '@/lib/driver-vehicle-types': vehicleLabels, './driver-ui': ui
  });
  return renderToStaticMarkup(React.createElement(DriverHome, { driverName: 'Joey Ryan', jobs, eventsByJob, today: date }));
}
for (const date of ['2026-10-08', '2026-10-12', '2027-10-12']) test(`next unfinished job has no future-date cutoff: ${date}`, () => {
  const jobs = [job('past', '2026-10-04'), job('today-done', today), job('tomorrow-done', '2026-10-06'), job('next', date)];
  const events = { 'today-done': [done], 'tomorrow-done': [done] };
  assert.equal(ops.nextDriverJob(jobs, events, today).id, 'next');
});
test('date and provided time order wins; ties and missing times never hide the card; inputs stay unchanged', () => {
  const jobs = [job('later-date', '2026-10-09', '07:00'), job('no-time-b', '2026-10-08'), job('no-time-a', '2026-10-08'), job('later-time', '2026-10-08', '12:00'), job('earlier-time', '2026-10-08', '08:00')];
  const snapshot = JSON.stringify(jobs);
  assert.equal(ops.nextDriverJob(jobs, {}, today).id, 'earlier-time');
  assert.equal(ops.nextDriverJob(jobs.slice(0, 3), {}, today).id, 'no-time-a');
  assert.equal(JSON.stringify(jobs), snapshot);
  assert.equal(ops.nextDriverJob([], {}, today), null);
  assert.equal(ops.nextDriverJob([job('done', today)], { done: [done] }, today), null);
});
for (const language of ['en', 'th']) test(`home keeps future Next Job unique, excludes completed jobs and reports today only: ${language}`, () => {
  const jobs = [job('done-today', today), job('done-future', '2026-10-06'), job('a', '2026-10-07'), job('b', '2026-10-07'), job('c', '2026-10-09')];
  const html = home(language, jobs, { 'done-today': [done], 'done-future': [done] });
  for (const id of ['a', 'b', 'c']) assert.equal((html.match(new RegExp(`href="/driver/jobs/${id}"`, 'g')) || []).length, 1);
  assert.ok(!html.includes('/driver/jobs/done-today')); assert.ok(!html.includes('/driver/jobs/done-future'));
  assert.ok(html.indexOf('/driver/jobs/a') < html.indexOf('/driver/jobs/b'));
  assert.ok(html.includes(language === 'en' ? 'No jobs remaining today' : 'วันนี้ไม่มีงานเหลือแล้ว'));
  assert.ok(html.includes(ui.driverJobAction(language, 'ready')));
  assert.ok(html.includes('/driver-hero-bg.png')); assert.ok(!html.includes('/ees-truck.png'));
  assert.ok(html.includes('min-h-[112px]')); assert.ok(html.includes('rounded-[24px]'));
});
test('underway future job keeps Continue job and original booking link', () => {
  const html = home('en', [job('active', '2026-10-12')], { active: [{ eventType: 'pickup_arrived', eventTime: '2026-10-05T04:00:00Z' }] });
  assert.ok(html.includes('Continue job')); assert.ok(html.includes('CURRENT JOB')); assert.ok(html.includes('/driver/jobs/active'));
});
function server(admin) {
  return load('lib/driver-portal-server.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), 'next/headers': {}, '@supabase/supabase-js': {}, react: { cache: f => f }, '@/lib/admin-user-management-server': { createServerSupabaseAdmin: () => admin } });
}
test('home reads all future assigned pages, preserving ownership and date filters', async () => {
  const calls = [], rows = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(4, '0'), booking_date: '2026-10-12', pickup_time: null }));
  const admin = { from(table) { assert.equal(table, 'booking_diary'); const q = { select() { return q; }, eq(key, value) { assert.equal(key, 'driver_id'); assert.equal(value, '26'); return q; }, gte(key, value) { assert.equal(key, 'booking_date'); assert.match(value, /^\d{4}-\d{2}-\d{2}$/); return q; }, order(key) { calls.push(key); return q; }, async range(start, end) { calls.push([start, end]); return { data: rows.slice(start, end + 1), error: null }; } }; return q; } };
  const result = await server(admin).listAssignedDriverJobs({ driverId: '26', vehicleRegistration: '1998', vehicleType: null });
  assert.equal(result.length, 1001);
  assert.deepEqual(calls.filter(Array.isArray), [[0, 499], [500, 999], [1000, 1499]]);
  const events = Object.fromEntries(result.slice(0, 1000).map(j => [j.id, [done]]));
  assert.equal(ops.nextDriverJob(result, events, today).id, '1000');
});
test('a later page failure reports unavailable instead of returning a misleading partial home list', async () => {
  const q = { select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; }, async range(start) { return start ? { data: null, error: new Error('failed') } : { data: Array.from({ length: 500 }, (_, i) => ({ id: String(i), booking_date: '2026-10-12' })), error: null }; } };
  await assert.rejects(server({ from: () => q }).listAssignedDriverJobs({ driverId: '26' }), { status: 503 });
});

for (const zone of ['Asia/Bangkok','America/Los_Angeles','Pacific/Auckland']) test('Tomorrow uses the Bangkok booking date independently of device timezone: '+zone, () => {const previous=process.env.TZ;try{process.env.TZ=zone;const html=home('en',[job('now','2026-11-01'),job('tomorrow','2026-11-02'),job('later','2026-11-03')],{},'2026-11-01');assert.equal((html.match(/>Tomorrow</g)||[]).length,1);assert.ok(html.includes('3 Nov 2026'));}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}});

for(const count of [0,1,2,3])test('today job-count grammar: '+count,()=>{const jobs=Array.from({length:count},(_,i)=>job('today-'+i,today));jobs.push(job('future','2026-10-12'));const html=home('en',jobs);const expected=count===0?'No jobs remaining today':count===1?'job remaining today':'jobs remaining today';assert.ok(html.includes(expected));if(count===1)assert.ok(!html.includes('jobs remaining today'));assert.ok(html.includes(count?'today-0':'future'));});
