"use client";

import clsx from "clsx";
import { CheckCircle2, RefreshCw, Search, ShieldCheck, UserCog, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
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
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
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

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black leading-none text-brand-700">{value}</p>
    </div>
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
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchManagedAccounts({ page, pageSize: PAGE_SIZE, search, role: roleFilter, status: statusFilter });
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
      setEditingNameFor(null);
      setNameInput("");
      void loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.adminUsers.updateError);
    } finally {
      setSaving(false);
    }
  };

  const startNameEdit = (user: ManagedAccount) => {
    setEditingNameFor(user.userId);
    setNameInput(user.displayName);
  };

  const UserActions = ({ user }: { user: ManagedAccount }) => (
    <div className="flex flex-wrap gap-2">
      <select
        value={user.role}
        onChange={(event) => setPendingAction({ type: "role", user, role: event.target.value as AccountRole })}
        className="min-h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-brand-200"
      >
        {ACCOUNT_ROLES.map((role) => <option key={role} value={role}>{t.adminUsers.roles[roleDisplayKey(role)]}</option>)}
      </select>
      {user.status === "active" ? (
        <button type="button" onClick={() => setPendingAction({ type: "status", user, status: "suspended" })} className="btn-secondary min-h-9 px-3 py-1.5 text-xs text-rose-700">
          {t.adminUsers.suspendAccount}
        </button>
      ) : (
        <button type="button" onClick={() => setPendingAction({ type: "status", user, status: "active" })} className="btn-secondary min-h-9 px-3 py-1.5 text-xs text-emerald-700">
          {t.adminUsers.reactivateAccount}
        </button>
      )}
      <button type="button" onClick={() => startNameEdit(user)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
        {t.adminUsers.correctName}
      </button>
      <button type="button" onClick={() => setPendingAction({ type: "password", user })} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
        {t.adminUsers.sendPasswordReset}
      </button>
    </div>
  );

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.adminUsers.title} description={t.adminUsers.description} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label={t.adminUsers.totalAccounts} value={summary.total} />
        <SummaryCard label={t.adminUsers.roles.administrator} value={summary.admin} />
        <SummaryCard label={t.adminUsers.roles.officeStaff} value={summary.officeStaff} />
        <SummaryCard label={t.adminUsers.roles.readOnly} value={summary.readOnly} />
        <SummaryCard label={t.adminUsers.statuses.suspended} value={summary.suspended} />
      </section>

      <section className="mt-4 surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="section-title">{t.adminUsers.accountList}</h2>
            <p className="section-subtitle">{t.adminUsers.accountListDescription}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(14rem,1fr)_10rem_10rem_auto]">
            <label>
              <span className="form-label">{t.adminUsers.search}</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="form-input bg-white pl-9" placeholder={t.adminUsers.searchPlaceholder} />
              </div>
            </label>
            <label>
              <span className="form-label">{t.profile.role}</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="form-input bg-white">
                <option value="">{t.adminUsers.allRoles}</option>
                {ACCOUNT_ROLES.map((role) => <option key={role} value={role}>{t.adminUsers.roles[roleDisplayKey(role)]}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">{t.adminUsers.accountStatus}</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="form-input bg-white">
                <option value="">{t.adminUsers.allStatuses}</option>
                {ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{t.adminUsers.statuses[status]}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void loadUsers()} className="btn-secondary self-end">
              <RefreshCw className="h-4 w-4" />
              {t.support.refresh}
            </button>
          </div>
        </div>

        {success ? <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{success}</p> : null}
        {error ? <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{error}</p> : null}

        <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white min-[980px]:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {[t.adminUsers.account, t.profile.role, t.adminUsers.accountStatus, t.adminUsers.emailConfirmed, t.adminUsers.accountCreated, t.adminUsers.lastSignIn, t.adminUsers.lastAccessChange, t.support.action].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-6 text-slate-500">{t.adminUsers.loading}</td></tr>
              ) : users.map((user) => (
                <tr key={user.userId} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-950">
                      {user.displayName}
                      {user.isCurrentUser ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">{t.adminUsers.you}</span> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-4 py-3"><span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", roleClass(user.role))}>{t.adminUsers.roles[roleDisplayKey(user.role)]}</span></td>
                  <td className="px-4 py-3"><span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", statusClass(user.status))}>{t.adminUsers.statuses[user.status]}</span></td>
                  <td className="px-4 py-3">{user.emailConfirmedAt ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-rose-500" />}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(user.createdAt, language)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(user.lastSignInAt, language)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(user.lastAccessChangedAt, language)}</td>
                  <td className="px-4 py-3"><UserActions user={user} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 min-[980px]:hidden">
          {loading ? <p className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">{t.adminUsers.loading}</p> : null}
          {!loading && users.map((user) => (
            <article key={user.userId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-bold text-slate-950">{user.displayName}</h3>
                  <p className="mt-1 break-all text-xs text-slate-500">{user.email}</p>
                </div>
                {user.isCurrentUser ? <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">{t.adminUsers.you}</span> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", roleClass(user.role))}>{t.adminUsers.roles[roleDisplayKey(user.role)]}</span>
                <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", statusClass(user.status))}>{t.adminUsers.statuses[user.status]}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                <Info label={t.adminUsers.emailConfirmed} value={user.emailConfirmedAt ? t.adminUsers.yes : t.adminUsers.no} />
                <Info label={t.adminUsers.accountCreated} value={formatDate(user.createdAt, language)} />
                <Info label={t.adminUsers.lastSignIn} value={formatDate(user.lastSignInAt, language)} />
                <Info label={t.adminUsers.lastAccessChange} value={formatDate(user.lastAccessChangedAt, language)} />
              </dl>
              <div className="mt-3"><UserActions user={user} /></div>
            </article>
          ))}
        </div>

        {!loading && users.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
            <UserCog className="mx-auto h-6 w-6 text-slate-400" />
            <p className="mt-2 font-semibold text-slate-800">{t.adminUsers.noUsers}</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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

      {editingNameFor ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <h3 className="text-lg font-semibold text-slate-950">{t.adminUsers.correctName}</h3>
            <input value={nameInput} onChange={(event) => setNameInput(event.target.value)} className="form-input mt-3 bg-white" maxLength={80} autoFocus />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditingNameFor(null)}>{t.common.cancel}</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const user = users.find((account) => account.userId === editingNameFor);
                  if (user) {
                    setEditingNameFor(null);
                    setPendingAction({ type: "name", user, displayName: nameInput.trim() });
                  }
                }}
              >
                {t.adminUsers.changeAccess}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-lg font-semibold text-slate-950">{t.adminUsers.confirmTitle}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{actionText}</p>
                {pendingAction.type === "role" && pendingAction.user.isCurrentUser ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{t.adminUsers.selfRoleWarning}</p>
                ) : null}
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
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-slate-800">{value}</dd>
    </div>
  );
}
