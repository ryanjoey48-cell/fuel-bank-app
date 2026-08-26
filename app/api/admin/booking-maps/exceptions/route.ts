import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { buildExceptionsCsv } from "@/lib/booking-maps-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const batchId = new URL(request.url).searchParams.get("batchId");
    const csv = await buildExceptionsCsv(admin, batchId);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="booking-maps-exceptions${batchId ? `-${batchId}` : ""}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unable to export exceptions.";
    return Response.json({ error: message }, { status });
  }
}
