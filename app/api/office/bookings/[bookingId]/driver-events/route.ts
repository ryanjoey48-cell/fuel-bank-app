import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { hasPermission } from "@/lib/authorization";
import { DriverPortalError } from "@/lib/driver-portal-server";
import { readDriverJobEvents } from "@/lib/driver-job-events-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const user = await requireVerifiedUser(request);
    const access = await resolveAccountAccess(createServerSupabaseAdmin(), user);
    if (!hasPermission(access, "business:read")) throw new AdminApiError(403, "Office access required.");
    const { bookingId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) throw new AdminApiError(400, "Invalid booking ID.");
    return NextResponse.json({ events: await readDriverJobEvents(bookingId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load driver progress." },
      { status: error instanceof AdminApiError || error instanceof DriverPortalError ? error.status : 500 });
  }
}
