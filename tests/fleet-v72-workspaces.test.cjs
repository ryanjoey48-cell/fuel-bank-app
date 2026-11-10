const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// Small .ts/.tsx loader so components can be server-rendered without a bundler.
function load(rel, cache = new Map()) {
  const file = path.resolve(root, rel); if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module); cache.set(file, m); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const resolve = base => ['.ts', '.tsx'].map(e => base + e).find(f => fs.existsSync(path.join(root, f)));
  m.require = r => { if (r === 'server-only') return {};
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); }
    return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const React = require('react'); const { renderToString } = require('react-dom/server');
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const snapshot = load('components/fleet-day-snapshot.tsx');

const model = (coverage = 'verified_incomplete') => ({ day: '2026-11-03', coverage, coverageReasons: [], insights: [], positionCount: { received: 10, analysed: 10, exactDuplicates: 0, noValidTime: 0, explained: true },
  activity: { movingJourneys: 4, stops: 3, movingMinutes: 300, stoppedMinutes: 120, longestStopMinutes: 60, missingMinutes: 0, coverageShare: 0.9, firstSegmentStart: '2026-11-03T06:00:00+07:00', lastSegmentEnd: '2026-11-03T20:00:00+07:00', startedMoving: false, endedMoving: false, observations: 200, verifiedObservations: 190 } });
const provider = (providerKm, gpsKm) => ({ sources: { providerReported: { value: providerKm }, gpsDerived: { value: gpsKm } }, provider: { arithmetic: { status: 'pass' } }, journeyLedger: null });
const summary = { issues: [] };
const render = (p, lang = 'en') => renderToString(React.createElement(snapshot.FleetDaySnapshot, { provider: p, model: model(), summary, registration: '68-7154', day: '2026-11-03', language: lang, restricted: false }));

test('V7.2 Daily: 664.02 km vs 966.99 km shows a review notice that names both and picks neither', () => {
  assert.equal(snapshot.distancesDisagree(664.02, 966.99), true);
  const html = render(provider(664.02, 966.99));
  const plain = text(html);
  assert.match(html, /data-distance-disagreement/); assert.match(html, /data-discrepancy-notice/);
  assert.match(plain, /664\.02/); assert.match(plain, /966\.99/);
  assert.match(plain, /neither is confirmed correct/); assert.match(plain, /Nothing has been adjusted/);
  assert.doesNotMatch(plain, /correct total|accepted/i);
  assert.match(text(render(provider(664.02, 966.99), 'th')), /ไม่มีการปรับตัวเลข/, 'Thai notice');
});

test('V7.2 Daily: matching or one-sided distances show no discrepancy; an unread day is unknown, not zero', () => {
  assert.equal(snapshot.distancesDisagree(100, 103), false);
  assert.equal(snapshot.distancesDisagree(0, 0.02), false);
  assert.equal(snapshot.distancesDisagree(null, 966.99), false);
  assert.doesNotMatch(render(provider(120, 121)), /data-distance-disagreement/);
  const unread = text(render(null));
  assert.match(unread, /not read for this day/i); assert.match(unread, /unknown, not zero/);
});

test('V7.2 Daily: the technical evidence is kept, collapsed, under one heading; the read control is not duplicated', () => {
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /<details className="v72-evidence" data-tracking-evidence><summary>\{t\("Tracking evidence & reconciliation"/);
  for (const c of ['<FleetDayInsights', '<FleetVehicleDaySummary', 'variant="details"', '{gpsHealth}']) assert.ok(panel.includes(c), c);
  const provider = read('components/fleet-provider-day-panel.tsx');
  assert.match(provider, /variant !== "details" \? <div className="v72-read-row">/, 'the evidence-only variant has no read button');
  assert.doesNotMatch(provider.slice(provider.indexOf('variant === "full" ? <h4>')), /autoRead|useEffect\(\(\) => \{ void read/);
});

test('V7.2 Journeys: recurring places are a table with one detail panel, and every old action survives', () => {
  const c = read('components/fleet-recurring-areas.tsx');
  assert.equal((c.match(/useState<string \| null>\(null\);\s*\n/g) ?? []).length >= 1, true);
  assert.match(c, /const \[selectedId, setSelectedId\]/);
  assert.equal((c.match(/<aside id="v72-area-detail"/g) ?? []).length, 1, 'one detail panel');
  assert.doesNotMatch(c, /<details><summary>\{t\("Evidence and dates"/, 'no per-card expanding details');
  for (const needle of ['Open this day', 'data-review-location', 'reviewLocation(selected)', 'navigator.clipboard', 'showRoadside', 'data-patterns', 'sourceText(v.sourceQuality)', 'aria-pressed', 'aria-controls="v72-area-detail"', 'Limitations and alternative explanations'])
    assert.ok(c.includes(needle), needle);
  for (const col of ['Area', 'Days', 'Visits', 'Vehicles', 'Typical stay', 'GPS quality']) assert.ok(c.includes(`t("${col}"`), col);
});

test('V7.2 Journeys: booking associations are optional and the significant-stops table does not invent stops', () => {
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /<details className="v72-optional" data-optional-jobs>/);
  const ledger = read('components/fleet-journey-ledger-panel.tsx');
  assert.match(ledger, /j\.kind === "stopped" && !j\.ambiguous && j\.minutes !== null && j\.minutes >= 10/);
  assert.match(ledger, /data-significant-stops/); assert.match(ledger, /A stop is not a delivery or a job/);
});

test('V7.2 Fuel: chronological tables with right-aligned numbers; the 1,693 km interval stays exact and gets a review note', () => {
  const f = read('components/fleet-fuel-panel.tsx');
  assert.match(f, /data-fuel-table/); assert.match(f, /data-odometer-table/);
  assert.ok((f.match(/className="num"/g) ?? []).length >= 8, 'numeric columns are right-aligned');
  assert.match(f, /const LARGE_INTERVAL_KM = 1000;/);
  assert.match(f, /formatLitres\(interval\.km, language\)/, 'the interval distance is displayed exactly as recorded');
  assert.match(f, /shown exactly as recorded/); assert.match(f, /Possible reasons: refuelling records missing in between/);
  assert.match(f, /purchased, not consumed/); assert.match(f, /Purchased fuel is not consumed fuel/);
  assert.doesNotMatch(f, /km\/L\s*=|litres\s*\/\s*km|efficiencyKmPerL/i, 'no fuel economy is calculated');
  const view = read('lib/fleet-fuel-view.ts'); assert.ok(view.length > 0);
});

test('V7.2 Reports: exceptions come first, then the coverage strip, and a partial distance is never a fleet total', () => {
  const c = read('components/fleet-day-review.tsx');
  assert.ok(c.indexOf('data-exception-groups') < c.indexOf('data-fleet-summary'), 'exceptions before the summary strip');
  assert.ok(c.indexOf('data-fleet-summary') < c.indexOf('data-distance-disclosure'));
  assert.match(c, /v72-notice is-partial/); assert.match(c, /is a partial sum of/); assert.match(c, /not a fleet total/);
  assert.match(c, /Not requested is not the same as no problem/);
  assert.match(c, /Unknown is never shown as zero/);
  assert.match(c, /Read \$\{pending\.length\} missing vehicle-days from Forth|Read \$\{pending.length\} missing/);
  assert.match(c, /queueAbort\.current\?\.abort\(\)/, 'stop remains');
  assert.match(c, /concurrency: 1/);
});

test('V7.2: shared styling is scoped to the V7 workspace and never touches other pages', () => {
  const css = read('components/fleet-tracking-v72.css');
  const bare = css.split('\n').filter(l => /^[.#a-z@]/i.test(l) && !l.startsWith('@media') && !l.startsWith('/*') && l.includes('{') && !l.includes('.fleet-v7.fleet-v7.fleet-v7'));
  assert.deepEqual(bare, [], 'every rule is scoped under the .fleet-v7 workspace');
});
