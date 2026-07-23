import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  LEGACY_ADMIN_EMAIL,
  ROLE_PERMISSIONS,
  isActiveAdmin,
  isLegacyAdminEmail,
  normalizeAccountRole,
  normalizeAccountStatus,
  type AccountAccess,
  type AccountRole,
  type AccountStatus
} from "@/lib/authorization";

type AccessRow = {
  user_id: string;
  display_name: string | null;
  role: string | null;
  status: string | null;
  last_access_changed_at: string | null;
};

export type AuditRow = {
  id: string;
  action: string;
  actor_display_name: string | null;
  target_display_name: string | null;
  previous_role: string | null;
  new_role: string | null;
  previous_status: string | null;
  new_status: string | null;
  success: boolean | null;
  created_at: string;
};

export type ServerManagedAccount = AccountAccess & {
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  isCurrentUser: boolean;
  history: Array<{
    id: string;
    action: string;
    actorDisplayName: string;
    targetDisplayName: string;
    previousRole: AccountRole | null;
    newRole: AccountRole | null;
    previousStatus: AccountStatus | null;
    newStatus: AccountStatus | null;
    success: boolean;
    createdAt: string;
  }>;
};

const ACCOUNT_ACCESS_TABLE = "account_access";
const ACCOUNT_AUDIT_TABLE = "account_access_audit";

export class AdminApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new AdminApiError(500, "Supabase public environment is not configured.");
  return { url, anonKey };
}

function adminSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new AdminApiError(500, "Supabase service role is not configured on the server.");
  return { url, serviceKey };
}

export function createServerSupabaseAdmin() {
  const { url, serviceKey } = adminSupabaseConfig();
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function createServerSupabasePublic() {
  const { url, anonKey } = publicSupabaseConfig();
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function getUserDisplayName(user: Pick<User, "email" | "user_metadata"> | null | undefined, accessName?: string | null) {
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  const metaName = metadata?.name ?? metadata?.full_name;
  if (typeof accessName === "string" && accessName.trim()) return accessName.trim();
  if (typeof metaName === "string" && metaName.trim()) return metaName.trim();
  if (isLegacyAdminEmail(user?.email)) return "Joey Ryan";
  return user?.email ?? "Account";
}

export async function requireVerifiedUser(request: Request) {
  const token = getBearerToken(request);
  if (!token) throw new AdminApiError(401, "Authentication required.");

  const supabase = createServerSupabasePublic();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new AdminApiError(401, "Authentication required.");
  return data.user;
}

async function readAccessRow(admin: SupabaseClient, user: User) {
  const { data, error } = await admin
    .from(ACCOUNT_ACCESS_TABLE)
    .select("user_id,display_name,role,status,last_access_changed_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /account_access/i.test(error.message)) {
      return null;
    }
    throw error;
  }

  return data as AccessRow | null;
}

export async function resolveAccountAccess(admin: SupabaseClient, user: User): Promise<AccountAccess> {
  const row = await readAccessRow(admin, user);
  const metadataRole = (user.user_metadata as Record<string, unknown> | undefined)?.role;
  const appRole = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  const role = row ? normalizeAccountRole(row.role) : isLegacyAdminEmail(user.email) ? "admin" : normalizeAccountRole(appRole ?? metadataRole);
  const status = row ? normalizeAccountStatus(row.status) : "active";

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName: getUserDisplayName(user, row?.display_name),
    role,
    status,
    lastAccessChangedAt: row?.last_access_changed_at ?? null
  };
}

export async function requireAdminAccess(request: Request) {
  const admin = createServerSupabaseAdmin();
  const user = await requireVerifiedUser(request);
  const access = await resolveAccountAccess(admin, user);

  if (!isActiveAdmin(access)) {
    await recordAccessAudit(admin, {
      actorUserId: user.id,
      actorDisplayName: access.displayName,
      targetUserId: null,
      targetDisplayName: null,
      action: "unauthorized_admin_api",
      previousRole: null,
      newRole: null,
      previousStatus: null,
      newStatus: null,
      success: false,
      reason: "Caller is not an active administrator."
    });
    throw new AdminApiError(access.status === "suspended" ? 403 : 403, "Administrator permission required.");
  }

  return { admin, user, access };
}

export async function recordAccessAudit(admin: SupabaseClient, payload: {
  actorUserId: string | null;
  actorDisplayName: string | null;
  targetUserId: string | null;
  targetDisplayName: string | null;
  action: string;
  previousRole: AccountRole | null;
  newRole: AccountRole | null;
  previousStatus: AccountStatus | null;
  newStatus: AccountStatus | null;
  success: boolean;
  reason?: string;
}) {
  const { error } = await admin.from(ACCOUNT_AUDIT_TABLE).insert({
    actor_user_id: payload.actorUserId,
    actor_display_name: payload.actorDisplayName,
    target_user_id: payload.targetUserId,
    target_display_name: payload.targetDisplayName,
    action: payload.action,
    previous_role: payload.previousRole,
    new_role: payload.newRole,
    previous_status: payload.previousStatus,
    new_status: payload.newStatus,
    success: payload.success,
    failure_reason: payload.reason ?? null
  });

  if (error && error.code !== "42P01") {
    console.warn("Account access audit write skipped:", error.message);
  }
}

export async function listAccountHistory(admin: SupabaseClient, userIds: string[]) {
  if (!userIds.length) return new Map<string, ServerManagedAccount["history"]>();

  const { data, error } = await admin
    .from(ACCOUNT_AUDIT_TABLE)
    .select("id,action,actor_display_name,target_display_name,previous_role,new_role,previous_status,new_status,success,created_at,target_user_id")
    .in("target_user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(Math.max(25, userIds.length * 5));

  const map = new Map<string, ServerManagedAccount["history"]>();
  if (error) return map;

  for (const row of (data ?? []) as Array<AuditRow & { target_user_id: string }>) {
    const entries = map.get(row.target_user_id) ?? [];
    if (entries.length >= 5) continue;
    entries.push({
      id: row.id,
      action: row.action,
      actorDisplayName: row.actor_display_name ?? "-",
      targetDisplayName: row.target_display_name ?? "-",
      previousRole: row.previous_role ? normalizeAccountRole(row.previous_role) : null,
      newRole: row.new_role ? normalizeAccountRole(row.new_role) : null,
      previousStatus: row.previous_status ? normalizeAccountStatus(row.previous_status) : null,
      newStatus: row.new_status ? normalizeAccountStatus(row.new_status) : null,
      success: row.success !== false,
      createdAt: row.created_at
    });
    map.set(row.target_user_id, entries);
  }

  return map;
}

export async function getTargetUser(admin: SupabaseClient, targetUserId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) throw new AdminApiError(400, "Invalid user ID.");
  const { data, error } = await admin.auth.admin.getUserById(targetUserId);
  if (error || !data.user) throw new AdminApiError(404, "User account not found.");
  return data.user;
}

export async function countOtherActiveAdmins(admin: SupabaseClient, targetUserId: string) {
  const { count, error } = await admin
    .from(ACCOUNT_ACCESS_TABLE)
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "active")
    .neq("user_id", targetUserId);

  if (error) {
    if (error.code === "42P01") return isLegacyAdminEmail(LEGACY_ADMIN_EMAIL) ? 1 : 0;
    throw error;
  }

  return count ?? 0;
}

export function permissionsFor(access: AccountAccess) {
  return access.status === "active" ? ROLE_PERMISSIONS[access.role] : [];
}
