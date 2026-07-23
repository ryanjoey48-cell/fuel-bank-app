"use client";

import { supabase } from "@/lib/supabase";
import type { AccountRole, AccountStatus, AccountAccess } from "@/lib/authorization";

export type ManagedAccountHistory = {
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
};

export type ManagedAccount = AccountAccess & {
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  isCurrentUser: boolean;
  history: ManagedAccountHistory[];
};

export type ManagedAccountSummary = {
  total: number;
  admin: number;
  officeStaff: number;
  readOnly: number;
  suspended: number;
};

export type ManagedAccountList = {
  users: ManagedAccount[];
  summary: ManagedAccountSummary;
  page: number;
  pageSize: number;
  total: number;
};

export async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Authentication required.");
  return token;
}

export class AdminFetchError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminFetchError";
    this.status = status;
  }
}

async function adminFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new AdminFetchError(payload?.status || response.status, payload?.error || `Request failed with status ${response.status}.`);
  }

  return payload as T;
}

export async function fetchCurrentAccess() {
  return adminFetch<{ access: AccountAccess; permissions: string[] }>("/api/admin/me");
}

export async function fetchManagedAccounts(params: {
  page: number;
  pageSize: number;
  search?: string;
  role?: string;
  status?: string;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize)
  });
  if (params.search) query.set("search", params.search);
  if (params.role) query.set("role", params.role);
  if (params.status) query.set("status", params.status);
  return adminFetch<ManagedAccountList>(`/api/admin/users?${query.toString()}`);
}

export async function updateManagedAccount(userId: string, payload: {
  role?: AccountRole;
  status?: AccountStatus;
  displayName?: string;
}) {
  return adminFetch<{ user: ManagedAccount }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function sendManagedAccountPasswordReset(userId: string) {
  return adminFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}/password-reset`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
