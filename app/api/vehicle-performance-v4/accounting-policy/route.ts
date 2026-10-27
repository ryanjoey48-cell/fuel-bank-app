import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { hasPermission } from "@/lib/authorization";
import {
  getActiveApprovedVehicleFinancialPolicy,
  VEHICLE_FINANCIAL_POLICY_DEFINITION
} from "@/lib/vehicle-financial-accounting-policy";

function responseError(error: unknown) {
  const status = error instanceof AdminApiError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check Vehicle Performance accounting policy." }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:read")) throw new AdminApiError(403, "You do not have access to Vehicle Performance policy status.");
    const policy = await getActiveApprovedVehicleFinancialPolicy(admin);
    return NextResponse.json({
      policyVersion: VEHICLE_FINANCIAL_POLICY_DEFINITION.policyVersion,
      formulaVersion: VEHICLE_FINANCIAL_POLICY_DEFINITION.formulaVersion,
      status: policy ? "approved" : "draft",
      calculationsEnabled: Boolean(policy)
    });
  } catch (error) { return responseError(error); }
}

/** Policy activation stays unavailable until the owner approves a separate release. */
export async function POST() {
  return NextResponse.json({ error: "Accounting-policy activation is disabled for this release." }, { status: 403 });
}
