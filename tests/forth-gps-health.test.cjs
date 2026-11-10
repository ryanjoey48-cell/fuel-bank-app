const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const T = load('lib/forth-tracking.ts');
const V = load('lib/forth-tracking-view.ts');
const H = load('lib/forth-gps-health.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');
const NOW = Date.parse('2026-11-06T02:08:24Z');                     // 09:08:24 Asia/Bangkok
// Sanitized fixtures: same field names, casing and types as the live response (strings "ON"/"OFF", numeric coordinates, dd-mm-yyyy local time).
const base = { gpsID: '519697', plateNumber: '64-5954', dateTime: '06-11-2026 09:07:29', GPS: 'ON', GPRS: 'ON', Engine: 'ON', Speed: 70, Latitude: 8.42132, Longitude: 98.55744, COG: 227, positionSource: 'No GPS', Sensor1: 0, Sensor2: 0, Sensor3: 0, Fuel: 0, Temperature: 0 };
const rec = (o = {}) => T.normalizeForthTrackingResponse([{ ...base, ...o }], { now: NOW, sourceTimeZone: 'Asia/Bangkok' })[0];
const health = o => H.classifyForthGpsHealth(rec(o));

test('GPS ON / GPRS ON with positionSource "GPS" is verified fresh GPS (category A)', () => {
  const r = rec({ gpsID: '546298', plateNumber: '3ฒน-9565', positionSource: 'GPS', Speed: 0 });
  assert.deepEqual({ ...H.classifyForthGpsHealth(r) }, { letter: 'A', code: 'verified_fresh_gps', verified: true }); assert.equal(V.isForthGpsPositionVerified(r), true);
});

test('64-5954 pattern: GPS ON, GPRS ON, speed 70, positionSource "No GPS" is unverified, unresolved (G), never promoted by speed', () => {
  const r = rec(); const h = H.classifyForthGpsHealth(r);
  assert.deepEqual({ ...h }, { letter: 'G', code: 'gps_on_source_no_gps', verified: false });
  assert.equal(r.gpsConnectivity, 'connected'); assert.equal(r.positionQuality, 'no_gps'); assert.equal(r.speed, 70); assert.equal(V.isForthGpsPositionVerified(r), false);
  assert.equal(V.getForthReportedActivity(r), 'driving'); assert.equal(V.getForthFleetStatus(r), 'unknown');      // moving is reported, but not GPS-verified motion
  const en = H.describeForthGpsHealth(r, 'en'), th = H.describeForthGpsHealth(r, 'th');
  assert.equal(en.line, 'Tracker online · Vehicle moving · GPS position unverified');
  assert.match(th.line, /ตัวติดตามออนไลน์/); assert.match(th.line, /ยังไม่ยืนยัน/);
  assert.match(en.reason, /GPS signal ON but labels this position’s source “No GPS”/); assert.match(en.signalSummary, /GPS signal \(Forth\): ON · Position source \(Forth\): No GPS/);
  assert.equal(en.positionTime, '06-11-2026 09:07:29');
});

test('GPS OFF with GPRS ON is B (tracker online, no GPS signal) and speed does not verify it', () => {
  const r = rec({ GPS: 'OFF', Speed: 80, positionSource: 'GPS' });
  assert.equal(H.classifyForthGpsHealth(r).letter, 'B'); assert.equal(V.isForthGpsPositionVerified(r), false);
  assert.equal(H.describeForthGpsHealth(r, 'en').line, 'Tracker online · Vehicle moving · GPS position unverified');
});

test('GPS ON with GPRS OFF is E (tracker offline); a stale position with GPRS OFF is also E, with GPRS ON it is C', () => {
  assert.equal(health({ GPRS: 'OFF', positionSource: 'GPS' }).letter, 'E');
  assert.equal(health({ GPRS: 'OFF', dateTime: '06-11-2026 06:00:00' }).letter, 'E');
  assert.equal(health({ dateTime: '06-11-2026 06:00:00', positionSource: 'GPS' }).letter, 'C');
  const stale = rec({ dateTime: '06-11-2026 06:00:00', positionSource: 'GPS' }); assert.equal(V.isForthGpsPositionVerified(stale), false); assert.equal(stale.timestampStatus, 'stale');
});

test('missing, empty and invalid coordinates are D and never produce a position', () => {
  for (const [o, code] of [[{ Latitude: '' }, 'coordinates_missing'], [{ Longitude: null }, 'coordinates_missing'], [{ Latitude: 95 }, 'coordinates_invalid'], [{ Longitude: 'abc' }, 'coordinates_invalid'], [{ Latitude: 200, Longitude: 300 }, 'coordinates_invalid']]) {
    const r = rec({ positionSource: 'GPS', ...o }); const h = H.classifyForthGpsHealth(r); assert.equal(h.letter, 'D'); assert.equal(h.code, code); assert.equal(r.latitude, null); assert.equal(V.isForthGpsPositionVerified(r), false);
  }
});

test('unreadable fields are F, not guessed: missing device or plate, GPS/GPRS not ON or OFF, time unreadable', () => {
  assert.equal(health({ gpsID: '' }).code, 'device_or_registration_missing'); assert.equal(health({ plateNumber: '   ' }).code, 'device_or_registration_missing');
  assert.equal(health({ GPS: 'MAYBE' }).code, 'gps_or_gprs_status_unreadable'); assert.equal(health({ GPRS: null }).code, 'gps_or_gprs_status_unreadable');
  assert.equal(health({ dateTime: 'yesterday' }).code, 'position_time_unreadable'); assert.equal(health({ dateTime: '' }).code, 'position_time_unreadable');
  assert.equal(rec({ GPS: true }).gpsConnectivity, 'connected'); assert.equal(rec({ GPS: 1 }).gpsConnectivity, 'connected'); assert.equal(rec({ GPS: 0 }).gpsConnectivity, 'disconnected');   // field typing variations
});

test('position-source variations stay unverified and are told apart: "No GPS", missing, unrecognised, Wi-Fi/LBS', () => {
  assert.equal(health({ positionSource: 'No GPS' }).code, 'gps_on_source_no_gps');
  assert.equal(health({ positionSource: undefined }).code, 'gps_on_source_unrecognised'); assert.equal(health({ positionSource: '' }).code, 'gps_on_source_unrecognised'); assert.equal(health({ positionSource: 'Satellite?' }).code, 'gps_on_source_unrecognised');
  for (const s of ['WiFi', 'Wi-Fi', 'LBS']) assert.equal(health({ positionSource: s }).code, 'gps_on_source_not_gps', s);
  for (const s of ['GPS', 'gps', ' GPS ']) assert.equal(health({ positionSource: s }).code, 'verified_fresh_gps', JSON.stringify(s));
});

test('conflicting indicators are shown, not resolved: positive speed with engine OFF is "uncertain" and never verified-moving', () => {
  const r = rec({ positionSource: 'GPS', Engine: 'OFF', Speed: 40 });
  assert.equal(V.getForthReportedActivity(r), 'uncertain'); assert.match(H.describeForthGpsHealth(r, 'en').line, /Motion uncertain/);
  assert.equal(H.classifyForthGpsHealth(r).letter, 'A');                                                            // position is verified; the motion conflict is a separate signal
  assert.equal(V.isForthGpsVerifiedDriving(r), false);
});

test('model-specific response variations: two devices differing only in positionSource produce different, explainable results', () => {
  const plus = rec({ gpsID: '519697', positionSource: 'No GPS' }), pro = rec({ gpsID: '546298', plateNumber: '3ฒน-9565', positionSource: 'GPS' });
  assert.equal(plus.gpsConnectivity, pro.gpsConnectivity); assert.equal(plus.gprsConnectivity, pro.gprsConnectivity); assert.equal(plus.timestampStatus, pro.timestampStatus); assert.equal(plus.coordinateStatus, pro.coordinateStatus);
  assert.notEqual(H.classifyForthGpsHealth(plus).letter, H.classifyForthGpsHealth(pro).letter);
  const fields = (x) => Object.keys(x).sort().join(','); assert.equal(fields(plus), fields(pro));                  // identical record shape: model/firmware are not in the API response
  assert.ok(!('model' in plus) && !('firmware' in plus));
});

test('device-to-registration mapping is exact: ids and plates are kept as sent, numeric ids become strings, duplicates stay visible', () => {
  const rows = T.normalizeForthTrackingResponse([{ ...base, gpsID: 519697 }, { ...base, gpsID: '546298', plateNumber: '3ฒน-9565' }, { ...base, gpsID: '546298', plateNumber: '3ฒน-9565' }], { now: NOW, sourceTimeZone: 'Asia/Bangkok' });
  assert.equal(rows[0].gpsDeviceId, '519697'); assert.equal(rows[0].vehicleRegistration, '64-5954'); assert.equal(rows[1].vehicleRegistration, '3ฒน-9565');
  assert.equal(rows.filter(r => r.gpsDeviceId === '546298').length, 2);                                              // the app's matcher treats this as ambiguous (409), it is not collapsed
  assert.equal(T.normalizeForthRegistration('3ฒน-9565'), T.normalizeForthRegistration(' 3ฒน 9565 '));
});

test('summary counts every category separately and totals match', () => {
  const rows = T.normalizeForthTrackingResponse([base, { ...base, gpsID: '2', positionSource: 'GPS' }, { ...base, gpsID: '3', GPS: 'OFF' }, { ...base, gpsID: '4', GPRS: 'OFF' }, { ...base, gpsID: '5', Latitude: '' }, { ...base, gpsID: '6', dateTime: '06-11-2026 06:00:00' }], { now: NOW, sourceTimeZone: 'Asia/Bangkok' });
  const s = H.summarizeForthGpsHealth(rows); assert.deepEqual(s.letters, { A: 1, B: 1, C: 1, D: 1, E: 1, F: 0, G: 1 }); assert.equal(s.total, 6); assert.equal(Object.values(s.letters).reduce((a, b) => a + b, 0), 6);
});

test('historical: "No GPS" log readings give no GPS-derived distance, GPS-labelled ones do, and Distance is incremental metres', () => {
  const hav = (a, b) => { const R = 6371000, t = x => x * Math.PI / 180, dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const times = ['08:00:00', '08:04:30', '08:09:00', '08:13:30'], coords = [[13.70, 100.70], [13.709, 100.70], [13.718, 100.70], [13.727, 100.70]];
  const mk = source => times.map((t, i) => ({ gpsID: 'box', plateNumber: 'REG', dateTime: `03-11-2026 ${t}`, GPS: 'ON', GPRS: 'ON', Engine: 'ON', Speed: 13, Latitude: coords[i][0], Longitude: coords[i][1], COG: 0, positionSource: source, Distance: i === 0 ? 0 : Math.round(hav(coords[i - 1], coords[i])) }));
  const input = rows => ({ vehicleId: 'v', registration: 'REG', deviceId: 'box', day: '2026-11-03', capturedAt: '2026-11-06T00:00:00Z', reportRows: null, logRows: rows });
  const noGps = dayMod.buildProviderDay(input(mk('No GPS'))), gps = dayMod.buildProviderDay(input(mk('GPS')));
  assert.equal(noGps.gps.verifiedObservations, 0); assert.equal(noGps.sources.gpsDerived.value, null); assert.equal(noGps.gps.observedKm, null);          // unknown, not zero, not the Distance sum
  assert.ok(gps.gps.verifiedObservations === 4);
  const raw = mk('GPS'), incrementalSum = raw.reduce((n, r) => n + r.Distance, 0), chordSum = coords.slice(1).reduce((n, c, i) => n + hav(coords[i], c), 0);
  assert.ok(Math.abs(incrementalSum - chordSum) <= 4);                                                                                                       // incremental metres add up to the path
  assert.notEqual(gps.gps.observedKm, null); assert.ok(Math.abs(gps.gps.observedKm * 1000 - chordSum) < 5);                                                   // GPS-derived km is the chord path of verified fixes (3.002 km), not the raw field
  assert.equal(gps.gps.verifiedObservations, 4); assert.equal(gps.gps.coveredSeconds, 810);                                                                 // three 270 s intervals; the rest of the day stays unknown
});

test('real stored day: historical Distance is incremental metres and No GPS stays unverified (offline, local ignored capture)', { skip: !fs.existsSync('output/fleet-real-validation/1793759758202/actual-input.json') && 'local ignored capture not present' }, () => {
  const log = JSON.parse(fs.readFileSync('output/fleet-real-validation/1793759758202/actual-input.json', 'utf8')).forthLog;
  const hav = (a, b) => { const R = 6371000, t = x => x * Math.PI / 180, dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  let close = 0, n = 0, rawSum = 0, chord = 0, decreases = 0;
  for (let i = 1; i < log.length; i++) { const h = hav([log[i - 1].Latitude, log[i - 1].Longitude], [log[i].Latitude, log[i].Longitude]); n++; rawSum += log[i].Distance; chord += h; if (Math.abs(log[i].Distance - h) <= Math.max(30, 0.15 * h)) close++; if (log[i].Distance < log[i - 1].Distance) decreases++; }
  assert.ok(close / n > 0.85); assert.ok(Math.abs(rawSum - chord) / chord < 0.02); assert.ok(decreases > 20);          // not cumulative (it falls), and it matches the previous-coordinate chord
  assert.ok(log.every(r => r.positionSource === 'No GPS' && r.GPS === 'ON'));
});
