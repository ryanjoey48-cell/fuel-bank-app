#!/usr/bin/env node
/**
 * Fail-closed identity check for future Finance migration tools.
 * Defaults to dry-run. Never applies SQL. Never prints secrets.
 *
 * Usage:
 *   node scripts/assert-finance-migration-target.cjs --env-file=.env.staging.local
 *   EES_FINANCE_MIGRATION_TARGET=development EES_FINANCE_MIGRATION_MODE=dry-run \
 *     node scripts/assert-finance-migration-target.cjs --env-file=.env.staging.local
 *
 * Refuses:
 *   --env-file=.env.local
 *   production project ref
 *   missing / conflicting staging refs
 *   apply/write mode (hard-disabled)
 *   falling back to process.env when --env-file is omitted
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertFinanceMigrationEnvironment,
  financeMigrationEnvSummary,
  FINANCE_MIGRATION_TARGET_ENV,
  FINANCE_MIGRATION_MODE_ENV,
  FINANCE_MIGRATION_ENV_FILE_ENV,
  isForbiddenFinanceMigrationEnvFile
} = require("../lib/finance-migration-environment.cjs");

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${path.relative(process.cwd(), filePath).replace(/\\/g, "/")}`);
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseArgs(argv) {
  let envFile = null;
  let mode = null;
  let target = null;
  for (const arg of argv) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
    else if (arg.startsWith("--mode=")) mode = arg.slice("--mode=".length);
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "assert-finance-migration-target.cjs",
          "  --env-file=.env.staging.local   (required; .env.local refused)",
          "  --target=development           (or set EES_FINANCE_MIGRATION_TARGET)",
          "  --mode=dry-run|read-only       (apply refused)"
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return { envFile, mode, target };
}

function main() {
  const { envFile: argFile, mode: argMode, target: argTarget } = parseArgs(process.argv.slice(2));
  const envFile = argFile || process.env[FINANCE_MIGRATION_ENV_FILE_ENV] || null;

  if (!envFile) {
    throw new Error(
      `Missing --env-file / ${FINANCE_MIGRATION_ENV_FILE_ENV}. Refusing to fall back to .env.local or process.env alone.`
    );
  }
  if (isForbiddenFinanceMigrationEnvFile(envFile)) {
    throw new Error("Forbidden env file for Finance migration (production-linked).");
  }

  const resolved = path.resolve(process.cwd(), envFile);
  const fileEnv = loadEnvFile(resolved);

  // Intentionally do NOT merge process.env.NEXT_PUBLIC_SUPABASE_URL — that would
  // reintroduce the .env.local production fallback this guard exists to prevent.
  const resolution = assertFinanceMigrationEnvironment({
    migrationTarget: argTarget || process.env[FINANCE_MIGRATION_TARGET_ENV] || fileEnv[FINANCE_MIGRATION_TARGET_ENV] || "development",
    migrationMode: argMode || process.env[FINANCE_MIGRATION_MODE_ENV] || fileEnv[FINANCE_MIGRATION_MODE_ENV] || "dry-run",
    envFile: path.relative(process.cwd(), resolved).replace(/\\/g, "/") || envFile,
    supabaseUrl: fileEnv.NEXT_PUBLIC_SUPABASE_URL,
    approvedStagingRef: fileEnv.EES_APPROVED_STAGING_PROJECT_REF
  });

  console.log(JSON.stringify(financeMigrationEnvSummary(resolution), null, 2));
}

try {
  main();
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  // Never dump env objects or keys.
  console.error(message);
  process.exit(1);
}
