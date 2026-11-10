const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

// Small .ts/.tsx loader so components can be server-rendered without a bundler.
function load(rel, cache = new Map()) {
  const file = path.resolve(root, rel); if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module); cache.set(file, m); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const resolve = base => ['.ts', '.tsx'].map(e => base + e).find(f => fs.existsSync(path.join(root, f)));
  m.require = r => { if (r === 'server-only') return {}; if (r === 'next/link') return { __esModule: true, default: ({ href, children }) => require('react').createElement('a', { href }, children) };
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); }
    if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); }
    return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const React = require('react'); const { renderToString } = require('react-dom/server');
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const panelSrc = fs.readFileSync(path.join(root, 'components/fleet-evidence-panel.tsx'), 'utf8');
const centreSrc = fs.readFileSync(path.join(root, 'components/forth-tracking-centre.tsx'), 'utf8').replace(/\r\n/g, '\n');
const view = name => { const m = panelSrc.split(`data-view="${name}"`)[1]; return m.slice(0, m.indexOf('data-view=') > 0 ? m.indexOf('data-view=') : undefined); };

test('each tab shows its own content: components appear in exactly one view', () => {
  const views = ['today', 'journeys', 'jobs', 'fuel', 'health'];
  // V7.1: the Forth day read is one shared slot (Daily Activity and Journeys), asserted separately below.
  const owners = { FleetVehicleDaySummary: 'today', FleetJourneyList: 'journeys', FleetJobReviewPanel: 'jobs', FleetJourneyAllocation: 'jobs', FleetFuelPanel: 'fuel' };
  for (const [component, owner] of Object.entries(owners)) {
    const where = views.filter(v => view(v).includes(`<${component}`));
    assert.deepEqual(where, [owner], `${component} must only render in the ${owner} view`);
  }
  // V7.2: one read control ("bar", shared by Daily Activity and Journeys) plus two read-only evidence views ("details") that never fetch.
  assert.equal(panelSrc.split('variant={isDaily || isJJ ? "bar" : "full"}').length - 1, 1, 'one shared Forth day-read control, so a read is never split between workspaces');
  assert.equal(panelSrc.split('variant="details"').length - 1, 2);
  assert.match(panelSrc, /showJourneys \|\| isDaily \? <FleetProviderDayPanel/);
  assert.match(view('health'), /\{gpsHealth\}/); assert.match(view('health'), /FORTH_QUESTIONS/);
  assert.doesNotMatch(view('fuel'), /FleetJourney|FleetJobReview|FleetProviderDay|Booking Diary suggestion/, 'Fuel no longer carries day intelligence, journeys, jobs or report reads');
  assert.doesNotMatch(view('today'), /FleetJourneyList|Read Forth report/, 'Today lists no journey cards and has no report-read button');
});

test('the workspace is mounted once per vehicle and keeps its state across tabs; the Journeys tab no longer jumps into playback', () => {
  assert.equal((centreSrc.match(/<FleetEvidencePanel/g) ?? []).length, 1, 'one workspace, not one per tab');
  assert.match(centreSrc, /<FleetEvidencePanel key=\{`\$\{activeEesVehicle\.id\}:/, 'keyed by the vehicle first; V6.1 appends the reviewed day only for a drill-down on that same registration');
  assert.doesNotMatch(centreSrc, /<FleetEvidencePanel[^>]*key=\{`?\$?\{?selectedKey\}?:\$\{detailSection\}/, 'switching tabs must not remount it');
  assert.doesNotMatch(centreSrc, /setDetailSection\(id\); if \(id === "journeys"\) enterPlayback\(\)/);
  assert.match(centreSrc, /onOpenPlayback=\{openRouteMap\}/);
  for (const [v, flag] of [['today', '!showToday'], ['journeys', '!showJourneys'], ['jobs', '!showJobs'], ['fuel', 'section !== "fuel"'], ['health', 'section !== "health"']]) assert.ok(panelSrc.includes(`data-view="${v}"`) && panelSrc.includes(`hidden={${flag}}`), `${v} is hidden, not unmounted`);
  // Earlier evidence is kept while refreshing; only a scope change clears it.
  const loadFn = panelSrc.slice(panelSrc.indexOf('async function load()'), panelSrc.indexOf('/** Operator-requested'));
  assert.doesNotMatch(loadFn, /setData\(null\)/);
  assert.match(panelSrc, /function invalidate\(\) \{[^}]*setData\(null\)/);
  assert.match(panelSrc, /function setScope\([^)]*\) \{ invalidate\(\)/);
});

test('Overview is light: status and links only; technical GPS detail moved to GPS Health', () => {
  const body = centreSrc.slice(centreSrc.indexOf('className="forth-vehicle-card-body"'), centreSrc.indexOf('className="forth-inspector-more-actions"'));
  assert.doesNotMatch(body, /hidden=\{detailSection/, 'V7.1: the live drawer shows a compact summary, always');
  assert.doesNotMatch(body, /forth-inspector-technical|copy\.technicalDetails/);
  // V7.1: the narrow six-tab drawer is gone. Overview is the compact live summary; Today, Journeys, Jobs and Fuel are full-width workspaces and GPS Health opens from the drawer.
  assert.doesNotMatch(body, /forth-overview-links/);
  assert.doesNotMatch(centreSrc, /role="tablist"/);
  const actions = centreSrc.slice(centreSrc.indexOf('className="v71-drawer-actions"'), centreSrc.indexOf('className="v71-drawer-health"'));
  for (const needle of ['goWorkspace("daily")', 'goWorkspace("journeys")', 'goWorkspace("fuel")', 'detailSection === "health"']) assert.ok(actions.includes(needle), needle);
  const hStart = centreSrc.indexOf('const gpsHealthNode = '); const health = centreSrc.slice(hStart, centreSrc.indexOf(') : null;', hStart));
  for (const needle of ['gpsDeviceId', 'gpsConnectivity', 'gprsConnectivity', 'positionSource', 'selectedGpsHealth', 'sourceTimestampRaw', 'noGpsSourceNote', 'approximateCoordinatesNote']) assert.match(health, new RegExp(needle), `GPS Health shows ${needle}`);
  assert.match(health, /Tracker connection \(GPRS\)/); assert.match(health, /Coordinate source classification/);
});

const SEG = (id, s, e, km) => ({ id, start: `2026-11-03T${s}+07:00`, end: e ? `2026-11-03T${e}+07:00` : null, km });
const PT = (hms, metres) => ({ timestampIso: new Date(`2026-11-03T${hms}+07:00`).toISOString(), verifiedGps: false, trailEligible: true, positionQuality: 'no_gps', speedKph: metres ? 40 : 0, engineOn: true, sourceDistanceRaw: metres });
function fixture() {
  const jl = load('lib/fleet-journey-ledger.ts'), sum = load('lib/fleet-vehicle-day-summary.ts');
  const points = [PT('08:00:10', 0), PT('08:05:11', 4000), PT('08:30:00', 6000), PT('09:00:00', 0), PT('09:20:00', 0), PT('11:00:00', 0)];
  const ledger = jl.buildJourneyLedger({ day: '2026-11-03', segments: [SEG('a', '08:00:00', '09:00:00', 10), SEG('b', '09:30:00', '09:30:00', 0), SEG('c', '10:00:00', '10:40:00', 2.5), SEG('d', '23:55:00', null, 0)], points, gpsIntervals: [], logAvailable: true });
  const provider = { journeyLedger: ledger, provider: { arithmetic: { status: 'pass' }, segments: [] }, sources: { providerReported: { value: 12.5, completeness: 'unknown' }, gpsDerived: { value: null } } };
  const analysis = sum.analyseDay({ day: '2026-11-03', journeyLedger: ledger, providerReconciled: true, providerComplete: false, providerKm: 12.5, jobs: [{ jobId: '1', workOrder: 'WO-1', pickupTime: '08:10', bookingAssignment: 'stable_vehicle_id' }] });
  return { ledger, provider, analysis };
}

test('Journeys: compact keyboard-accessible rows with expandable details, English and Thai', () => {
  const { provider, analysis } = fixture(); const { FleetJourneyList } = load('components/fleet-journey-ledger-panel.tsx');
  for (const language of ['en', 'th']) {
    const html = renderToString(React.createElement(FleetJourneyList, { provider, analysis, language, day: '2026-11-03' }));
    // V7.3: segments with no log records or zero duration are grouped under Technical segments (kept, not hidden); every segment is still listed once.
    const shown = (html.match(/<li class="fleet-journey-row/g) ?? []).length;
    const technicalRows = (html.split('data-technical-segments')[1] ?? '').split('</details>')[0].match(/<tr><th scope="row">/g)?.length ?? 0;
    assert.ok(technicalRows >= 1, 'zero-duration and no-log segments are grouped, not dropped');
    assert.equal(shown + technicalRows, 4, 'one entry per segment: compact row or technical row');
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, shown, 'every compact row is a button that starts collapsed');
    assert.match(html, /aria-controls=/); assert.match(html, /hidden="" class="fleet-journey-row-detail"/);
    assert.match(html, /is-moving/); assert.match(text(html.split('data-technical-segments')[1] ?? ''), language === 'th' ? /ระยะเวลาเป็นศูนย์|ไม่มีบันทึก/ : /zero duration|no log records/, 'the zero-duration stop is kept in the technical group');
    assert.ok(/is-open/.test(html) || /→\s*(open|ยังไม่ปิด)/.test(text(html.split('data-technical-segments')[1] ?? '')), 'the open final segment is shown either as a row or in the technical group');
    const t = text(html);
    // Three distances kept apart, and real missing history is separate from normal recording spacing.
    for (const needle of language === 'th' ? ['ประวัติที่ขาดจริง', 'ระยะห่างการบันทึกตามปกติ', 'นอกช่วงที่รายงาน', 'ตัวกรองเที่ยว'] : ['Provider-reported km', 'Reported trail km', 'GPS-verified km', 'Actual missing history', 'Normal recording spacing', 'Outside report segments', 'Journey filters']) assert.ok(t.includes(needle) || html.includes(needle), `${language}: ${needle}`);
    if (language === 'th') assert.doesNotMatch(html, /Actual missing history|Normal recording spacing|Journey filters/);
  }
  const en = text(renderToString(React.createElement(FleetJourneyList, { provider, analysis, language: 'en', day: '2026-11-03' })));
  assert.match(en, /Reported positions, No GPS/); assert.doesNotMatch(en, /GPS-verified positions/, 'No GPS is never presented as verified');
  assert.match(en, /4 report segments: \d+ shown here, \d+ technical/);
});

test('Jobs: allocation view keeps all five categories and the reconciliation status; unread day stays unknown', () => {
  const { provider, analysis } = fixture(); const { FleetJourneyAllocation } = load('components/fleet-journey-ledger-panel.tsx'); const sum = load('lib/fleet-vehicle-day-summary.ts');
  const en = text(renderToString(React.createElement(FleetJourneyAllocation, { provider, analysis, language: 'en', day: '2026-11-03' })));
  for (const needle of ['1 · Confirmed job km', '2 · Supported repositioning', '3 · Candidate km', '4 · Unallocated', '5 · Missing', 'no approved confirmation record exists', 'Allocation check']) assert.ok(en.includes(needle), needle);
  const none = text(renderToString(React.createElement(FleetJourneyAllocation, { provider: null, analysis: sum.analyseDay({ day: '2026-11-03', journeyLedger: null, providerReconciled: false, providerComplete: false, providerKm: null, jobs: null }), language: 'en', day: '2026-11-03' })));
  assert.match(none, /Kilometres are unknown/); assert.doesNotMatch(none, /0\.00/);
});

test('review panel stays temporary and does not claim persistence', () => {
  const { provider, analysis, ledger } = fixture(); const { FleetJobReviewPanel } = load('components/fleet-job-review-panel.tsx');
  const job = { jobId: '1', workOrder: 'WO-1', bookingRef: 'BK-1', pickupName: 'Depot', deliveryName: 'Customer', driverId: null, driverText: 'Somchai', pickupTime: '08:10', bookingAssignment: 'stable_vehicle_id', score: 60, scheduledPickup: { latitude: 13.7, longitude: 100.5 }, scheduledDelivery: null, reasons: [] };
  const en = text(renderToString(React.createElement(FleetJobReviewPanel, { jobs: [job], analysis, ledger, registration: 'AA-1', language: 'en', day: '2026-11-03' })));
  assert.match(en, /Temporary — not saved/); assert.match(en, /Driver\s*:\s*not confirmed/); assert.match(en, /Confirm Reject Needs Review/);
  assert.doesNotMatch(en, /\bsaved to\b|\bpersisted\b|has been saved/i);
});

test('Jobs: per-day booking warnings are counted and never changed', () => {
  const { summarizeDayJobWarnings } = load('lib/fleet-booking-quality.ts');
  const job = (jobId, pickupTime, o = {}) => ({ jobId, workOrder: 'WO', pickupTime, bookingAssignment: 'stable_vehicle_id', scheduledPickup: {}, scheduledDelivery: {}, ...o });
  const w = summarizeDayJobWarnings([job('1', '09:00'), job('2', '09:00:00'), job('3', null), job('4', '11:00', { bookingAssignment: 'registration_only', workOrder: '', scheduledDelivery: null })]);
  assert.equal(w.total, 4); assert.equal(w.counts.same_time_booking, 2); assert.equal(w.counts.missing_pickup_time, 1); assert.equal(w.counts.registration_only_assignment, 1);
  assert.equal(w.counts.missing_work_order, 1); assert.equal(w.counts.missing_pickup_or_delivery_coordinates, 1); assert.equal(w.blocking, 3);
  assert.equal(summarizeDayJobWarnings([]).total, 0);
});

test('Fuel: shared date scope is controlled, purchases are never consumption, pricing stays two decimals', () => {
  const { FleetFuelPanel } = load('components/fleet-fuel-panel.tsx');
  const html = renderToString(React.createElement(FleetFuelPanel, { vehicleId: 'v', language: 'en', scope: { from: '2026-10-01', to: '2026-10-07' }, onScope: () => {} }));
  assert.match(html, /value="2026-10-01"/); assert.match(html, /value="2026-10-07"/);
  const src = fs.readFileSync(path.join(root, 'components/fleet-fuel-panel.tsx'), 'utf8');
  assert.match(src, /Purchased fuel is not consumed fuel/); assert.match(src, /Efficiency: Unknown/); assert.match(src, /LPG/);
  assert.match(src, /\[from, to, vehicleId\]/, 'a different range or vehicle discards what was loaded');
  assert.match(src, /href="\/fuel-logs"/);
});

test('data paths are unchanged: the workspace reads only the existing read-only endpoints and writes nothing', () => {
  const sources = ['components/fleet-evidence-panel.tsx', 'components/fleet-journey-ledger-panel.tsx', 'components/fleet-vehicle-day-summary.tsx', 'components/fleet-job-review-panel.tsx'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const urls = [...sources.matchAll(/\/api\/[a-z0-9\-/]+/g)].map(m => m[0]);
  assert.deepEqual([...new Set(urls)].sort(), ['/api/admin/forth-tracking/evidence', '/api/admin/forth-tracking/evidence/provider']);
  assert.doesNotMatch(sources, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|localStorage|sessionStorage|method: "(PUT|PATCH|DELETE)"/);
  assert.match(sources, /method: "POST"[^}]*Authorization/, 'the provider read is the existing bounded read');
});

test('playback restriction is unchanged: the link only appears when the server granted journey access', () => {
  assert.match(panelSrc, /journeyAccess === "granted" && onOpenPlayback/);
  assert.match(panelSrc, /requires_authorisation/);
  const gate = fs.readFileSync(path.join(root, 'lib/forth-history-live-gate.ts'), 'utf8'); assert.match(gate, /production/i);
  const access = fs.readFileSync(path.join(root, 'lib/forth-playback-access.ts'), 'utf8'); assert.match(access, /fleet:history_playback/);
  assert.match(fs.readFileSync(path.join(root, 'lib/authorization.ts'), 'utf8'), /"fleet:history_playback"/);
});
