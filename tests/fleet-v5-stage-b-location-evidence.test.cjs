const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const ev = load('lib/fleet-location-evidence.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const DAY = '2026-10-26';
const at = hms => new Date(Date.parse(`${DAY}T${hms}+07:00`)).toISOString();
const SITE = { latitude: 13.112, longitude: 100.982 };
const north = (p, m) => ({ latitude: p.latitude + m / 111_000, longitude: p.longitude });
const o = (hms, where, speedKph, verified = true) => ({ timestamp: at(hms), latitude: where.latitude, longitude: where.longitude, speedKph, verified });
const FAR = north(SITE, 6000);
const stop = (where, startMin, verified = true, hour = 10) => [0, 1, 2, 3].map(i => o(`${hour}:${String(startMin + i).padStart(2, '0')}:00`, north(where, i * 3), 0, verified));
const day = [o('09:58:00', FAR, 60), ...stop(north(SITE, 170), 10), o('10:14:00', FAR, 60), o('13:00:00', FAR, 60), ...stop(north(SITE, 900), 10, false, 13), o('13:14:00', FAR, 60), ...stop(north(SITE, 3000), 30, true, 13), o('13:36:00', FAR, 60)];

test('with an anchor, stops inside the bounded search are ranked and carry honest notes; far stops are left out', () => {
  const e = ev.buildLocationEvidence({ observations: day, anchor: SITE });
  assert.equal(e.mode, 'near_anchor'); assert.equal(e.searchRadiusM, 1000); assert.equal(e.stops.length, 2, 'the stop 3 km away is outside the search');
  assert.ok(e.stops[0].distanceFromAnchorM > 150 && e.stops[0].distanceFromAnchorM < 200);
  assert.ok(e.stops[0].notes.includes('outside_the_150m_matching_radius')); assert.ok(e.stops[0].notes.includes('could_belong_to_a_neighbouring_site'));
  assert.equal(e.stops[0].sourceQuality, 'verified_gps'); assert.ok(e.stops[0].weight > e.stops[1].weight);
  assert.equal(e.stops[1].sourceQuality, 'unverified'); assert.ok(e.stops[1].notes.includes('positions_not_all_verified_gps'));
  assert.deepEqual(e.observations, { total: day.length, verified: day.filter(p => p.verified).length, unverified: day.filter(p => !p.verified).length });
});

test('the search is capped and the 150 m matching radius is never widened', () => {
  assert.equal(ev.buildLocationEvidence({ observations: day, anchor: SITE, searchRadiusM: 9000 }).searchRadiusM, 2000);
  assert.equal(ev.buildLocationEvidence({ observations: day, anchor: SITE, searchRadiusM: 5 }).searchRadiusM, 150);
});

test('without an anchor (a site with no pin) the day stops are listed, longest stay first, with no distance or weight', () => {
  const e = ev.buildLocationEvidence({ observations: day });
  assert.equal(e.mode, 'whole_day'); assert.equal(e.anchorProvided, false); assert.equal(e.searchRadiusM, null);
  assert.equal(e.stops.length, 3); assert.ok(e.stops.every(s => s.distanceFromAnchorM === null && s.weight === null));
  assert.ok(e.stops[0].stayMinutes.min >= e.stops[1].stayMinutes.min);
});

test('an invalid anchor is ignored, slow traffic is never listed as a stop, and an empty day says so', () => {
  assert.equal(ev.buildLocationEvidence({ observations: day, anchor: { latitude: 999, longitude: 0 } }).mode, 'whole_day');
  const crawl = [o('10:00:00', SITE, 6), o('10:01:00', north(SITE, 12), 7), o('10:02:00', north(SITE, 25), 6)];
  assert.equal(ev.buildLocationEvidence({ observations: crawl, anchor: SITE }).stops.length, 0);
  const none = ev.buildLocationEvidence({ observations: [] });
  assert.equal(none.stops.length, 0); assert.ok(none.limitations.some(l => /No positions/.test(l)));
});

test('a roadside booked pin is flagged and stays a candidate list, never a verdict', () => {
  const road = [o('09:50:00', FAR, 60), o('09:55:00', north(SITE, 5), 68), o('09:56:00', north(SITE, 100), 40), ...stop(north(SITE, 300), 10), o('10:14:00', FAR, 60)];
  const e = ev.buildLocationEvidence({ observations: road, anchor: SITE });
  assert.equal(e.anchorOnRoad, true); assert.equal(e.stops.length, 1);
  assert.ok(e.limitations.some(l => /not customer sites until the office verifies/i.test(l))); assert.ok(e.limitations.some(l => /not unloading time and not billable waiting time/i.test(l)));
});

test('provider-day positions are merged with their verified flag preserved', () => {
  const merged = ev.observationsFromProviderDay({ observedPoints: [{ timestamp: at('10:00:00'), latitude: 1, longitude: 2, speedKph: 3 }], reportedPoints: [{ timestamp: at('10:01:00'), latitude: 1, longitude: 2 }] });
  assert.deepEqual(merged.map(m => [m.verified, m.speedKph]), [[true, 3], [false, null]]);
  assert.deepEqual(ev.observationsFromProviderDay(null), []);
});

test('the Stage B route is gated, read only, never calls Forth and keeps the anchor out of the URL', () => {
  const route = read('app/api/admin/forth-tracking/evidence/location-stops/route.ts');
  assert.match(route, /requireFleetOfficeAccess/); assert.match(route, /canViewJourneyDetail/); assert.match(route, /needs administrator authorisation/);
  assert.match(route, /recalledProviderDay\(/); assert.match(route, /day_not_read/); assert.match(route, /saved: false/);
  assert.doesNotMatch(route, /getForthParkingReport|getForthLogReport|getForthTrackingFleetData|rememberProviderDay|\.insert\(|\.update\(|\.upsert\(|\.delete\(|service_role|SUPABASE_SERVICE/);
  assert.match(route, /request\.json\(\)/); assert.doesNotMatch(route, /searchParams\.get\(["']anchor|latitude.*searchParams/);
  assert.ok(route.indexOf('canViewJourneyDetail') < route.indexOf('request.json'), 'authorisation is decided before the body is read');
});

test('the panel is read only, bilingual and honest; the editor changes are additive and unsaved', () => {
  const panel = read('components/location-evidence-panel.tsx'), map = read('components/locations-map.tsx'), dir = read('components/locations-directory.tsx');
  for (const needle of ['Read only', 'candidate, not saved', 'Dwell is not unloading time', 'Read this day from Forth (read only)', 'language === "th"', 'อ่านอย่างเดียว', 'Use as unsaved candidate position in the editor']) assert.ok(panel.includes(needle), needle);
  assert.doesNotMatch(panel, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|map-pins|method:\s*["'](PUT|PATCH|DELETE)|localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /new URLSearchParams\([^)]*(latitude|longitude|anchor)/, 'coordinates are never sent in a URL');
  assert.match(panel, /JSON\.stringify\(\{ vehicleId, day, anchor \}\)/);
  assert.match(map, /evidenceMarkers\?:/); assert.match(map, /suggestedCandidate\?:/); assert.match(map, /dashArray/);
  assert.match(map, /await onSavePin\(\{/, 'saving still goes only through the existing editor step'); assert.equal((map.match(/onSavePin\(\{/g) ?? []).length, 1);
  assert.match(dir, /canEdit && <LocationEvidencePanel/); // V6.5: Stage B markers are still passed through unchanged, now alongside the unsaved fleet suggestion marker.
  assert.match(dir, /evidenceMarkers=\{\[\.\.\.evidenceMarkers, \.\.\.fleetMarkers\]\}/); assert.match(dir, /onMarkers=\{setEvidenceMarkers\}/);
});

test('the pin save route, the pin model and bookings are untouched by Stage B', () => {
  const save = read('app/api/locations/map-pins/route.ts');
  assert.match(save, /manual_confirmed/); assert.match(save, /Manual map-pin correction is restricted to administrators/);
  const source = read('lib/fleet-location-evidence.ts');
  assert.doesNotMatch(source, /supabase|fetch\(|weekly_mileage|fuel_logs|odometer|booking_diary|Math\.random|Date\.now\(\)/i);
});
