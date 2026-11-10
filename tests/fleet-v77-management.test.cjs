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
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports;
}
const R = load('lib/fleet-day-review.ts');
const activity = { movingJourneys: 3, movingMinutes: 200, stops: 4, longestStopMinutes: 30, missingMinutes: 0, stoppedMinutes: 100, observations: 100, verifiedObservations: 100 };
const row = (reg, insights, coverage = 'verified_complete', extra = {}) => ({ vehicleId: 'id-' + reg, registration: reg, providerKm: 100, providerReconciled: true, segments: 5, capturedAt: '2026-11-04T00:00:00Z', registry: 'active',
  review: { coverage, coverageReasons: [], activity, insights, positionCount: { received: 10, analysed: 10, exactDuplicates: 0, noValidTime: 0, explained: true }, journeyAccess: 'granted' }, ...extra });
const gap = (min) => ({ id: 'tracking_gap', reliability: 'verified_gps', evidence: { missingMinutes: min } });
const reviewAll = rows => rows.map(r => R.reviewVehicle(r));

test('attention queue groups repeated issues, ranks High above Medium, and leaves information-level items out', () => {
  const reviews = reviewAll([row('A-1', [gap(200)]), row('B-2', [gap(70)]), row('C-3', [{ id: 'unverified_positions', reliability: 'provider_reported', evidence: {} }]), row('D-4', [{ id: 'long_distance', reliability: 'verified_gps', evidence: {} }])]);
  const queue = R.buildAttentionQueue(reviews);
  assert.equal(queue[0].key, 'tracking_gap'); assert.equal(queue[0].priority, 'high'); assert.equal(queue[0].vehicles.length, 2, 'two vehicles, one group');
  assert.deepEqual(queue[0].vehicles.map(v => v.registration), ['A-1', 'B-2'], 'High vehicle first inside the group');
  assert.ok(queue.some(g => g.key === 'unverified_positions' && g.priority === 'medium'));
  assert.ok(!queue.some(g => g.key === 'long_distance'), 'information-level findings are not in the queue');
});

test('unreviewed vehicles never appear as issues and are never counted as clean: questions count reviewed vehicles only and name the reviewed total', () => {
  const rows = [row('A-1', [gap(200)]), { vehicleId: 'id-N', registration: 'N-9', providerKm: null, providerReconciled: false, segments: null, capturedAt: null, review: null, registry: 'active' }];
  const reviews = reviewAll(rows); const summary = R.summarizeFleetReview(reviews); const q = R.managementQuestions(summary);
  assert.equal(q.reviewed, 1); assert.equal(q.total, 2);
  assert.equal(q.questions.find(x => x.id === 'tracking_gaps').vehicles, 1);
  assert.ok(!R.buildAttentionQueue(reviews).some(g => g.vehicles.some(v => v.registration === 'N-9')));
});

test('queue evidence carries the source reliability and no coordinates', () => {
  const g = R.buildAttentionQueue(reviewAll([row('A-1', [gap(200)])]))[0];
  assert.equal(g.vehicles[0].reliability, 'verified_gps'); assert.doesNotMatch(JSON.stringify(g), /latitude|longitude|centroid/i);
});

test('management summary renders with Thai copy and a vehicle-day link, and adds no read of its own', () => {
  const ui = read('components/fleet-day-review.tsx');
  assert.match(ui, /data-management-summary/); assert.match(ui, /data-attention-queue/); assert.match(ui, /onVehicle\(v\.registration, day\)/);
  assert.match(ui, /ยังไม่ได้ขอ ซึ่งไม่ได้หมายความว่าไม่มีปัญหา/); assert.match(ui, /not requested, which is not the same as no problem/);
  const before = ui.indexOf('v77-management'), fetches = (ui.slice(before).match(/fetch\(/g) || []).length;
  assert.equal(fetches, 0, 'the management summary section performs no request');
  for (const id of ['gps_unverified', 'tracking_gaps', 'distance_disagreement', 'prolonged_stays', 'unusable_tracking']) assert.ok(R.QUESTION_COPY[id][1].length > 0, id);
});

test('Daily Activity shows the day\'s fuel records and odometer readings beside the movement, says purchases are not consumption, and links to Fuel Intelligence without a read', () => {
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /data-day-other-evidence/); assert.match(panel, /Purchases are not consumption\./); assert.match(panel, /link\("fuel", t\("Open fuel"/);
  const seg = panel.slice(panel.indexOf('data-day-other-evidence'), panel.indexOf('data-day-other-evidence') + 700);
  assert.doesNotMatch(seg, /fetch\(|load\(\)|read\(/);
});
