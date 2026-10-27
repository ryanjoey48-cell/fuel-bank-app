import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { hasPermission } from "@/lib/authorization";

export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:write")) throw new AdminApiError(403, "You do not have permission to change monthly Vehicle Performance records.");
    const { data, error } = await admin.from("vehicle_financial_write_control")
      .select("mode").eq("control_key", "vehicle_monthly_performance").maybeSingle();
    const errorCode = (error as { code?: unknown } | null)?.code;
    if (error && (errorCode === "42P01" || errorCode === "PGRST205" || /relation .* does not exist/i.test(error.message))) {
      return NextResponse.json({ mode: "legacy_enabled", migrationReady: false });
    }
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "write_control_missing", migrationReady: true }, { status: 503 });
    if (data.mode !== "legacy_enabled" && data.mode !== "v4_only") {
      return NextResponse.json({ error: "write_control_invalid", migrationReady: true }, { status: 503 });
    }
    return NextResponse.json({ mode: data.mode, migrationReady: true });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check the monthly Vehicle Performance write mode." }, { status });
  }
}
