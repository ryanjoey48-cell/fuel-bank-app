const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(
  join(__dirname, "..", "components", "finance-booking-diary-picker.tsx"),
  "utf8"
);

test("picker paginates Booking Diary instead of truncating to a recent-only window", () => {
  assert.match(source, /PAGE_SIZE\s*=\s*1000/);
  assert.match(source, /\.range\(from,\s*from \+ PAGE_SIZE - 1\)/);
  assert.doesNotMatch(source, /\.limit\(300\)/);
});

test("picker applies inclusive booking_date filters server-side", () => {
  assert.match(source, /\.gte\("booking_date",\s*dateFrom\)/);
  assert.match(source, /\.lte\("booking_date",\s*dateTo\)/);
});

test("empty state does not claim ineligibility when the query simply returned no rows", () => {
  assert.doesNotMatch(source, /No eligible bookings found/);
  assert.match(source, /No Booking Diary jobs in this date range/);
});

test("office date display helper uses DD\/MM\/YYYY from ISO calendar dates", () => {
  assert.match(source, /formatDiaryDateDisplay/);
  assert.match(source, /\$\{day\}\/\$\{month\}\/\$\{year\}/);
});

test("picker uses a master-detail card list instead of a wide horizontally scrolling table", () => {
  assert.doesNotMatch(source, /min-w-\[720px\]/);
  assert.doesNotMatch(source, /<table/);
  assert.match(source, /Booking details/);
  assert.match(source, /Open existing reconciliation/);
  assert.match(source, /Save Job & Work Order/);
  assert.match(source, /Available only/);
});
