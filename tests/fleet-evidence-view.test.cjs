const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const { purchaseTotal, bangkokDateInput } = load('lib/fleet-evidence-view.ts');

test('purchase totals preserve unknown, zero and malformed source states', () => {
  assert.equal(purchaseTotal(null, 'purchasedLitres'), null);
  assert.equal(purchaseTotal([], 'purchasedLitres'), 0);
  for (const value of [null, undefined, -1, NaN, Infinity, '2']) {
    assert.equal(purchaseTotal([{ purchasedLitres: 1 }, { purchasedLitres: value }], 'purchasedLitres'), null);
  }
  assert.ok(Math.abs(purchaseTotal([{ purchasedLitres: 54.1 }, { purchasedLitres: 39.7 }], 'purchasedLitres') - 93.8) < 1e-10);
  assert.equal(purchaseTotal([{ costThb: 100 }, { costThb: 0 }], 'costThb'), 100);
});

test('date inputs follow Bangkok midnight independently of host timezone', () => {
  assert.equal(bangkokDateInput(new Date('2026-11-03T16:59:59Z')), '2026-11-03');
  assert.equal(bangkokDateInput(new Date('2026-11-03T17:00:00Z')), '2026-11-04');
});
