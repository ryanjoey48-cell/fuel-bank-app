const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const gate = load('lib/forth-history-live-gate.ts');
const playback = load('lib/forth-journey-playback.ts');
const day = load('lib/fleet-intelligence-day.ts');
const on = env => gate.isForthHistoryLiveRequestsEnabled(env);

test('gate truth table: either flag opens local development, neither is session-scoped, defaults are closed', () => {
  assert.equal(on({}), false);
  assert.equal(on({ FORTH_HISTORY_SUPERVISED_SESSION: '1' }), true);
  assert.equal(on({ FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED: '1' }), true);
  assert.equal(on({ FORTH_HISTORY_SUPERVISED_SESSION: '1', FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED: '1' }), true);   // together is redundant, not required
  assert.equal(on({ FORTH_HISTORY_SUPERVISED_SESSION: 'true' }), true); assert.equal(on({ FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED: 'TRUE' }), true);
  for (const v of ['0', 'false', '', 'yes', 'on', ' 1', '2']) { assert.equal(on({ FORTH_HISTORY_SUPERVISED_SESSION: v }), false, `supervised=${JSON.stringify(v)}`); assert.equal(on({ FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED: v }), false, `office=${JSON.stringify(v)}`); }
});

test('production: the supervised flag can never open history; only the owner-approved office flag can', () => {
  const prod = { VERCEL_ENV: 'production' };
  assert.equal(on({ ...prod }), false);
  assert.equal(on({ ...prod, FORTH_HISTORY_SUPERVISED_SESSION: '1' }), false);
  assert.equal(on({ ...prod, FORTH_HISTORY_SUPERVISED_SESSION: 'true' }), false);
  assert.equal(on({ ...prod, FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED: '1' }), true);
  assert.equal(on({ ...prod, FORTH_HISTORY_SUPERVISED_SESSION: '1', FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED: '1' }), true);
  for (const preview of ['preview', 'development']) assert.equal(on({ VERCEL_ENV: preview, FORTH_HISTORY_SUPERVISED_SESSION: '1' }), true);   // supervised works outside production only
  assert.equal(gate.FORTH_HISTORY_LIVE_REQUESTS_ENABLED, false);                                                                                 // the compile-time default stays closed
});

test('the denial text names the flags, says production must never use the supervised one, and does not blame Forth', () => {
  const en = gate.forthHistoryGateDenialDetail('en'), th = gate.forthHistoryGateDenialDetail('th');
  assert.match(en, /FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED/); assert.match(en, /FORTH_HISTORY_SUPERVISED_SESSION must never be set in production/);
  assert.match(th, /FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED/);
  for (const language of ['en', 'th']) { const message = playback.describeHistoryGateOff(language); assert.ok(message.length > 20); assert.doesNotMatch(message, /current Forth access|ไม่มีข้อมูล GPS ย้อนหลังจากสิทธิ์/); }
  assert.match(playback.describeHistoryGateOff('en'), /not available/i); assert.match(playback.describeHistoryGateOff('en'), /switched off/i);
  assert.match(playback.describeHistoryUnavailable('en'), /not available/i);                                                                       // genuine provider failures keep their own wording
});

test('location coordinates never travel with a distance report', () => {
  const evidence = { vehicleId: 'v', day: '2026-11-03', sources: { providerReported: { value: 289.2 } }, observedPoints: [{ timestamp: '2026-11-03T01:00:00Z', latitude: 13.7, longitude: 100.7 }] };
  const shown = day.publicProviderDay(evidence);
  assert.equal('observedPoints' in shown, false); assert.equal(shown.sources.providerReported.value, 289.2); assert.equal(shown.vehicleId, 'v');
  assert.equal('observedPoints' in evidence, true);                                                                                              // the server-side copy keeps them for job matching
  assert.doesNotMatch(JSON.stringify(shown), /13\.7|100\.7/);
  for (const file of ['app/api/admin/forth-tracking/evidence/provider/route.ts', 'app/api/admin/forth-tracking/evidence/route.ts']) assert.match(fs.readFileSync(file, 'utf8'), /publicProviderDay\(/, file);
});

test('real stored day: playback would mark every No-GPS point as a reported (amber) trail and verify none', { skip: !fs.existsSync('output/fleet-real-validation/1793759758202/actual-input.json') && 'local ignored capture not present' }, () => {
  // Uses the local, git-ignored capture from the 4 Nov validation. Offline: no Forth request and no flag.
  const { normalizeHistoricalLog } = load('lib/forth-history-log.ts'), { buildPlaybackObservations } = playback;
  const input = JSON.parse(fs.readFileSync('output/fleet-real-validation/1793759758202/actual-input.json', 'utf8'));
  const observations = buildPlaybackObservations(normalizeHistoricalLog(input.forthLog, input.deviceId, 'Asia/Bangkok'));
  assert.equal(observations.length, input.forthLog.length);
  assert.equal(observations.filter(o => o.point.verifiedGps).length, 0);               // nothing is verified GPS
  assert.ok(observations.filter(o => o.point.trailEligible).length > 0);               // but the reported coordinates qualify for an amber trail
});
