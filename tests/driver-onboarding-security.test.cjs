const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");

const joey = "6b36f383-28e0-48aa-99a0-c1e655d6c3f7";
test("login distinguishes required email confirmation from invalid credentials", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "components/auth-form.tsx"), "utf8");
  const parsed = ts.createSourceFile("auth-form.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ["bilingualSignInError", "isInvalidCredentialError"].includes(node.name?.text));
  const js = ts.transpileModule(functions.map((node) => node.getText(parsed)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  const message = new Function(`${js}\nreturn bilingualSignInError;`)();
  assert.match(message("Email not confirmed"), /confirm your email.*signup confirmation link/i);
  assert.match(message("Invalid login credentials"), /check your email and password/i);
  assert.match(message("Network failed"), /try again/i);
});
function load(file, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(dependencies[name], `Unexpected import ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
class DriverPortalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const next = { NextResponse: { json(body, options) {
  return { body, status: options?.status ?? 200, cookies: { set() {} } };
} } };

for (const failure of ["throw", "retryable", "invalid-token", "unexpected"]) {
  test(`server auth distinguishes ${failure} from an authorization decision`, async () => {
    const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
    const previous = keys.map((key) => process.env[key]);
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
      const server = load("lib/admin-user-management-server.ts", {
        "@supabase/supabase-js": { createClient: () => ({ auth: { getUser: async () => {
          if (failure === "throw") throw new TypeError("fetch failed");
          if (failure === "unexpected") throw new Error("Unexpected verification failure");
          return { data: { user: null }, error: failure === "retryable"
            ? { name: "AuthRetryableFetchError", status: 0 }
            : { name: "AuthApiError", status: 401 } };
        } } }) },
        "@/lib/authorization": {}
      });
      await assert.rejects(server.requireVerifiedUser(new Request("http://localhost/api/admin/driver-access-requests", {
        headers: { authorization: "Bearer test-token" }
      })), (error) => error.status === (failure === "invalid-token" ? 401 : failure === "unexpected" ? 500 : 503));
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
      });
    }
  });
}

test("admin verification uses public auth then a separate service client without the browser JWT", async () => {
  const previous = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-test-key";
    const created = [];
    const server = load("lib/admin-user-management-server.ts", {
      "@supabase/supabase-js": { createClient(url, key, options) {
        created.push({ url, key, options });
        if (key === "public-test-key") return { auth: { getUser: async (token) => {
          assert.equal(token, "browser-session");
          return { data: { user: { id: joey, email: "admin@example.com" } }, error: null };
        } } };
        return { from(table) { return {
          select() { return this; }, eq() { return this; },
          maybeSingle: async () => ({ data: table === "driver_accounts" ? null : {
            user_id: joey, role: "admin", status: "active"
          }, error: null })
        }; } };
      } },
      "@/lib/authorization": {
        isActiveAdmin: (access) => access.role === "admin" && access.status === "active",
        normalizeAccountRole: (role) => role, normalizeAccountStatus: (status) => status
      }
    });
    const result = await server.requireAdminAccess(new Request("http://localhost/api/admin/driver-access-requests", {
      headers: { authorization: "Bearer browser-session" }
    }));
    assert.equal(result.user.id, joey);
    assert.deepEqual(created.map((client) => client.key), ["public-test-key", "server-test-key"]);
    assert.ok(created.every((client) => !client.options.global?.headers?.Authorization));
    assert.ok(created.every((client) => client.options.auth.persistSession === false));
    assert.ok(created.every((client) => client.options.auth.autoRefreshToken === false));
    global.fetch = async (input, init) => {
      assert.equal(input, "https://example.invalid/rest/v1/driver_access_requests");
      assert.equal(init.cache, "no-store");
      assert.equal(init.headers.apikey, "server-test-key");
      return new Response("[]");
    };
    await created[1].options.global.fetch("https://example.invalid/rest/v1/driver_access_requests", {
      cache: "force-cache", headers: { apikey: "server-test-key" }
    });
  } finally {
    global.fetch = originalFetch;
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

for (const type of ["driver", "office_staff"]) {
  test(`${type} review ignores browser-supplied reviewer UUIDs and uses the verified admin`, async () => {
    let args;
    const route = load("app/api/admin/driver-access-requests/[id]/route.ts", {
      "next/server": next,
      "@/lib/admin-user-management-server": {
        AdminApiError,
        requireAdminAccess: async () => ({ user: { id: joey }, admin: { rpc(name, payload) {
          assert.equal(name, "review_driver_access_request"); args = payload;
          return { single: async () => ({ data: {
            id: "request", requested_account_type: type, status: "approved", reviewed_at: "2026-10-02T00:00:00Z"
          }, error: null }) };
        } } }),
        requireAccessRequestApprover: (id) => assert.equal(id, joey)
      }
    });
    const result = await route.PATCH(new Request("http://localhost/api/admin/driver-access-requests/request", {
      method: "PATCH", body: JSON.stringify({ decision: "approved", ...(type === "driver" ? { driverId: "11" } : {}),
        reviewed_by: "forged", user_id: "forged", admin_id: "forged", p_reviewed_by: "forged" })
    }), { params: Promise.resolve({ id: "request" }) });
    assert.equal(result.status, 200);
    assert.equal(args.p_reviewed_by, joey);
    assert.equal(args.p_linked_driver_id, type === "driver" ? "11" : null);
    assert.equal(result.body.request.status, "approved");
  });
}

test("unauthorized reviewer is rejected before the review RPC runs", async () => {
  const route = load("app/api/admin/driver-access-requests/[id]/route.ts", {
    "next/server": next,
    "@/lib/admin-user-management-server": {
      AdminApiError,
      requireAdminAccess: async () => ({ user: { id: "other-admin" }, admin: { rpc() { assert.fail("Review RPC must not run"); } } }),
      requireAccessRequestApprover: () => { throw new AdminApiError(403, "Only Joey can review"); }
    }
  });
  const result = await route.PATCH(new Request("http://localhost/api/admin/driver-access-requests/request", {
    method: "PATCH", body: JSON.stringify({ decision: "approved", driverId: "11", reviewed_by: joey })
  }), { params: Promise.resolve({ id: "request" }) });
  assert.equal(result.status, 403);
});

function routing(serverOverrides = {}, driverOverrides = {}) {
  return load("app/api/auth/login-routing/route.ts", {
    "next/server": next,
    "@/lib/admin-user-management-server": {
      AdminApiError, requireVerifiedUser: async () => ({ id: "driver-user" }),
      createServerSupabaseAdmin: () => ({}), findActiveDriverAccount: async () => null,
      findDriverAccessRequest: async () => null, resolveAccountAccess: async () => ({}), ...serverOverrides
    },
    "@/lib/driver-portal-server": {
      DriverPortalError, DRIVER_SESSION_COOKIE: "ees_driver_session", DRIVER_SESSION_MAX_AGE_SECONDS: 60,
      createDriverPortalSessionForAuthUser: async () => ({ token: "opaque-cookie" }), ...driverOverrides
    }
  });
}
for (const status of [401, 403, 503]) {
  test(`login routing preserves explicit ${status} instead of treating all failures as invalid login`, async () => {
    const route = routing({ requireVerifiedUser: async () => { throw new AdminApiError(status, "Verification failed"); } });
    assert.equal((await route.POST(new Request("http://localhost/api/auth/login-routing"))).status, status);
  });
}
test("unexpected login database failures return 500", async () => {
  const route = routing({ findActiveDriverAccount: async () => { throw new Error("Database failed"); } });
  assert.equal((await route.POST(new Request("http://localhost/api/auth/login-routing"))).status, 500);
});
test("active driver linkage wins over office access and routes only to /driver", async () => {
  const route = routing({
    findActiveDriverAccount: async () => ({ driver_id: 11, active: true }),
    resolveAccountAccess: async () => assert.fail("Office resolver must not run for an active driver")
  });
  const response = await route.POST(new Request("http://localhost/api/auth/login-routing"));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { accountType: "driver", destination: "/driver" });
});
