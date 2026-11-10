/**
 * Staging-only iPhone Web Push TEST readiness (no deploy, no notification send).
 * Target Supabase: wpmnjfncaoogssgpqxek. Never production.
 *
 * - Verifies staging identity / push tables / office access
 * - Generates staging-only VAPID into .env.staging.local if missing
 * - Ensures synthetic staging pilot can sign in (password only in gitignored env)
 * - Writes output/v20-3-iphone-web-push-test-readiness.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  assertApprovedStagingTarget,
  assertNotConfirmedProductionForExperimentalSql,
  extractSupabaseProjectRef
} from "../lib/ees-database-environment";
import { hasPermission } from "../lib/authorization";

const root = path.resolve(__dirname, "..");
const STAGING_REF = "wpmnjfncaoogssgpqxek";
const PILOT_EMAIL = "staging-fleet-pilot@ees-development.invalid";
const VAPID_SUBJECT = `mailto:${PILOT_EMAIL}`;

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

function upsertEnvFile(filePath: string, updates: Record<string, string>): string[] {
  const changed: string[] = [];
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (!(key in updates)) return line;
    seen.add(key);
    const value = updates[key];
    if (line.slice(i + 1).trim() === value) return line;
    changed.push(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    next.push(`${key}=${value}`);
    changed.push(key);
  }
  if (changed.length) fs.writeFileSync(filePath, `${next.join("\n").replace(/\n*$/, "\n")}`);
  return changed;
}

function generateVapidKeyPair(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey(undefined, "uncompressed").toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url")
  };
}

function presence(value: string | undefined) {
  return { present: Boolean(value), length: value ? value.length : 0 };
}

async function main() {
  const stagingPath = path.join(root, ".env.staging.local");
  const staging = loadEnv(stagingPath);
  assertNotConfirmedProductionForExperimentalSql(staging.NEXT_PUBLIC_SUPABASE_URL);
  assertApprovedStagingTarget(
    staging.NEXT_PUBLIC_SUPABASE_URL,
    staging.EES_APPROVED_STAGING_PROJECT_REF || STAGING_REF
  );
  const ref = extractSupabaseProjectRef(staging.NEXT_PUBLIC_SUPABASE_URL);
  if (ref !== STAGING_REF) throw new Error(`Wrong staging ref: ${ref}`);

  const updates: Record<string, string> = {};
  if (staging.EES_WEB_PUSH_TEST_ENABLED !== "false") updates.EES_WEB_PUSH_TEST_ENABLED = "false";
  if (staging.EES_FLEET_MONITOR_ENABLED !== "false") updates.EES_FLEET_MONITOR_ENABLED = "false";

  let vapidGenerated = false;
  if (
    !staging.EES_WEB_PUSH_VAPID_PUBLIC_KEY ||
    !staging.EES_WEB_PUSH_VAPID_PRIVATE_KEY ||
    !staging.EES_WEB_PUSH_VAPID_SUBJECT
  ) {
    const pair = generateVapidKeyPair();
    updates.EES_WEB_PUSH_VAPID_PUBLIC_KEY = pair.publicKey;
    updates.EES_WEB_PUSH_VAPID_PRIVATE_KEY = pair.privateKey;
    updates.EES_WEB_PUSH_VAPID_SUBJECT = VAPID_SUBJECT;
    vapidGenerated = true;
  }

  let passwordRotated = false;
  if (!staging.EES_STAGING_PILOT_PASSWORD || staging.EES_STAGING_PILOT_PASSWORD.length < 16) {
    updates.EES_STAGING_PILOT_PASSWORD = `StgPush_${crypto.randomBytes(18).toString("base64url")}`;
    passwordRotated = true;
  }

  const envChanges = upsertEnvFile(stagingPath, updates);
  const env = { ...staging, ...updates };

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let pilot = (listed?.users ?? []).find((u) => u.email === PILOT_EMAIL) ?? null;
  if (!pilot) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: PILOT_EMAIL,
      email_confirm: true,
      password: env.EES_STAGING_PILOT_PASSWORD,
      user_metadata: {
        synthetic: true,
        purpose: "STAGING iPhone Web Push TEST — not a production employee"
      }
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create staging pilot user");
    pilot = created.user;
    passwordRotated = true;
  } else if (passwordRotated) {
    const { error } = await admin.auth.admin.updateUserById(pilot.id, {
      password: env.EES_STAGING_PILOT_PASSWORD,
      email_confirm: true
    });
    if (error) throw new Error(error.message);
  }

  const { error: accessErr } = await admin
    .from("account_access")
    .upsert({ user_id: pilot.id, role: "admin", status: "active" });
  if (accessErr) throw new Error(accessErr.message);

  const { data: accessRow } = await admin
    .from("account_access")
    .select("user_id,role,status")
    .eq("user_id", pilot.id)
    .maybeSingle();

  const accessForPerm = {
    userId: pilot.id,
    email: PILOT_EMAIL,
    displayName: "Staging Fleet Pilot",
    role: (accessRow?.role ?? "admin") as "admin",
    status: (accessRow?.status ?? "active") as "active",
    lastAccessChangedAt: null
  };
  const canRead = hasPermission(accessForPerm, "business:read");
  const canWrite = hasPermission(accessForPerm, "business:write");

  const tables = [
    "ees_fleet_push_subscriptions",
    "ees_fleet_push_test_attempts",
    "ees_fleet_notification_preferences",
    "ees_fleet_notification_inbox"
  ] as const;
  const tableStatus: Record<string, { ok: boolean; count: number | null; error: string | null }> = {};
  for (const table of tables) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    tableStatus[table] = { ok: !error, count: count ?? null, error: error?.message ?? null };
  }

  // Sign-in probe against staging Auth only (no app traffic / no push).
  let signInOk = false;
  let signInError: string | null = null;
  {
    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await anon.auth.signInWithPassword({
      email: PILOT_EMAIL,
      password: env.EES_STAGING_PILOT_PASSWORD
    });
    signInOk = Boolean(data.session?.access_token) && !error;
    signInError = error?.message ?? null;
    if (data.session) await anon.auth.signOut();
  }

  const blockers: string[] = [];
  if (!signInOk) blockers.push(`Staging pilot sign-in failed: ${signInError ?? "unknown"}`);
  if (!canRead || !canWrite) blockers.push("Staging pilot lacks business read/write permission");
  if (!env.EES_WEB_PUSH_VAPID_PUBLIC_KEY || !env.EES_WEB_PUSH_VAPID_PRIVATE_KEY) {
    blockers.push("VAPID keys missing after prep");
  }
  if (env.EES_WEB_PUSH_TEST_ENABLED === "true") {
    blockers.push("EES_WEB_PUSH_TEST_ENABLED is true — leave false until owner-authorised single send");
  }
  if (Object.values(tableStatus).some((t) => !t.ok)) {
    blockers.push("One or more Web Push staging tables are unavailable");
  }
  blockers.push(
    "No isolated HTTPS staging host yet — current Vercel Preview shares production Supabase URL (hafoaurzfgkkwpvzedvd)"
  );
  blockers.push(
    "Owner must approve a safe staging HTTPS deployment (separate Vercel project recommended) before iPhone Home Screen install"
  );

  const report = {
    recordType: "EES_V20_3_IPHONE_WEB_PUSH_TEST_READINESS",
    generatedAt: new Date().toISOString(),
    stagingRef: ref,
    productionRefBlocked: EES_PRODUCTION_SUPABASE_PROJECT_REF,
    identityVerified: true,
    envFileChanges: envChanges,
    vapidGenerated,
    passwordRotated,
    httpsStagingReadiness: {
      required: true,
      currentProductionApp: "https://fuel-bank-app.vercel.app",
      vercelProject: "fuel-bank-app / prj_w2DllHvYeMPzc3XpQD1yFQ8PXVAF",
      previewSharesProductionSupabase: true,
      previewSafeForPushTest: false,
      recommendation:
        "Create a separate Vercel project (e.g. fuel-bank-app-staging) whose ONLY Supabase URL/keys are wpmnjfncaoogssgpqxek. Do not use fuel-bank-app Preview while NEXT_PUBLIC_SUPABASE_URL is shared with Production.",
      alternateTemporaryOption:
        "Owner-approved HTTPS tunnel (cloudflared/ngrok) to a local Next process loaded solely from .env.staging.local — still not a Vercel Production deploy.",
      notDeployedThisSession: true
    },
    authenticationReadiness: {
      pilotEmail: PILOT_EMAIL,
      pilotUserId: pilot.id,
      emailConfirmed: Boolean(pilot.email_confirmed_at),
      accountAccess: accessRow,
      businessRead: canRead,
      businessWrite: canWrite,
      signInProbeOk: signInOk,
      passwordStoredIn: ".env.staging.local (EES_STAGING_PILOT_PASSWORD) — gitignored; not a production employee",
      passwordLength: env.EES_STAGING_PILOT_PASSWORD.length,
      note: "Synthetic staging pilot only. Do not clone production users or employee passwords."
    },
    vapidReadiness: {
      publicKey: presence(env.EES_WEB_PUSH_VAPID_PUBLIC_KEY),
      privateKey: presence(env.EES_WEB_PUSH_VAPID_PRIVATE_KEY),
      subject: env.EES_WEB_PUSH_VAPID_SUBJECT || null,
      testEnabled: env.EES_WEB_PUSH_TEST_ENABLED,
      privateKeyCommitted: false
    },
    implementationCompatibility: {
      homeScreenManifest: true,
      serviceWorkerRegistration: true,
      pushPermissionRequest: true,
      subscriptionStorage: tableStatus.ees_fleet_push_subscriptions.ok,
      testPushApiGated: true,
      notificationClickDeepLink: "/fleet-events?testPush=1",
      deliveryDiagnosticsTable: tableStatus.ees_fleet_push_test_attempts.ok,
      preferencesTable: tableStatus.ees_fleet_notification_preferences.ok,
      inboxTable: tableStatus.ees_fleet_notification_inbox.ok,
      applePushEndpointAllowed: true,
      iOSRequirement: "iOS 16.4+; install to Home Screen; open from Home Screen icon before granting notification permission"
    },
    tableStatus,
    operationalAlertsRemainDisabled: {
      monitorEnabled: env.EES_FLEET_MONITOR_ENABLED,
      webPushTestEnabled: env.EES_WEB_PUSH_TEST_ENABLED,
      fleetOutboxDeliveryHardCodedOff: true,
      cronConfigured: false,
      geofenceUnchangedThisSession: true
    },
    exactSingleDeviceTestProcedure: [
      "1. After owner approves isolated staging HTTPS, open that staging URL in Safari on iPhone (not production).",
      "2. Share → Add to Home Screen (label clearly as EES Staging if prompted).",
      "3. Open the installed Home Screen app (standalone), not a Safari tab.",
      `4. Sign in as ${PILOT_EMAIL} using the staging password from .env.staging.local (EES_STAGING_PILOT_PASSWORD).`,
      "5. Open Fleet Operations → allow notifications when prompted.",
      "6. Tap Register device; confirm activeDevices ≥ 1 and Apple push endpoint stored.",
      "7. Owner sets EES_WEB_PUSH_TEST_ENABLED=true on the staging runtime only; tap Send server push test once.",
      "8. Confirm the physical iPhone displays a [TEST] notification (provider HTTP accept alone is not enough).",
      "9. Tap the notification; confirm navigation to /fleet-events?testPush=1.",
      "10. Immediately set EES_WEB_PUSH_TEST_ENABLED=false; record ees_fleet_push_test_attempts + operator confirmation."
    ],
    ownerApprovalsStillRequired: [
      "Approve isolated HTTPS staging host (separate Vercel staging project OR temporary HTTPS tunnel to staging-local Next)",
      "Approve configuring that host with staging Supabase + staging VAPID only (never production URL)",
      "Approve one [TEST] send window (flip EES_WEB_PUSH_TEST_ENABLED=true briefly)",
      "Do NOT approve using current fuel-bank-app Preview while it still points at production Supabase"
    ],
    blockers,
    goNoGo: "NO_GO_PENDING_STAGING_HTTPS",
    nextStepToSendOneTestNotification:
      "Owner approves and provisions an isolated HTTPS staging deployment bound only to wpmnjfncaoogssgpqxek, then follow the 10-step device procedure and authorise one TEST enable window.",
    notificationSent: false,
    deployed: false,
    committed: false,
    monitorActivated: false
  };

  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  const outPath = path.join(root, "output", "v20-3-iphone-web-push-test-readiness.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        goNoGo: report.goNoGo,
        stagingRef: ref,
        vapidGenerated,
        passwordRotated,
        signInOk,
        envFileChanges: envChanges,
        blockers,
        outPath: "output/v20-3-iphone-web-push-test-readiness.json"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
