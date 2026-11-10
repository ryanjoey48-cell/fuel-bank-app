/**
 * Finance testing chrome belongs only on Finance routes.
 * Fleet Tracking, Booking Diary and other ops pages stay free of Finance banners.
 */

const FINANCE_WORKSPACE_PREFIXES = [
  "/finance-centre",
  "/finance-records",
  "/finance-cost-pricing",
  "/finance-pricing-admin",
  "/finance-demo",
  "/finance-preview",
  "/job-verification",
  "/weekly-billing",
  "/invoice-approval",
  "/document-packs",
  "/paperwork-inbox"
] as const;

export function isFinanceWorkspaceRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split("?")[0] || "";
  return FINANCE_WORKSPACE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
