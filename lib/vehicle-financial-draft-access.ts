import { hasPermission, type AccountAccess } from "@/lib/authorization";

export type DraftAction = "read" | "import" | "validate" | "review" | "approve";
export function canUseVehicleFinancialDrafts(access: AccountAccess, action: DraftAction) {
  // Every draft response includes salary-bearing source or calculated totals.
  // Keep those reads within the same financial-management boundary as review.
  if (action === "read") return hasPermission(access, "business:write");
  if (action === "import") return hasPermission(access, "business:import") && hasPermission(access, "business:write");
  if (action === "validate" || action === "review") return hasPermission(access, "business:write");
  return hasPermission(access, "admin:user_management");
}
