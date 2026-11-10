/**
 * Journey Playback / history HTTP live gate.
 *
 * Defaults OFF. Production never uses FORTH_HISTORY_SUPERVISED_SESSION.
 * Production enable requires an explicit owner-approved env:
 *   FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED=1
 * Local supervised verification may set FORTH_HISTORY_SUPERVISED_SESSION=1.
 * Do not set either flag in Vercel until separately approved.
 */

export const FORTH_HISTORY_LIVE_REQUESTS_ENABLED = false;

export const FORTH_HISTORY_OFFICE_PLAYBACK_ENV = "FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED";
export const FORTH_HISTORY_SUPERVISED_SESSION_ENV = "FORTH_HISTORY_SUPERVISED_SESSION";

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isVercelProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * Whether live Forth history requests may leave this server.
 * Auth and business:read still apply on every route when this returns true.
 */
export function isForthHistoryLiveRequestsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const officePlayback = isTruthyEnv(env[FORTH_HISTORY_OFFICE_PLAYBACK_ENV]);
  const supervised = isTruthyEnv(env[FORTH_HISTORY_SUPERVISED_SESSION_ENV]);

  if (isVercelProductionEnvironment(env)) {
    // Supervised session must never unlock production.
    if (supervised && !officePlayback) return false;
    if (officePlayback) return true;
    return FORTH_HISTORY_LIVE_REQUESTS_ENABLED;
  }

  if (supervised) return true;
  if (officePlayback) return true;
  return FORTH_HISTORY_LIVE_REQUESTS_ENABLED;
}

export function forthHistoryGateDenialDetail(
  language: "en" | "th" = "en"
): string {
  if (language === "th") {
    return (
      "คำขอประวัติ Forth ยังปิดอยู่ — ต้องได้รับอนุมัติเจ้าของกิจการและตั้งค่า " +
      "FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED บนเซิร์ฟเวอร์เท่านั้น " +
      "ห้ามใช้ FORTH_HISTORY_SUPERVISED_SESSION บน production"
    );
  }
  return (
    "Forth history requests stay disabled until the owner approves office playback " +
    "and sets FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED on the server. " +
    "FORTH_HISTORY_SUPERVISED_SESSION must never be set in production."
  );
}
