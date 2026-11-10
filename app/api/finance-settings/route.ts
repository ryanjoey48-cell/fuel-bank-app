import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess, requireVerifiedUser } from "@/lib/admin-user-management-server";
import { isFinanceLocalStoreEnabled } from "@/lib/finance-local-store-server";
import { readFinanceSettings, writeFinanceSettings } from "@/lib/finance-settings-server";
import { isValidFinanceStartDate } from "@/lib/finance-settings";

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function failure(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Any signed-in office user can read the setting (the Admin Intake list needs it). */
export async function GET(request: Request) {
  try {
    if (hasSupabaseEnv()) await requireVerifiedUser(request);
    const settings = await readFinanceSettings();
    return NextResponse.json({ settings, editable: isFinanceLocalStoreEnabled() });
  } catch (error) {
    return failure(error, "Unable to read Finance settings.");
  }
}

/** Only an active Admin / Super Admin can change it — checked here on the server, not just hidden in the UI. */
export async function PUT(request: Request) {
  try {
    if (!isFinanceLocalStoreEnabled()) return NextResponse.json({ error: "Finance settings are not editable here." }, { status: 404 });
    if (!hasSupabaseEnv()) return NextResponse.json({ error: "Administrator permission required." }, { status: 403 });
    const { access } = await requireAdminAccess(request);
    const body = (await request.json().catch(() => null)) as { startDate?: unknown } | null;
    if (!isValidFinanceStartDate(body?.startDate)) {
      return NextResponse.json({ error: "Start date must be a valid date (YYYY-MM-DD)." }, { status: 400 });
    }
    const settings = await writeFinanceSettings({ startDate: body.startDate }, access.displayName || access.email || access.userId);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return failure(error, "Unable to save Finance settings.");
  }
}
