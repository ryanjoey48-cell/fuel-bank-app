import { NextResponse } from "next/server";
import august from "../../../../data/vehicle-performance-v4/previews/2026-08.json";
import september from "../../../../data/vehicle-performance-v4/previews/2026-09.json";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { canUseVehicleFinancialDrafts } from "@/lib/vehicle-financial-draft-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!canUseVehicleFinancialDrafts(access, "read")) {
      throw new AdminApiError(403, "Financial-management access is required to view monthly source previews.");
    }

    return NextResponse.json({ reports: [august, september] }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Vary": "Authorization",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 503;
    return NextResponse.json({ error: status === 403 ? "permission_denied" : "source_preview_unavailable" }, {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Vary": "Authorization",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
}
