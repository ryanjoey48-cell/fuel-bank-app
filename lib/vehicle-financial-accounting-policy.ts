import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormulaPolicy } from "@/lib/vehicle-financial-draft";

/**
 * Versioned candidate accounting policy. The owner-confirmed field definitions are
 * recorded here for review, including the owner's LPG fleet classification. The
 * policy remains a draft until formal policy approval, source reconciliation and
 * schema checks are complete. Import notes cannot activate financial calculations.
 */
export const VEHICLE_FINANCIAL_POLICY_DEFINITION = Object.freeze({
  policyId: "ees-vehicle-financial-v4",
  policyVersion: "v4-accounting-draft-3",
  formulaVersion: "vehicle-finance-v4-v1" as const,
  ownerConfirmedDefinitions: Object.freeze({
    totalReceived: "client_transport_service_revenue",
    salary: "fixed_monthly_base_pay; separate_from_trip_payments",
    tripPayments: "variable_completed_job_pay; separate_from_salary",
    expenses: "additional_expenses; separate_from_parking_fees_fuel_lpg_and_maintenance",
    jobs: "count_only; not_an_expense"
  }),
  candidateFormula: Object.freeze({
    recordedBalance: "total_received - salary - trip_payments - expenses - parking_fees - fuel - maintenance - lpg_when_separate",
    marginPercent: "recorded_balance / total_received when total_received > 0",
    jobs: "excluded_from_costs"
  }),
  lpg: Object.freeze({
    canonicalVehicleRegistration: "ฒอ-8453",
    identityRule: "resolve_source_registration_through_monthly_vehicle_aliases_then_apply_by_canonical_vehicle_id",
    otherFleetVehicles: "no_lpg; confirmed_zero_only_when_monthly_roster_is_confirmed",
    januaryThroughJuly2026: "included_in_fuel; do_not_deduct_again",
    august2026Onward: "separate; deduct_lpg_once",
    unknown: "withhold_balance_and_margin",
    ownerRuleStatus: "confirmed",
    approvalStatus: "policy_approval_pending",
    evidenceStatus: "source_reconciliation_and_schema_checks_required_before_activation"
  }),
  maintenance: "financial_report_amount_only; operational_maintenance_isolated",
  status: "draft" as const,
  activationStatus: "blocked_pending_policy_approval_source_reconciliation_and_schema_checks" as const
});

export const VEHICLE_FINANCIAL_POLICY_HASH = "190052557026203b9a6f8aa41090fc2050b374812b9f025c77b2a2b4aa04b17a";
export const VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS = [
  "owner_decision_sha256",
  "revenue_semantics_sha256",
  "expense_boundaries_sha256",
  "lpg_boundary_sha256",
  "source_reconciliation_sha256",
  "schema_compatibility_sha256"
] as const;
export type VehicleFinancialPolicyEvidence = Record<typeof VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS[number], string>;
export type VehicleFinancialPolicyApprovalRow = VehicleFinancialPolicyEvidence & {
  policy_version: string;
  formula_version: string;
  policy_hash: string;
  approved_by: string | null;
  approved_at: string | null;
};

const SHA256 = /^[a-f0-9]{64}$/i;

/** The deployment operator sets this only after verifying each immutable evidence artifact. */
export function verifiedVehicleFinancialPolicyEvidence(): VehicleFinancialPolicyEvidence | null {
  const raw = process.env.EES_VEHICLE_FINANCIAL_POLICY_EVIDENCE_SHA256;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== [...VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS].sort().join(",") ||
        VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS.some(key => typeof value[key] !== "string" || !SHA256.test(value[key] as string))) return null;
    return Object.fromEntries(VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS.map(key => [key, (value[key] as string).toLowerCase()])) as VehicleFinancialPolicyEvidence;
  } catch {
    return null;
  }
}

export function vehicleFinancialPolicyApprovalMatches(row: VehicleFinancialPolicyApprovalRow | null | undefined, evidence: VehicleFinancialPolicyEvidence | null) {
  return Boolean(row && evidence && row.policy_version === VEHICLE_FINANCIAL_POLICY_DEFINITION.policyVersion &&
    row.formula_version === VEHICLE_FINANCIAL_POLICY_DEFINITION.formulaVersion && row.policy_hash === VEHICLE_FINANCIAL_POLICY_HASH &&
    row.approved_by && row.approved_at && VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS.every(key => row[key] === evidence[key]));
}

/** Read only an immutable approval for the exact code-reviewed policy and verified evidence manifest. */
export async function getActiveApprovedVehicleFinancialPolicy(admin: SupabaseClient): Promise<FormulaPolicy | null> {
  const evidence = verifiedVehicleFinancialPolicyEvidence();
  if (!evidence) return null;
  const { data, error } = await admin.from("vehicle_financial_policy_approvals")
    .select("policy_version,formula_version,policy_hash,owner_decision_sha256,revenue_semantics_sha256,expense_boundaries_sha256,lpg_boundary_sha256,source_reconciliation_sha256,schema_compatibility_sha256,approved_by,approved_at")
    .eq("policy_version", VEHICLE_FINANCIAL_POLICY_DEFINITION.policyVersion).maybeSingle();
  if (error || !data) return null;
  if (!vehicleFinancialPolicyApprovalMatches(data as VehicleFinancialPolicyApprovalRow, evidence)) return null;
  return {
    status: "approved",
    policyId: VEHICLE_FINANCIAL_POLICY_DEFINITION.policyId,
    version: VEHICLE_FINANCIAL_POLICY_DEFINITION.formulaVersion,
    approvedBy: data.approved_by,
    approvedAt: data.approved_at,
    sourceEvidence: VEHICLE_FINANCIAL_POLICY_EVIDENCE_KEYS.map(key => evidence[key])
  };
}
