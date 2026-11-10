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
  m.require = r => { if (r === 'server-only') return {}; if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); } if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); } return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const M = load('lib/fleet-visit-map.ts');
const base = { vehicleId: 'veh-1', registration: '3ฒน-9565', day: '2026-11-04', visitId: 'V04' };
const info = { firstAt: '2026-11-04T02:40:00Z', lastAt: '2026-11-04T04:33:00Z', observedMinutes: 93, spanMinutes: 113, maxMinutes: 115, stops: 3, observations: 63, sourceQuality: 'verified_gps', openStart: false, openEnd: false, nextToGap: false, interruptions: 2, missingReports: 2, arrival: { earliest: null, latest: '2026-11-04T02:40:00Z' }, departure: { earliest: '2026-11-04T04:33:00Z', latest: null }, spreadM: 6, centroid: { latitude: 13.7, longitude: 100.6 } };
const match = { status: 'likely_directory_match', reasons: [], uncertainty: [], primaryName: 'Global', primaryDistanceM: 50 };
const pos = (i, verified = true, over = {}) => ({ at: new Date(Date.UTC(2026, 10, 4, 2, i)).toISOString(), latitude: 13.7 + i * 1e-5, longitude: 100.6, verified, speedKph: 0, phase: 'during', distanceFromCentreM: 3, ...over });
const cand = (id, role, over = {}) => ({ id, name: id, thaiName: null, latitude: 13.7005, longitude: 100.6, distanceM: 50, source: 'forth_saved_location', category: null, role, ...over });
const view = (positions, candidates = [], over = {}) => M.visitMapView({ base, group: { ...info, ...over }, match, candidates, positions });

test('a visit with observed positions is ready, keeps its identity and never invents a position', () => {
  const v = view([pos(1), pos(2), pos(3, false)], [cand('Global', 'primary')]);
  assert.equal(v.status, 'ready'); assert.deepEqual([v.vehicleId, v.day, v.visitId], ['veh-1', '2026-11-04', 'V04']);
  assert.equal(v.positions.length, 3); assert.equal(v.positionCounts.verifiedShown, 2); assert.equal(v.positionCounts.unverifiedShown, 1);
  assert.deepEqual(v.centre, { latitude: 13.7, longitude: 100.6 });
});

test('missing or invalid coordinates give an unavailable state, no centre and no candidates (never a fabricated point)', () => {
  const none = view([], [cand('Global', 'primary')]);
  assert.equal(none.status, 'no_location_evidence'); assert.equal(none.centre, null); assert.deepEqual(none.candidates, []);
  const bad = view([pos(1, true, { latitude: NaN }), pos(2, true, { latitude: 0, longitude: 0 }), pos(3, true, { latitude: 99 })]);
  assert.equal(bad.status, 'no_location_evidence'); assert.equal(bad.positions.length, 0);
  assert.equal(view([pos(1)], [], { centroid: { latitude: NaN, longitude: 100 } }).status, 'no_location_evidence');
});

test('positions are bounded; unverified, first and last are always kept; order preserved', () => {
  const many = Array.from({ length: 1000 }, (_, i) => pos(i % 60, i % 97 !== 0, { at: new Date(Date.UTC(2026, 10, 4, 0, 0, i)).toISOString() }));
  const v = view(many);
  assert.ok(v.positions.length <= M.MAX_MAP_POSITIONS && v.positionCounts.downsampled && v.positionCounts.total === 1000);
  assert.equal(v.positions[0].at, many[0].at); assert.equal(v.positions.at(-1).at, many.at(-1).at);
  assert.deepEqual([...v.positions].map(p => p.at), [...v.positions].map(p => p.at).sort());
  const allBad = M.boundPositions(Array.from({ length: 900 }, (_, i) => ({ at: String(i), verified: false })));
  assert.ok(allBad.items.length <= M.MAX_MAP_POSITIONS, 'a hard cap even when every position is unverified');
});

test('competing saved points keep their roles; the diameter field and EES names carry no coordinates', () => {
  const v = view([pos(1)], [cand('Global', 'primary'), cand('Other', 'alternative', { distanceM: 90 }), cand('Far', 'nearby', { distanceM: 240 })]);
  assert.deepEqual(v.candidates.map(c => c.role), ['primary', 'alternative', 'nearby']);
  const src = read('lib/fleet-visit-map-server.ts') + read('lib/fleet-visit-map.ts');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /forthDiameter|diameterRaw|ees_locations/);
  assert.match(src, /SEARCH_RADIUS_M/, 'the existing 250 m matching radius is reused, not widened');
});

test('a late response for another vehicle, day or visit is rejected', () => {
  assert.equal(M.mapMatchesRequest(base, base), true);
  for (const k of ['vehicleId', 'day', 'visitId']) assert.equal(M.mapMatchesRequest({ ...base, [k]: 'other' }, base), false, k);
  assert.equal(M.mapMatchesRequest(null, base), false);
  const comp = read('components/fleet-visit-map.tsx');
  assert.match(comp, /mapMatchesRequest\(body, want\)/); assert.match(comp, /controller\.abort\(\)/);
});

test('selection survives a refresh only when the same observed window still exists; otherwise it clears', () => {
  const prev = { id: 'V03', firstAt: 'a', lastAt: 'b' };
  assert.equal(M.reselectVisit(prev, [{ id: 'V04', firstAt: 'a', lastAt: 'b' }]), 'V04', 'ids are positional, the window is the identity');
  assert.equal(M.reselectVisit(null, []), null);
  const t0 = '2026-11-04T02:00:00Z', t1 = '2026-11-04T03:00:00Z';
  assert.equal(M.reselectVisit({ id: 'V01', firstAt: t0, lastAt: t1 }, [{ id: 'V02', firstAt: '2026-11-04T02:05:00Z', lastAt: t1 }]), 'V02');
  assert.equal(M.reselectVisit({ id: 'V01', firstAt: t0, lastAt: t1 }, [{ id: 'V02', firstAt: '2026-11-04T05:00:00Z', lastAt: '2026-11-04T06:00:00Z' }]), null);
  assert.equal(M.reselectVisit({ id: 'V01', firstAt: t0, lastAt: t1 }, [{ id: 'V02', firstAt: t0, lastAt: '2026-11-04T02:30:00Z' }, { id: 'V03', firstAt: '2026-11-04T02:40:00Z', lastAt: t1 }]), null, 'two candidates is ambiguous: clear');
});

test('route: GET only, historical-journey authorisation first, ids only in the URL, reads only this user cache, never writes or calls Forth', () => {
  const route = read('app/api/admin/forth-tracking/evidence/visit-map/route.ts');
  assert.match(route, /export async function GET/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf('requireFleetOfficeAccess') < route.indexOf('canViewJourneyDetail') && route.indexOf('canViewJourneyDetail') < route.indexOf('loadVisitMap'));
  assert.match(route, /status: error instanceof AdminApiError/); assert.match(route, /403/); assert.match(route, /\^V\\d\{2,3\}\$/);
  assert.doesNotMatch(route, /latitude|longitude|searchParams\.get\("(lat|lng|lon)/i, 'no coordinates accepted from the URL');
  const server = read('lib/fleet-visit-map-server.ts');
  assert.match(server, /recalledProviderDay\(userId, vehicle\.id, vehicle\.vehicle_reg, day\)/); assert.doesNotMatch(server, /\.(insert|update|upsert|delete)\(|fetch\(|forthApi|history\/playback/);
  assert.match(server, /rows\.filter\(x => key\(x\.vehicle_reg\) === key\(vehicle\.vehicle_reg\)\)\.length !== 1/, 'duplicate registrations never resolve to a vehicle');
});

test('client: the map only mounts after a user action, requests ids (no coordinates in the URL) and the page URL carries none', () => {
  const comp = read('components/fleet-visit-map.tsx'), panel = read('components/fleet-evidence-panel.tsx');
  assert.match(comp, /new URLSearchParams\(\{ vehicleId, day, visit: visitId \}\)/); assert.doesNotMatch(comp, /history\.(push|replace)State|location\.(search|href)\s*=|searchParams\.set\("(lat|lng)/);
  assert.match(panel, /mapVisitId && vehicleId && journeyAccess === "granted"/); assert.match(panel, /onViewLocation: journeyAccess === "granted"/);
  assert.doesNotMatch(panel, /useEffect\(\(\) => \{ setMapVisitId\(\w+\)/, 'nothing opens the map by itself');
  assert.match(panel, /key=\{`\$\{vehicleId\}:\$\{activeDay\}`\}/, 'a different vehicle or day remounts the inspector');
});

test('movement rows offer a route only for a single Bangkok day and only prefill the supervised playback (no read on its own)', () => {
  const snap = read('components/fleet-day-snapshot.tsx'), play = read('components/forth-journey-playback-panel.tsx'), centre = read('components/forth-tracking-centre.tsx');
  assert.match(snap, /r\.kind === "moving" && r\.end && actions\?\.onViewRoute && bkkDay\(r\.start\) === bkkDay\(r\.end\)/);
  assert.match(play, /presetRange/); assert.doesNotMatch(play.slice(play.indexOf('presetNonce'), play.indexOf('presetNonce') + 600), /fetch\(|loadPlayback|void load/);
  assert.match(centre, /const openRouteMap = \(range\?: unknown\)/);
});

test('timeline: visit rows carry View location and In Journeys, selection is shared with the visit list, EN and TH labels exist', () => {
  const snap = read('components/fleet-day-snapshot.tsx'), places = read('components/fleet-day-places.tsx'), panel = read('components/fleet-evidence-panel.tsx');
  for (const s of ['View location", "ดูตำแหน่ง', 'View route", "ดูเส้นทาง', 'In Journeys", "ในเที่ยวรถ']) assert.ok(snap.includes(s), s);
  assert.match(places, /onSelectedChange/); assert.match(panel, /selectedId=\{selectedVisit\?\.id \?\? null\} onSelectedChange=\{chooseVisit\}/);
  assert.match(panel, /onOpenInJourneys: \(id: string\) => \{ chooseVisit\(id\); onNavigate\?\.\("journeys"\)/);
  for (const k of Object.keys(M.MAP_COPY)) { const [en, th] = M.MAP_COPY[k]; assert.ok(en && /[฀-๿]/.test(th), k); }
  assert.equal(M.mapText('close', 'th'), 'ปิดแผนที่');
});

test('map inspector copy: three marker kinds are labelled, saved points are never called confirmed, no geofence from the diameter field', () => {
  const comp = read('components/fleet-visit-map.tsx');
  for (const s of ['not office-verified', 'Observed position · verified GPS', 'Observed position · unverified (dashed)', 'closest candidate', 'alternative', 'Centre of the observed positions (not a company location)', 'is not proof of pickup']) assert.ok(comp.toLowerCase().includes(s.toLowerCase()), s);
  assert.doesNotMatch(comp, /confirmed (customer|delivery)|Delivered/);
  assert.doesNotMatch(comp, /L\.circle\(/, 'no radius circle is drawn from Forth diameters');
});
