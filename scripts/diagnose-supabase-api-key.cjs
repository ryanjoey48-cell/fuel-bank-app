#!/usr/bin/env node
/**
 * Read-only Supabase API-key health check.
 * Does not print secret values.
 *
 * Usage: node scripts/diagnose-supabase-api-key.cjs
 *
 * Notes:
 * - GET /rest/v1/ (OpenAPI root) returning "Secret API key required" for a
 *   publishable key is expected platform behaviour, not proof the key is dead.
 * - A working publishable key must answer Auth health and password-token probes
 *   quickly (even with 4xx). Hanging with 0 bytes indicates a bad/disabled key
 *   or gateway fault for that exact key id.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function loadEnvLocal() {
  const file = path.resolve(".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local");
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

function shape(value) {
  if (!value) return { present: false };
  return {
    present: true,
    length: value.length,
    kind: value.startsWith("eyJ")
      ? "legacy_jwt"
      : value.startsWith("sb_publishable_")
        ? "publishable"
        : value.startsWith("sb_secret_")
          ? "secret"
          : "unknown",
    prefix: value.slice(0, 14),
    fingerprint: crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
  };
}

async function probe(url, init, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, ms: Date.now() - started, body: body.slice(0, 160) };
  } catch (error) {
    return { ok: false, status: null, ms: Date.now() - started, body: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const env = loadEnvLocal();
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const report = {
    checkedAt: new Date().toISOString(),
    urlHost: base ? new URL(base).host : null,
    anon: shape(anon),
    serviceRole: shape(env.SUPABASE_SERVICE_ROLE_KEY),
    probes: {},
    interpretation: []
  };

  if (!base || !anon) {
    console.log(JSON.stringify({ ...report, error: "missing_url_or_anon" }, null, 2));
    process.exitCode = 2;
    return;
  }

  const fakePublishable = "sb_publishable_DIAGNOSTIC_INVALID_KEY_XXXXXX";
  report.probes.healthNoKey = await probe(`${base}/auth/v1/health`);
  report.probes.healthFakePublishable = await probe(`${base}/auth/v1/health`, { headers: { apikey: fakePublishable } });
  report.probes.healthWithAnon = await probe(`${base}/auth/v1/health`, { headers: { apikey: anon } });
  report.probes.restRootWithAnon = await probe(`${base}/rest/v1/`, { headers: { apikey: anon, Accept: "application/json" } });
  report.probes.vehiclesWithAnon = await probe(`${base}/rest/v1/vehicles?select=id&limit=1`, {
    headers: { apikey: anon, Accept: "application/json" }
  });
  report.probes.tokenFakePassword = await probe(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "diagnose-invalid@example.com", password: "not-a-real-password" })
  });

  const openApiLocked =
    report.probes.restRootWithAnon.status === 401 &&
    /Secret API key required|schema is forbidden/i.test(report.probes.restRootWithAnon.body || "");
  if (openApiLocked) {
    report.interpretation.push("rest_root_openapi_locked_expected_for_publishable");
  }

  const fakeRejectedFast =
    report.probes.healthFakePublishable.status === 401 &&
    /Invalid API key/i.test(report.probes.healthFakePublishable.body || "");
  if (fakeRejectedFast) {
    report.interpretation.push("gateway_rejects_invalid_publishable_quickly");
  }

  const configuredHangs =
    report.probes.healthWithAnon.status == null ||
    report.probes.tokenFakePassword.status == null ||
    report.probes.vehiclesWithAnon.status == null;
  if (configuredHangs) {
    report.interpretation.push("configured_key_hangs_auth_or_rest_tables");
  }

  const healthOk = report.probes.healthWithAnon.status === 200;
  const tokenResponded = report.probes.tokenFakePassword.status != null;
  const vehiclesResponded = report.probes.vehiclesWithAnon.status != null;

  if (healthOk && tokenResponded && vehiclesResponded) {
    report.verdict = "PASS";
    report.ownerAction = null;
  } else if (configuredHangs && fakeRejectedFast) {
    report.verdict = "FAIL_CONFIGURED_PUBLISHABLE_KEY_HANGS_WHILE_INVALID_KEYS_401";
    report.ownerAction = {
      dashboard: `https://supabase.com/dashboard/project/${new URL(base).host.split(".")[0]}/settings/api-keys`,
      copy: "Publishable key (sb_publishable_…) under API Keys → Publishable and secret API keys. Prefer Create publishable key if the current default hangs.",
      updateEnvVars: [
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel Production",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel Preview",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel Development",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in local .env.local"
      ],
      note: "Publishable keys are valid. Do not assume a legacy eyJ anon JWT is required. Replace only the hanging key value."
    };
  } else {
    report.verdict = "FAIL_SUPABASE_AUTH_OR_REST_UNREACHABLE";
    report.ownerAction = {
      dashboard: `https://supabase.com/dashboard/project/${new URL(base).host.split(".")[0]}/settings/api-keys`,
      copy: "Confirm project is not paused, then verify the active publishable key.",
      updateEnvVars: ["NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel + .env.local if the Dashboard value differs"]
    };
  }

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verdict === "PASS" ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
