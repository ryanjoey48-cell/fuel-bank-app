#!/usr/bin/env node
/**
 * Refuse experimental / review-only SQL helpers when the target URL is production
 * or does not match EES_APPROVED_STAGING_PROJECT_REF.
 *
 * Usage:
 *   node scripts/assert-staging-sql-target.cjs
 *   node scripts/assert-staging-sql-target.cjs --env-file=.env.staging.local
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  extractSupabaseProjectRef,
  assertNotConfirmedProductionForExperimentalSql,
  assertApprovedStagingTarget
} = require("../lib/ees-database-environment.cjs");

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function parseArgs(argv) {
  let envFile = ".env.staging.local";
  for (const arg of argv) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  return { envFile };
}

function main() {
  const { envFile } = parseArgs(process.argv.slice(2));
  const resolved = path.resolve(process.cwd(), envFile);
  const fileEnv = loadEnvFile(resolved);
  const url = fileEnv.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const approved =
    fileEnv.EES_APPROVED_STAGING_PROJECT_REF || process.env.EES_APPROVED_STAGING_PROJECT_REF;

  assertNotConfirmedProductionForExperimentalSql(url);
  assertApprovedStagingTarget(url, approved);

  const ref = extractSupabaseProjectRef(url);
  if (ref === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error("Production project refused.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        envFile: path.relative(process.cwd(), resolved).replace(/\\/g, "/"),
        stagingRef: ref,
        approvedRef: approved,
        productionRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
}
