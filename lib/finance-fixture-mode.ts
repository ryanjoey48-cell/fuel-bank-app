/** Shared in-memory fixture testing. Never enable in production or with live Supabase credentials. */
export function isFinanceFixtureMode() {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.NEXT_PUBLIC_EES_FINANCE_FIXTURE !== "1") return false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return false;
  return true;
}

export function isFinanceLocalPreview() {
  return isFinanceFixtureMode();
}

/**
 * Four-section Finance Centre workspace UI (Admin Intake → Arrange → Billing → Documents).
 * Shown on localhost and Vercel Production. Opt into the legacy Supabase overview only with
 * NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL=1 after persistent finance migrations are approved.
 *
 * Persistence is separate: filesystem local store + simulated TRNs require
 * NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE=1 (localhost / next start only). Never set that
 * flag on Vercel Production — serverless has no durable .ees-local disk, and production uses
 * authenticated browser storage until shared Supabase Finance storage is approved.
 */
export function isFinanceCentreLocalWorkspace() {
  if (process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL === "1") return false;
  return true;
}

/** Use the four-section Finance screens (fixture-cleared OR normal app with Booking Diary auth). */
export function usesFinanceLocalDemoScreens() {
  return isFinanceFixtureMode() || isFinanceCentreLocalWorkspace();
}
