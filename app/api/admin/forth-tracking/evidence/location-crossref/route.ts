import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { loadCrossReference } from "@/lib/fleet-crossref-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * V7.4, read only. Review-only name suggestions between the EES Locations Directory and Forth saved locations. Same read permission as
 * the Locations Directory (business:read). Nothing is saved, no link is created and no coordinates are returned.
 */
export async function GET(request: Request) {
  try {
    const { access } = await requireFleetOfficeAccess(request);
    if (!hasPermission(access, "business:read")) throw new AdminApiError(403, "You do not have access to the locations directory.");
    let result;
    try { result = await loadCrossReference(createFleetSourceClient(request)); }
    catch (error) { if ((error as { status?: number }).status === 503) throw new AdminApiError(503, "The locations directory is unavailable."); throw error; }
    return NextResponse.json({ ...result, note: "Suggestions only. Nothing is linked, saved or changed." }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Location suggestions are unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
