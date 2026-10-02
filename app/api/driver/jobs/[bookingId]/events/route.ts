import { NextResponse } from "next/server";
import { DriverPortalError, getDriverPortalSession } from "@/lib/driver-portal-server";
import { appendDriverJobEvent, getAssignedDriverJobEvents } from "@/lib/driver-job-events-server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ bookingId: string }> };
const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof DriverPortalError ? error.message : "Job progress is unavailable." },
    { status: error instanceof DriverPortalError ? error.status : 500, headers });
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const session = await getDriverPortalSession();
    if (!session) throw new DriverPortalError(401, "Driver sign-in required.");
    const { bookingId } = await params;
    return NextResponse.json({ events: await getAssignedDriverJobEvents(session, bookingId) }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    // Cookie-authenticated writes require a same-origin browser request.
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new DriverPortalError(403, "Invalid request origin.");
    const session = await getDriverPortalSession();
    if (!session) throw new DriverPortalError(401, "Driver sign-in required.");
    const { bookingId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DriverPortalError(400, "Invalid progress request.");
    const event = await appendDriverJobEvent(session, bookingId, body);
    return NextResponse.json({ event }, { status: 201, headers });
  } catch (error) { return failure(error); }
}
