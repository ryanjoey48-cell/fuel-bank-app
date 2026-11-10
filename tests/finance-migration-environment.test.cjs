"use strict";
/**
 * Finance V3 — migration environment safety guards (simulated env values only).
 * Does not touch remote databases or .env.local.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const guard = require("../lib/finance-migration-environment.cjs");
const issuance = (() => {
  // Load TS issuance gate via the shared invoice-compare helper when available.
  try {
    return require("./helpers/invoice-compare.cjs").lib("finance-issuance-gate.ts");
  } catch {
    return null;
  }
})();

const DEV = "wpmnjfncaoogssgpqxek";
const PROD = "hafoaurzfgkkwpvzedvd";
const DEV_URL = `https://${DEV}.supabase.co`;
const PROD_URL = `https://${PROD}.supabase.co`;

function baseOk(overrides = {}) {
  return {
    migrationTarget: "development",
    migrationMode: "dry-run",
    envFile: ".env.staging.local",
    supabaseUrl: DEV_URL,
    approvedStagingRef: DEV,
    ...overrides
  };
}

test("defaults to dry-run when mode omitted", () => {
  const resolution = guard.assertFinanceMigrationEnvironment(baseOk({ migrationMode: null }));
  assert.equal(resolution.mode, "dry-run");
  assert.equal(resolution.dryRun, true);
  assert.equal(resolution.applyAllowed, false);
  assert.equal(resolution.projectRef, DEV);
});

test("refuses production project ref under all circumstances", () => {
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ supabaseUrl: PROD_URL, approvedStagingRef: DEV })),
    (err) => err.code === "FINANCE_MIGRATION_PRODUCTION_REFUSED"
  );
  assert.throws(
    () =>
      guard.assertFinanceMigrationEnvironment(
        baseOk({ migrationTarget: "production", supabaseUrl: DEV_URL, approvedStagingRef: DEV })
      ),
    (err) => err.code === "FINANCE_MIGRATION_PRODUCTION_TARGET_REFUSED"
  );
  assert.throws(
    () =>
      guard.assertFinanceMigrationEnvironment(
        baseOk({ approvedStagingRef: PROD, supabaseUrl: DEV_URL })
      ),
    (err) => err.code === "FINANCE_MIGRATION_APPROVED_REF_PRODUCTION"
  );
});

test("requires explicit development project ref", () => {
  assert.throws(
    () =>
      guard.assertFinanceMigrationEnvironment(
        baseOk({ supabaseUrl: "https://unknownprojectxyz.supabase.co", approvedStagingRef: DEV })
      ),
    (err) => err.code === "FINANCE_MIGRATION_REF_UNKNOWN" || err.code === "FINANCE_MIGRATION_REF_MISMATCH"
  );
});

test("requires explicit staging environment selection", () => {
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ migrationTarget: null })),
    (err) => err.code === "FINANCE_MIGRATION_TARGET_REQUIRED"
  );
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ migrationTarget: "preview" })),
    (err) => err.code === "FINANCE_MIGRATION_TARGET_UNKNOWN"
  );
});

test("refuses missing environment identity", () => {
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ supabaseUrl: null })),
    (err) => err.code === "FINANCE_MIGRATION_URL_MISSING"
  );
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ envFile: null })),
    (err) => err.code === "FINANCE_MIGRATION_ENV_FILE_REQUIRED"
  );
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ approvedStagingRef: null })),
    (err) => err.code === "FINANCE_MIGRATION_APPROVED_REF_REQUIRED"
  );
});

test("refuses conflicting project refs", () => {
  assert.throws(
    () =>
      guard.assertFinanceMigrationEnvironment(
        baseOk({
          supabaseUrl: DEV_URL,
          approvedStagingRef: "kiewhxiwxmpijhlldlpm"
        })
      ),
    (err) =>
      err.code === "FINANCE_MIGRATION_APPROVED_REF_MISMATCH" ||
      err.code === "FINANCE_MIGRATION_CONFLICTING_REFS"
  );
});

test("refuses .env.local and production-linked env files", () => {
  assert.equal(guard.isForbiddenFinanceMigrationEnvFile(".env.local"), true);
  assert.equal(guard.isForbiddenFinanceMigrationEnvFile("tmp/.env.vercel.prod"), true);
  assert.equal(guard.isForbiddenFinanceMigrationEnvFile(".env.staging.local"), false);
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ envFile: ".env.local" })),
    (err) => err.code === "FINANCE_MIGRATION_ENV_FILE_FORBIDDEN"
  );
});

test("refuses accidental .env.local / process.env production fallback", () => {
  assert.throws(
    () =>
      guard.assertFinanceMigrationEnvironment(
        baseOk({
          accidentalLocalUrl: PROD_URL,
          accidentalLocalRef: PROD
        })
      ),
    (err) => err.code === "FINANCE_MIGRATION_ENV_LOCAL_FALLBACK_REFUSED"
  );
});

test("apply/write mode is hard-disabled even with valid development identity", () => {
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ migrationMode: "apply" })),
    (err) => err.code === "FINANCE_MIGRATION_APPLY_DISABLED"
  );
  assert.throws(
    () => guard.assertFinanceMigrationEnvironment(baseOk({ migrationMode: "migrate" })),
    (err) => err.code === "FINANCE_MIGRATION_APPLY_DISABLED"
  );
});

test("summary never includes secrets or full URLs", () => {
  const resolution = guard.assertFinanceMigrationEnvironment(baseOk());
  const summary = guard.financeMigrationEnvSummary(resolution);
  const blob = JSON.stringify(summary);
  assert.doesNotMatch(blob, /eyJ/);
  assert.doesNotMatch(blob, /service_role/i);
  assert.doesNotMatch(blob, /sb_publishable/);
  assert.equal(summary.projectRef, DEV);
  assert.equal(summary.applyAllowed, false);
});

test("CLI assert script refuses .env.local without reading secrets into stdout", () => {
  const script = path.join(__dirname, "..", "scripts", "assert-finance-migration-target.cjs");
  const refused = spawnSync(process.execPath, [script, "--env-file=.env.local", "--target=development"], {
    encoding: "utf8",
    cwd: path.join(__dirname, "..")
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr || refused.stdout, /Forbidden env file|refuse|FINANCE_MIGRATION/i);
  assert.doesNotMatch(refused.stdout + refused.stderr, /eyJ/);
  assert.doesNotMatch(refused.stdout + refused.stderr, /service_role/i);
});

test("CLI assert script accepts staging file when present (dry-run only)", () => {
  const staging = path.join(__dirname, "..", ".env.staging.local");
  if (!fs.existsSync(staging)) return;
  const script = path.join(__dirname, "..", "scripts", "assert-finance-migration-target.cjs");
  const run = spawnSync(
    process.execPath,
    [script, "--env-file=.env.staging.local", "--target=development", "--mode=dry-run"],
    { encoding: "utf8", cwd: path.join(__dirname, "..") }
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout);
  assert.equal(report.projectRef, DEV);
  assert.equal(report.applyAllowed, false);
  assert.equal(report.dryRun, true);
  assert.doesNotMatch(run.stdout, /eyJ/);
});

test("official issuance remains hard-disabled", () => {
  if (!issuance) return;
  assert.equal(issuance.isOfficialIssuanceEnabled(), false);
  const blocked = issuance.issuanceBlockedReasons();
  assert.ok(blocked.some((item) => item.id === "shared_storage"));
  assert.ok(blocked.some((item) => item.id === "official_trn_register"));
});

test("isolated development SQL stays outside supabase/migrations and refuses official issuance", () => {
  const sqlPath = path.join(
    __dirname,
    "..",
    "docs",
    "proposed",
    "PROPOSED-migration-finance-records-development-isolated.sql"
  );
  assert.ok(fs.existsSync(sqlPath));
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /NOT APPLIED/);
  assert.match(sql, /wpmnjfncaoogssgpqxek/);
  assert.match(sql, /hafoaurzfgkkwpvzedvd/);
  assert.match(sql, /amount_satang|total_satang|transport_amount_satang/);
  assert.match(sql, /FINANCE_OFFICIAL_ISSUANCE_DISABLED/);
  assert.match(sql, /finance_dev_clients/);
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /\bdrop table\b/i);
  const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
  if (fs.existsSync(migrationsDir)) {
    const names = fs.readdirSync(migrationsDir).join("\n");
    assert.doesNotMatch(names, /finance-records-development-isolated/);
  }
});
