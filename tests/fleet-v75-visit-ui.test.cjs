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
  m.require = r => { if (r === 'server-only') return {}; if (r === '@/lib/supabase') return { supabase: {} }; if (r === 'next/link') return { __esModule: true, default: props => require('react').createElement('a', { href: props.href }, props.children) };
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); }
    if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); }
    return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const React = require('react'); const { renderToString } = require('react-dom/server');
const P = load('components/fleet-day-places.tsx');

const match = (status, name, d) => ({ status, reasons: ['near_saved_point'], uncertainty: ['forth_saved_point_not_office_verified'], primary: name ? { name, thaiName: null, groupLayer: null, source: 'forth_saved_location', distanceM: d, proximity: 'near', referenceRadiusM: 50, forthDiameterRaw: '100', entrances: 1, eesSuggestion: null } : null, alternatives: [{ name: 'Other Co', thaiName: null, distanceM: 120 }] });
const stop = (id, a, b, m) => ({ id, firstAt: a, lastAt: b, observedMinutes: m, observations: 10, sourceQuality: 'verified_gps', nextToGap: false, matchStatus: 'possible_directory_match', matchName: 'Other Co' });
const data = {
  day: '2026-11-04', registration: '3ฒน-9565', read: true,
  visits: [
    { id: 'V01', stops: [stop('S01', '2026-11-04T01:00:00Z', '2026-11-04T01:40:00Z', 40), stop('S02', '2026-11-04T01:45:00Z', '2026-11-04T02:30:00Z', 45)], joins: [{ fromStopId: 'S01', toStopId: 'S02', interruptionMinutes: 5, separationM: 90, observationsBetween: 4, farthestBetweenM: 80, maxSpeedBetweenKph: 6 }],
      arrivalWindow: { earliest: '2026-11-04T00:58:00Z', latest: '2026-11-04T01:00:00Z' }, departureWindow: { earliest: '2026-11-04T02:30:00Z', latest: '2026-11-04T02:32:00Z' }, firstAt: '2026-11-04T01:00:00Z', lastAt: '2026-11-04T02:30:00Z', observedMinutes: 85, spanMinutes: 90, maxMinutes: 94, sourceQuality: 'verified_gps', openStart: false, openEnd: false, nextToGap: false, interruptions: 1, observations: 20, match: match('possible_directory_match', 'Acme Co', 30), stopLevelNames: ['Other Co'] },
    { id: 'V02', stops: [stop('S03', '2026-11-04T05:00:00Z', '2026-11-04T05:30:00Z', 30)], joins: [], arrivalWindow: { earliest: null, latest: '2026-11-04T05:00:00Z' }, departureWindow: { earliest: '2026-11-04T05:30:00Z', latest: null }, firstAt: '2026-11-04T05:00:00Z', lastAt: '2026-11-04T05:30:00Z', observedMinutes: 30, spanMinutes: 30, maxMinutes: null, sourceQuality: 'unverified', openStart: true, openEnd: true, nextToGap: true, interruptions: 0, observations: 10, match: match('unknown_stopping_area', null, 0), stopLevelNames: [] }
  ],
  driveBys: [], counts: { gpsStops: 28, visits: 2, driveBys: 0, splitsKept: 0, gapAffectedVisits: 1, unknownVisits: 1 }, splits: [],
  driver: { status: 'not_confirmed', drivers: [], ignored: [] }, directory: { usable: 466, total: 466 }
};
const html = (lang, extra = {}) => renderToString(React.createElement(P.FleetDayPlaces, { places: { data, state: 'ready' }, language: lang, dayRead: true, providerStops: { total: 4, zeroDuration: 3 }, ...extra })).replace(/<!-- -->/g, '');

test('visit table shows visits not raw stops, reconciles the counts, and never claims pickup or delivery', () => {
  const h = html('en');
  assert.match(h, /data-visit="V01"/); assert.match(h, /data-visit="V02"/);
  assert.match(h, /2 visits/); assert.match(h, /from 28 GPS stops/);
  assert.match(h, /data-stop-reconciliation/); assert.match(h, /Forth report stop entries/); assert.match(h, />4</); assert.match(h, /3 have zero duration/);
  assert.match(h, /≥ /, 'open visits show a lower-bound stay');
  assert.doesNotMatch(h, /confirmed (delivery|visit|pickup)|delivered|picked up/i);
});

test('thai rendering of the visit table and reconciliation', () => {
  const h = html('th');
  assert.match(h, /การเข้าเยี่ยม/); assert.match(h, /จำนวนจุดจอดแต่ละแหล่ง/); assert.match(h, /รายการจุดจอดในรายงาน Forth/);
});

test('without a provider report the reconciliation says so instead of inventing a number', () => {
  const h = html('en', { providerStops: null });
  assert.match(h, /Report not available for this day/);
});

test('the day-places response shape and component carry no coordinates, and the route stays GET-only and cache-only', () => {
  const server = read('lib/fleet-day-places-server.ts');
  const types = server.slice(server.indexOf('export type PlaceMatch'), server.indexOf('const toPlaceMatch'));
  assert.doesNotMatch(types, /latitude|longitude|centroid|coordinates/i);
  assert.match(server, /recalledProviderDay\(/); assert.doesNotMatch(server, /fetchProvider|forthClient|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  const route = read('app/api/admin/forth-tracking/evidence/day-places/route.ts');
  assert.match(route, /export async function GET/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /requireFleetOfficeAccess/); assert.match(route, /canViewJourneyDetail/);
  assert.doesNotMatch(read('components/fleet-day-places.tsx'), /latitude|longitude|centroid/);
});

test('the timeline shows visits in place of provider stop rows once loaded', () => {
  const snap = read('components/fleet-day-snapshot.tsx');
  assert.match(snap, /useVisits/); assert.match(snap, /kind: "visit"/);
});

test('V7.5.1: place view is presentation only, short visits are hidden by a visible toggle, never deleted', () => {
  const ui = read('components/fleet-day-places.tsx');
  assert.match(ui, /By place \(view only\)/); assert.match(ui, /Visits are not merged/);
  assert.match(ui, /SHORT_MINUTES = 10/); assert.match(ui, /Show \$\{shortCount\} short visits/);
  assert.doesNotMatch(ui, /visits\.splice|visits\.length = 0/);
});

test('V7.5.1: each status says which source it describes, and one read control remains once the day is loaded', () => {
  const panel = read('components/fleet-evidence-panel.tsx'), bar = read('components/fleet-provider-day-panel.tsx');
  assert.match(panel, /EES records loaded \(fuel, mileage, bookings\)/); assert.match(panel, /EES records not loaded yet/);
  assert.doesNotMatch(panel, /Evidence not read yet/);
  assert.match(bar, /Forth report for this day: not read/); assert.match(bar, /Forth report for this day: loaded/);
  assert.doesNotMatch(bar, /"Read again"/);
});

test('V7.5.1: the two GPS distances carry different scope labels and the difference is explained from the two figures only', () => {
  const ledger = read('components/fleet-journey-ledger-panel.tsx'), snap = read('components/fleet-day-snapshot.tsx');
  assert.match(ledger, /GPS-verified km in moving segments/); assert.match(ledger, /data-gps-measures/); assert.match(ledger, /Different measures, not a conflict/);
  assert.match(snap, /GPS, whole day \(verified intervals\)/); assert.doesNotMatch(snap, /"GPS-derived"/);
});

test('V7.6: the Daily Activity headline shows supported visits, and "—" (never zero) until the analysis has run', () => {
  const snap = read('components/fleet-day-snapshot.tsx'), panel = read('components/fleet-evidence-panel.tsx');
  assert.match(snap, /data-visit-groups/); assert.match(snap, /visits \? visits\.supported : "—"/); assert.match(snap, /not analysed yet/);
  assert.match(panel, /dayPlaces\.data\?\.read \? \{ supported: dayPlaces\.data\.counts\.visits/);
});

test('V7.6.1: the visit analysis is rebuilt when a new provider day arrives, adds no provider request, and the phone layout keeps the Details button reachable', () => {
  const hook = read('components/fleet-day-places.tsx'), panel = read('components/fleet-evidence-panel.tsx'), css = read('components/fleet-tracking-v73.css');
  assert.match(hook, /readStamp = ""/); assert.match(hook, /\[vehicleId, day, dayRead, readStamp\]/);
  assert.match(panel, /readStamp: dayReadStamp/); assert.match(panel, /sourceTimestamp/);
  assert.doesNotMatch(hook, /forth-tracking\/(history|provider)|fetchProvider/, 'the hook only calls the cache-only day-places route');
  assert.match(css, /max-width: 860px[\s\S]*v73-places-table th:nth-child\(4\)/); assert.match(css, /v75-q/);
});

test('V7.6.1: on phones all five workspace tabs share the width (no scrolling nav) with 44 px targets, and review-row buttons are 44 px', () => {
  const css = read('components/fleet-tracking-v73.css');
  assert.match(css, /max-width: 560px[\s\S]*v7-header-row \.v7-workspace-nav \{ overflow-x: visible/); assert.match(css, /v7-workspace-nav button \{ flex: 1 1 0; min-width: 0;[^}]*min-height: 44px/);
  assert.match(css, /fleet-review-row button \{ min-height: 44px; \}/);
});
