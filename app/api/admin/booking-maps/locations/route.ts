import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { approveCanonicalLocation, approveRouteContextLocation, BookingMapsStaleCountError, BookingMapsStaleSnapshotError } from "@/lib/booking-maps-server";

type ApprovalRequest = {
  alias?: string;
  clientId?: string | null;
  displayName?: string | null;
  placeId?: string;
  expectedAffectedCount?: number;
  snapshotVersion?: string;
  confirmedName?: string;
  outsideThailandApproved?: boolean;
  scope?: "global" | "client" | "route";
  side?: "pickup" | "dropoff";
  context?: { clientId: string | null; pickup: string; dropoff: string };
};

export async function POST(request: Request) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const body = (await request.json()) as ApprovalRequest;
    if (!body.alias?.trim() || !body.placeId?.trim()) {
      throw new AdminApiError(400, "Alias and Google Place ID are required.");
    }
    if (!Number.isInteger(body.expectedAffectedCount) || Number(body.expectedAffectedCount) < 0) {
      throw new AdminApiError(400, "Review the affected booking count before approving.");
    }
    if (!body.snapshotVersion?.trim() || !body.confirmedName?.trim()) {
      throw new AdminApiError(400, "A current review snapshot and confirmed company location name are required.");
    }
    if (body.scope === "route") {
      if (!body.side || !body.context?.pickup?.trim() || !body.context.dropoff?.trim()) {
        throw new AdminApiError(400, "A complete pickup/drop-off route context is required.");
      }
      const result = await approveRouteContextLocation(admin, user.id, {
        alias: body.alias,
        side: body.side,
        clientId: body.context.clientId,
        pickup: body.context.pickup,
        dropoff: body.context.dropoff,
        displayName: body.displayName,
        placeId: body.placeId,
        expectedAffectedCount: Number(body.expectedAffectedCount),
        snapshotVersion: body.snapshotVersion,
        confirmedName: body.confirmedName,
        outsideThailandApproved: body.outsideThailandApproved
      });
      return NextResponse.json(result);
    }
    if (!body.side) throw new AdminApiError(400, "Pickup or drop-off type is required.");
    const result = await approveCanonicalLocation(admin, user.id, {
      alias: body.alias,
      side: body.side,
      clientId: body.clientId || null,
      displayName: body.displayName,
      placeId: body.placeId,
      expectedAffectedCount: Number(body.expectedAffectedCount),
      snapshotVersion: body.snapshotVersion,
      confirmedName: body.confirmedName,
      outsideThailandApproved: body.outsideThailandApproved
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingMapsStaleSnapshotError) {
      return NextResponse.json({
        error: error.message,
        code: "STALE_REVIEW_SNAPSHOT",
        snapshot: error.snapshot
      }, { status: error.status });
    }
    if (error instanceof BookingMapsStaleCountError) {
      return NextResponse.json({
        error: error.message,
        code: "STALE_AFFECTED_COUNT",
        currentAffectedCount: error.currentAffectedCount,
        cutoffDate: error.cutoffDate
      }, { status: error.status });
    }
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to approve the canonical location." }, { status: 500 });
  }
}
