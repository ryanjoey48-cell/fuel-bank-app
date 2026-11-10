"use client";

import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { canManageFinancePricing } from "@/lib/finance-intake-access";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";

export function useCanManagePricing() {
  const { role } = useFinanceFixture();
  const { access } = useAccountAccess();
  return canManageFinancePricing(access, role, isFinanceFixtureMode());
}

export function financePricingAdminHref(clientId = "", sheetId = "", jobId = "") {
  const query = new URLSearchParams({ tab: "review" });
  if (clientId) query.set("customer", clientId);
  if (sheetId) query.set("sheet", sheetId);
  if (jobId) query.set("job", jobId);
  return `/finance-pricing-admin?${query.toString()}`;
}
