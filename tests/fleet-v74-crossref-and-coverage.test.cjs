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
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const X = load('lib/fleet-location-crossref.ts');
const off = (north, east) => ({ latitude: 13.7 + north / 111320, longitude: 100.6 + east / (111320 * Math.cos(13.7 * Math.PI / 180)) });
const forth = (id, name, north = 0, east = 0, extra = {}) => ({ id, name, groupLayer: null, address: null, ...off(north, east), ...extra });
const ees = (id, company_name, extra = {}) => ({ id, company_name, thai_name: null, alternative_names: [], address: null, province: null, destination_type: 'Customer', ...extra });
const one = (e, f) => X.crossReferenceLocations(e, f)[0];

test('same company name (after removing company words and punctuation) with one site is a strong suggestion', () => {
  const r = one([ees('e1', 'Sirtec Co., Ltd.')], [forth('f1', 'SIRTEC')]);
  assert.equal(r.status, 'strong'); assert.equal(r.candidates[0].nameMatch, 'exact'); assert.ok(r.reasons.includes('exact_name'));
});

test('the same company at two sites more than 1 km apart is never merged: several competing matches, the office must choose', () => {
  const r = one([ees('e1', 'Pioneer Packing')], [forth('f1', 'Pioneer Packing', 0, 0), forth('f2', 'Pioneer Packing', 6000, 0)]);
  assert.equal(r.status, 'multiple'); assert.equal(r.candidates[0].sites, 2); assert.ok(r.reasons.includes('several_sites'));
});

test('several entrances close together are one site, so the suggestion stays strong and says so', () => {
  const r = one([ees('e1', 'Mass Logistic')], [forth('f1', 'Mass Logistic', 0, 0), forth('f2', 'Mass Logistic', 200, 100), forth('f3', 'MASS LOGISTIC', -150, 80)]);
  assert.equal(r.status, 'strong'); assert.equal(r.candidates[0].sites, 1); assert.equal(r.candidates[0].points, 3); assert.ok(r.reasons.includes('several_entrances'));
});

test('spelling and spacing differences: CAL-COMP / Cal Comp match; a partial name is only possible; a different spelling is not guessed', () => {
  assert.equal(one([ees('e1', 'Cal-Comp')], [forth('f1', 'CALCOMP')]).status, 'strong');
  assert.equal(one([ees('e1', 'Cal-Comp')], [forth('f1', 'CAL COMP')]).candidates[0].nameMatch, 'exact');
  const partial = one([ees('e1', 'Cal-Comp Electronics (Thailand) Public Co., Ltd.')], [forth('f1', 'CAL-COMP')]);
  assert.equal(partial.status, 'possible'); assert.equal(partial.candidates[0].nameMatch, 'contains');
  assert.equal(one([ees('e1', 'Sirtec')], [forth('f1', 'Sirtek')]).status, 'none', 'a one-letter difference is not enough to claim the same company');
});

test('Thai names and aliases: legal words are ignored and an alias can carry the match', () => {
  assert.equal(one([ees('e1', 'Sirtec International', { thai_name: 'บริษัท เซอเทค จำกัด' })], [forth('f1', 'เซอเทค')]).status, 'strong');
  assert.equal(one([ees('e1', 'Sirtec International', { alternative_names: ['Sirtec'] })], [forth('f1', 'Sirtec')]).status, 'strong');
});

test('two EES records matching the same Forth name are both "several competing", never both linked', () => {
  const rs = X.crossReferenceLocations([ees('e1', 'Sirtec'), ees('e2', 'SIRTEC Co Ltd')], [forth('f1', 'Sirtec')]);
  assert.deepEqual(rs.map(r => r.status), ['multiple', 'multiple']); assert.ok(rs[0].reasons.includes('forth_name_shared_by_several_ees_records'));
});

test('no similar name is "no reliable association"; address overlap is extra support, not a match by itself', () => {
  assert.equal(one([ees('e1', 'Unrelated Trading')], [forth('f1', 'Sirtec')]).status, 'none');
  assert.equal(one([ees('e1', 'Alpha Foods', { address: '88 Moo 3 Bangna Trad Road Samut Prakan' })], [forth('f1', 'Zeta Plastics', 0, 0, { address: '88 Moo 3 Bangna Trad Road Samut Prakan' })]).status, 'none');
  const supported = one([ees('e1', 'Alpha Foods', { address: '88 Moo 3 Bangna Trad Road Samut Prakan' })], [forth('f1', 'Alpha Foods', 0, 0, { address: '88 Moo 3 Bangna Trad Road' })]);
  assert.equal(supported.candidates[0].addressOverlap, true);
});

test('suggestions never invent coordinates for EES records and never write anything', () => {
  const r = one([ees('e1', 'Sirtec')], [forth('f1', 'Sirtec')]);
  assert.deepEqual(Object.keys(r).sort(), ['candidates', 'eesId', 'eesName', 'reasons', 'status']);
  assert.doesNotMatch(JSON.stringify(r), /latitude|longitude/);
  const server = read('lib/fleet-crossref-server.ts'), route = read('app/api/admin/forth-tracking/evidence/location-crossref/route.ts');
  assert.doesNotMatch(server, /\.(insert|update|upsert|delete)\(/); assert.match(route, /business:read/); assert.match(route, /export async function GET/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
});

test('103 EES records against 466 Forth sites is fast and deterministic', () => {
  const lib = load('lib/forth-gps-map-locations.ts');
  const payload = lib.buildForthGpsMapPayloadFromCsv(fs.readFileSync(path.join(root, 'data/forth-locations/Locations Forth Pinned.csv'), 'utf8'));
  const sites = payload.locations.map(l => ({ id: l.id, name: l.name, groupLayer: l.groupLayer, address: l.address, latitude: l.latitude, longitude: l.longitude }));
  assert.equal(sites.length, 466);
  const records = Array.from({ length: 103 }, (_, i) => ees('e' + i, i < 40 ? sites[i * 7 % 466].name : 'Unrelated Company ' + i));
  const started = Date.now(); const a = X.crossReferenceLocations(records, sites); const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, 'bounded work: ' + elapsed + ' ms'); assert.deepEqual(a, X.crossReferenceLocations(records, sites));
  assert.ok(a.filter(r => r.status !== 'none').length >= 30, 'names copied from the Forth file are found');
});

test('driver coverage counts reviewed vehicle-days only, uses only same-day fuel records, exposes counts and no names', () => {
  const server = read('lib/fleet-recurring-server.ts');
  assert.match(server, /async function loadDriverCoverage/); assert.match(server, /select\("date,vehicle_reg,driver_id"\)/);
  assert.doesNotMatch(server.slice(server.indexOf('async function loadDriverCoverage'), server.indexOf('/** Stop evidence for one recurring area')), /from\("drivers"\)|\.name\b/, 'no driver names in the coverage');
  assert.match(server, /out\.confirmed = out\.supporting = out\.conflicting = 0; out\.unknown = out\.vehicleDays/, 'an unreadable source leaves every day unknown, never confirmed');
  const D = load('lib/fleet-driver-attribution.ts');
  assert.equal(D.resolveDriverForDay('2026-10-05', [{ source: 'current_assignment', driverId: 'd1', day: '2026-10-05' }]).status, 'not_confirmed');
  const ui = read('components/fleet-recurring-areas.tsx'); assert.match(ui, /data\.driverCoverage/); assert.match(ui, /Driver evidence/);
});

test('fuel and kilometre comparability is labelled Comparable / Partially comparable / Not comparable / Unknown', () => {
  const src = read('components/fleet-operating-history.tsx');
  for (const label of ['Comparable', 'Partially comparable', 'Not comparable', 'Unknown']) assert.ok(src.includes(label), label);
  assert.match(src, /every day inside the span was reviewed/); assert.match(src, /no km\/L is calculated/);
});

test('named stops carry observed arrival and departure windows, not inferred times', () => {
  const server = read('lib/fleet-day-places-server.ts'); const ui = read('components/fleet-day-places.tsx');
  assert.match(server, /arrivalWindow: g\.arrival, departureWindow: g\.departure/);
  assert.match(ui, /Observed windows, not exact times/); assert.match(ui, /Possible EES directory record/);
});

test('rendered km/fuel comparison: Comparable, Partially comparable, Not comparable and Unknown appear for the right cases (EN and TH)', () => {
  const React = require('react'); const { renderToString } = require('react-dom/server');
  const { FleetKmFuelTable } = load('components/fleet-operating-history.tsx');
  const day = (d, read) => ({ day: d, read, providerKm: read ? 100 : null, providerReconciled: read, gpsKm: read ? 99 : null, stops: null, missingMinutes: null, fuel: [], odometerReadings: 1 });
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const span = (from, to) => ({ label: 'Fuel Log odometer span', km: 210, from, to, reviewRequired: false });
  const render = (days, spans, language = 'en') => text(renderToString(React.createElement(FleetKmFuelTable, { days, spans, language })));
  const all = [day('2026-11-01', true), day('2026-11-02', true)];
  assert.match(render(all, [span('2026-11-01', '2026-11-02')]), /Comparable · difference/);
  assert.match(render([day('2026-11-01', true), day('2026-11-02', false)], [span('2026-11-01', '2026-11-02')]), /Partially comparable: Forth reviewed for 1 of 2 days/);
  assert.match(render([day('2026-11-01', false), day('2026-11-02', false)], [span('2026-11-01', '2026-11-02')]), /Not comparable: no Forth day reviewed/);
  assert.match(render(all, [span('2026-10-01', '2026-10-05')]), /Unknown: the span lies outside the dates shown/);
  assert.match(render([day('2026-11-01', false)], [span('2026-11-01', '2026-11-01')], 'th'), /เทียบไม่ได้/);
  assert.doesNotMatch(render(all, [span('2026-11-01', '2026-11-02')]), /km\/L\s*[:=]\s*\d/, 'no fuel economy figure');
  assert.match(render([day('2026-11-01', false)], []), /not reviewed/);
});
