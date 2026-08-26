import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { buildBookingCheckMatchingPreview, buildBookingCheckSummary, buildBookingChecks, saveBookingCheck } from "@/lib/booking-maps-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const url = new URL(request.url);
    if (url.searchParams.get("summary") === "true") {
      return NextResponse.json(await buildBookingCheckSummary(admin));
    }
    if (url.searchParams.get("matching") === "true") {
      const bookingId = url.searchParams.get("bookingId");
      if (!bookingId) throw new AdminApiError(400, "Booking ID is required for matching preview.");
      return NextResponse.json(await buildBookingCheckMatchingPreview(admin, bookingId));
    }
    return NextResponse.json(await buildBookingChecks(admin));
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load booking checks." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const body = await request.json();
    const actions = new Set([
      "confirm_all",
      "confirm_client",
      "confirm_pickup",
      "confirm_dropoff",
      "skip",
      "investigate"
    ]);
    if (!body.bookingId || !actions.has(body.action)) {
      throw new AdminApiError(400, "Booking ID and a valid review action are required.");
    }
    const result = await saveBookingCheck(admin, user.id, {
      bookingId: String(body.bookingId),
      action: body.action,
      applyMatching: body.applyMatching === true,
      client: body.client ?? null,
      pickup: body.pickup ?? null,
      dropoff: body.dropoff ?? null
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to save booking checks." }, { status: 500 });
  }
}
