import { NextResponse } from "next/server";
import {
  AdminApiError,
  countOtherActiveAdmins,
  getTargetUser,
  listAccountHistory,
  recordAccessAudit,
  requireAdminAccess,
  resolveAccountAccess,
  type ServerManagedAccount
} from "@/lib/admin-user-management-server";
import { ACCOUNT_ROLES, ACCOUNT_STATUSES, normalizeAccountRole, normalizeAccountStatus } from "@/lib/authorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function cleanDisplayName(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  if (!text) throw new AdminApiError(400, "Display name cannot be blank.");
  if (text.length > 80) throw new AdminApiError(400, "Display name must be 80 characters or less.");
  return text;
}

function parseRole(value: unknown) {
  if (value === undefined) return undefined;
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!(ACCOUNT_ROLES as readonly string[]).includes(normalized)) throw new AdminApiError(400, "Invalid account role.");
  return normalizeAccountRole(normalized);
}

function parseStatus(value: unknown) {
  if (value === undefined) return undefined;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!(ACCOUNT_STATUSES as readonly string[]).includes(normalized)) throw new AdminApiError(400, "Invalid account status.");
  return normalizeAccountStatus(normalized);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id: targetUserId } = await context.params;
  let actor: Awaited<ReturnType<typeof requireAdminAccess>> | null = null;
  let targetDisplayName: string | null = null;
  let previousRole = null;
  let previousStatus = null;
  let nextRole = null;
  let nextStatus = null;

  try {
    actor = await requireAdminAccess(request);
    const body = await request.json().catch(() => ({}));
    const role = parseRole(body.role);
    const status = parseStatus(body.status);
    const displayName = cleanDisplayName(body.displayName);

    if (role === undefined && status === undefined && displayName === undefined) {
      throw new AdminApiError(400, "No account changes were requested.");
    }

    const targetUser = await getTargetUser(actor.admin, targetUserId);
    const targetAccess = await resolveAccountAccess(actor.admin, targetUser);
    targetDisplayName = targetAccess.displayName;
    previousRole = targetAccess.role;
    previousStatus = targetAccess.status;
    nextRole = role ?? targetAccess.role;
    nextStatus = status ?? targetAccess.status;

    if (targetUser.id === actor.user.id && nextStatus === "suspended") {
      throw new AdminApiError(400, "Administrators cannot suspend their own signed-in account.");
    }

    if (targetAccess.role === "admin" && targetAccess.status === "active" && (nextRole !== "admin" || nextStatus !== "active")) {
      const otherAdmins = await countOtherActiveAdmins(actor.admin, targetUser.id);
      if (otherAdmins < 1) {
        throw new AdminApiError(400, "The final active administrator cannot be demoted or suspended.");
      }
    }

    const updatePayload = {
      user_id: targetUser.id,
      display_name: displayName ?? targetAccess.displayName,
      role: nextRole,
      status: nextStatus,
      last_access_changed_at: new Date().toISOString(),
      changed_by: actor.user.id
    };

    const { error: accessError } = await actor.admin
      .from("account_access")
      .upsert(updatePayload, { onConflict: "user_id" });

    if (accessError) throw new AdminApiError(500, "Unable to update account access. Apply the account access migration first.");

    if (displayName !== undefined) {
      const metadata = targetUser.user_metadata as Record<string, unknown> | undefined;
      const { error: metadataError } = await actor.admin.auth.admin.updateUserById(targetUser.id, {
        user_metadata: {
          ...(metadata ?? {}),
          name: displayName,
          full_name: displayName
        }
      });
      if (metadataError) throw new AdminApiError(500, "Access changed, but display name metadata could not be updated.");
    }

    await recordAccessAudit(actor.admin, {
      actorUserId: actor.user.id,
      actorDisplayName: actor.access.displayName,
      targetUserId: targetUser.id,
      targetDisplayName: displayName ?? targetAccess.displayName,
      action: "change_access",
      previousRole,
      newRole: nextRole,
      previousStatus,
      newStatus: nextStatus,
      success: true
    });

    const updatedAccess = await resolveAccountAccess(actor.admin, targetUser);
    const history = await listAccountHistory(actor.admin, [targetUser.id]);
    const user = {
      ...updatedAccess,
      emailConfirmedAt: targetUser.email_confirmed_at ?? targetUser.confirmed_at ?? null,
      createdAt: targetUser.created_at ?? null,
      lastSignInAt: targetUser.last_sign_in_at ?? null,
      isCurrentUser: targetUser.id === actor.user.id,
      history: history.get(targetUser.id) ?? []
    } satisfies ServerManagedAccount;

    return NextResponse.json({ user });
  } catch (error) {
    if (actor) {
      await recordAccessAudit(actor.admin, {
        actorUserId: actor.user.id,
        actorDisplayName: actor.access.displayName,
        targetUserId,
        targetDisplayName,
        action: "change_access",
        previousRole,
        newRole: nextRole,
        previousStatus,
        newStatus: nextStatus,
        success: false,
        reason: error instanceof Error ? error.message : "Unknown access-change failure."
      });
    }

    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to update account access." }, { status: 500 });
  }
}
