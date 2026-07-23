import { NextResponse } from "next/server";
import { AdminApiError, getTargetUser, recordAccessAudit, requireAdminAccess, resolveAccountAccess } from "@/lib/admin-user-management-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: targetUserId } = await context.params;
  let actor: Awaited<ReturnType<typeof requireAdminAccess>> | null = null;
  let targetDisplayName: string | null = null;

  try {
    actor = await requireAdminAccess(request);
    const targetUser = await getTargetUser(actor.admin, targetUserId);
    const targetAccess = await resolveAccountAccess(actor.admin, targetUser);
    targetDisplayName = targetAccess.displayName;

    if (!targetUser.email) throw new AdminApiError(400, "Target account has no email address.");

    const redirectTo = new URL("/change-password", request.url).toString();
    const { error } = await actor.admin.auth.resetPasswordForEmail(targetUser.email, { redirectTo });
    if (error) throw new AdminApiError(500, "Unable to send password reset email.");

    await recordAccessAudit(actor.admin, {
      actorUserId: actor.user.id,
      actorDisplayName: actor.access.displayName,
      targetUserId: targetUser.id,
      targetDisplayName,
      action: "send_password_reset",
      previousRole: targetAccess.role,
      newRole: targetAccess.role,
      previousStatus: targetAccess.status,
      newStatus: targetAccess.status,
      success: true
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (actor) {
      await recordAccessAudit(actor.admin, {
        actorUserId: actor.user.id,
        actorDisplayName: actor.access.displayName,
        targetUserId,
        targetDisplayName,
        action: "send_password_reset",
        previousRole: null,
        newRole: null,
        previousStatus: null,
        newStatus: null,
        success: false,
        reason: error instanceof Error ? error.message : "Unknown password reset failure."
      });
    }

    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to send password reset email." }, { status: 500 });
  }
}
