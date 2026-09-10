import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import {
  approveBookingRoute,
  buildRouteApprovalQueue,
  reopenBookingRoute,
  type RouteApprovalPayload
} from "@/lib/booking-route-approvals";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    return NextResponse.json(await buildRouteApprovalQueue(admin));
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load route approvals." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const body = await request.json();
    if (body.action === "approve") {
      return NextResponse.json(await approveBookingRoute(admin, user.id, body.route as RouteApprovalPayload));
    }
    if (body.action === "reopen") {
      if (!body.approvalId) throw new AdminApiError(400, "Route approval ID is required.");
      return NextResponse.json(await reopenBookingRoute(admin, user.id, String(body.approvalId)));
    }
    throw new AdminApiError(400, "A valid route approval action is required.");
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to save route approval." }, { status: 500 });
  }
}
