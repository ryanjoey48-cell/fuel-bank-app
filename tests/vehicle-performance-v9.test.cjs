const test = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./helpers/invoice-compare.cjs');
const f = lib('vehicle-performance-financial.ts');
const sources = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();

test('V9 August/September baselines remain exact under owner-approved convention', () => {
  const [august, september] = sources;
  const aug = f.v6FleetHeroTotals(august);
  const sep = f.v6FleetHeroTotals(september);
  assert.equal(aug.revenueBaht, 3581914);
  assert.equal(Math.round(aug.balanceBaht * 100), 180509700);
  assert.equal(Number(aug.marginPercent.toFixed(2)), 50.39);
  assert.equal(aug.vehicleCount, 21);
  assert.equal(aug.provisional, false);
  assert.equal(sep.revenueBaht, 3819401);
  assert.equal(Math.round(sep.balanceBaht * 100), 181408589);
  assert.equal(Number(sep.marginPercent.toFixed(2)), 47.5);
  assert.equal(sep.vehicleCount, 21);
});

test('V9 combined Aug+Sep projection keeps 21 unique vehicles with finite balances', () => {
  const projected = f.v6ReportsAsDashboardProjection(sources, [8, 9]);
  assert.equal(projected.records.length, 42);
  const unique = new Set(projected.meta.map(row => row.registration));
  assert.equal(unique.size, 21);
  assert.ok(projected.meta.every(row => Number.isFinite(row.recordedBalanceBaht)));
  const review = projected.meta.filter(row => row.status === 'review');
  assert.ok(review.every(row => /4565/.test(row.registration)));
  const augustFleet = f.operationalFleetFinancials(sources[0]);
  const septemberFleet = f.operationalFleetFinancials(sources[1]);
  assert.equal(augustFleet.balance, 180509700);
  assert.equal(septemberFleet.balance, 181408589);
  assert.equal(augustFleet.balance + septemberFleet.balance, 361918289);
  const vehicleSumSatang = projected.meta.reduce((sum, row) => sum + Math.round(row.recordedBalanceBaht * 100), 0);
  assert.ok(Math.abs(vehicleSumSatang - (augustFleet.balance + septemberFleet.balance)) <= projected.meta.length);
});

test('V9 blank costs never rewrite source while still contributing zero', () => {
  for (const report of sources) {
    const fleet = f.operationalFleetFinancials(report);
    assert.equal(fleet.incompleteCount, 0);
    assert.equal(fleet.provisional, false);
    for (const row of report.rows) {
      const metrics = f.reportedVehicleFinancials(row);
      assert.ok(Number.isFinite(metrics.balance));
      for (const field of f.COST_FIELDS) {
        if (row.cells[field].status === 'unknown') {
          assert.equal(row.cells[field].value, null);
          assert.equal(f.contributionSatang(row.cells[field]), 0);
        }
      }
    }
  }
});

test('V9 methodology notes remain non-audited wording', () => {
  assert.match(f.OWNER_REPORTING_NOTE_EN, /does not verify/i);
  assert.doesNotMatch(f.OWNER_REPORTING_NOTE_EN, /audited net profit/i);
});
