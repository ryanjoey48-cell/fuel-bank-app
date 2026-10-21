import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { getForthTimestampFormatDiagnostic } from "@/lib/forth-tracking-server";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:read")) {
      throw new AdminApiError(403, "EES office access is required.");
    }

    if (process.env.FORTH_TIMESTAMP_DIAGNOSTIC_ENABLED !== "true") {
      return NextResponse.json({ error: "Timestamp format diagnostic is disabled." }, { status: 404, headers: privateNoStoreHeaders });
    }

    if (new URL(request.url).searchParams.get("confirm") !== "format-only") {
      return NextResponse.json({ error: "Add confirm=format-only to request one redacted format inspection." }, { status: 400, headers: privateNoStoreHeaders });
    }

    return NextResponse.json(await getForthTimestampFormatDiagnostic(), { headers: privateNoStoreHeaders });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const message = error instanceof AdminApiError ? error.message : "Forth timestamp format diagnostic is unavailable.";
    return NextResponse.json({ error: message }, { status, headers: privateNoStoreHeaders });
  }
}
