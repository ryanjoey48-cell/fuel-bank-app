const test = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./helpers/invoice-compare.cjs');
const perf = lib('vehicle-performance.ts');
const financial = lib('vehicle-performance-financial.ts');
const sources = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();

test('V10 701-5145 is not eligible in Jan/Feb 2026 and is eligible from March', () => {
  assert.equal(perf.isVehicleEligibleForPerformanceMonth('701-5145', 2026, 1), false);
  assert.equal(perf.isVehicleEligibleForPerformanceMonth('701-5145', 2026, 2), false);
  assert.equal(perf.isVehicleEligibleForPerformanceMonth('701-5145', 2026, 3), true);
  assert.equal(perf.isVehicleEligibleForPerformanceMonth('701-5145', 2026, 9), true);
  assert.equal(perf.isVehicleEligibleForPerformanceMonth('79-5318', 2026, 1), true);
});

test('V10 month-aware expected counts make Jan/Feb complete at 20 eligible vehicles', () => {
  const registrations = [
    '61-2835', '61-6672', '62-1085', '62-4337', '64-0359', '64-5954', '64-5956', '74-8969',
    '78-6996', '79-2945', '700-4145', '700-6659', '701-1654', '701-5145', '79-5318',
    '3ฒน-9565', '3ฒล-4565', 'ฒอ-8453', '63-3543', '64-8665', '68-7154'
  ];
  assert.equal(registrations.length, 21);
  assert.equal(perf.filterEligibleRegistrationsForMonth(registrations, 2026, 1).length, 20);
  assert.equal(perf.filterEligibleRegistrationsForMonth(registrations, 2026, 2).length, 20);
  assert.equal(perf.filterEligibleRegistrationsForMonth(registrations, 2026, 3).length, 21);
  assert.ok(!perf.filterEligibleRegistrationsForMonth(registrations, 2026, 1).some((reg) => /701-5145/.test(reg)));

  const januaryRecords = registrations
    .filter((reg) => perf.isVehicleEligibleForPerformanceMonth(reg, 2026, 1))
    .map((reg, index) => ({
      id: `jan-${index}`,
      user_id: null,
      vehicle_id: null,
      year: 2026,
      month: 1,
      vehicle_registration: reg,
      salary_cost: 1000,
      trip_income: 200,
      other_expenses: 50,
      gross_revenue: 10000,
      lpg_cost: 0,
      notes: '',
      created_at: '',
      updated_at: '',
      created_by: null,
      updated_by: null
    }));
  const rows = perf.buildVehicleMonthlyPerformanceRows({
    records: januaryRecords,
    fuelRows: januaryRecords.map((row) => ({
      vehicleRegistration: row.vehicle_registration,
      year: 2026,
      month: 1,
      fuelSpend: 100,
      fuelLogCount: 1
    })),
    months: [1],
    expectedVehicleCount: 21,
    expectedVehicleCountByMonth: { 1: 20 }
  });
  assert.equal(rows[0].vehicleCount, 20);
  assert.equal(rows[0].status, 'complete');
});

test('V10 financial baselines remain unchanged by eligibility rules', () => {
  const [august, september] = sources;
  assert.equal(financial.v6FleetHeroTotals(august).balanceBaht, 1805097);
  assert.equal(Number(financial.v6FleetHeroTotals(august).marginPercent.toFixed(2)), 50.39);
  assert.equal(Math.round(financial.v6FleetHeroTotals(september).balanceBaht * 100), 181408589);
  assert.equal(Number(financial.v6FleetHeroTotals(september).marginPercent.toFixed(2)), 47.5);
  assert.equal(august.rows.length, 21);
  assert.equal(september.rows.length, 21);
});
