import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";

export async function requireFleetOfficeAccess(request: Request, write = false) {
  const user = await requireVerifiedUser(request);
  const admin = createServerSupabaseAdmin();
  const access = await resolveAccountAccess(admin, user);
  if (!hasPermission(access, write ? "business:write" : "business:read")) {
    throw new AdminApiError(403, "EES office access is required.");
  }
  return { user, admin, access };
}
