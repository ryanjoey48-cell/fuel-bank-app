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
  m.require = r => { if (r === 'server-only') return {};
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); }
    if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); }
    return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports;
}
const M = load('lib/fleet-location-match.ts');
const D = load('lib/fleet-driver-attribution.ts');

const BASE = { latitude: 13.7, longitude: 100.6 };
const off = (north, east, p = BASE) => ({ latitude: p.latitude + north / 111_320, longitude: p.longitude + east / (111_320 * Math.cos(p.latitude * Math.PI / 180)) });
const site = (id, name, north, east, extra = {}) => ({ id, name, ...off(north, east), source: 'forth_saved_location', groupLayer: null, forthDiameterRaw: '100', ...extra });
const stop = (extra = {}) => ({ ...BASE, radiusM: 10, dwellMinutes: 90, days: 3, visits: 4, sourceQuality: 'verified_gps', shortStaysOnly: false, nextToGap: false, ...extra });
const match = (sites, s) => M.matchStop(M.prepareSites(sites), s);

test('a verified long stay inside one saved boundary is a likely match, never a verified identity', () => {
  const m = match([site('a', 'Sirtec', 10, 5)], stop());
  assert.equal(m.status, 'likely_directory_match');
  assert.equal(m.primary.name, 'Sirtec'); assert.ok(m.primary.distanceM > 0 && m.primary.distanceM <= 50);
  assert.ok(m.uncertainty.includes('saved_point_not_office_verified'), 'a Forth point is not office-verified');
  assert.equal(m.gpsQuality, 'verified_gps');
});

test('only an office-confirmed pin whose boundary contains the stop is "matched to reviewed site boundary"', () => {
  assert.equal(match([site('a', 'Depot', 5, 5, { source: 'office_confirmed_pin', boundaryVerified: true })], stop()).status, 'reviewed_site_boundary');
  assert.equal(match([site('a', 'Depot', 5, 5, { source: 'office_confirmed_pin' })], stop()).status, 'likely_directory_match', 'an office pin without a verified boundary is not a reviewed boundary');
  assert.notEqual(match([site('a', 'Depot', 5, 5)], stop()).status, 'reviewed_site_boundary');
});

test('multiple businesses within a short radius: nearest is not assumed', () => {
  const m = match([site('a', 'Alpha Co', 20, 0), site('b', 'Beta Co', 0, 30)], stop());
  assert.equal(m.status, 'multiple_nearby_locations');
  assert.ok(m.uncertainty.includes('other_site_nearby'));
  assert.equal(m.alternatives.length, 1);
  assert.equal(M.matchLabel(m, 'en', 'RA-08').title, 'Multiple nearby companies');
  assert.match(M.matchLabel(m, 'en', 'RA-08').secondary, /Alpha Co · Beta Co/);
  assert.equal(M.matchLabel(m, 'th', 'RA-08').title, 'มีหลายบริษัทอยู่ใกล้กัน');
});

test('the same company with several entrances is one place, not a competitor', () => {
  const m = match([site('a', 'Sirtec', 10, 0), site('b', 'SIRTEC ', 80, 40), site('c', 'Sirtec', -90, 20)], stop());
  assert.equal(m.status, 'likely_directory_match');
  assert.equal(m.primary.entrances, 3);
  assert.ok(m.reasons.includes('several_entrances_same_company'));
  assert.equal(m.alternatives.length, 0);
});

test('wrong or entrance-only saved coordinates: repeated stays outside the boundary stay "possible" and say why', () => {
  const m = match([site('a', 'Gate Co', 150, 0)], stop({ days: 4 }));
  assert.equal(m.status, 'possible_directory_match');
  assert.ok(m.uncertainty.includes('near_saved_point')); assert.ok(m.uncertainty.includes('repeated_offset_from_saved_point'));
  assert.equal(m.primary.proximity, 'near'); assert.ok(m.primary.distanceM >= 140);
  const far = match([site('a', 'Gate Co', 200, 0)], stop({ days: 4 }));
  assert.equal(far.primary.proximity, 'far'); assert.ok(far.uncertainty.includes('beyond_reference_distance')); assert.equal(far.status, 'possible_directory_match');
});

test('roadside stops: only short stays can never be better than possible', () => {
  const m = match([site('a', 'Roadside Shop', 5, 0)], stop({ dwellMinutes: 8, shortStaysOnly: true, days: 5 }));
  assert.equal(m.status, 'possible_directory_match'); assert.ok(m.uncertainty.includes('short_stays_possible_roadside'));
});

test('highway drive-by and a very short stationary period are not visits wherever they happen', () => {
  for (const dwell of [0, 1, 3, 4]) { const m = match([site('a', 'On The Road Co', 0, 0)], stop({ dwellMinutes: dwell })); assert.equal(m.status, 'drive_by_only'); assert.equal(m.primary, null); }
  assert.equal(M.matchLabel(match([], stop({ dwellMinutes: 2 })), 'en').title, 'Drive-by only');
});

test('unverified GPS lowers the match but is never changed by it; tracking gaps and single visits only add caveats', () => {
  const unverified = match([site('a', 'Sirtec', 5, 5)], stop({ sourceQuality: 'unverified' }));
  assert.equal(unverified.status, 'possible_directory_match'); assert.equal(unverified.gpsQuality, 'unverified'); assert.ok(unverified.uncertainty.includes('unverified_gps'));
  const gap = match([site('a', 'Sirtec', 5, 5)], stop({ nextToGap: true, visits: 1, days: 1 }));
  assert.equal(gap.status, 'likely_directory_match'); assert.ok(gap.uncertainty.includes('next_to_tracking_gap')); assert.ok(gap.uncertainty.includes('single_visit'));
  assert.equal(match([site('a', 'Sirtec', 5, 5)], stop({ sourceQuality: 'mixed' })).gpsQuality, 'mixed');
});

test('nothing within 250 m is an unknown stopping area, and the label keeps the trace id', () => {
  const m = match([site('a', 'Far Away Co', 600, 0)], stop());
  assert.equal(m.status, 'unknown_stopping_area'); assert.ok(m.uncertainty.includes('no_saved_point_nearby'));
  const label = M.matchLabel(m, 'en', 'RA-08');
  assert.equal(label.title, 'Unknown stopping area'); assert.equal(label.secondary, 'RA-08'); assert.equal(label.named, false);
  assert.equal(M.matchLabel(m, 'th', 'RA-08').title, 'ไม่ทราบพื้นที่จอด');
});

test('labels: a supported name is shown plainly, an uncertain one is marked possible, Thai names are used as stored and never invented', () => {
  const likely = match([site('a', 'Sirtec', 5, 5, { thaiName: 'เซอร์เทค' })], stop());
  assert.equal(M.matchLabel(likely, 'en', 'RA-08').title, 'Sirtec'); assert.equal(M.matchLabel(likely, 'th', 'RA-08').title, 'เซอร์เทค');
  const noThai = match([site('a', 'Sirtec', 5, 5)], stop());
  assert.equal(M.matchLabel(noThai, 'th', 'RA-08').title, 'Sirtec', 'no Thai name stored: the stored name is used, not a translation');
  const possible = match([site('a', 'Sirtec', 5, 5)], stop({ sourceQuality: 'unverified' }));
  assert.equal(M.matchLabel(possible, 'en', 'RA-08').title, 'Possible: Sirtec'); assert.equal(M.matchLabel(possible, 'th', 'RA-08').title, 'อาจเป็น: Sirtec');
});

test('every status, reason and caveat has English and Thai text', () => {
  const statuses = ['reviewed_site_boundary', 'likely_directory_match', 'possible_directory_match', 'multiple_nearby_locations', 'unknown_stopping_area', 'drive_by_only'];
  for (const s of statuses) { assert.ok(M.statusLabel(s, 'en')); assert.match(M.statusLabel(s, 'th'), /[฀-๿]/); }
  const src = read('lib/fleet-location-match.ts');
  const block = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  for (const [from, to, fn] of [['const REASONS', 'const UNCERTAIN', M.reasonLabel], ['const UNCERTAIN', 'export const reasonLabel', M.uncertaintyLabel]]) {
    for (const code of [...block(from, to).matchAll(/^  ([a-z_]+): \["/gm)].map(m => m[1])) { assert.ok(fn(code, 'en'), code); assert.match(fn(code, 'th'), /[\u0E00-\u0E7F]/, `${code} has Thai text`); }
  }
});

test('Forth diameter is a hint, never a boundary: a huge diameter does not turn a far stop into a close one, and the radius is never widened', () => {
  const m = match([site('a', 'Big Yard Co', 220, 0, { forthDiameterRaw: '1000' })], stop({ days: 5 }));
  assert.equal(m.primary.proximity, 'far'); assert.equal(m.primary.referenceRadiusM, 50); assert.equal(m.primary.forthDiameterRaw, '1000');
  assert.equal(m.status, 'possible_directory_match'); assert.ok(m.uncertainty.includes('boundary_not_verified'));
  assert.equal(match([site('a', 'Edge Co', 260, 0)], stop()).status, 'unknown_stopping_area', 'nothing beyond 250 m is considered');
  assert.equal(M.REFERENCE_RADIUS_M, 50); assert.equal(M.SEARCH_RADIUS_M, 250);
});

test('invalid saved points are counted but never used, and the match is deterministic', () => {
  const p = M.prepareSites([site('a', 'Good Co', 5, 5), { id: 'bad', name: 'Bad Co', latitude: 999, longitude: 0, source: 'forth_saved_location' }, { id: 'noname', name: '  ', ...off(1, 1), source: 'forth_saved_location' }]);
  assert.equal(p.count, 3); assert.equal(p.usable, 1);
  assert.deepEqual(M.matchStop(p, stop()), M.matchStop(p, stop()));
});

test('the real Forth saved-location source: all 466 readable, matching 2,000 stops is fast, and duplicate names stay one company', () => {
  const lib = load('lib/forth-gps-map-locations.ts');
  const payload = lib.buildForthGpsMapPayloadFromCsv(fs.readFileSync(path.join(root, 'data/forth-locations/Locations Forth Pinned.csv'), 'utf8'));
  assert.equal(payload.locations.length, 466);
  const points = payload.locations.map(l => ({ id: l.id, name: l.name, thaiName: l.thaiName, latitude: l.latitude, longitude: l.longitude, source: 'forth_saved_location', groupLayer: l.groupLayer, forthDiameterRaw: l.diameterRaw }));
  const prepared = M.prepareSites(points); assert.equal(prepared.usable, 466);
  const started = Date.now();
  let named = 0;
  for (let i = 0; i < 2000; i++) { const p = points[i % points.length]; const r = M.matchStop(prepared, { ...off(3, 3, p), radiusM: 8, dwellMinutes: 40, days: 2, visits: 2, sourceQuality: 'verified_gps' }); if (r.primary) named++; }
  assert.ok(Date.now() - started < 1500, 'bounded work for 2,000 stops');
  assert.ok(named > 1900, 'a stop placed on each saved point finds a candidate');
  // A stop placed exactly on a saved point is never reported as unknown or drive-by.
  const first = points[0]; assert.ok(M.matchStop(prepared, { ...off(0, 0, first), dwellMinutes: 30, days: 1, visits: 1, sourceQuality: 'verified_gps' }).primary);
});

test('driver attribution: nothing dated means "Driver not confirmed", and unreliable sources are ignored, never used', () => {
  const none = D.resolveDriverForDay('2026-10-05', []);
  assert.equal(none.status, 'not_confirmed');
  const ignored = D.resolveDriverForDay('2026-10-05', [
    { source: 'current_assignment', driverId: 'd1', driverName: 'Current', day: '2026-10-05' },
    { source: 'booking_diary', driverId: 'd2', driverName: 'Booked', day: '2026-10-05' },
    { source: 'weekly_mileage', driverId: 'd3', driverName: 'Weekly', day: '2026-10-05' }]);
  assert.equal(ignored.status, 'not_confirmed'); assert.deepEqual(ignored.ignored.sort(), ['booking_diary', 'current_assignment', 'weekly_mileage']);
  assert.match(D.driverLabel(none, 'en', true).title, /Driver not confirmed/); assert.match(D.driverLabel(none, 'th', true).title, /ยังไม่ยืนยันคนขับ/);
});

test('driver attribution: a same-day fuel record is supporting evidence only; two drivers need review; only dated history confirms', () => {
  const one = D.resolveDriverForDay('2026-10-05', [{ source: 'fuel_log', driverId: 'd1', driverName: 'Somchai', day: '2026-10-05' }]);
  assert.equal(one.status, 'supporting_evidence_only'); assert.notEqual(one.status, 'confirmed');
  assert.match(D.driverLabel(one, 'en', true).note, /not who drove/);
  assert.doesNotMatch(D.driverLabel(one, 'en', false).title, /Somchai/, 'names are hidden from roles that may not see them');
  const two = D.resolveDriverForDay('2026-10-05', [{ source: 'fuel_log', driverId: 'd1', day: '2026-10-05' }, { source: 'fuel_log', driverId: 'd2', day: '2026-10-05' }]);
  assert.equal(two.status, 'needs_review'); assert.match(D.driverLabel(two, 'en', true).title, /needs review/);
  assert.equal(D.resolveDriverForDay('2026-10-05', [{ source: 'assignment_history', driverId: 'd1', day: '2026-10-05' }]).status, 'confirmed');
  assert.equal(D.resolveDriverForDay('2026-10-05', [{ source: 'assignment_history', driverId: 'd1', day: '2026-10-05' }, { source: 'assignment_history', driverId: 'd2', day: '2026-10-05' }]).status, 'needs_review', 'conflicting assignments');
});

test('different drivers across days stay separate: evidence dated to another day is not used', () => {
  const ev = [{ source: 'fuel_log', driverId: 'd1', driverName: 'A', day: '2026-10-05' }, { source: 'fuel_log', driverId: 'd2', driverName: 'B', day: '2026-10-26' }];
  assert.equal(D.resolveDriverForDay('2026-10-05', ev).drivers[0].id, 'd1');
  assert.equal(D.resolveDriverForDay('2026-10-26', ev).drivers[0].id, 'd2');
  assert.equal(D.resolveDriverForDay('2026-10-27', ev).status, 'not_confirmed');
});

test('security: the named-stops route needs historical-journey authorisation, uses only the caller\'s own cache, returns no coordinates and has no Booking Diary dependency', () => {
  const route = read('app/api/admin/forth-tracking/evidence/day-places/route.ts'), server = read('lib/fleet-day-places-server.ts');
  assert.match(route, /requireFleetOfficeAccess/); assert.match(route, /canViewJourneyDetail/); assert.match(route, /status: error instanceof AdminApiError \? error\.status : 503/);
  assert.match(server, /recalledProviderDay\(userId, vehicle\.id, vehicle\.vehicle_reg, day\)/, 'user-scoped cache');
  assert.doesNotMatch(server, /callForth|fetchForth|forth-history|booking/i);
  const type = server.slice(server.indexOf('export type DayPlace ='), server.indexOf('export type DayPlaces'));
  assert.doesNotMatch(type, /latitude|longitude|centroid|coordinates/i, 'no coordinates in the response shape');
  assert.match(server, /canSeeDriverNames/); assert.match(read('lib/fleet-recurring-server.ts'), /\.eq\("pin_status", "manual_confirmed"\)/, 'only manually confirmed pins count as office-confirmed');
  for (const f of ['lib/fleet-location-match.ts', 'lib/fleet-driver-attribution.ts']) assert.doesNotMatch(read(f), /\.from\("|fetch\(|supabase/i, `${f} reads nothing itself`);
  assert.doesNotMatch(read('lib/fleet-location-match.ts'), /booking/i);
  assert.match(read('lib/fleet-driver-attribution.ts'), /e\.source === "booking_diary" \|\| e\.source === "current_assignment"/, 'booking and current-assignment evidence is explicitly ignored');
});
