import { validateJourneyHistoryRequest } from "@/lib/forth-history-contract";
import { normalizeForthRegistration } from "@/lib/forth-tracking";

export type ForthHistoryPreviewTestScope = {
  userId: string;
  deviceId: string;
  date: string;
  registration: string;
};

/** A short, exact Preview test scope. No assignment means the history route stays closed. */
export function resolveForthHistoryPreviewTestScope(
  environment: NodeJS.ProcessEnv = process.env,
  now = Date.now()
): ForthHistoryPreviewTestScope | null {
  if (environment.VERCEL_ENV !== "preview" ||
    environment.VERCEL_GIT_COMMIT_REF !== "codex/fleet-tracking-v2-history-integration" ||
    environment.FORTH_HISTORY_PREVIEW_TEST_ENABLED !== "true") return null;

  const userId = environment.FORTH_HISTORY_PREVIEW_TEST_USER_ID;
  const registration = environment.FORTH_HISTORY_PREVIEW_TEST_REGISTRATION;
  const request = validateJourneyHistoryRequest({
    deviceId: environment.FORTH_HISTORY_PREVIEW_TEST_DEVICE_ID,
    date: environment.FORTH_HISTORY_PREVIEW_TEST_DATE
  });
  const expiry = environment.FORTH_HISTORY_PREVIEW_TEST_EXPIRES_AT;
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
    !registration || registration.length > 40 || !normalizeForthRegistration(registration) ||
    !request.ok || !expiry || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expiry)) return null;

  const expiresAt = Date.parse(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 15 * 60_000) return null;
  return { userId, deviceId: request.deviceId, date: request.date, registration };
}
