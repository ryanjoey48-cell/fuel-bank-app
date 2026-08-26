import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { createBookingMapsDryRun, getDryRun } from "@/lib/booking-maps-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const batchId = new URL(request.url).searchParams.get("batchId");
    return NextResponse.json({ dryRun: await getDryRun(admin, batchId) });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load the dry run." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const body = await request.json().catch(() => ({})) as {
      batchId?: string | null;
      batchSize?: number;
    };
    return NextResponse.json({
      dryRun: await createBookingMapsDryRun(admin, user.id, {
        batchId: body.batchId,
        batchSize: body.batchSize
      })
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to create the Booking Maps dry run." }, { status: 500 });
  }
}
