const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const file = path.resolve(__dirname, "../app/api/internal/fleet-monitor/route.ts");
let calls = 0;
const loaded = new Module(file, module);
loaded.paths = module.paths;
loaded.require = (request) => {
  if (request === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
  if (request === "@/lib/fleet-operations-monitor-server") {
    return {
      runFleetOperationsMonitor: async () => {
        calls += 1;
        return { status: "succeeded" };
      }
    };
  }
  if (request === "@/lib/ees-database-environment") {
    return require("../lib/ees-database-environment.cjs");
  }
  return require(request);
};
loaded._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  file
);

const STAGING_URL = "https://wpmnjfncaoogssgpqxek.supabase.co";
const PROD_URL = "https://hafoaurzfgkkwpvzedvd.supabase.co";
const SECRET = "12345678901234567890123456789012";
const DEPOT_ID = "cccccccc-dddd-4eee-8fff-000000000002";

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test("monitor route stays disabled and requires a long secret before any Forth polling", async () => {
  calls = 0;
  await withEnv(
    {
      EES_FLEET_MONITOR_ENABLED: undefined,
      EES_FLEET_MONITOR_SECRET: SECRET,
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      EES_FLEET_MONITOR_ALLOWED_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_APPROVED_STAGING_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS: DEPOT_ID
    },
    async () => {
      const request = new Request("https://ees.example/api/internal/fleet-monitor", {
        headers: { Authorization: `Bearer ${SECRET}` }
      });
      assert.equal((await loaded.exports.GET(request)).status, 503);
      process.env.EES_FLEET_MONITOR_ENABLED = "true";
      assert.equal((await loaded.exports.GET(new Request(request.url))).status, 401);
      assert.equal(calls, 0);
      assert.equal((await loaded.exports.GET(request)).status, 200);
      assert.equal(calls, 1);
    }
  );
});

test("monitor route refuses production or mismatched Supabase targets before monitor work", async () => {
  calls = 0;
  const request = new Request("https://ees.example/api/internal/fleet-monitor", {
    headers: { Authorization: `Bearer ${SECRET}` }
  });

  await withEnv(
    {
      EES_FLEET_MONITOR_ENABLED: "true",
      EES_FLEET_MONITOR_SECRET: SECRET,
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
      EES_FLEET_MONITOR_ALLOWED_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_APPROVED_STAGING_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS: DEPOT_ID
    },
    async () => {
      const response = await loaded.exports.GET(request);
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /approved staging project/i);
      assert.equal(calls, 0);
    }
  );

  await withEnv(
    {
      EES_FLEET_MONITOR_ENABLED: "true",
      EES_FLEET_MONITOR_SECRET: SECRET,
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      EES_FLEET_MONITOR_ALLOWED_PROJECT_REF: undefined,
      EES_APPROVED_STAGING_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS: DEPOT_ID
    },
    async () => {
      assert.equal((await loaded.exports.GET(request)).status, 503);
      assert.equal(calls, 0);
    }
  );

  await withEnv(
    {
      EES_FLEET_MONITOR_ENABLED: "true",
      EES_FLEET_MONITOR_SECRET: SECRET,
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      EES_FLEET_MONITOR_ALLOWED_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_APPROVED_STAGING_PROJECT_REF: "otherref1234567890ab",
      EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS: DEPOT_ID
    },
    async () => {
      assert.equal((await loaded.exports.GET(request)).status, 503);
      assert.equal(calls, 0);
    }
  );

  await withEnv(
    {
      EES_FLEET_MONITOR_ENABLED: "true",
      EES_FLEET_MONITOR_SECRET: SECRET,
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      EES_FLEET_MONITOR_ALLOWED_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_APPROVED_STAGING_PROJECT_REF: "wpmnjfncaoogssgpqxek",
      EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS: undefined
    },
    async () => {
      assert.equal((await loaded.exports.GET(request)).status, 503);
      assert.equal(calls, 0);
    }
  );
});
