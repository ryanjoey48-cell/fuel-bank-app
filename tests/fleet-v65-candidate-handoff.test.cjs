const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const dayModule = load('lib/fleet-intelligence-day.ts');
const intelligence = load('lib/fleet-intelligence.ts');
const playback = load('lib/forth-playback-access.ts');
const stopIntel = load('lib/fleet-stop-intelligence.ts');
const locEvidence = load('lib/fleet-location-evidence.ts');
const recurring = load('lib/fleet-recurring-areas.ts');
const mapLocations = load('lib/forth-gps-map-locations.ts');
const cand = load('lib/fleet-location-candidate.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const compile = (file, mocks) => {
  const module = { exports: {} };
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'crypto', out)(name => { if (!(name in mocks)) throw Error('unmocked ' + name); return mocks[name]; }, module, module.exports, globalThis.crypto);
  return module.exports;
};
const session = compile('lib/fleet-intelligence-session.ts', { 'server-only': {} });
const handoff = compile('lib/fleet-candidate-handoff.ts', { 'server-only': {}, './fleet-location-candidate': cand });
const registry = [{ id: 'v-a', vehicle_reg: 'AA-1', active: true }, { id: 'v-b', vehicle_reg: 'BB-2', active: true }];
const stopPoints = (lat, lng, day, hour, n = 8) => Array.from({ length: n }, (_, i) => ({ timestamp: `${day}T${String(hour).padStart(2, '0')}:${String(i).padStart(2, '0')}:00+07:00`, latitude: lat, longitude: lng, speedKph: 0 }));
const evidence = (id, reg, day, points) => ({ ...dayModule.buildProviderDay({ vehicleId: id, registration: reg, deviceId: 'dev-' + id, day, capturedAt: '2026-11-04T00:00:00Z', reportRows: [], logRows: [] }), observedPoints: points, reportedPoints: [], journeyLedger: { totals: { missingMinutes: 0 } } });
const seed = (user, reg, id, day, lat = 13.7, lng = 100.6) => session.rememberProviderDay(user, evidence(id, reg, day, stopPoints(lat, lng, day, 9)));

const source = { from: table => { const chain = { select: () => chain, order: () => chain, eq: () => chain, in: () => chain, limit: async () => table === 'vehicles' ? { data: registry, error: null } : { data: [], error: null } }; return chain; } };
const server = compile('lib/fleet-recurring-server.ts', { 'server-only': {}, './fleet-intelligence-session': session, './fleet-location-evidence': locEvidence, './fleet-stop-intelligence': stopIntel, './fleet-location-match': load('lib/fleet-location-match.ts'), './fleet-driver-attribution': load('lib/fleet-driver-attribution.ts'), './fleet-recurring-areas': recurring,
  './forth-locations-import-server': { loadBundledForthPinnedLocationsCsv: async () => 'csv' }, './forth-gps-map-locations': { ...mapLocations, buildForthGpsMapPayloadFromCsv: () => ({ validation: { status: 'ready' }, locations: [{ id: 'L1', name: 'Forth lot', latitude: 13.7002, longitude: 100.6002, groupLayer: 'Customer', locationType: null }] }) } });
const route = (userId, { admin = false } = {}) => compile('app/api/admin/forth-tracking/evidence/recurring/candidate/route.ts', {
  'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } }, '@/lib/admin-user-management-server': { AdminApiError: ApiError },
  '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async request => { if (request.headers.get('x-denied')) throw new ApiError(Number(request.headers.get('x-denied')), 'Denied'); return { user: { id: userId }, access: { role: admin ? 'admin' : 'office' } }; } },
  '@/lib/authorization': { hasPermission: (access, permission) => permission === 'business:read' || (permission === 'fleet:history_playback' && access.role === 'admin') },
  '@/lib/forth-playback-access': playback, '@/lib/fleet-intelligence': intelligence, '@/lib/fleet-recurring-server': server, '@/lib/fleet-location-candidate': cand, '@/lib/fleet-candidate-handoff': handoff, '@/lib/fleet-evidence-server': { createFleetSourceClient: () => source } });
const post = (r, body, headers = {}) => r.POST(new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const RANGE = { from: '2026-10-01', to: '2026-10-31' };
async function readyArea(user, admin = true) {
  seed(user, 'AA-1', 'v-a', '2026-10-05'); seed(user, 'AA-1', 'v-a', '2026-10-06'); seed(user, 'BB-2', 'v-b', '2026-10-06');
  const list = await (await compile('app/api/admin/forth-tracking/evidence/recurring/route.ts', {
    'next/server': { NextResponse: { json: (b, o) => new Response(JSON.stringify(b), o) } }, '@/lib/admin-user-management-server': { AdminApiError: ApiError },
    '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => ({ user: { id: user }, access: { role: admin ? 'admin' : 'office' } }) },
    '@/lib/authorization': { hasPermission: (a, p) => p === 'business:read' || (p === 'fleet:history_playback' && a.role === 'admin') }, '@/lib/forth-playback-access': playback, '@/lib/fleet-intelligence': intelligence, '@/lib/fleet-recurring-server': server, '@/lib/fleet-evidence-server': { createFleetSourceClient: () => source } }).GET(new Request('http://localhost/api/x?from=2026-10-01&to=2026-10-31'))).json();
  return list.analysis.areas[0];
}
const create = (r, area, extra = {}) => post(r, { action: 'create', ...RANGE, areaId: area.id, expected: { latitude: area.centroid.latitude, longitude: area.centroid.longitude }, ...extra });

test('create then open: the server builds the candidate from the user\'s own cached days and returns a summary with no positions', async () => {
  handoff.resetHandoffForTests(); const u = 'c-user-1'; const area = await readyArea(u); const r = route(u, { admin: true });
  const made = await create(r, area); assert.equal(made.status, 201); const { token, expiresAt } = await made.json();
  assert.match(token, cand.TOKEN_PATTERN); assert.ok(Date.parse(expiresAt) > Date.now());
  const opened = await post(r, { action: 'open', token }); assert.equal(opened.status, 200); const text = await opened.text(); const { candidate } = JSON.parse(text);
  assert.equal(candidate.label, 'suggested_from_vehicle_evidence'); assert.equal(candidate.evidence.distinctDays, 2); assert.deepEqual(candidate.evidence.vehicles, ['AA-1', 'BB-2']); assert.equal(candidate.evidence.visits, 3);
  assert.ok(Math.abs(candidate.area.latitude - 13.7) < 0.001 && Math.abs(candidate.area.longitude - 100.6) < 0.001, 'the coordinates are the server-computed area centre');
  assert.doesNotMatch(text, /observedPoints|reportedPoints|speedKph|dev-v-|"positions"|userId|user-id|c-user-1/);
});

test('the browser cannot choose the coordinates: a forged expected position is rejected and nothing is stored', async () => {
  handoff.resetHandoffForTests(); const u = 'c-user-2'; const area = await readyArea(u); const r = route(u, { admin: true });
  const forged = await create(r, area, { expected: { latitude: 14.5, longitude: 101.5 } }); assert.equal(forged.status, 409); assert.equal(handoff.handoffCountForTests(), 0);
  assert.equal((await create(r, area, { expected: null })).status, 409); assert.equal((await create(r, area, { expected: { latitude: 'x', longitude: 100.6 } })).status, 409); assert.equal(handoff.handoffCountForTests(), 0);
  const ok = await create(r, area, { expected: { latitude: area.centroid.latitude + 0.0002, longitude: area.centroid.longitude } }); assert.equal(ok.status, 201, 'a position within 50 m only confirms which area was meant');
  const candidate = (await (await post(r, { action: 'open', token: (await ok.json()).token })).json()).candidate; assert.ok(Math.abs(candidate.area.latitude - area.centroid.latitude) < 1e-5, 'the stored point is the server\'s, not the browser\'s');
});

test('authorisation: unauthenticated 401, ordinary office 403 on every action, and no data or token is created', async () => {
  handoff.resetHandoffForTests(); const u = 'c-user-3'; const area = await readyArea(u);
  assert.equal((await post(route(u, { admin: true }), { action: 'create', ...RANGE, areaId: area.id }, { 'x-denied': '401' })).status, 401);
  const office = route(u, { admin: false });
  for (const body of [{ action: 'create', ...RANGE, areaId: area.id, expected: { latitude: 13.7, longitude: 100.6 } }, { action: 'open', token: '11111111-1111-4111-8111-111111111111' }, { action: 'dismiss', token: '11111111-1111-4111-8111-111111111111' }]) {
    const res = await post(office, body); assert.equal(res.status, 403, body.action); assert.doesNotMatch(await res.text(), /candidate|latitude|AA-1|token"/);
  }
  assert.equal(handoff.handoffCountForTests(), 0);
});

test('isolation: another user, even an authorised one, cannot open or dismiss a token that is not theirs', async () => {
  handoff.resetHandoffForTests(); const owner = 'c-user-4'; const area = await readyArea(owner); const { token } = await (await create(route(owner, { admin: true }), area)).json();
  const other = route('c-user-5', { admin: true });
  assert.equal((await post(other, { action: 'open', token })).status, 404); assert.equal((await post(other, { action: 'dismiss', token })).status, 200);
  assert.equal((await post(route(owner, { admin: true }), { action: 'open', token })).status, 200, 'the other user\'s dismiss did not remove it');
  const noEvidence = await create(other, area); assert.equal(noEvidence.status, 410, 'the other user has not read those days, so they cannot create a candidate from them');
});

test('tampered and invalid input: bad tokens, area ids, ranges and actions are rejected before any lookup', async () => {
  handoff.resetHandoffForTests(); const u = 'c-user-6'; const area = await readyArea(u); const r = route(u, { admin: true });
  for (const token of ['', 'abc', '../../etc', 'x'.repeat(200), '11111111-1111-1111-1111-111111111111', 12345, null]) assert.equal((await post(r, { action: 'open', token })).status, 400, String(token));
  for (const areaId of ['', 'RA-1', 'ra-01', 'RA-01; drop', '../RA-01', 5, undefined]) assert.equal((await create(r, area, { areaId })).status, 400, String(areaId));
  assert.equal((await post(r, { action: 'create', from: 'x', to: 'y', areaId: area.id, expected: {} })).status, 400); assert.equal((await post(r, { action: 'create', from: '2026-01-01', to: '2026-10-31', areaId: area.id, expected: {} })).status, 400); assert.equal((await post(r, { action: 'create', from: '2026-10-01', to: '2099-01-01', areaId: area.id })).status, 400);
  assert.equal((await post(r, { action: 'save', token: '11111111-1111-4111-8111-111111111111' })).status, 400); assert.equal((await post(r, 'not json')).status, 400); assert.equal((await post(r, '[]')).status, 400);
  assert.equal((await create(r, { id: 'RA-99', centroid: { latitude: 13.7, longitude: 100.6 } })).status, 404, 'an unknown area id'); assert.equal((await post(r, { action: 'open', token: '22222222-2222-4222-8222-222222222222' })).status, 404);
});

test('expiry: an expired candidate is gone (410), and the entry is removed; the lifetime is ten minutes', async () => {
  handoff.resetHandoffForTests(); assert.equal(cand.HANDOFF_TTL_MS, 600000);
  const payload = cand.buildCandidatePayload({ area: { id: 'RA-01', centroid: { latitude: 13.7, longitude: 100.6 }, radiusM: 5, kind: 'recurring_area', placeHint: 'no_match', matches: [], visits: 2, vehicleDays: 2, distinctDays: 2, vehicles: ['AA-1'], firstSeen: '2026-10-05T09:00:00+07:00', lastSeen: '2026-10-06T09:00:00+07:00', days: ['2026-10-05', '2026-10-06'], stayMinutes: { min: 7, median: 7, longestSupported: 7 }, quality: { verified: 2, mixed: 0, unverified: 0 }, visitsNextToGap: 0, daysWithKnownMissingTracking: 0, flags: ['single_vehicle'], nearestOtherAreaM: null, visitList: [] }, from: '2026-10-01', to: '2026-10-31', vehicleDaysIncluded: 2, vehicleDaysInRange: 62, limits: [] });
  const now = Date.now(); const { token } = handoff.createHandoff('c-user-7', payload, now);
  assert.equal(handoff.readHandoff('c-user-7', token, now + 599000).status, 'ok'); assert.equal(handoff.readHandoff('c-user-7', token, now + 601000).status, 'expired'); assert.equal(handoff.readHandoff('c-user-7', token, now + 602000).status, 'not_found');
  assert.equal(handoff.handoffCountForTests(), 0);
});

test('the store is bounded per user and in total, and dismiss forgets the entry', async () => {
  handoff.resetHandoffForTests(); const base = cand.buildCandidatePayload({ area: { id: 'RA-01', centroid: { latitude: 13.7, longitude: 100.6 }, radiusM: 5, kind: 'one_off_stop', placeHint: 'no_match', matches: [], visits: 1, vehicleDays: 1, distinctDays: 1, vehicles: ['AA-1'], firstSeen: 'a', lastSeen: 'b', days: [], stayMinutes: { min: 1, median: 1, longestSupported: 1 }, quality: { verified: 1, mixed: 0, unverified: 0 }, visitsNextToGap: 0, daysWithKnownMissingTracking: 0, flags: [], nearestOtherAreaM: null, visitList: [] }, from: 'a', to: 'b', vehicleDaysIncluded: 1, vehicleDaysInRange: 1, limits: [] });
  const tokens = Array.from({ length: 15 }, () => handoff.createHandoff('c-user-8', base).token);
  assert.equal(handoff.readHandoff('c-user-8', tokens[0]).status, 'not_found', 'the oldest was dropped'); assert.equal(handoff.readHandoff('c-user-8', tokens[14]).status, 'ok'); assert.ok(handoff.handoffCountForTests() <= cand.HANDOFF_MAX_PER_USER);
  const t = tokens[14]; assert.equal(handoff.dismissHandoff('c-user-8', t), true); assert.equal(handoff.readHandoff('c-user-8', t).status, 'not_found');
  for (let i = 0; i < 260; i++) handoff.createHandoff(`bulk-${i}`, base); assert.ok(handoff.handoffCountForTests() <= cand.HANDOFF_MAX_TOTAL);
});

test('an expired evidence cache cannot create a candidate; the days must be read again', async () => {
  handoff.resetHandoffForTests(); const r = route('c-user-9', { admin: true }); const res = await post(r, { action: 'create', ...RANGE, areaId: 'RA-01', expected: { latitude: 13.7, longitude: 100.6 } });
  assert.equal(res.status, 410); assert.match((await res.json()).error, /no longer in your session/);
});

test('no database or Forth writes: the routes and libraries contain no write, no Forth call and no persistence', () => {
  const files = ['app/api/admin/forth-tracking/evidence/recurring/candidate/route.ts', 'lib/fleet-candidate-handoff.ts', 'lib/fleet-recurring-server.ts', 'lib/fleet-location-candidate.ts', 'components/location-fleet-candidate.tsx'];
  // Map.delete on the in-memory store is not a database write, so it is excluded; any table write, RPC, browser storage, Forth call or file write is not.
  for (const f of files) assert.doesNotMatch(read(f).replace(/store\.delete\(/g, 'store_remove(').replace(/searchParams\.delete\(/g, 'searchParams_remove('), /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|localStorage|sessionStorage|indexedDB|getForth\w+|forth-tracking-server|writeFile|appendFile/, f);
  assert.match(read('lib/fleet-evidence-server.ts'), /read_only_source/);
  assert.doesNotMatch(read('app/api/admin/forth-tracking/evidence/recurring/candidate/route.ts'), /export async function (GET|PUT|PATCH|DELETE)/);
});

test('no coordinates in any URL: navigation carries an opaque token only, and the receiving page removes it from the address bar', () => {
  const fleet = read('components/fleet-recurring-areas.tsx'), page = read('components/location-fleet-candidate.tsx');
  assert.match(fleet, /router\.push\(`\/locations\?candidate=\$\{encodeURIComponent\(result\.token\)\}`\)/); assert.doesNotMatch(fleet, /\/locations\?[^`]*(lat|lng|latitude|longitude)/i);
  assert.match(page, /url\.searchParams\.delete\("candidate"\)/); assert.match(page, /window\.history\.replaceState/); assert.match(page, /isHandoffToken\(token\)/);
  assert.match(page, /let capturedToken: string \| null \| undefined;/, 'the token survives a React remount but not a browser refresh'); assert.match(page, /const token = takeCandidateToken\(\);/); assert.match(page, /forgetCandidateToken\(\); setState\(\{ status: "dismissed" \}\)/);
  assert.doesNotMatch(page, /searchParams\.get\("(lat|lng|latitude|longitude)"\)/);
  assert.match(page, /"Content-Type": "application\/json"/); assert.doesNotMatch(page, /candidate\?token=|\?token=/);
});

test('human approval stays with the existing workflow: the panel never saves, verifies or calls a save route', () => {
  const page = read('components/location-fleet-candidate.tsx'), dir = read('components/locations-directory.tsx');
  // Reading a pin's status to show "verified pin" is allowed; setting one, or calling any save route, is not.
  assert.doesNotMatch(page, /map-pins|saveMapPin|onSavePin|method: "(PUT|PATCH|DELETE)"|pin_status\s*[:=]\s*"/);
  assert.equal((page.match(/fetch\(/g) ?? []).length, 2, 'only the open and dismiss calls to the candidate route'); assert.equal((page.match(/recurring\/candidate/g) ?? []).length, 2);
  assert.match(page, /data-not-saved/); assert.match(page, /t\("notSaved"\)/);
  assert.match(dir, /onSuggestedCandidate=\{\(point\) => setSuggestedCandidate\(\{ \.\.\.point, nonce: Date\.now\(\) \}\)\}/);
  assert.match(dir, /onSavePin=\{saveMapPin\}/, 'the existing save path is unchanged');
  const mapRoute = read('app/api/locations/map-pins/route.ts'); assert.match(mapRoute, /business:write/); assert.match(mapRoute, /admin:user_management/);
});

test('read-only accounts cannot prefill the editor: the editor candidate is requested only when editing is allowed', () => {
  const page = read('components/location-fleet-candidate.tsx'); assert.match(page, /if \(canEdit\) onSuggestedRef\.current/); assert.match(page, /data-read-only/);
  assert.match(read('components/locations-directory.tsx'), /canEdit=\{canEdit && canViewInternal\}/);
});

test('English and Thai: every candidate label exists in both languages and states the unsaved, not-a-customer status', () => {
  const thai = /[฀-๿]/;
  for (const k of Object.keys(cand.CANDIDATE_COPY)) { assert.ok(cand.CANDIDATE_COPY[k][0].length > 1, k); assert.match(cand.CANDIDATE_COPY[k][1], thai, k); }
  assert.equal(cand.candidateText('notSaved', 'en'), 'Suggested location — not saved or verified.'); assert.match(cand.candidateText('notCustomer', 'en'), /not a confirmed customer, loading bay, warehouse or delivery location/);
  for (const k of ['reviewLocation', 'reviewedDays', 'vehicles', 'visits', 'stay', 'gps', 'nearby', 'keepUnsaved', 'dismiss', 'copy', 'back', 'forbidden', 'expired']) assert.notEqual(cand.candidateText(k, 'en'), cand.candidateText(k, 'th'), k);
});

test('nearby comparison: nearest first within range, verified-pin flag kept, never auto-associated; empty means "unknown stopping area"', () => {
  const point = { latitude: 13.7, longitude: 100.6 }; const off = (m) => ({ latitude: 13.7 + m / 111195, longitude: 100.6 });
  const known = [{ id: 'far', name: 'Far', ...off(900), verifiedPin: true }, { id: 'b', name: 'B', ...off(300), verifiedPin: false }, { id: 'a', name: 'A', ...off(40), verifiedPin: true }, { id: 'bad', name: 'Bad', latitude: 999, longitude: 0, verifiedPin: true }];
  const near = cand.nearbyKnownLocations(point, known); assert.deepEqual(near.map(n => n.id), ['a', 'b']); assert.equal(near[0].verifiedPin, true); assert.equal(near[1].verifiedPin, false); assert.ok(near[0].distanceM >= 38 && near[0].distanceM <= 42);
  assert.deepEqual(cand.nearbyKnownLocations(point, [known[0]]), []); assert.deepEqual(cand.nearbyKnownLocations({ latitude: 999, longitude: 0 }, known), []);
  assert.match(read('components/location-fleet-candidate.tsx'), /data-unknown-area/);
});

test('map: the fleet suggestion marker is drawn differently from saved pins and Stage B stops, and clicking it brings the evidence into view', () => {
  const map = read('components/locations-map.tsx'), dir = read('components/locations-directory.tsx'), page = read('components/location-fleet-candidate.tsx');
  assert.match(map, /m\.kind === "fleet_suggestion"/); assert.match(map, /color: "#f97316"/); assert.match(map, /fillColor: "#6d28d9"/);
  assert.match(dir, /FLEET_SUGGESTION_MARKER_ID\) setFleetFocusTick/); assert.match(page, /focusTick > 0 && candidate/);
  assert.match(dir, /evidenceMarkers=\{\[\.\.\.evidenceMarkers, \.\.\.fleetMarkers\]\}/);
});

test('mobile and accessibility: touch targets are at least 44 px, the heading takes focus, and the panel has a labelled region and a polite status', () => {
  const page = read('components/location-fleet-candidate.tsx');
  const buttons = page.split('<button').slice(1); assert.ok(buttons.length >= 5);
  for (const b of buttons) assert.match(b.slice(0, 260), /min-h-11/, b.slice(0, 80));
  assert.match(page, /aria-labelledby="fleet-candidate-title"/); assert.match(page, /role="status" aria-live="polite"/); assert.match(page, /tabIndex=\{-1\}/); assert.match(page, /headingRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(page, /position:\s*(fixed|absolute)|fixed inset|z-\[/, 'an in-flow panel cannot cover the map controls');
});

test('editor integration: a suggestion handed over before the map exists wins over the editor resets, re-applies when the map is ready, and is cleared on dismiss only if unchanged', () => {
  const map = read('components/locations-map.tsx');
  const resetAt = map.indexOf('}, [selectedLocationId, pinType]);'), suggestAt = map.indexOf('}, [suggestedCandidate?.nonce, mapReady]);');
  assert.ok(resetAt > 0 && suggestAt > resetAt, 'the suggestion effect is declared after the reset effects');
  assert.match(map, /const lastSuggestionRef = useRef/); assert.match(map, /if \(!suggestedCandidate\) \{/); assert.match(map, /Math\.abs\(current\.latitude - last\.latitude\) < 1e-7/);
  assert.match(read('components/locations-directory.tsx'), /onDismissed=\{\(\) => setSuggestedCandidate\(null\)\}/); assert.match(read('components/location-fleet-candidate.tsx'), /onDismissedRef\.current\?\.\(\)/);
  assert.equal((map.match(/setSuggestedCandidate|onSavePin\(/g) ?? []).filter(x => x === 'setSuggestedCandidate').length, 0, 'the map only receives the suggestion; the directory owns it');
});
