import type { AccountAccess } from "@/lib/authorization";
import { FINANCE_DESK_ACTIONS, type Action, type Role } from "@/lib/finance-demo-centre";

type IntakeAccess = Pick<AccountAccess, "role" | "status"> | null | undefined;

const ADMIN_OWNED_ACTIONS = new Set<Action["type"]>([
  "add_document",
  "ready_handover",
  "confirm_document",
  "waive_document",
  "verify_job",
  "add_expense",
  "set_returned_work_order",
  "set_returned_details",
  "set_document_attachment",
  "admin_save_intake"
]);

export function hasAuthenticatedFinanceAdminIntake(access: IntakeAccess) {
  return access?.status === "active" && (access.role === "admin" || access.role === "super_admin");
}

/** Pricing administration uses authenticated administrators; simulated actors exist only in the isolated fixture. */
export function canManageFinancePricing(access: IntakeAccess, simulatedRole: Role, isolatedFixtureMode: boolean) {
  return hasAuthenticatedFinanceAdminIntake(access) || (isolatedFixtureMode && ["admin", "super_admin", "approver"].includes(simulatedRole));
}

export function canUseFinanceAdminIntake(access: IntakeAccess, simulatedRole: Role, isolatedFixtureMode: boolean) {
  return hasAuthenticatedFinanceAdminIntake(access) || (isolatedFixtureMode && simulatedRole === "admin");
}

/** Management approval of billing figures (never issuance). Authenticated Admin/Super Admin, or simulated approver/management in fixture mode. */
export function canApproveFinanceBilling(access: IntakeAccess, simulatedRole: Role, _isolatedFixtureMode: boolean) {
  if (hasAuthenticatedFinanceAdminIntake(access)) return true;
  return _isolatedFixtureMode && (simulatedRole === "super_admin" || simulatedRole === "approver" || simulatedRole === "management");
}

export function financeActionActor(
  access: IntakeAccess,
  simulatedRole: Role,
  isolatedFixtureMode: boolean,
  actionType: Action["type"]
): Role {
  if (ADMIN_OWNED_ACTIONS.has(actionType) && canUseFinanceAdminIntake(access, simulatedRole, isolatedFixtureMode)) return "admin";
  // Finance desk (arrange papers, billing sheet): an authenticated Admin works it as themselves — no role switching,
  // recorded truthfully as "admin". Approval is mapped only for authorized management actors — never issuance.
  if ((actionType === "confirm_rate_mapping" || actionType === "approve_proposed_rate_mapping" || actionType === "approve_customer_profile" || actionType === "retire_customer_profile")
      && simulatedRole !== "approver" && simulatedRole !== "super_admin" && hasAuthenticatedFinanceAdminIntake(access)) return "admin";
  if ((actionType === "sheet_approve" || actionType === "sheet_reject_approval") && hasAuthenticatedFinanceAdminIntake(access)
      && simulatedRole !== "approver" && simulatedRole !== "management" && simulatedRole !== "super_admin") return "admin";
  if (FINANCE_DESK_ACTIONS.has(actionType) && simulatedRole !== "finance" && simulatedRole !== "super_admin" &&
      hasAuthenticatedFinanceAdminIntake(access)) return "admin";
  return simulatedRole;
}

/**
 * Who may read the detailed Activity History (the audit trail) of Finance records.
 * Authenticated Admin / Super Admin always; in the isolated fixture any simulated role except Office.
 * Office-only accounts see statuses but not the history. The trail itself is never deleted or filtered at the source.
 */
export function canViewFinanceActivity(access: IntakeAccess, simulatedRole: Role, isolatedFixtureMode: boolean) {
  if (hasAuthenticatedFinanceAdminIntake(access)) return true;
  if (simulatedRole === "super_admin") return true;
  return isolatedFixtureMode && simulatedRole !== "office";
}
