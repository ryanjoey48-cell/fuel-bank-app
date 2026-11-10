import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import {
  AdminApiError,
  createServerSupabaseAdmin,
  requireVerifiedUser,
  resolveAccountAccess
} from "@/lib/admin-user-management-server";
import {
  applyForthSpeedConfigOfficeAction,
  buildForthSpeedConfigCatalogueView,
  listForthSpeedConfigAudit,
  type ForthSpeedConfigOfficeAction
} from "@/lib/forth-speed-config-server";
import { getForthSpeedConfigVersion, listForthSpeedDeviceConfigs } from "@/lib/forth-speed-config";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

const WRITE_ACTIONS = new Set<ForthSpeedConfigOfficeAction>(["office_confirmed", "conflict", "cleared"]);

export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:read")) {
      throw new AdminApiError(403, "EES office access is required to view speed settings.");
    }

    const url = new URL(request.url);
    const includeAudit = url.searchParams.get("audit") === "1";
    const registrationKey = url.searchParams.get("registrationKey")?.trim() || undefined;

    let catalogue;
    let audit = [] as Awaited<ReturnType<typeof listForthSpeedConfigAudit>>;
    try {
      catalogue = await buildForthSpeedConfigCatalogueView(admin);
      if (includeAudit) {
        audit = await listForthSpeedConfigAudit(admin, { registrationKey, limit: 100 });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      // Migration may not be applied yet — still return the owner catalogue.
      if (/relation .*forth_speed_config_/i.test(message) || /Could not find the table/i.test(message)) {
        return NextResponse.json({
          version: getForthSpeedConfigVersion(),
          canWrite: hasPermission(access, "business:write"),
          migrationApplied: false,
          catalogue: listForthSpeedDeviceConfigs().map((config) => ({ config, officeReview: null })),
          audit: [],
          notice: "Speed-config audit tables are not applied yet. Owner-reported catalogue is available read-only."
        }, { headers: privateNoStoreHeaders });
      }
      throw error;
    }

    return NextResponse.json({
      version: getForthSpeedConfigVersion(),
      canWrite: hasPermission(access, "business:write"),
      migrationApplied: true,
      catalogue,
      audit,
      notice: null
    }, { headers: privateNoStoreHeaders });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const message = error instanceof AdminApiError ? error.message : "Speed configuration is unavailable.";
    return NextResponse.json({ error: message }, { status, headers: privateNoStoreHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:write")) {
      throw new AdminApiError(403, "Only authorised office administrators or staff may approve or modify speed-config reviews.");
    }

    const body = await request.json().catch(() => null);
    const action = body && typeof body.action === "string" ? body.action.trim() : "";
    const registration = body && typeof body.registration === "string" ? body.registration.trim() : "";
    const note = body && typeof body.note === "string" ? body.note : "";
    const reason = body && typeof body.reason === "string" ? body.reason : "";

    if (!registration || !WRITE_ACTIONS.has(action as ForthSpeedConfigOfficeAction)) {
      throw new AdminApiError(400, "A catalogue registration and a valid office action are required.");
    }

    try {
      const result = await applyForthSpeedConfigOfficeAction(admin, {
        registrationKeyOrDisplay: registration,
        action: action as ForthSpeedConfigOfficeAction,
        note,
        reason,
        reviewerUserId: access.userId,
        reviewerName: access.displayName || access.email || "Office"
      });
      return NextResponse.json({
        ok: true,
        migrationApplied: true,
        independentlyVerified: false,
        forthUnchanged: true,
        result
      }, { headers: privateNoStoreHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (/relation .*forth_speed_config_/i.test(message) || /Could not find the table/i.test(message)) {
        throw new AdminApiError(503, "Speed-config audit migration is not applied yet. Ask an administrator to run supabase/migrations/20261029100000_forth_speed_config_audit.sql before office approvals.");
      }
      if (/not in the owner-reported/i.test(message)) {
        throw new AdminApiError(400, message);
      }
      throw error;
    }
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const message = error instanceof AdminApiError ? error.message : "Unable to save speed-config review.";
    return NextResponse.json({ error: message }, { status, headers: privateNoStoreHeaders });
  }
}
