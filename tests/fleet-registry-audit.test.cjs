const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const audit = load('lib/fleet-registry-audit.ts');
const refs = (f, w, b) => ({ fuelLogs: f, weeklyMileage: w, bookings: b });
const run = (rows, tracked, references, aliases = []) => audit.classifyRegistry({ rows, trackedRegistrations: new Set(tracked), references: new Map(Object.entries(references)), aliasSources: new Set(aliases) });

test('registry classification is evidence based and conservative', () => {
  const rows = [{ id: 'a', vehicle_reg: '61-2835', active: true }, { id: 'b', vehicle_reg: '3ฒล-4565', active: true }, { id: 'c', vehicle_reg: '3ฒล 4565', active: true },
    { id: 'd', vehicle_reg: '12345', active: false }, { id: 'e', vehicle_reg: '99999', active: true }, { id: 'f', vehicle_reg: '6-782', active: true }, { id: 'g', vehicle_reg: '55555', active: true }];
  const f = Object.fromEntries(run(rows, ['612835', '3ฒล4565'], { a: refs(5, 5, 1), b: refs(1, 1, 1), c: refs(1, 1, 1), d: refs(2, 0, 0), e: refs(0, 0, 0), f: refs(0, 21, 0), g: refs(null, 0, 0) }).map(x => [x.vehicleId, x]));
  assert.equal(f.a.classification, 'confirmed_active');
  assert.equal(f.b.classification, 'duplicate_candidate'); assert.equal(f.c.classification, 'duplicate_candidate'); assert.equal(f.b.duplicateGroup, f.c.duplicateGroup);
  assert.equal(f.d.classification, 'inactive_historical');           // inactive with references is never called a test record
  assert.equal(f.e.classification, 'test_candidate');                // placeholder-style, untracked, zero references everywhere
  assert.equal(f.f.classification, 'unresolved'); assert.ok(f.f.reasons.includes('has_historical_references'));
  assert.equal(f.g.classification, 'unresolved'); assert.ok(f.g.reasons.includes('reference_counts_incomplete')); // unknown counts are not zero
  assert.deepEqual(audit.registryCounts(Object.values(f)), { confirmed_active: 1, inactive_historical: 1, duplicate_candidate: 2, test_candidate: 1, unresolved: 2 });
});

test('report statuses never infer inactive from missing data and flag shared registrations', () => {
  const s = audit.registryStatuses([{ id: 'a', vehicle_reg: 'AA-1', active: true }, { id: 'b', vehicle_reg: 'BB-2', active: false }, { id: 'c', vehicle_reg: 'CC-3' }, { id: 'd', vehicle_reg: 'DD-4', active: true }, { id: 'e', vehicle_reg: 'DD 4', active: true }]);
  assert.deepEqual([...s.values()], ['active', 'inactive', 'unknown', 'duplicate', 'duplicate']);
});

test('registry route and classifier are read-only', () => {
  const sources = ['app/api/admin/forth-tracking/evidence/registry/route.ts', 'lib/fleet-registry-audit.ts'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(sources, /\.(insert|update|upsert|delete|rpc)\(|method:\s*["'](POST|PUT|PATCH|DELETE)/);
  assert.match(sources, /head: true/);
});
