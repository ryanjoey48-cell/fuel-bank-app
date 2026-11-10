const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const ls = load('lib/forth-live-status.ts');
const view = load('lib/forth-tracking-view.ts');
const health = load('lib/forth-gps-health.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

const base = { gpsDeviceId: 'dev', vehicleRegistration: 'AA-1', timestampStatus: 'current', coordinateStatus: 'valid', latitude: 13.7, longitude: 100.5, speed: 0, engineOn: null, gpsConnectivity: 'connected', gprsConnectivity: 'connected', positionQuality: 'gps' };
const rec = (o = {}) => ({ ...base, ...o });
const ids = r => ls.describeLiveVehicle(r).statements.map(s => s.id);

test('verified, fresh, online: one "ok" statement and nothing contradictory', () => {
  const v = ls.describeLiveVehicle(rec());
  assert.equal(v.verified, true); assert.equal(v.freshness, 'current'); assert.deepEqual(ids(rec()), ['stopped_engine_unknown', 'verified_current']);
  assert.ok(!ids(rec()).includes('unverified_position'));
});

test('an unverified position (source "No GPS") is explained as last reported coordinates, not as an offline tracker', () => {
  const r = rec({ positionQuality: 'no_gps' }); const v = ls.describeLiveVehicle(r);
  assert.equal(v.verified, false); assert.equal(v.trackerOnline, true); assert.ok(ids(r).includes('unverified_position')); assert.ok(!ids(r).includes('tracker_offline')); assert.ok(!ids(r).includes('verified_current'));
  assert.equal(v.hasCoordinates, true, 'it still has a pin; verification is a separate question');
});

test('a stale position is "last known, not live": never moving, never verified, never "current"', () => {
  const r = rec({ timestampStatus: 'stale', speed: 62, engineOn: true }); const v = ls.describeLiveVehicle(r);
  assert.equal(v.freshness, 'stale'); assert.equal(v.motion, 'unavailable'); assert.equal(v.verified, false);
  assert.ok(ids(r).includes('stale_last_known')); assert.ok(!ids(r).includes('observed_speed')); assert.ok(!ids(r).includes('verified_current')); assert.ok(!ids(r).includes('unverified_position'));
});

test('idling needs the provider engine flag on a fresh stopped reading: zero speed alone is not idling', () => {
  assert.ok(ids(rec({ speed: 0, engineOn: true })).includes('potential_idling'));
  assert.ok(!ids(rec({ speed: 0, engineOn: null })).includes('potential_idling')); assert.ok(ids(rec({ speed: 0, engineOn: null })).includes('stopped_engine_unknown'));
  assert.ok(!ids(rec({ speed: 0, engineOn: false })).includes('potential_idling'));
  assert.ok(!ids(rec({ speed: 0, engineOn: true, timestampStatus: 'stale' })).includes('potential_idling'), 'a stale reading is never current idling');
  assert.ok(!ids(rec({ speed: 40, engineOn: true })).includes('potential_idling'), 'a moving vehicle is not idling');
});

test('speed is an observation, never a legal offence: no statement claims speeding', () => {
  const r = rec({ speed: 130, engineOn: true }); const s = ls.describeLiveVehicle(r).statements.find(x => x.id === 'observed_speed');
  assert.ok(s); assert.match(ls.liveStatementLabel('observed_speed', 'en'), /not a speeding finding/);
  for (const id of Object.keys(ls.LIVE_STATEMENT_COPY)) assert.doesNotMatch(ls.LIVE_STATEMENT_COPY[id][0], /offence|violation|illegal|speeding detected/i, id);
  assert.ok(!ids(rec({ speed: 0 })).includes('observed_speed'));
});

test('a positive speed with the engine reported OFF is uncertain, not driving', () => {
  const r = rec({ speed: 30, engineOn: false }); const v = ls.describeLiveVehicle(r);
  assert.equal(v.motion, 'uncertain'); assert.ok(ids(r).includes('speed_engine_conflict'));
});

test('offline tracker, GPS signal off, missing coordinates and unreadable time each get their own statement', () => {
  assert.ok(ids(rec({ gprsConnectivity: 'disconnected' })).includes('tracker_offline'));
  assert.ok(ids(rec({ gpsConnectivity: 'disconnected', positionQuality: 'no_gps' })).includes('gps_signal_off'));
  assert.ok(!ids(rec({ gpsConnectivity: 'disconnected', gprsConnectivity: 'disconnected' })).includes('gps_signal_off'), 'an offline tracker is reported as offline, not as a GPS-off tracker');
  const none = rec({ coordinateStatus: 'missing', latitude: null, longitude: null }); assert.ok(ids(none).includes('no_coordinates')); assert.equal(ls.describeLiveVehicle(none).hasCoordinates, false);
  assert.ok(ids(rec({ timestampStatus: 'unknown' })).includes('time_unknown'));
});

test('consistency matrix: for every combination, the live status agrees with GPS Health and with the map verification rule', () => {
  const values = { timestampStatus: ['current', 'stale', 'unknown'], coordinateStatus: ['valid', 'missing', 'invalid'], speed: [null, 0, 55], engineOn: [null, true, false], gpsConnectivity: ['connected', 'disconnected', 'unknown'], gprsConnectivity: ['connected', 'disconnected', 'unknown'], positionQuality: ['gps', 'no_gps', 'unknown', 'wifi', 'lbs'] };
  const keys = Object.keys(values); let combos = 0, gap = 0;
  const walk = (i, acc) => { if (i === keys.length) { const r = rec({ ...acc, ...(acc.coordinateStatus === 'valid' ? {} : { latitude: null, longitude: null }) }); combos++;
      const v = ls.describeLiveVehicle(r), h = health.classifyForthGpsHealth(r);
      assert.equal(v.verified, view.isForthGpsPositionVerified(r), JSON.stringify(acc));
      // GPS Health A implies verified on the map; the one allowed gap (map verified, health not) is a tracker that is not reported online, and it is stated.
      if (h.verified) assert.equal(v.verified, true, JSON.stringify(acc));
      if (v.verified && !h.verified) { assert.notEqual(v.trackerOnline, true, JSON.stringify(acc)); assert.ok(v.statements.some(s => s.id === 'verified_reading_tracker_unconfirmed'), 'the gap is explained: ' + JSON.stringify(acc)); gap++; }
      assert.ok(ls.liveAgreesWithGpsHealth(r));
      if (v.freshness === 'stale') { assert.equal(v.verified, false); assert.equal(v.motion, 'unavailable'); assert.ok(!v.statements.some(s => s.id === 'verified_current')); }
      if (v.statements.some(s => s.id === 'verified_current')) assert.ok(v.verified && v.freshness === 'current' && v.trackerOnline === true && h.verified);
      if (v.statements.some(s => s.id === 'potential_idling')) assert.ok(r.engineOn === true && v.freshness === 'current');
      return; }
    for (const value of values[keys[i]]) walk(i + 1, { ...acc, [keys[i]]: value }); };
  walk(0, {}); assert.equal(combos, 3 * 3 * 3 * 3 * 3 * 3 * 5); assert.equal(gap, 18, 'exactly the tracker-not-online readings with fresh valid GPS coordinates');
});

test('fleet summary partitions the fleet exactly and counts unverified without calling them offline', () => {
  const fleet = [rec(), rec({ positionQuality: 'no_gps', speed: 40, engineOn: true }), rec({ positionQuality: 'no_gps' }), rec({ timestampStatus: 'stale' }), rec({ gprsConnectivity: 'disconnected' }), rec({ coordinateStatus: 'missing', latitude: null, longitude: null }), rec({ speed: 20, engineOn: false }), rec({ speed: 0, engineOn: true })];
  const s = ls.summarizeLiveFleet(fleet);
  assert.equal(s.total, 8); assert.equal(s.moving + s.stationary + s.uncertain + s.unavailable, 8); assert.equal(s.consistent, true);
  assert.equal(s.stale, 1); assert.equal(s.trackerOffline, 1); assert.equal(s.withoutCoordinates, 1); assert.equal(s.uncertain, 1); assert.equal(s.potentialIdling, 1);
  assert.equal(s.unverified, 4); assert.equal(s.total - s.unverified, 4, 'four records pass the map verification rule'); assert.equal(s.freshVerified, 3, 'one of those four has a tracker reported offline and is not counted as fresh verified');
  assert.equal(s.unverified, s.total - fleet.filter(view.isForthGpsPositionVerified).length);
  assert.equal(ls.summarizeLiveFleet([]).total, 0);
});

test('every statement has Thai copy; the Overview shows the statements read-only', () => {
  const thai = /[฀-๿]/; for (const id of Object.keys(ls.LIVE_STATEMENT_COPY)) { assert.match(ls.LIVE_STATEMENT_COPY[id][1], thai, id); assert.ok(ls.LIVE_STATEMENT_COPY[id][0].length > 20, id); }
  const centre = read('components/forth-tracking-centre.tsx'), lib = read('lib/forth-live-status.ts');
  assert.match(centre, /describeLiveVehicle\(selectedRecord\)/); assert.match(centre, /data-live-statements/);
  assert.doesNotMatch(lib, /fetch\(|supabase|localStorage|Date\.now\(\)|Math\.random|\.insert\(|\.update\(/);
});

test('mobile map overlays: the collapse button and the Map status bar reserve their own corners', () => {
  const css = read('components/forth-operations-v21.css');
  const block = css.slice(css.indexOf('V6.3 mobile map overlays'));
  assert.match(block, /@media\(max-width:767px\)/); assert.match(block, /\.forth-map-status \{ max-width: calc\(100% - 7\.2rem\); \}/);
  assert.match(block, /\.forth-map-coverage-control \{ right: auto; max-width: calc\(100% - 5\.4rem\); \}/);
  assert.match(block, /min-height: 44px/, 'the 44 px touch target is kept');
  assert.doesNotMatch(block, /display:\s*none|visibility:\s*hidden/, 'nothing is hidden to avoid the overlap');
  assert.match(css, /\.forth-mobile-map-collapse \{ grid-row:2; grid-column:1; z-index:30;/, 'the existing placement is unchanged');
});

test('live and historical are isolated: the live poll does not depend on the Reports section and is visible-tab only', () => {
  const centre = read('components/forth-tracking-centre.tsx');
  const start = centre.indexOf('const loadIfDue = (force = false)');
  assert.ok(start > 0); const block = centre.slice(start, centre.indexOf('requestController?.abort();', start) + 80);
  assert.match(block, /document\.visibilityState !== "visible"/); assert.match(block, /window\.setInterval\(\(\) => loadIfDue\(false\), POLL_INTERVAL_MS\)/);
  assert.match(block, /\}, \[\]\);/, 'the live loader has no dependency on the selected section, so opening Reports cannot restart or stop it');
  assert.doesNotMatch(block, /intelligenceSection|FleetDayReview|evidence\/provider/);
  const review = read('components/fleet-day-review.tsx');
  assert.doesNotMatch(review, /forth-tracking\/vehicles|setInterval|refreshRef/, 'the historical review never touches the live loader and has no background timer');
  assert.match(centre, /const POLL_INTERVAL_MS = 180_000;/);
});

test('map: a search or list filter fades non-matching markers without hiding or disabling them, and never fades the selected vehicle', () => {
  const map = read('components/forth-tracking-map.tsx');
  assert.match(map, /markerElement\.style\.opacity = emphasized\.size > 0 && !reveal && !entry\.selected \? "0\.3" : ""/);
  assert.doesNotMatch(map.slice(map.indexOf('V6.3: when a search or list filter')).slice(0, 600), /pointerEvents|display\s*=|visibility/);
});

test('drawer: the six tabs and the preserved day are unchanged by V6.3', () => {
  const centre = read('components/forth-tracking-centre.tsx');
  for (const id of ['overview', 'today', 'jobs', 'journeys', 'fuel', 'health']) assert.ok(centre.includes(`"${id}"`), id);
  assert.match(centre, /<FleetEvidencePanel key=\{`\$\{activeEesVehicle\.id\}:/); assert.match(centre, /initialDay=\{reviewDrill/);
  assert.match(centre, /selectedLiveStatus = useMemo\(\(\) => \(selectedRecord \? describeLiveVehicle\(selectedRecord\) : null\), \[selectedRecord\]\)/);
});
