/**
 * Read-only contract check for a future fuel-bank-app-staging Vercel project.
 * Does not create/deploy/alter Vercel. Validates local .env.staging.local isolation.
 */
import fs from "node:fs";
import path from "node:path";
import {
  EES_PILOT_002_DEPOT_LOCATION_ID,
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  assertApprovedStagingTarget,
  assertFleetMonitorAllowedLocationIds,
  assertFleetMonitorSupabaseTarget,
  assertNotConfirmedProductionForExperimentalSql,
  extractSupabaseProjectRef
} from "../lib/ees-database-environment";

const root = path.resolve(__dirname, "..");
const STAGING_REF = "wpmnjfncaoogssgpqxek";

function loadEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function presence(value: string | undefined) {
  return { present: Boolean(value), length: value ? value.length : 0 };
}

function main() {
  const staging = loadEnv(path.join(root, ".env.staging.local"));
  const local = loadEnv(path.join(root, ".env.local"));
  const checks: { id: string; pass: boolean; detail?: string }[] = [];

  const url = staging.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assertNotConfirmedProductionForExperimentalSql(url);
    assertApprovedStagingTarget(url, staging.EES_APPROVED_STAGING_PROJECT_REF || STAGING_REF);
    checks.push({ id: "staging_url_approved", pass: true });
  } catch (error) {
    checks.push({
      id: "staging_url_approved",
      pass: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    assertFleetMonitorSupabaseTarget({
      supabaseUrl: url,
      allowedProjectRef: staging.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF,
      approvedStagingRef: staging.EES_APPROVED_STAGING_PROJECT_REF
    });
    checks.push({ id: "monitor_project_isolation", pass: true });
  } catch (error) {
    checks.push({
      id: "monitor_project_isolation",
      pass: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const ids = assertFleetMonitorAllowedLocationIds(staging.EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS);
    checks.push({
      id: "depot_only_location_allowlist",
      pass: ids.length === 1 && ids[0] === EES_PILOT_002_DEPOT_LOCATION_ID,
      detail: ids.join(",")
    });
  } catch (error) {
    checks.push({
      id: "depot_only_location_allowlist",
      pass: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  checks.push({
    id: "monitor_disabled",
    pass: staging.EES_FLEET_MONITOR_ENABLED === "false"
  });
  checks.push({
    id: "web_push_test_disabled",
    pass: staging.EES_WEB_PUSH_TEST_ENABLED === "false"
  });
  checks.push({
    id: "vapid_present",
    pass: Boolean(
      staging.EES_WEB_PUSH_VAPID_PUBLIC_KEY &&
        staging.EES_WEB_PUSH_VAPID_PRIVATE_KEY &&
        staging.EES_WEB_PUSH_VAPID_SUBJECT
    )
  });
  checks.push({
    id: "staging_service_role_distinct_from_local",
    pass:
      Boolean(staging.SUPABASE_SERVICE_ROLE_KEY) &&
      staging.SUPABASE_SERVICE_ROLE_KEY !== local.SUPABASE_SERVICE_ROLE_KEY
  });
  checks.push({
    id: "local_is_production_ref_expected",
    pass: extractSupabaseProjectRef(local.NEXT_PUBLIC_SUPABASE_URL) === EES_PRODUCTION_SUPABASE_PROJECT_REF,
    detail: extractSupabaseProjectRef(local.NEXT_PUBLIC_SUPABASE_URL) ?? "missing"
  });

  const requiredForStagingVercel = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "EES_APPROVED_STAGING_PROJECT_REF",
    "EES_FLEET_MONITOR_ALLOWED_PROJECT_REF",
    "EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS",
    "EES_FLEET_MONITOR_ENABLED",
    "EES_FLEET_MONITOR_SECRET",
    "EES_WEB_PUSH_TEST_ENABLED",
    "EES_WEB_PUSH_VAPID_PUBLIC_KEY",
    "EES_WEB_PUSH_VAPID_PRIVATE_KEY",
    "EES_WEB_PUSH_VAPID_SUBJECT"
  ];

  const missingRequired = requiredForStagingVercel.filter((key) => !staging[key]);
  checks.push({
    id: "required_keys_present_locally",
    pass: missingRequired.length === 0,
    detail: missingRequired.join(",") || undefined
  });

  const optionalMaps = ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_SERVER_API_KEY", "GOOGLE_MAPS_API_KEY"];
  const missingMaps = optionalMaps.filter((key) => !staging[key]);

  const report = {
    recordType: "EES_V20_3_VERCEL_STAGING_PROJECT_PREPARATION",
    generatedAt: new Date().toISOString(),
    proposedVercelProject: "fuel-bank-app-staging",
    productionVercelProject: "fuel-bank-app",
    stagingSupabaseRef: STAGING_REF,
    productionSupabaseRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF,
    createdOrDeployed: false,
    productionUnchanged: true,
    checks,
    localCredentialPresence: Object.fromEntries(
      requiredForStagingVercel.map((key) => [key, presence(staging[key])])
    ),
    optionalMapsMissing: missingMaps,
    proposedHostname: "https://fuel-bank-app-staging.vercel.app",
    supabaseAuthActionsRequired: [
      "Set staging Supabase Auth Site URL to staging HTTPS origin",
      "Allow redirect URLs for staging hostname (and custom domain if any)",
      "Do not change production Supabase Auth URLs"
    ],
    vercelActionsRequiringOwnerApproval: [
      "Create project fuel-bank-app-staging",
      "Import repo without attaching production domains",
      "Paste staging-only env vars",
      "Enable Deployment Protection",
      "Deploy once to staging project only"
    ],
    goNoGo: missingRequired.length || checks.some((c) => !c.pass && c.id !== "local_is_production_ref_expected")
      ? "NO_GO_FIX_LOCAL_CONTRACT"
      : "READY_FOR_OWNER_APPROVAL_TO_CREATE_STAGING_PROJECT",
    docs: "docs/ees-fleet-operations-v20-3-vercel-staging-project-preparation.md"
  };

  // local_is_production_ref_expected is informational; if local isn't prod, still OK for staging prep
  const hardFails = checks.filter(
    (c) => !c.pass && c.id !== "local_is_production_ref_expected"
  );
  report.goNoGo =
    hardFails.length === 0
      ? "READY_FOR_OWNER_APPROVAL_TO_CREATE_STAGING_PROJECT"
      : "NO_GO_FIX_LOCAL_CONTRACT";

  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "output", "v20-3-vercel-staging-project-preparation.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify(
      {
        goNoGo: report.goNoGo,
        hardFails: hardFails.map((c) => c.id),
        optionalMapsMissing: missingMaps,
        outPath: "output/v20-3-vercel-staging-project-preparation.json"
      },
      null,
      2
    )
  );
  if (hardFails.length) process.exit(1);
}

main();
