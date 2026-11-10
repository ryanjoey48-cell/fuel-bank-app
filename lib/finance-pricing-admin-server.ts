import { requireAdminAccess } from "@/lib/admin-user-management-server";

/** No production or partially configured environment can use the development fixture exception. */
export function isIsolatedFinancePricingFixture(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "development" && env.EES_FINANCE_DEMO_ONLY === "1" && env.NEXT_PUBLIC_EES_FINANCE_FIXTURE === "1"
    && !env.NEXT_PUBLIC_SUPABASE_URL && !env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !env.SUPABASE_SERVICE_ROLE_KEY
    && env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL !== "1";
}

export async function requireFinancePricingAdminAccess(request: Request) {
  if (isIsolatedFinancePricingFixture(process.env)) return { allowed: true, fixture: true };
  await requireAdminAccess(request);
  return { allowed: true, fixture: false };
}
