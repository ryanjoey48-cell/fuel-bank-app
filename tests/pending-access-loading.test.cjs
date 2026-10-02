const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");

function loadRoute(file, admin) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const dependencies = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, headers: options?.headers }) } },
    "@/lib/admin-user-management-server": {
      AdminApiError,
      requireAdminAccess: async () => ({ admin, user: { id: "verified-admin" } }),
      canReviewAccessRequests: () => false
    }
  };
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(dependencies[name], `Unexpected import ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

test("pending rows with null review fields load independently of driver failures", async () => {
  const calls = [];
  const rows = ["driver", "office_staff"].map((type) => ({
    id: type, auth_user_id: type, full_name: "Pending applicant", email: `${type}@example.com`,
    phone: "0928936516", requested_account_type: type, status: "pending",
    requested_at: "2026-10-01T00:00:00Z", reviewed_at: null, linked_driver_id: null, rejection_reason: null
  }));
  const admin = { from(table) {
    calls.push(table);
    if (table === "drivers") throw new Error("Driver service unavailable");
    return { select() { return this; }, eq(field, value) {
      assert.equal(field, "status"); assert.equal(value, "pending"); return this;
    }, order: async () => ({ data: rows, error: null }) };
  } };
  const route = loadRoute("app/api/admin/driver-access-requests/route.ts", admin);
  const result = await route.GET(new Request("http://localhost/api/admin/driver-access-requests"));
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["driver_access_requests"]);
  assert.deepEqual(result.body.requests.map((row) => row.requestedAccountType), ["driver", "office_staff"]);
  assert.equal(result.body.requests[0].linkedDriverId, null);
  assert.equal(result.body.canReview, false);
  assert.equal(result.body.drivers, undefined);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(route.dynamic, "force-dynamic");
});

for (const [result, expected] of [
  [{ data: null, error: null }, 500],
  [{ data: null, error: { code: "", message: "TypeError: fetch failed" } }, 503],
  [{ data: null, error: { code: "PGRST205", message: "Table unavailable" } }, 503],
  [{ data: [], error: null }, 200]
]) {
  test(`pending API returns ${expected} for ${JSON.stringify(result)} without fabricating an empty success`, async () => {
    const admin = { from() { return {
      select() { return this; }, eq() { return this; }, order: async () => result
    }; } };
    const route = loadRoute("app/api/admin/driver-access-requests/route.ts", admin);
    const response = await route.GET(new Request("http://localhost/api/admin/driver-access-requests"));
    assert.equal(response.status, expected);
    if (expected === 200) assert.deepEqual(response.body.requests, []);
    else { assert.ok(response.body.error); assert.equal(response.body.requests, undefined); }
  });
}

test("request query failures return an API error rather than a successful empty list", async () => {
  const admin = { from() { return {
    select() { return this; }, eq() { return this; },
    order: async () => ({ data: null, error: { code: "XX000", message: "Unavailable" } })
  }; } };
  const route = loadRoute("app/api/admin/driver-access-requests/route.ts", admin);
  const result = await route.GET(new Request("http://localhost/api/admin/driver-access-requests"));
  assert.equal(result.status, 500);
  assert.ok(result.body.error);
  assert.equal(result.body.requests, undefined);
});

test("independent driver failures return an error for the selector", async () => {
  const admin = { from(table) {
    assert.equal(table, "drivers");
    return { select() { return this; }, eq(field, value) {
      assert.equal(field, "active"); assert.equal(value, true); return this;
    }, order: async () => ({ data: null, error: { message: "Unavailable" } }) };
  } };
  const route = loadRoute("app/api/admin/driver-access-requests/drivers/route.ts", admin);
  const result = await route.GET(new Request("http://localhost/api/admin/driver-access-requests/drivers"));
  assert.equal(result.status, 503);
  assert.match(result.body.error, /active drivers/);
});
