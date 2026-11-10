const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const centre = read('components/forth-tracking-centre.tsx');
const panel = read('components/fleet-evidence-panel.tsx');
const bar = read('components/fleet-workspace-bar.tsx');

test('V7.1: the live map grid renders only for Live Fleet or an on-demand route map', () => {
  assert.match(centre, /const showMapShell = intelligenceSection === "live" \|\| routeMapOpen;/);
  assert.match(centre, /\{showMapShell \? \(\s*<div className="forth-tracking-grid">/);
  const shell = centre.slice(centre.indexOf('<div className="v71-shell"'));
  assert.doesNotMatch(shell.slice(0, shell.indexOf('speedConfigOpen')), /<ForthTrackingMap/, 'no map in the four full-width workspaces');
  assert.equal((centre.match(/<ForthTrackingMap/g) ?? []).length, 1, 'one map instance');
});

test('V7.1: one workspace navigation, five destinations, shared handler', () => {
  for (const id of ['live', 'daily', 'journeys', 'fuel', 'reports']) assert.ok(centre.includes(`"${id}"`), id);
  assert.match(centre, /const WORKSPACE_IDS = \["live", "daily", "journeys", "fuel", "reports"\]/);
  assert.equal((centre.match(/className="v7-workspace-nav"/g) ?? []).length, 1, 'no second workspace menu');
});

test('V7.1: switching workspaces never starts a read; the vehicle and date scope are kept', () => {
  const fn = centre.slice(centre.indexOf('const goWorkspace = '), centre.indexOf('const chooseWorkspaceVehicle'));
  assert.doesNotMatch(fn, /fetch\(|loadEesFleetIdentities|refreshRef|void load|read\(/);
  assert.doesNotMatch(fn, /setSelectedKey\(null\)|setEvidenceScope/, 'selection and scope survive');
  assert.match(centre, /initialScope=\{evidenceScope\} onScopeChange=\{setEvidenceScope\}/);
  assert.match(panel, /initialScope\?: EvidenceScope \| null/);
  assert.doesNotMatch(panel.slice(panel.indexOf('const seed ='), panel.indexOf('const [data, setData]')), /load\(\)/, 'seeding the scope does not read');
});

test('V7.1: duplicate registry registrations cannot be chosen, and the selector never reads evidence', () => {
  assert.match(bar, /disabled=\{option\.ambiguous\}/);
  assert.doesNotMatch(bar, /fetch\(|supabase/);
  assert.match(centre, /ambiguous: \(counts\.get\(/);
});

test('V7.1: the live drawer is a compact summary that opens the workspaces and keeps GPS Health reachable', () => {
  assert.doesNotMatch(centre, /<FleetEvidencePanel[\s\S]{0,80}detailSection/, 'the narrow drawer no longer hosts the evidence panel');
  for (const label of ['View activity', 'View journeys', 'View fuel', 'GPS health']) assert.ok(centre.includes(label), label);
  assert.match(centre, /const gpsHealthNode = selectedRecord \? \(/);
  assert.match(panel, /data-daily-health/, 'GPS health is also reachable inside Daily Activity');
});

test('V7.1: route map is on demand and keeps the existing supervised playback panel', () => {
  // V7.8: the open function may also pre-fill a movement's time window, but it still only opens the supervised panel (no read of its own).
  assert.match(centre, /const openRouteMap = \(range\?: unknown\) => \{[\s\S]*?setRouteMapOpen\(true\); enterPlayback\(\);\n  \};/);
  assert.doesNotMatch(centre.slice(centre.indexOf('const openRouteMap'), centre.indexOf('const leaveRouteMap')), /fetch\(/);
  assert.match(centre, /onOpenPlayback=\{openRouteMap\}/);
  assert.match(centre, /<ForthJourneyPlaybackPanel/);
  assert.match(panel, /journeyAccess === "granted" && onOpenPlayback/, 'playback is still gated by the server-granted journey access');
});

test('V7.1: Journeys & Jobs works without bookings and labels jobs as optional', () => {
  assert.match(panel, /isJJ \? <p className="fleet-evidence-note v71-jobs-lead">/);
  assert.match(panel, /Journeys above work without bookings/);
});
