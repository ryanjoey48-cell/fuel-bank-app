// V7.8.3 second pass: request-origin diagnostics now cover all three server routes that can contact Forth history (provider day,
// journey playback, journey report), every exit is logged (including refusals before any Forth call), and Reports links notices that
// come from the same vehicle-day evidence. Fixtures only: no network, no Forth, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const mocks = { 'next/server': { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } },
  '@/lib/admin-user-management-server': { AdminApiError, requireVerifiedUser: async () => { throw new AdminApiError(401, 'Authentication required.'); }, createServerSupabaseAdmin: () => ({}), resolveAccountAccess: async () => null } };
const shared = new Map();
function load(rel) {
  const file = path.resolve(root, rel); if (shared.has(file)) return shared.get(file).exports;
  const m = new Module(file, module); shared.set(file, m); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m.require = r => {
    if (Object.hasOwn(mocks, r)) return mocks[r]; if (r === 'server-only') return {};
    for (const [prefix, base] of [['@/', root], ['.', path.dirname(file)]]) if (r.startsWith(prefix)) { const t = prefix === '@/' ? path.join(base, r.slice(2)) : path.resolve(base, r); const hit = [t, `${t}.ts`, `${t}.tsx`].find(n => fs.existsSync(n) && fs.statSync(n).isFile()); if (hit) return load(hit); }
    return require(r);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports;
}
const L = load('lib/fleet-provider-request-log.ts');
const auth = load('lib/authorization.ts');
const audit = load('lib/forth-history-audit.ts');
const O = load('lib/fleet-fuel-oversight.ts');
const { createJourneyPlaybackPostHandler } = load('lib/forth-history-playback-route.ts');
const { createJourneyHistoryPostHandler } = load('lib/forth-history-route.ts');

const ADMIN = { id: 'u-admin', role: 'admin' }, OFFICE = { id: 'u-office', role: 'office_staff' };
const accessOf = u => ({ userId: u.id, role: u.role, status: 'active' });
const fleetRecord = { gpsDeviceId: '519698', vehicleRegistration: 'ฒอ-8453' };
const logRow = i => ({ gpsID: '519698', plateNumber: 'ฒอ-8453', dateTime: `02-11-2026 06:0${i}:00`, GPS: 'ON', GPRS: 'ON', Engine: 'ON', Speed: 30, Latitude: 13.76 + i * 0.001, Longitude: 100.76, COG: 0, positionSource: 'GPS', Distance: i ? 110 : 0 });
function deps({ user = ADMIN, enabled = true, events, calls }) {
  return { enabled, allowedUserIds: [], audit: i => audit.buildHistoryAuditEvent(i), logRequest: e => { const ev = L.logProviderRequest({ ...e, log: () => undefined }); events.push(ev); return ev; },
    requireUser: async () => ({ id: user.id }), createAdmin: () => ({}), resolveAccess: async () => accessOf(user), checkPermission: auth.hasPermission,
    getFleet: async () => ({ connectionStatus: 'connected', error: null, records: [fleetRecord] }),
    getLog: async () => { calls.forth++; return { ok: true, status: 200, payload: [0, 1, 2].map(logRow) }; },
    getTrips: async () => { calls.forth++; return { ok: true, status: 200, payload: [] }; },
    rateLimitKey: (u, d) => `t:${u}:${d}:${Math.random()}`, beginRateLimit: () => ({ allowed: true, remaining: 5, retryAfterSeconds: null }), releaseRateLimit: () => undefined, sourceTimeZone: 'Asia/Bangkok' };
}
const playbackReq = (headers = {}) => new Request('https://ees.test/api/admin/forth-tracking/history/playback', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ deviceId: '519698', date: '2026-11-02', startTime: '00:00', endTime: '23:59', language: 'en' }) });
const journeyReq = (headers = {}) => new Request('https://ees.test/api/admin/forth-tracking/history/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ deviceId: '519698', date: '2026-11-02', language: 'en' }) });

test('outcome mapping: cancelled, rate limited, refused before any Forth call, and failed after Forth was contacted are distinct', () => {
  assert.equal(L.failureOutcome({ cancelled: true, forthRequests: 1, status: 499 }), 'cancelled');
  assert.equal(L.failureOutcome({ cancelled: false, forthRequests: 0, status: 429 }), 'rate_limited');
  for (const status of [400, 401, 403, 404, 409, 415, 503]) assert.equal(L.failureOutcome({ cancelled: false, forthRequests: 0, status }), 'refused_before_provider', String(status));
  assert.equal(L.failureOutcome({ cancelled: false, forthRequests: 2, status: 502 }), 'failed');
  L.resetProviderRequestLogForTests();
  const e = L.logProviderRequest({ id: 'abcdef12-0001', actor: 'not-a-hash', origin: 'unlabelled', vehicleRef: '', day: '', refresh: false, outcome: 'refused_before_provider', status: 401, forthRequests: 0, durationMs: 1, waitedForInFlight: false, log: () => undefined });
  assert.equal(e.actor, L.UNVERIFIED_ACTOR, 'anything that is not a hashed actor reference is stored as "unverified"'); assert.equal(e.route, 'provider_day'); assert.equal(e.day, 'invalid');
  assert.deepEqual(L.summariseByOrigin([e]).unlabelled, { requests: 1, providerReads: 0, cacheHits: 0, refused: 1, forthRequests: 0 });
});

test('journey playback: an explicit Load is logged with its origin, the route, one Forth call, and no device id, coordinates or token', async () => {
  const events = [], calls = { forth: 0 };
  const res = await createJourneyPlaybackPostHandler(deps({ events, calls }))(playbackReq({ 'X-EES-Request-Origin': 'journey_playback_load', 'X-EES-Request-Id': 'abcdef12-aaaa-bbbb', Authorization: 'Bearer secret-token' }));
  assert.equal(res.status, 200); assert.equal(calls.forth, 1); assert.equal(events.length, 1);
  const [e] = events;
  assert.deepEqual([e.route, e.origin, e.initiation, e.outcome, e.forthRequests, e.day, e.id], ['journey_playback', 'journey_playback_load', 'explicit_user_action', 'provider_read', 1, '2026-11-02', 'abcdef12-aaaa-bbbb']);
  assert.match(e.vehicleRef, /^device-[0-9a-f]{12}$/); assert.match(e.actor, /^[0-9a-f]{12}$/);
  const text = JSON.stringify(e); assert.doesNotMatch(text, /519698|ฒอ|secret-token|Bearer|13\.76|100\.76|u-admin/);
});

test('journey playback: refusals are logged as refused_before_provider with zero Forth calls (permission, approval gate)', async () => {
  for (const [label, d] of [['office staff without playback permission', { user: OFFICE }], ['history gate closed', { enabled: false }]]) {
    const events = [], calls = { forth: 0 };
    const res = await createJourneyPlaybackPostHandler(deps({ events, calls, ...d }))(playbackReq({ 'X-EES-Request-Origin': 'journey_playback_load' }));
    assert.ok(res.status === 403 || res.status === 503, label); assert.equal(calls.forth, 0, label);
    assert.equal(events.length, 1, label); assert.equal(events[0].outcome, 'refused_before_provider', label); assert.equal(events[0].forthRequests, 0, label);
  }
});

test('journey report: origin recorded, an unlabelled caller is visible as unlabelled, and the access audit event keeps its exact fields', async () => {
  const events = [], calls = { forth: 0 }, audits = [];
  const d = deps({ events, calls }); d.audit = i => { const a = audit.buildHistoryAuditEvent(i); audits.push(a); return a; };
  const handler = createJourneyHistoryPostHandler(d);
  assert.equal((await handler(journeyReq({ 'X-EES-Request-Origin': 'live_journey_history_form' }))).status, 200);
  assert.equal((await handler(journeyReq())).status, 200);
  assert.deepEqual(events.map(e => [e.route, e.origin, e.outcome, e.forthRequests, e.day]), [['journey_report', 'live_journey_history_form', 'provider_read', 1, '2026-11-02'], ['journey_report', 'unlabelled', 'provider_read', 1, '2026-11-02']]);
  assert.equal(events[1].initiation, 'unlabelled');
  assert.deepEqual(Object.keys(audits[0]).sort(), ['accessBasis', 'action', 'at', 'atBangkok', 'correlationId', 'date', 'deviceId', 'httpStatus', 'observationCount', 'outcome', 'reason', 'role', 'userId', 'window'].sort(), 'the existing audit contract is unchanged');
});

test('a broken request logger never breaks a history request', async () => {
  const calls = { forth: 0 }; const d = deps({ events: [], calls }); d.logRequest = () => { throw new Error('log sink down'); };
  assert.equal((await createJourneyPlaybackPostHandler(d)(playbackReq())).status, 200);
});

test('provider-day route: the origin is parsed before sign-in, every exit (including early refusals) is logged once, and failures use the shared mapping', () => {
  const route = read('app/api/admin/forth-tracking/evidence/provider/route.ts');
  assert.ok(route.indexOf('parseOrigin(request.headers.get(ORIGIN_HEADER))') < route.indexOf('requireFleetOfficeAccess(request)'), 'origin parsed before sign-in');
  assert.ok(route.indexOf('const note = ') < route.indexOf('requireFleetOfficeAccess(request)'), 'the log hook exists before anything can throw');
  assert.match(route, /if \(logged\.done\) return; logged\.done = true;/);
  assert.match(route, /note\(failureOutcome\(\{ cancelled, forthRequests, status: failStatus \}\), failStatus\)/);
  assert.doesNotMatch(route, /note\?\.\(/);
});

test('all Forth history entry points are labelled: the two history callers send their own origin, and no other component calls those routes', () => {
  assert.match(read('components/forth-journey-playback-panel.tsx'), /originHeaders\("journey_playback_load"\)/);
  assert.match(read('components/fleet-tracking-v2/journey-history.tsx'), /originHeaders\("live_journey_history_form"\)/);
  const client = read('lib/fleet-request-origin.ts'); for (const o of L.REQUEST_ORIGINS) assert.ok(client.includes(`"${o}"`), o);
  const hits = [];
  const walk = dir => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name) && p !== 'app/api') walk(p); } else if (/\.tsx?$/.test(e.name) && /history\/(playback|journeys)/.test(fs.readFileSync(path.join(root, p), 'utf8'))) hits.push(p); } };
  walk('components'); walk('app');
  assert.deepEqual(hits.sort(), ['components/fleet-tracking-v2/journey-history.tsx', 'components/forth-journey-playback-panel.tsx']);
  // Neither caller reads from an effect: the playback load is a button handler and the journey report is a form submit.
  const pb = read('components/forth-journey-playback-panel.tsx');
  assert.match(pb, /onClick=\{\(\) => void loadHistory\(\)\}/);
  for (const m of pb.matchAll(/useEffect\(\(\) => \{[\s\S]{0,500}?\}, \[/g)) assert.doesNotMatch(m[0], /loadHistory\(|history\/playback/);
  assert.match(read('components/fleet-tracking-v2/journey-history.tsx'), /onSubmit=\{loadHistory\}/);
});

test('keyboard: closing the Reports investigation panel returns focus to the control that opened it (setTimeout, not rAF, so it works in a background window)', () => {
  const src = read('components/fleet-vehicle-investigation.tsx');
  assert.match(src, /const opener = useRef<HTMLElement \| null>\(/);
  assert.match(src, /document\.activeElement !== document\.body/);
  assert.match(src, /onClose\(\); if \(el\) setTimeout\(\(\) => \{ if \(el\.isConnected\) el\.focus\(\); \}, 0\)/);
  assert.match(src, /onClick=\{close\}>\{t\("Close", "ปิด"\)\}/);
  assert.doesNotMatch(src, /onClick=\{onClose\}>\{t\("Close"/);
});

test('odometer interval: a Forth day ending with an open trip is flagged, GPS for the same days is shown for context, and the Forth range itself is unchanged', () => {
  const C = load('lib/fleet-fuel-comparability.ts');
  // Figures observed for 3ฒน-9565, 1–2 Nov 2026 (Forth 119.58 + 664.02; GPS 120.50 + 966.99; odometer 374,586 → 375,452).
  const forth = [{ day: '2026-11-01', providerKm: 119.58, reconciled: true, openAtDayEnd: true, gpsKm: 120.5 }, { day: '2026-11-02', providerKm: 664.02, reconciled: true, openAtDayEnd: true, gpsKm: 966.99 }];
  const c = C.compareIntervalToForth({ fromDate: '2026-11-01', toDate: '2026-11-02', km: 866, withheld: null }, forth);
  assert.deepEqual([c.status, c.lowerKm, c.upperKm, c.gapKm], ['outside_range', 0, 783.6, 82.4], 'the provider range and gap are exactly as before');
  assert.deepEqual(c.openEndDays, ['2026-11-01', '2026-11-02']);
  assert.deepEqual([c.gpsLowerKm, c.gpsUpperKm], [0, 1087.49]);
  // Missing GPS on any needed day: unknown, never zero. No open trip: nothing flagged.
  const noGps = C.compareIntervalToForth({ fromDate: '2026-11-01', toDate: '2026-11-02', km: 866, withheld: null }, [{ ...forth[0], gpsKm: null, openAtDayEnd: false }, { ...forth[1], openAtDayEnd: false }]);
  assert.equal(noGps.gpsUpperKm, null); assert.deepEqual(noGps.openEndDays, []); assert.equal(noGps.upperKm, 783.6);
  const ui = read('components/fleet-fuel-panel.tsx');
  assert.match(ui, /data-odometer-open-end/); assert.match(ui, /เที่ยววิ่งข้ามเที่ยงคืน/); assert.match(ui, /it does not replace the Forth range/);
  assert.doesNotMatch(ui.slice(ui.indexOf('data-odometer-open-end'), ui.indexOf('data-odometer-open-end') + 900), /tamper|fraud|misuse|theft/i);
  // Phones and tablets (≤860 px): the explanation cell spans the whole card and its toggle is a 44 px touch target.
  const css = read('components/fleet-tracking-v73.css'); const phone = css.slice(css.lastIndexOf('@media (max-width: 860px)'));
  assert.match(phone, /table\.v782-cards td:has\(> details\.v783-odo\) \{ grid-column: 1 \/ -1; \}/); assert.match(phone, /\.v783-odo summary \{ min-height: 44px; \}/);
  assert.match(read('components/fleet-evidence-panel.tsx'), /openAtDayEnd: \(d\.provider!\.provider\.segments \?\? \[\]\)\.at\(-1\)\?\.end === null, gpsKm: d\.provider!\.sources\.gpsDerived\.value/);
});

test('Reports queue links notices from the same vehicle-day instead of treating them as separate problems; nothing is merged or re-graded', () => {
  const cov = (id, reg, over = {}) => ({ vehicleId: id, registration: reg, vehicleType: null, registryStatus: 'active', reviewedDays: 3, verifiedDays: 3, partlyVerifiedDays: 0, unverifiedDays: 0, noPositionDays: 0, providerKm: 120, providerKmDays: 3, gpsKm: 118, gpsKmDays: 3, reviewedDayList: ['2026-11-01', '2026-11-02', '2026-11-03'], unverifiedDayList: [], partlyVerifiedDayList: [], gapDays: [], disagreeDays: [], ...over });
  const rows = O.buildOversightRows({ fuel: { status: 'not_loaded', vehicles: [] }, calendarDays: 7, coverage: [cov('a', '3ฒน-9565', { disagreeDays: [{ day: '2026-11-02', providerKm: 664.02, gpsKm: 966.99 }], gapDays: [{ day: '2026-11-02', minutes: 191 }, { day: '2026-11-03', minutes: 75 }], partlyVerifiedDayList: ['2026-11-01'] })] });
  const groups = O.groupOversightIssues(rows);
  const dis = groups.find(g => g.key === 'distance_sources_disagree').vehicles[0], gap = groups.find(g => g.key === 'tracking_gap_material').vehicles[0];
  assert.deepEqual(dis.related, [{ key: 'tracking_gap_material', days: ['2026-11-02'] }], 'only the shared date is linked');
  assert.deepEqual(gap.related, [{ key: 'distance_sources_disagree', days: ['2026-11-02'] }]);
  assert.equal(groups.find(g => g.key === 'positions_partly_verified').vehicles[0].related.length, 0, 'a notice on a different day is not linked');
  assert.equal(dis.severity, 'medium'); assert.ok(groups.every(g => g.severity !== 'high'));
  const ui = read('components/fleet-fuel-report.tsx');
  assert.match(ui, /data-related-issues/); assert.match(ui, /Same day also flagged/); assert.match(ui, /วันเดียวกันมีรายการอื่นด้วย/);
});
