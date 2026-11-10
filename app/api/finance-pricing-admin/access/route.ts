import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFinancePricingAdminAccess } from "@/lib/finance-pricing-admin-server";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await requireFinancePricingAdminAccess(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Pricing administration access could not be verified." }, { status: 500 });
  }
}
