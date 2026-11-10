import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { recentHistoryAudit } from "@/lib/forth-history-audit";

const headers = { "Cache-Control": "private, no-store" };

type Dependencies = {
  requireUser: typeof requireVerifiedUser;
  createAdmin: typeof createServerSupabaseAdmin;
  resolveAccess: typeof resolveAccountAccess;
  checkPermission: typeof hasPermission;
  recent: typeof recentHistoryAudit;
};

/**
 * Recent historical-location access events for administrators. NON-DURABLE: this is the server process's
 * memory, cleared on restart and not shared between server instances. It exists so the audit can be inspected
 * during supervised local use; durable storage needs separate approval.
 */
export function createHistoryAuditGetHandler(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = { requireUser: requireVerifiedUser, createAdmin: createServerSupabaseAdmin, resolveAccess: resolveAccountAccess, checkPermission: hasPermission, recent: recentHistoryAudit, ...overrides };
  return async function GET(request: Request) {
    try {
      const user = await dependencies.requireUser(request);
      const access = await dependencies.resolveAccess(dependencies.createAdmin(), user);
      if (!dependencies.checkPermission(access, "admin:security_settings")) throw new AdminApiError(403, "Administrator access is required.");
      const requested = Number(new URL(request.url).searchParams.get("limit") ?? 50);
      const limit = Number.isInteger(requested) && requested >= 1 && requested <= 200 ? requested : 50;
      return NextResponse.json({ durable: false, note: "In-memory events only; cleared on restart and not shared between server instances.", events: dependencies.recent(limit) }, { headers });
    } catch (error) {
      const status = error instanceof AdminApiError ? error.status : 500;
      return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Audit view is unavailable." }, { status, headers });
    }
  };
}
