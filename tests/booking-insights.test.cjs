const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const {
  TRIP_LINKING_WORKFLOW_START_DATE,
  aliasVehicleType,
  buildBookingBusinessInsights,
  normalizeRouteLabel,
  operationalRouteKey,
  reportingCustomerName
} = loadTypeScriptModule("lib/booking-insights.ts");

function booking({
  id,
  date,
  created = `${date}T02:00:00Z`,
  pickup = "Warehouse A",
  dropoff = "Port B",
  pickupTime = "08:30",
  vehicle = "6ล้อ",
  distance = null,
  driver = "Driver",
  customer = null,
  clientId = customer ? `client-${customer.trim().toLowerCase().replace(/\s+/g, "-")}` : null,
  notes = null
}) {
  return {
    id,
    booking_id: id,
    client_id: clientId,
    client: customer && clientId ? { id: clientId, name: customer, active: true } : null,
    booking_date: date,
    pickup_time: pickupTime,
    amount_pallets: null,
    weight: null,
    dimensions: null,
    pickup,
    warehouse_no: null,
    dropoff,
    estimated_distance_km: distance,
    job_order_number: null,
    vehicle,
    driver,
    notes,
    status: "booked",
    created_at: created,
    updated_at: created,
    created_by_user_id: null,
    created_by: null,
    modified_by: null
  };
}

function report(bookings, options = {}) {
  return buildBookingBusinessInsights(
    bookings,
    options.trips ?? new Map(),
    options.vehicles ?? [],
    options.drivers ?? [],
    options.period ?? { key: "all", startDate: null, endDate: null },
    options.today ?? "2026-07-17"
  );
}

test("reporting-period boundaries are inclusive and use the Bangkok business date key", () => {
  const result = report([
    booking({ id: "before", date: "2026-07-10" }),
    booking({ id: "start", date: "2026-07-11" }),
    booking({ id: "end", date: "2026-07-17" })
  ], { period: { key: "7d", startDate: null, endDate: null } });
  assert.deepEqual(result.selectedBookings.map((item) => item.id), ["start", "end"]);
  assert.deepEqual(result.selectedPeriod, { startDate: "2026-07-11", endDate: "2026-07-17" });
});

test("latest periods end on the latest available record instead of today's empty dates", () => {
  const result = report([
    booking({ id: "old", date: "2026-06-01" }),
    booking({ id: "latest", date: "2026-07-07" })
  ], {
    period: { key: "30d", startDate: null, endDate: null },
    today: "2026-07-20"
  });
  assert.equal(result.latestAvailableDate, "2026-07-07");
  assert.deepEqual(result.selectedPeriod, { startDate: "2026-06-08", endDate: "2026-07-07" });
  assert.deepEqual(result.selectedBookings.map((item) => item.id), ["latest"]);
});

test("route normalization merges harmless label variants and keeps reverse routes separate", () => {
  assert.equal(normalizeRouteLabel(" Bangkok  Warehouse. "), normalizeRouteLabel("bangkok-warehouse"));
  const forward = operationalRouteKey(booking({ id: "a", date: "2026-01-01", pickup: "A", dropoff: "B" }));
  const reverse = operationalRouteKey(booking({ id: "b", date: "2026-01-01", pickup: "B", dropoff: "A" }));
  assert.notEqual(forward, reverse);
});

test("repeat-route percentage counts bookings belonging to a repeated directional family", () => {
  const result = report([
    booking({ id: "a", date: "2026-01-01" }),
    booking({ id: "b", date: "2026-01-02", pickup: "Warehouse  A", dropoff: "Port B." }),
    booking({ id: "c", date: "2026-01-03", pickup: "Other", dropoff: "Port B" })
  ]);
  assert.equal(result.summary.repeatRoutePercent, 66.7);
});

test("same-day duplicates do not establish repeat-route work", () => {
  const result = report([
    booking({ id: "a", date: "2026-07-01" }),
    booking({ id: "b", date: "2026-07-01" }),
    booking({ id: "c", date: "2026-07-02", pickup: "Other", dropoff: "Lane" })
  ]);
  assert.equal(result.summary.repeatRoutePercent, 0);
  assert.equal(result.commonRoutes.length, 0);
});

test("new recurring opportunities require two bookings on separate dates after the baseline", () => {
  const result = report([
    booking({ id: "baseline", date: "2026-01-01", pickup: "Old", dropoff: "Route" }),
    booking({ id: "repeat-1", date: "2026-02-15", pickup: "New", dropoff: "Lane" }),
    booking({ id: "repeat-2", date: "2026-02-20", pickup: "New", dropoff: "Lane" }),
    booking({ id: "one-off", date: "2026-02-18", pickup: "Single", dropoff: "Lane" }),
    booking({ id: "same-day-1", date: "2026-02-19", pickup: "Same Day", dropoff: "Lane" }),
    booking({ id: "same-day-2", date: "2026-02-19", pickup: "Same Day", dropoff: "Lane" })
  ]);
  assert.equal(result.newRecurringRouteOpportunities.length, 1);
  assert.equal(result.newRecurringRouteOpportunities[0].bookings, 2);
  assert.equal(result.newRecurringRouteOpportunities[0].activeBookingDates, 2);
  assert.equal(result.newRecurringRouteOpportunities[0].status, "watch");
  assert.equal(result.oneOffNewRoutes.length, 1);
  assert.match(result.oneOffNewRoutes[0].friendlyName, /Single/);
});

test("vehicle aliases recognize safe Thai and English variants without guessing ambiguous values", () => {
  const aliases = new Map([
    ["6ล้อ", "SIX_WHEEL_TRUCK"],
    ["6 ล้อเฮียบ", "SIX_WHEEL_TRUCK"],
    ["6ล้อครอก", "SIX_WHEEL_TRUCK"],
    ["6ล้อพ่วง", "SIX_PLUS_SIX_WHEELER"],
    ["พ่วง6ล้อ", "SIX_PLUS_SIX_WHEELER"],
    ["พ่วง", "EIGHTEEN_WHEELER"],
    ["10ล้อพ่วง", "EIGHTEEN_WHEELER"],
    ["หัวลาก", "EIGHTEEN_WHEELER"],
    ["กระบะ", "FOUR_WHEEL_TRUCK"],
    ["pickup truck", "FOUR_WHEEL_TRUCK"]
  ]);
  for (const [value, expected] of aliases) assert.equal(aliasVehicleType(value), expected, value);
  for (const value of ["40", "40\"", "20", "10ล้อ", "คอก", "6ล้อสองคัน", "เก๋ง"]) {
    assert.equal(aliasVehicleType(value), null, value);
  }
});

test("missing pickup times stay out of demand bands and recent capture can improve", () => {
  const result = report([
    booking({ id: "old-missing", date: "2026-05-01", pickupTime: null }),
    booking({ id: "old-invalid", date: "2026-05-02", pickupTime: "TBC" }),
    booking({ id: "recent-valid-1", date: "2026-07-01", pickupTime: "08:30" }),
    booking({ id: "recent-valid-2", date: "2026-07-02", pickupTime: "14:00" })
  ]);
  assert.equal(result.validPickupTimeBookings, 2);
  assert.equal(result.missingPickupTimeBookings, 2);
  assert.equal(result.pickupTimeDemand.reduce((sum, item) => sum + item.count, 0), 2);
  assert.equal(result.pickupTimeCapture.trend, "improving");
});

test("upcoming workload uses Bangkok today and ignores the selected historical period", () => {
  const result = report([
    booking({ id: "historical", date: "2026-06-01" }),
    booking({ id: "today", date: "2026-07-20", driver: "", pickupTime: null }),
    booking({ id: "day7", date: "2026-07-26" }),
    booking({ id: "day8", date: "2026-07-27" }),
    booking({ id: "day14", date: "2026-08-02" }),
    booking({ id: "outside", date: "2026-08-03" })
  ], {
    today: "2026-07-20",
    period: { key: "custom", startDate: "2026-06-01", endDate: "2026-06-30" }
  });
  assert.equal(result.selectedBookings.length, 1);
  assert.equal(result.upcomingWorkload.next7Bookings, 2);
  assert.equal(result.upcomingWorkload.next14Bookings, 4);
  assert.equal(result.upcomingWorkload.missingDriverBookings, 1);
  assert.equal(result.upcomingWorkload.missingPickupTimeBookings, 1);
});

test("previous-period comparison uses an equal complete period", () => {
  const result = report([
    booking({ id: "p1", date: "2026-06-01" }),
    booking({ id: "p2", date: "2026-06-02" }),
    booking({ id: "c1", date: "2026-06-03" }),
    booking({ id: "c2", date: "2026-06-04" }),
    booking({ id: "c3", date: "2026-06-04" })
  ], { period: { key: "custom", startDate: "2026-06-03", endDate: "2026-06-04" } });
  assert.deepEqual(result.previousPeriod, { startDate: "2026-06-01", endDate: "2026-06-02" });
  assert.equal(result.summary.previousTotalBookings, 2);
  assert.equal(result.summary.bookingChangePercent, 50);
});

test("client grouping uses only the canonical relation and never infers names from notes", () => {
  const result = report([
    booking({ id: "a", date: "2026-06-01", customer: "ACME Co", clientId: "acme" }),
    booking({ id: "b", date: "2026-06-02", customer: "ACME Co", clientId: "acme" }),
    booking({ id: "c", date: "2026-06-03", customer: "ACME Company", clientId: "acme-company" }),
    booking({ id: "d", date: "2026-06-04", notes: "Customer: Beta Ltd" }),
    booking({ id: "e", date: "2026-06-05", notes: "Deliver urgently" })
  ]);
  assert.equal(result.customerActivity.length, 2);
  assert.equal(result.customerActivity.find((item) => item.key === "acme").bookings, 2);
  assert.equal(reportingCustomerName(booking({ id: "x", date: "2026-06-01", notes: "Deliver urgently" })), null);
});

test("client insights report upcoming workload and post-launch capture coverage", () => {
  const result = report([
    booking({ id: "legacy", date: "2026-07-19", created: "2026-07-19T02:00:00Z" }),
    booking({ id: "acme-1", date: "2026-07-20", created: "2026-07-20T02:00:00Z", customer: "ACME", clientId: "acme" }),
    booking({ id: "acme-2", date: "2026-07-21", created: "2026-07-20T03:00:00Z", customer: "ACME", clientId: "acme" }),
    booking({ id: "beta", date: "2026-07-22", created: "2026-07-20T04:00:00Z", customer: "Beta", clientId: "beta" })
  ], { today: "2026-07-20" });
  assert.equal(result.upcomingWorkload.topClients[0].name, "ACME");
  assert.equal(result.upcomingWorkload.topClients[0].next7Bookings, 2);
  assert.deepEqual(result.clientCoverage.createdSinceLaunch, { captured: 3, total: 3, percent: 100 });
  assert.equal(result.summary.topUpcomingClient, "ACME");
});

test("regular clients without activity require repeat history on separate dates", () => {
  const result = report([
    booking({ id: "old-1", date: "2026-05-01", customer: "Dormant Co", clientId: "dormant" }),
    booking({ id: "old-2", date: "2026-05-10", customer: "Dormant Co", clientId: "dormant" }),
    booking({ id: "one-off", date: "2026-05-02", customer: "One Off", clientId: "one-off" }),
    booking({ id: "recent", date: "2026-07-20", customer: "Current Co", clientId: "current" })
  ], { today: "2026-07-20" });
  assert.deepEqual(result.regularCustomersWithoutRecentActivity.map((client) => client.name), ["Dormant Co"]);
});

test("route opportunity strength uses active dates and ranks active patterns first", () => {
  const rows = [booking({ id: "base", date: "2026-01-01", pickup: "Base", dropoff: "Route" })];
  for (let day = 1; day <= 5; day += 1) rows.push(booking({ id: `strong-${day}`, date: `2026-03-0${day}`, pickup: "Strong", dropoff: "Lane" }));
  for (let day = 1; day <= 3; day += 1) rows.push(booking({ id: `grow-${day}`, date: `2026-03-1${day}`, pickup: "Grow", dropoff: "Lane" }));
  const result = report(rows);
  assert.equal(result.newRecurringRouteOpportunities[0].status, "strong_pattern");
  assert.equal(result.newRecurringRouteOpportunities[1].status, "growing");
});

test("weekday demand includes average per weekday occurrence", () => {
  const result = report([
    booking({ id: "m1", date: "2026-07-06" }),
    booking({ id: "m2", date: "2026-07-06" }),
    booking({ id: "m3", date: "2026-07-13" }),
    booking({ id: "t1", date: "2026-07-07" }),
    booking({ id: "t2", date: "2026-07-07" })
  ], { period: { key: "custom", startDate: "2026-07-06", endDate: "2026-07-19" } });
  const monday = result.weekdayDemand.find((item) => item.label === "Monday");
  const tuesday = result.weekdayDemand.find((item) => item.label === "Tuesday");
  assert.deepEqual({ count: monday.count, occurrences: monday.occurrences, average: monday.averagePerOccurrence }, { count: 3, occurrences: 2, average: 1.5 });
  assert.deepEqual({ count: tuesday.count, occurrences: tuesday.occurrences, average: tuesday.averagePerOccurrence }, { count: 2, occurrences: 2, average: 1 });
  assert.equal(result.summary.busiestWeekday, "Monday");
});

test("Trip coverage uses only the dependable foreign key and post-workflow cohort", () => {
  const old = booking({ id: "old", date: "2026-07-01", created: "2026-06-29T23:59:59Z" });
  const eligible = booking({ id: "eligible", date: "2026-07-02", created: "2026-06-30T00:00:00Z" });
  const future = booking({ id: "future", date: "2026-07-20", created: "2026-07-01T00:00:00Z" });
  const result = report([old, eligible, future], { trips: new Map([["eligible", { id: "trip" }]]) });
  assert.equal(TRIP_LINKING_WORKFLOW_START_DATE, "2026-06-30");
  assert.equal(result.tripCoverage.eligibleBookings, 1);
  assert.equal(result.tripCoverage.linkedEligibleBookings, 1);
  assert.equal(result.tripCoverage.historicalBookingsExcluded, 1);
  assert.equal(result.tripCoverage.percent, 100);
});

test("empty input returns stable zero and empty states", () => {
  const result = report([]);
  assert.equal(result.summary.totalBookings, 0);
  assert.equal(result.commonRoutes.length, 0);
  assert.equal(result.newRecurringRouteOpportunities.length, 0);
  assert.equal(result.tripCoverage.percent, null);
  assert.equal(result.upcomingWorkload.next14Bookings, 0);
  assert.equal(result.customerDataAvailable, false);
});

test("Business Insights includes English, Thai, two views, and both print contracts", () => {
  const component = fs.readFileSync(path.resolve("components/booking-business-insights.tsx"), "utf8");
  const styles = fs.readFileSync(path.resolve("app/globals.css"), "utf8");
  assert.match(component, /Manager Overview/);
  assert.match(component, /ภาพรวมผู้บริหาร/);
  assert.match(component, /Upcoming workload/);
  assert.match(component, /งานที่กำลังจะมาถึง/);
  assert.match(component, /Print Manager Summary/);
  assert.match(component, /Print Full Report/);
  assert.match(component, /generatedAt/);
  assert.match(component, /booking-insights-print-full-page/);
  assert.match(styles, /@page\s*\{[\s\S]*A4 landscape/);
  assert.match(styles, /booking-insights-print-columns-three/);
});
