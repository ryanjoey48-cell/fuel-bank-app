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
 * Finance Centre workspace inside the normal localhost EES app.
 * Keeps app-wide Supabase auth for Booking Diary / Fleet / etc.
 * Finance actions stay in-memory only and never write finance tables.
 * Opt into the legacy live Supabase overview with
 * NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL=1 after persistent finance migrations
 * are proven safe on a Development database.
 *
 * Local demos must keep NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE=1 in .env.local
 * so an accidental `next start` (NODE_ENV=production) still serves the
 * four-section workspace. Never set that flag on Vercel Production.
 */
export function isFinanceCentreLocalWorkspace() {
  if (process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL === "1") return false;
  if (process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

/** Use in-memory Finance screens (fixture-cleared OR normal localhost with live Booking Diary). */
export function usesFinanceLocalDemoScreens() {
  return isFinanceFixtureMode() || isFinanceCentreLocalWorkspace();
}
