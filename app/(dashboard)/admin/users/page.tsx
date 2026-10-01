"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  X,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PendingDriverRequests } from "@/components/admin/pending-driver-requests";
import {
  fetchManagedAccounts,
  sendManagedAccountPasswordReset,
  updateManagedAccount,
  type ManagedAccount
} from "@/lib/account-management";
import { ACCOUNT_ROLES, ACCOUNT_STATUSES, roleDisplayKey, type AccountRole, type AccountStatus } from "@/lib/authorization";
import { useLanguage } from "@/lib/language-provider";

const PAGE_SIZE = 20;

type PendingAction =
  | { type: "role"; user: ManagedAccount; role: AccountRole }
  | { type: "status"; user: ManagedAccount; status: AccountStatus }
  | { type: "name"; user: ManagedAccount; displayName: string }
  | { type: "password"; user: ManagedAccount };

function formatDate(value: string | null | undefined, language: "en" | "th") {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function statusClass(status: AccountStatus) {
  return status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function roleClass(role: AccountRole) {
  if (role === "admin") return "border-violet-200 bg-violet-50 text-violet-700";
  if (role === "office_staff") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function SummaryCard({
  label,
  value,
  description,
  active = false,
  onClick
}: {
  label: string;
  value: number;
  description: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-2xl border px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-brand-300 bg-brand-50/70" : "border-violet-100 bg-white"
      )}
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black leading-none text-brand-700">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </button>
  );
}

export default function AdminUsersPage() {
  const { language, t } = useLanguage();
  const [users, setUsers] = useState<ManagedAccount[]>([]);
  const [summary, setSummary] = useState({ total: 0, admin: 0, officeStaff: 0, readOnly: 0, suspended: 0 });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [managedUserId, setManagedUserId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchManagedAccounts({
        page,
        pageSize: PAGE_SIZE,
        search,
        role: roleFilter,
        status: statusFilter
      });
      setUsers(result.users);
      setSummary(result.summary);
      setTotal(result.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.adminUsers.loadError);
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, search, statusFilter, t.adminUsers.loadError]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    setPage(1);
  }, [roleFilter, search, statusFilter]);

  const managedUser = useMemo(
    () => users.find((user) => user.userId === managedUserId) ?? null,
    [managedUserId, users]
  );

  useEffect(() => {
    if (managedUser) setNameInput(managedUser.displayName);
  }, [managedUser]);

  const actionText = useMemo(() => {
    if (!pendingAction) return "";
    if (pendingAction.type === "role") {
      return t.adminUsers.confirmRoleChange
        .replace("{name}", pendingAction.user.displayName)
        .replace("{role}", t.adminUsers.roles[roleDisplayKey(pendingAction.role)]);
    }
    if (pendingAction.type === "status") {
      return pendingAction.status === "suspended"
        ? t.adminUsers.confirmSuspend.replace("{name}", pendingAction.user.displayName)
        : t.adminUsers.confirmReactivate.replace("{name}", pendingAction.user.displayName);
    }
    if (pendingAction.type === "name") {
      return t.adminUsers.confirmNameChange
        .replace("{name}", pendingAction.user.displayName)
        .replace("{newName}", pendingAction.displayName);
    }
    return t.adminUsers.confirmPasswordReset.replace("{name}", pendingAction.user.displayName);
  }, [pendingAction, t.adminUsers]);

  const completePendingAction = async () => {
    if (!pendingAction) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (pendingAction.type === "password") {
        await sendManagedAccountPasswordReset(pendingAction.user.userId);
        setSuccess(t.adminUsers.passwordResetSent);
      } else {
        const payload =
          pendingAction.type === "role"
            ? { role: pendingAction.role }
            : pendingAction.type === "status"
              ? { status: pendingAction.status }
              : { displayName: pendingAction.displayName };
        const result = await updateManagedAccount(pendingAction.user.userId, payload);
        setUsers((current) => current.map((user) => (user.userId === result.user.userId ? result.user : user)));
        setSuccess(t.adminUsers.updateSuccess);
      }
      setPendingAction(null);
      void loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.adminUsers.updateError);
    } finally {
      setSaving(false);
    }
  };

  const applySummaryFilter = (type: "all" | "admin" | "staff" | "suspended") => {
    setSearch("");
    if (type === "all") {
      setRoleFilter("");
      setStatusFilter("");
    } else if (type === "admin") {
      setRoleFilter("admin");
      setStatusFilter("");
    } else if (type === "staff") {
      setRoleFilter("office_staff");
      setStatusFilter("");
    } else {
      setRoleFilter("");
      setStatusFilter("suspended");
    }
  };

  return (
    <>
      <PendingDriverRequests />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={t.adminUsers.totalAccounts}
          value={summary.total}
          description="Everyone with access to EES"
          active={!roleFilter && !statusFilter}
          onClick={() => applySummaryFilter("all")}
        />
        <SummaryCard
          label={t.adminUsers.roles.administrator}
          value={summary.admin}
          description="Full system access"
          active={roleFilter === "admin" && !statusFilter}
          onClick={() => applySummaryFilter("admin")}
        />
        <SummaryCard
          label={t.adminUsers.roles.officeStaff}
          value={summary.officeStaff}
          description="Day-to-day operational access"
          active={roleFilter === "office_staff" && !statusFilter}
          onClick={() => applySummaryFilter("staff")}
        />
        <SummaryCard
          label={t.adminUsers.statuses.suspended}
          value={summary.suspended}
          description="Accounts currently blocked"
          active={statusFilter === "suspended"}
          onClick={() => applySummaryFilter("suspended")}
        />
      </section>

      <section className="mt-4 overflow-hidden rounded-[1.4rem] border border-violet-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-white via-white to-violet-50/60 px-4 py-5 sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">Access control</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Application accounts</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                See who can access EES, what level they have and when they last signed in. Open Manage only when you need to change an account.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_10rem_10rem_auto]">
              <label>
                <span className="form-label">{t.adminUsers.search}</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="form-input bg-white pl-9"
                    placeholder={t.adminUsers.searchPlaceholder}
                  />
                </div>
              </label>
              <label>
                <span className="form-label">{t.profile.role}</span>
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="form-input bg-white">
                  <option value="">{t.adminUsers.allRoles}</option>
                  {ACCOUNT_ROLES.map((role) => (
                    <option key={role} value={role}>{t.adminUsers.roles[roleDisplayKey(role)]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="form-label">{t.adminUsers.accountStatus}</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="form-input bg-white">
                  <option value="">{t.adminUsers.allStatuses}</option>
                  {ACCOUNT_STATUSES.map((status) => (
                    <option key={status} value={status}>{t.adminUsers.statuses[status]}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void loadUsers()} className="btn-secondary self-end">
                <RefreshCw className="h-4 w-4" />
                {t.support.refresh}
              </button>
            </div>
          </div>
        </div>

        {success ? <p className="mx-4 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 sm:mx-5">{success}</p> : null}
        {error ? <p className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 sm:mx-5">{error}</p> : null}

        <div className="hidden min-[980px]:block">
          <table className="w-full text-sm">
            <thead className="bg-violet-50/60">
              <tr>
                {["User", "Access", "Status", "Last sign-in", "Security", "Manage"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-slate-500">{t.adminUsers.loading}</td></tr>
              ) : users.map((user) => (
                <tr key={user.userId} className="border-t border-slate-100 align-middle transition hover:bg-violet-50/30">
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2 font-bold text-slate-950">
                      <span>{user.displayName}</span>
                      {user.isCurrentUser ? (
                        <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">Primary account</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", roleClass(user.role))}>
                      {t.adminUsers.roles[roleDisplayKey(user.role)]}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", statusClass(user.status))}>
                      {t.adminUsers.statuses[user.status]}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{formatDate(user.lastSignInAt, language)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      {user.emailConfirmedAt ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                      {user.emailConfirmedAt ? "Email confirmed" : "Email not confirmed"}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <button type="button" onClick={() => setManagedUserId(user.userId)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-4 min-[980px]:hidden">
          {loading ? <p className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">{t.adminUsers.loading}</p> : null}
          {!loading && users.map((user) => (
            <article key={user.userId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words font-bold text-slate-950">{user.displayName}</h3>
                    {user.isCurrentUser ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">Primary account</span> : null}
                  </div>
                  <p className="mt-1 break-all text-xs text-slate-500">{user.email}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", roleClass(user.role))}>{t.adminUsers.roles[roleDisplayKey(user.role)]}</span>
                <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", statusClass(user.status))}>{t.adminUsers.statuses[user.status]}</span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Info label="Last sign-in" value={formatDate(user.lastSignInAt, language)} />
                <Info label="Email security" value={user.emailConfirmedAt ? "Confirmed" : "Not confirmed"} />
              </div>
              <button type="button" onClick={() => setManagedUserId(user.userId)} className="btn-secondary mt-4 w-full">Manage account</button>
            </article>
          ))}
        </div>

        {!loading && users.length === 0 ? (
          <div className="m-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center sm:m-5">
            <UserCog className="mx-auto h-6 w-6 text-slate-400" />
            <p className="mt-2 font-semibold text-slate-800">{t.adminUsers.noUsers}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold text-slate-500">{t.adminUsers.totalCount.replace("{count}", String(total))}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              {t.adminUsers.previous}
            </button>
            <span className="text-sm font-bold text-slate-600">{page} / {totalPages}</span>
            <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              {t.adminUsers.next}
            </button>
          </div>
        </div>
      </section>

      {managedUser ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 sm:p-6">
          <div className="ml-auto min-h-full w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-violet-50 px-5 py-5 sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">Manage account</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl font-semibold text-slate-950">{managedUser.displayName}</h3>
                  {managedUser.isCurrentUser ? (
                    <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">Primary account</span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">{managedUser.email}</p>
              </div>
              <button type="button" onClick={() => setManagedUserId(null)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              {managedUser.isCurrentUser ? (
                <div className="flex gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                  <div>
                    <p className="font-semibold text-slate-900">Protected primary account</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">This is your main EES administrator account. It cannot be suspended or downgraded from this screen.</p>
                  </div>
                </div>
              ) : null}

              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-brand-700" />
                  <h4 className="font-semibold text-slate-950">Profile</h4>
                </div>
                <label className="block">
                  <span className="form-label">Display name</span>
                  <div className="mt-1 flex gap-2">
                    <input value={nameInput} onChange={(event) => setNameInput(event.target.value)} className="form-input bg-white" maxLength={80} />
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      disabled={!nameInput.trim() || nameInput.trim() === managedUser.displayName}
                      onClick={() => setPendingAction({ type: "name", user: managedUser, displayName: nameInput.trim() })}
                    >
                      Save name
                    </button>
                  </div>
                </label>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-brand-700" />
                  <h4 className="font-semibold text-slate-950">Access & role</h4>
                </div>
                <label className="block">
                  <span className="form-label">Role</span>
                  <select
                    value={managedUser.role}
                    disabled={managedUser.isCurrentUser}
                    onChange={(event) => setPendingAction({ type: "role", user: managedUser, role: event.target.value as AccountRole })}
                    className="form-input bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    {ACCOUNT_ROLES.map((role) => (
                      <option key={role} value={role}>{t.adminUsers.roles[roleDisplayKey(role)]}</option>
                    ))}
                  </select>
                </label>
                <p className="mt-2 text-xs leading-5 text-slate-500">Role changes require confirmation before they are applied.</p>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-brand-700" />
                    <h4 className="font-semibold text-slate-950">Security</h4>
                  </div>
                  <p className="text-sm text-slate-600">Email {managedUser.emailConfirmedAt ? "confirmed" : "not confirmed"}</p>
                  <button type="button" onClick={() => setPendingAction({ type: "password", user: managedUser })} className="btn-secondary mt-3 w-full">
                    Send password reset email
                  </button>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <h4 className="font-semibold text-slate-950">Activity</h4>
                  <dl className="mt-3 space-y-2 text-sm">
                    <DetailLine label="Account created" value={formatDate(managedUser.createdAt, language)} />
                    <DetailLine label="Last sign-in" value={formatDate(managedUser.lastSignInAt, language)} />
                    <DetailLine label="Last access change" value={formatDate(managedUser.lastAccessChangedAt, language)} />
                  </dl>
                </div>
              </section>

              {!managedUser.isCurrentUser ? (
                <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-950">Account status</h4>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {managedUser.status === "active" ? "Suspending blocks this user from using the application." : "This account is suspended and cannot currently use the application."}
                      </p>
                      {managedUser.status === "active" ? (
                        <button type="button" onClick={() => setPendingAction({ type: "status", user: managedUser, status: "suspended" })} className="btn-secondary mt-3 text-rose-700">
                          Suspend account
                        </button>
                      ) : (
                        <button type="button" onClick={() => setPendingAction({ type: "status", user: managedUser, status: "active" })} className="btn-secondary mt-3 text-emerald-700">
                          Reactivate account
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="fixed inset-0 z-[calc(var(--z-modal)+1)] overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-lg font-semibold text-slate-950">{t.adminUsers.confirmTitle}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{actionText}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => setPendingAction(null)}>{t.common.cancel}</button>
              <button type="button" className="btn-primary disabled:opacity-60" disabled={saving} onClick={() => void completePendingAction()}>
                {saving ? t.common.saving : t.adminUsers.confirmAction}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-800">{value}</dd>
    </div>
  );
}
