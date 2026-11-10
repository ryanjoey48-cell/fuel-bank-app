const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = fs.readFileSync("lib/finance-ready-jobs.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("module", "exports", compiled)(loaded, loaded.exports);
const { loadFinanceReadyJobs } = loaded.exports;

function fixture({ verifications = [], bookings = [], clients = [], errorTable = "" } = {}) {
  const calls = [];
  const rows = { finance_job_verifications: verifications, booking_diary: bookings, clients };
  return {
    calls,
    from(table) {
      assert.ok(table in rows, table);
      const query = {
        select(fields) { calls.push([table, "select", fields]); return query; },
        eq(field, value) { calls.push([table, "eq", field, value]); return query; },
        order(field, options) { calls.push([table, "order", field, options]); return query; },
        async range(start, end) { calls.push([table, "range", start, end]); return { data: rows[table].slice(start, end + 1), error: table === errorTable ? new Error("permission denied") : null }; },
        async in(field, values) { calls.push([table, "in", field, values]); return { data: rows[table].filter((row) => values.includes(row[field])), error: table === errorTable ? new Error("permission denied") : null }; }
      };
      return query;
    }
  };
}
const verification = (booking_id, checked_at = "2026-10-31T00:00:00Z") => ({ booking_id, checked_at, checked_by: "office-user", revision: 2 });
const booking = (id, client_id = "customer-1") => ({ id, booking_id: `EES-${id}`, booking_date: "2026-10-30", client_id, pickup: "Depot", dropoff: "Port", vehicle_registration: "AB-1234", vehicle: "Legacy AB-1234", driver: "Driver One" });

test("matches multiple ready verifications to existing booking UUIDs and displays customer, route, vehicle and driver", async () => {
  const db = fixture({ verifications: [verification("uuid-b"), verification("uuid-a")], bookings: [booking("uuid-a"), booking("uuid-b", "customer-2")], clients: [{ id: "customer-1", name: "Customer One" }, { id: "customer-2", name: "Customer Two" }] });
  const jobs = await loadFinanceReadyJobs(db);
  assert.deepEqual(jobs.map((row) => row.booking_id), ["uuid-b", "uuid-a"]);
  assert.equal(jobs[0].booking.id, "uuid-b");
  assert.equal(jobs[0].booking.client_name, "Customer Two");
  assert.deepEqual([jobs[0].booking.pickup, jobs[0].booking.dropoff, jobs[0].booking.vehicle_registration, jobs[0].booking.driver], ["Depot", "Port", "AB-1234", "Driver One"]);
  assert.deepEqual(db.calls.find((call) => call[0] === "booking_diary" && call[1] === "select")[2], "id,booking_id,booking_date,client_id,pickup,dropoff,vehicle_registration,vehicle,driver");
  assert.ok(db.calls.some((call) => call[0] === "finance_job_verifications" && call[1] === "order" && call[2] === "checked_at" && call[3].ascending === false));
  assert.ok(db.calls.some((call) => call[0] === "finance_job_verifications" && call[1] === "order" && call[2] === "booking_id" && call[3].ascending === true));
});

test("omits missing, deleted or RLS-hidden bookings without disclosing their verification metadata", async () => {
  const db = fixture({ verifications: [verification("visible"), verification("deleted"), verification("hidden")], bookings: [booking("visible")], clients: [{ id: "customer-1", name: "Customer One" }] });
  const jobs = await loadFinanceReadyJobs(db);
  assert.deepEqual(jobs.map((row) => row.booking_id), ["visible"]);
  assert.ok(db.calls.some((call) => call[0] === "booking_diary" && call[1] === "in" && call[2] === "id"));
});

test("empty ready queue performs no booking or customer lookup", async () => {
  const db = fixture();
  assert.deepEqual(await loadFinanceReadyJobs(db), []);
  assert.ok(db.calls.every((call) => call[0] === "finance_job_verifications"));
});

test("paginates verification reads with stable sorting and chunks booking lookups", async () => {
  const ids = Array.from({ length: 501 }, (_, i) => `uuid-${i}`);
  const db = fixture({ verifications: ids.map((id) => verification(id)), bookings: ids.map((id) => booking(id)), clients: [{ id: "customer-1", name: "Customer One" }] });
  assert.equal((await loadFinanceReadyJobs(db)).length, 501);
  assert.deepEqual(db.calls.filter((call) => call[0] === "finance_job_verifications" && call[1] === "range").map((call) => call.slice(2)), [[0, 499], [500, 999]]);
  assert.deepEqual(db.calls.filter((call) => call[0] === "booking_diary" && call[1] === "in").map((call) => call[3].length), [100, 100, 100, 100, 100, 1]);
});

test("a denied read fails closed; the query and page contain no write or service-role path", async () => {
  await assert.rejects(loadFinanceReadyJobs(fixture({ verifications: [verification("uuid-a")], errorTable: "booking_diary" })), /permission denied/);
  await assert.rejects(loadFinanceReadyJobs(fixture({ verifications: [verification("uuid-a")], errorTable: "finance_job_verifications" })), /permission denied/);
  const page = fs.readFileSync("app/(dashboard)/finance-centre/page.tsx", "utf8");
  assert.match(page, /loadFinanceReadyJobs\(supabase\)/);
  assert.match(page, /item\.booking\.client_name/);
  assert.match(page, /item\.booking\.vehicle_registration/);
  assert.match(page, /item\.booking\.vehicle_registration \|\| item\.booking\.vehicle/);
  assert.match(page, /item\.booking\.driver/);
  assert.doesNotMatch(page + source, /booking:booking_diary|\.insert\(|\.update\(|\.delete\(|\.upsert\(|service_role|SERVICE_ROLE/);
});
