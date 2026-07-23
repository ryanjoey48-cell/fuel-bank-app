import { NextResponse } from "next/server";
import { AdminApiError, listAccountHistory, requireAdminAccess, resolveAccountAccess, type ServerManagedAccount } from "@/lib/admin-user-management-server";
import { normalizeAccountRole, normalizeAccountStatus, type AccountRole, type AccountStatus } from "@/lib/authorization";

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
    const histories = await listAccountHistory(admin, userIds);
    const users = await Promise.all(data.users.map(async (account) => {
      const access = await resolveAccountAccess(admin, account);
      return {
        ...access,
        emailConfirmedAt: account.email_confirmed_at ?? account.confirmed_at ?? null,
        createdAt: account.created_at ?? null,
        lastSignInAt: account.last_sign_in_at ?? null,
        isCurrentUser: account.id === currentUser.id,
        history: histories.get(account.id) ?? []
      } satisfies ServerManagedAccount;
    }));

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
