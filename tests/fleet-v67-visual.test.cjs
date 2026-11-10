const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const ls = load('lib/forth-live-status.ts');
const health = load('lib/forth-gps-health.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const css = read('components/forth-operations-v21.css');
const v67 = css.slice(css.indexOf('V6.7 visual cleanup'));

test('GPS Health headline restates the existing class in plain language and never upgrades it: only class A is "ok"', () => {
  const thai = /[฀-๿]/;
  for (const letter of 'ABCDEFG') { const en = ls.gpsSummaryFor(letter, 'en'), th = ls.gpsSummaryFor(letter, 'th'); assert.ok(en && th, letter); assert.match(th.title, thai); assert.match(th.meaning, thai); assert.ok(en.meaning.length > 30); }
  assert.equal(ls.gpsSummaryFor('A', 'en').tone, 'ok'); for (const letter of 'BCDEFG') assert.notEqual(ls.gpsSummaryFor(letter, 'en').tone, 'ok', letter);
  assert.equal(ls.gpsSummaryFor('Z', 'en'), null);
  assert.match(ls.gpsSummaryFor('G', 'en').title, /not verified/); assert.match(ls.gpsSummaryFor('G', 'en').meaning, /not necessarily faulty/); assert.match(ls.gpsSummaryFor('E', 'en').title, /Tracker connection unavailable/);
});

test('the headline agrees with the classifier for real record shapes (verified is exactly class A)', () => {
  const base = { gpsDeviceId: 'd', vehicleRegistration: 'AA-1', timestampStatus: 'current', coordinateStatus: 'valid', latitude: 13.7, longitude: 100.6, speed: 0, engineOn: null, gpsConnectivity: 'connected', gprsConnectivity: 'connected', positionQuality: 'gps' };
  const cases = [base, { ...base, positionQuality: 'no_gps' }, { ...base, timestampStatus: 'stale' }, { ...base, coordinateStatus: 'missing', latitude: null, longitude: null }, { ...base, gprsConnectivity: 'disconnected' }, { ...base, gpsConnectivity: 'disconnected' }, { ...base, gpsDeviceId: '' }];
  for (const r of cases) { const h = health.classifyForthGpsHealth(r); const s = ls.gpsSummaryFor(h.letter, 'en'); assert.ok(s, h.letter); assert.equal(s.tone === 'ok', h.verified, h.letter); }
});

test('terminology: the fleet review says provider-reported and reviewed-only, never "fleet total"', () => {
  const cmp = read('components/fleet-day-review.tsx');
  for (const needle of ['Provider-reported km (reviewed vehicles only)', 'กม. ที่ผู้ให้บริการรายงาน (เฉพาะรถที่ตรวจแล้ว)', 'Vehicles reviewed', 'is a partial sum', 'not a fleet total']) assert.ok(cmp.includes(needle), needle);
  assert.doesNotMatch(cmp, /Fleet total|Evidence loaded/);
});

test('Reports: the earlier distance and mileage reports sit in one closed section; the daily review and recurring places stay on top; nothing reads Forth on load', () => {
  const centre = read('components/forth-tracking-centre.tsx');
  // V7.1: Reports is its own full-width workspace (no sidebar stack, no map).
  const start = centre.indexOf('<div className="v71-workspace v71-reports-workspace"'), end = centre.indexOf('</details>', start);
  const block = centre.slice(start, end);
  assert.ok(block.indexOf('<FleetDayReview') < block.indexOf('<FleetRecurringAreas') && block.indexOf('<FleetRecurringAreas') < block.indexOf('<details className="fleet-legacy-reports"'));
  for (const name of ['<FleetDailyReport', '<FleetMileageReport']) assert.ok(block.indexOf(name) > block.indexOf('<details className="fleet-legacy-reports"'), name);
  // V7.7.1: the fleet fuel and mileage section moved out of the closed section into Reports proper, directly under the daily review.
  assert.ok(block.indexOf('<FleetDayReview') < block.indexOf('<FleetFuelReport') && block.indexOf('<FleetFuelReport') < block.indexOf('<FleetRecurringAreas'));
  assert.doesNotMatch(read('components/fleet-fuel-report.tsx'), /useEffect\(\(\) => \{ void read\(/, 'the fuel section reads nothing until the button is pressed');
  assert.doesNotMatch(block, /<details[^>]*\bopen\b/, 'closed by default');
  assert.doesNotMatch(read('components/fleet-day-review.tsx'), /setInterval|useEffect\(\(\) => \{ void readIds/);
});

test('Today: the long how-it-works text is in a closed disclosure and the scope controls are unchanged', () => {
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /<details className="fleet-evidence-more" data-scope-help><summary>/); assert.match(panel, /Source reads happen only when requested/);
  for (const needle of ['preset(1)', 'Load EES records', 'Reload EES records', 'Selected day']) assert.ok(panel.includes(needle), needle);
});

test('GPS Health shows the plain headline first, then the unchanged technical detail', () => {
  const centre = read('components/forth-tracking-centre.tsx'); const at = centre.indexOf('data-gps-summary');
  assert.ok(at > 0); assert.ok(at < centre.indexOf('copy.device}</span>'), 'headline precedes the device and coordinate rows'); assert.match(centre, /role="status"><strong>\{g\.title\}<\/strong>\{g\.meaning\}/);
  assert.match(centre, /classifyForthGpsHealth|describeForthGpsHealth/);
});

test('status language: icon plus text chips, restrained colour, high priority marked by a symbol, and keyboard focus is visible', () => {
  for (const needle of ['.fleet-review-badge::before', 'content: "✓"', 'content: "▲"', 'content: "✕"', 'content: "◐"', ':focus-visible { outline: 2px solid #6d28d9']) assert.ok(v67.includes(needle), needle);
  assert.match(v67, /\.fleet-gps-summary\[data-tone="ok"\]/); assert.match(v67, /data-coverage="verified_complete"/);
});

test('drawer tabs: all six stay visible (grid when narrow, one row when wide), 44 px targets, active tab has a non-colour marker', () => {
  assert.match(v67, /\.fleet-details-drawer \{ container-type: inline-size; \}/); assert.match(v67, /@container \(min-width: 26rem\)/); assert.match(v67, /box-shadow: inset 0 -3px 0 #f97316/);
  assert.doesNotMatch(v67, /overflow-x:\s*auto[^}]*forth-detail-navigation|forth-detail-navigation[^}]*overflow-x:\s*auto/, 'no sideways-scrolling tab strip that hides tabs');
  assert.match(read('components/fleet-premium-v3.css'), /\.forth-v21 \.forth-detail-navigation button \{ min-height: 44px; \}/, 'the 44 px touch-target rule is unchanged');
  const centre = read('components/forth-tracking-centre.tsx'); for (const id of ['"overview", "Overview"', '"today", "Today"', '"jobs", "Jobs"', '"journeys", "Journeys"', '"fuel", "Fuel"', '"health", "GPS Health"']) assert.ok(centre.includes(id) || centre.includes(id.replace('", "', '", "')), id);
});

test('no business logic changed for looks: the verification, freshness and live-status helpers are untouched by V6.7', () => {
  const live = read('lib/forth-live-status.ts');
  assert.match(live, /export function describeLiveVehicle/); assert.match(live, /export function liveAgreesWithGpsHealth/);
  assert.doesNotMatch(read('lib/forth-tracking-view.ts') + read('lib/forth-gps-health.ts'), /V6\.7/);
});
