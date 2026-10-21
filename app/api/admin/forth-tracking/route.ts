import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { getForthTrackingDiagnostic } from "@/lib/forth-tracking-server";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:read")) {
      throw new AdminApiError(403, "EES office access is required.");
    }

    return NextResponse.json(await getForthTrackingDiagnostic(), { headers: privateNoStoreHeaders });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const message = error instanceof AdminApiError ? error.message : "Forth tracking diagnostic is unavailable.";
    return NextResponse.json({ error: message }, { status, headers: privateNoStoreHeaders });
  }
}
