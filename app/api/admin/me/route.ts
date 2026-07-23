import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, permissionsFor, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";

export async function GET(request: Request) {
  try {
    const admin = createServerSupabaseAdmin();
    const user = await requireVerifiedUser(request);
    const access = await resolveAccountAccess(admin, user);

    if (access.status === "suspended") {
      return NextResponse.json({ error: "Account suspended.", access, permissions: [] }, { status: 403 });
    }

    return NextResponse.json({ access, permissions: permissionsFor(access) });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to verify account access." }, { status: 500 });
  }
}
