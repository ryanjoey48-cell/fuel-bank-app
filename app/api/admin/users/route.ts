import { NextResponse } from "next/server";
import { AdminApiError, listAccountHistory, requireAdminAccess, type ServerManagedAccount } from "@/lib/admin-user-management-server";
import { normalizeAccountRole, normalizeAccountStatus, type AccountRole, type AccountStatus } from "@/lib/authorization";

type AccessRow = {
  user_id: string;
  display_name: string | null;
  role: string | null;
  status: string | null;
  last_access_changed_at: string | null;
};

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function matchesFilters(user: ServerManagedAccount, filters: { search: string; role: string; status: string }) {
  const search = filters.search.trim().toLowerCase();
  if (search && !`${user.displayName} ${user.email}`.toLowerCase().includes(search)) return false;
  if (filters.role && user.role !== normalizeAccountRole(filters.role)) return false;
  if (filters.status && user.status !== normalizeAccountStatus(filters.status)) return false;
  return true;
}

function emptySummary() {
  return { total: 0, admin: 0, officeStaff: 0, readOnly: 0, suspended: 0 };
}

function metaString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    const { admin, user: currentUser } = await requireAdminAccess(request);
    const url = new URL(request.url);
    const page = numberParam(url.searchParams.get("page"), 1, 1, 500);
    const pageSize = numberParam(url.searchParams.get("pageSize"), 20, 5, 50);
    const filters = {
      search: url.searchParams.get("search") ?? "",
      role: url.searchParams.get("role") ?? "",
      status: url.searchParams.get("status") ?? ""
    };

    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: pageSize });
    if (error) throw new AdminApiError(500, "Unable to list Supabase Auth users.");

    const userIds = data.users.map((account) => account.id);
    const [{ data: accessRows, error: accessError }, histories] = userIds.length
      ? await Promise.all([
          admin
            .from("account_access")
            .select("user_id,display_name,role,status,last_access_changed_at")
            .in("user_id", userIds),
          listAccountHistory(admin, userIds)
        ])
      : [{ data: [], error: null }, new Map()];

    if (accessError) {
      if (accessError.code === "42P01" || /account_access/i.test(accessError.message)) {
        throw new AdminApiError(503, "User Management setup required. Apply the Admin User Management migration before using administrator features.");
      }
      throw accessError;
    }

    const accessByUserId = new Map((accessRows ?? []).map((row) => [row.user_id, row as AccessRow]));
    const users = data.users.map((account) => {
      const row = accessByUserId.get(account.id);
      const metadata = account.user_metadata as Record<string, unknown> | undefined;
      const displayName =
        row?.display_name?.trim() ||
        metaString(metadata, "name") ||
        metaString(metadata, "full_name") ||
        account.email ||
        "Account";
      const role = row ? normalizeAccountRole(row.role) : "office_staff";
      const status = row ? normalizeAccountStatus(row.status) : "active";

      return {
        userId: account.id,
        email: account.email ?? "",
        displayName,
        role,
        status,
        lastAccessChangedAt: row?.last_access_changed_at ?? null,
        emailConfirmedAt: account.email_confirmed_at ?? account.confirmed_at ?? null,
        createdAt: account.created_at ?? null,
        lastSignInAt: account.last_sign_in_at ?? null,
        isCurrentUser: account.id === currentUser.id,
        history: histories.get(account.id) ?? []
      } satisfies ServerManagedAccount;
    });

    const visibleUsers = users.filter((account) => matchesFilters(account, filters));
    const summary = visibleUsers.reduce((acc, account) => {
      acc.total += 1;
      if (account.role === "admin") acc.admin += 1;
      if (account.role === "office_staff") acc.officeStaff += 1;
      if (account.role === "read_only") acc.readOnly += 1;
      if (account.status === "suspended") acc.suspended += 1;
      return acc;
    }, emptySummary());

    return NextResponse.json({
      users: visibleUsers,
      summary,
      page,
      pageSize,
      total: typeof data.total === "number" ? data.total : visibleUsers.length
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load user accounts." }, { status: 500 });
  }
}
