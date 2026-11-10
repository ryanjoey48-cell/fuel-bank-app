const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
function load(rel, cache = new Map()) {
  const file = path.resolve(root, rel); if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module); cache.set(file, m); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const resolve = base => ['.ts', '.tsx'].map(e => base + e).find(f => fs.existsSync(path.join(root, f)));
  m.require = r => { if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); } if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); } return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const F = load('lib/fleet-fuel-review.ts');
const day = (d, over = {}) => ({ day: d, read: true, providerKm: 100, providerReconciled: true, gpsKm: 99, stops: 3, missingMinutes: 0, fuel: [], odometerReadings: 0, ...over });
const span = (km, from, to, reviewRequired = false) => ({ label: 'Fuel Log odometer span', km, from, to, reviewRequired });
const keys = c => c.map(x => x.key);

test('a comparable odometer span that differs by 5 km and 10% is a medium review candidate; a small difference is not', () => {
  const days = [day('2026-11-01'), day('2026-11-02'), day('2026-11-03')];
  const big = F.fuelReviewCandidates({ days, spans: [span(250, '2026-11-01', '2026-11-03')], intervals: [] });
  assert.deepEqual(keys(big), ['odometer_vs_provider']); assert.equal(big[0].severity, 'medium'); assert.equal(big[0].evidence.differenceKm, 50);
  assert.deepEqual(keys(F.fuelReviewCandidates({ days, spans: [span(303, '2026-11-01', '2026-11-03')], intervals: [] })), []);
});

test('no comparison is made when any day in the span is unreviewed or unreconciled (never forced to agree)', () => {
  const unread = [day('2026-11-01'), day('2026-11-02', { read: false, providerKm: null, providerReconciled: false }), day('2026-11-03')];
  assert.ok(!keys(F.fuelReviewCandidates({ days: unread, spans: [span(900, '2026-11-01', '2026-11-03')], intervals: [] })).includes('odometer_vs_provider'));
  const unreconciled = [day('2026-11-01', { providerReconciled: false })];
  assert.ok(!keys(F.fuelReviewCandidates({ days: unreconciled, spans: [span(900, '2026-11-01', '2026-11-01')], intervals: [] })).includes('odometer_vs_provider'));
  assert.ok(!keys(F.fuelReviewCandidates({ days: [day('2026-11-01')], spans: [span(900, '2026-10-01', '2026-10-05')], intervals: [] })).includes('odometer_vs_provider'), 'a span outside the dates is unknown, not compared');
});

test('information-level candidates: date-only odometer, withheld interval, fuel without cost or type, purchases on unreviewed days; LPG is a type, not an anomaly', () => {
  const days = [
    day('2026-11-01', { fuel: [{ fuelType: 'lpg', records: 1, purchasedLitres: 40, costThb: 800 }] }),
    day('2026-11-02', { fuel: [{ fuelType: 'unrecorded', records: 2, purchasedLitres: null, costThb: null }] }),
    day('2026-11-03', { read: false, providerKm: null, providerReconciled: false, fuel: [{ fuelType: 'diesel', records: 1, purchasedLitres: 50, costThb: 1700 }] })
  ];
  const c = F.fuelReviewCandidates({ days, spans: [span(100, '2026-11-01', '2026-11-01', true)], intervals: [{ source: 'fuel_logs', from: '2026-11-01', to: '2026-11-03', withheld: true }, { source: 'weekly_mileage', from: '2026-11-01', to: '2026-11-02', withheld: false }] });
  const k = keys(c);
  for (const x of ['odometer_date_only', 'odometer_interval_withheld', 'fuel_cost_missing', 'fuel_type_unrecorded', 'purchases_on_unreviewed_days']) assert.ok(k.includes(x), x);
  assert.equal(c.find(x => x.key === 'odometer_interval_withheld').evidence.source, 'fuel_logs');
  assert.equal(c.find(x => x.key === 'fuel_cost_missing').evidence.records, 2, 'only the record with unknown cost counts; the LPG record with a cost is clean');
  assert.ok(c.every(x => x.severity === 'info'), 'nothing here is escalated');
});

test('quiet when there is nothing to show, and the candidates never contain consumption or km per litre', () => {
  assert.deepEqual(F.fuelReviewCandidates({ days: [day('2026-11-01')], spans: [null, null], intervals: [] }), []);
  assert.doesNotMatch(read('lib/fleet-fuel-review.ts').replace(/\/\*[\s\S]*?\*\//g, ''), /kmPerLitre|km\/L|consumption\s*=|efficiency\s*=/i);
});

test('the fuel view shows the period strip and review candidates (EN/TH) and the review adds no request', () => {
  const panel = read('components/fleet-evidence-panel.tsx'), hist = read('components/fleet-operating-history.tsx');
  // V7.8.2: the fuel review leads; candidates follow it and the day-by-day strip is a secondary, collapsed section.
  assert.match(panel, /<FleetFuelPanel[\s\S]*data && historyDays\.length \? <><FleetFuelReview[\s\S]*FleetOperatingStrip/);
  assert.match(hist, /data-fuel-review/); assert.match(hist, /Candidates are prompts to look, not findings/); assert.match(hist, /เป็นข้อเสนอให้ตรวจ ไม่ใช่ข้อสรุป/);
  const seg = hist.slice(hist.indexOf('export function FleetFuelReview'), hist.indexOf('export function FleetKmFuelTable'));
  assert.doesNotMatch(seg, /fetch\(|supabase/);
  for (const k of Object.keys(F.FUEL_REVIEW_COPY)) { assert.ok(F.FUEL_REVIEW_COPY[k].title[1].length > 0 && F.FUEL_REVIEW_COPY[k].action[1].length > 0, k); }
});

test('regression: the odometer comparison uses Forth distance over exactly the days the span covers, not the whole displayed period', () => {
  const days = [day('2026-11-01'), day('2026-11-02'), day('2026-11-03')]; // 100 km each
  assert.deepEqual(keys(F.fuelReviewCandidates({ days, spans: [span(100, '2026-11-01', '2026-11-01')], intervals: [] })), [], 'one-day span of 100 km vs one day of 100 km agrees');
  assert.deepEqual(keys(F.fuelReviewCandidates({ days, spans: [span(300, '2026-11-01', '2026-11-03')], intervals: [] })), []);
  const hist = read('components/fleet-operating-history.tsx');
  assert.match(hist, /coveredSum/); assert.doesNotMatch(hist, /Math.abs(providerSum - s.km)/);
});

test('repeated withheld odometer intervals from one source collapse into a single candidate with a count (no warning flood)', () => {
  const intervals = [['2026-10-01','2026-10-02'],['2026-10-02','2026-10-05'],['2026-10-06','2026-10-08']].map(([from,to]) => ({ source: 'fuel_logs', from, to, withheld: true })).concat([{ source: 'weekly_mileage', from: '2026-10-04', to: '2026-10-11', withheld: true }]);
  const c = F.fuelReviewCandidates({ days: [day('2026-10-01')], spans: [], intervals }).filter(x => x.key === 'odometer_interval_withheld');
  assert.equal(c.length, 2); const fuel = c.find(x => x.evidence.source === 'fuel_logs'); assert.equal(fuel.evidence.intervals, 3); assert.equal(fuel.evidence.from, '2026-10-01'); assert.equal(fuel.evidence.to, '2026-10-08');
});
