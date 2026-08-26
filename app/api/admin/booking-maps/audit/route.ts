import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { buildBookingMapsAudit, getDryRun } from "@/lib/booking-maps-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const locationReviewOnly = new URL(request.url).searchParams.get("view") === "location-review";
    if (locationReviewOnly) {
      const audit = await buildBookingMapsAudit(admin);
      return NextResponse.json({ audit });
    }
    const [audit, latestDryRun] = await Promise.all([
      buildBookingMapsAudit(admin),
      getDryRun(admin)
    ]);
    if (latestDryRun) {
      audit.summary.googleApiFailure = latestDryRun.items.filter(
        (item: Record<string, unknown>) => item.item_status === "google_api_failure"
      ).length;
      audit.summary.suspiciousDistance = latestDryRun.items.filter(
        (item: Record<string, unknown>) => item.item_status === "suspicious_distance"
      ).length;
    }
    return NextResponse.json({ audit, latestDryRun });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load the Booking Maps audit." }, { status: 500 });
  }
}
