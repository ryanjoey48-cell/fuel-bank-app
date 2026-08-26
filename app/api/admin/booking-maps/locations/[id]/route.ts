import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { renameApprovedLocationMapping, undoApprovedLocationMapping } from "@/lib/booking-maps-server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const { id } = await context.params;
    const body = await request.json() as { confirmedName?: string };
    return NextResponse.json(await renameApprovedLocationMapping(admin, user.id, id, body.confirmedName ?? ""));
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to edit the approved location mapping." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const { id } = await context.params;
    return NextResponse.json(await undoApprovedLocationMapping(admin, user.id, id));
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to undo the approved location mapping." }, { status: 500 });
  }
}
