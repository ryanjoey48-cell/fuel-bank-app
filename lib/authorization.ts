export const ACCOUNT_ROLES = ["admin", "office_staff", "read_only"] as const;
export const ACCOUNT_STATUSES = ["active", "suspended"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type Permission =
  | "admin:support_tickets"
  | "admin:user_management"
  | "admin:security_settings"
  | "business:read"
  | "business:write"
  | "business:delete"
  | "business:import";

export type AccountAccess = {
  userId: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  lastAccessChangedAt: string | null;
};

export const ROLE_PERMISSIONS: Record<AccountRole, Permission[]> = {
  admin: [
    "admin:support_tickets",
    "admin:user_management",
    "admin:security_settings",
    "business:read",
    "business:write",
    "business:delete",
    "business:import"
  ],
  office_staff: ["business:read", "business:write", "business:delete", "business:import"],
  read_only: ["business:read"]
};

export function normalizeAccountRole(value: unknown): AccountRole {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "administrator") return "admin";
  if (normalized === "staff" || normalized === "office" || normalized === "office_user") return "office_staff";
  if (normalized === "readonly" || normalized === "read") return "read_only";
  return ACCOUNT_ROLES.includes(normalized as AccountRole) ? (normalized as AccountRole) : "office_staff";
}

export function normalizeAccountStatus(value: unknown): AccountStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "suspended" ? "suspended" : "active";
}

export function hasPermission(access: Pick<AccountAccess, "role" | "status"> | null | undefined, permission: Permission) {
  if (!access || access.status !== "active") return false;
  return ROLE_PERMISSIONS[access.role]?.includes(permission) ?? false;
}

export function isActiveAdmin(access: Pick<AccountAccess, "role" | "status"> | null | undefined) {
  return hasPermission(access, "admin:user_management");
}

export function roleDisplayKey(role: AccountRole) {
  if (role === "admin") return "administrator";
  if (role === "read_only") return "readOnly";
  return "officeStaff";
}
