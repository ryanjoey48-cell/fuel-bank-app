"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
import { deleteSupportTicket, fetchSupportTickets, updateSupportTicketAdminFields } from "@/lib/data";
import { fetchCurrentAccess } from "@/lib/account-management";
import { hasPermission } from "@/lib/authorization";
import { useLanguage } from "@/lib/language-provider";
import type { SupportTicket, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/types/database";

const BUILD_MARKER = "Build: 57e52f2";
const STATUSES: Array<"" | SupportTicketStatus> = ["", "Open", "In Progress", "Waiting", "Closed"];
const STATUS_OPTIONS: SupportTicketStatus[] = ["Open", "In Progress", "Waiting", "Closed"];
const PRIORITIES: Array<"" | SupportTicketPriority> = ["", "Low", "Medium", "High"];
const STATUS_RANK: Record<string, number> = { Open: 0, "In Progress": 1, Waiting: 2, Closed: 3 };
const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function formatDate(value: string, language: "en" | "th") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function statusClass(status: string) {
  if (status === "Open") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "In Progress") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "Waiting") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "Closed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function priorityClass(priority: string) {
  if (priority === "High") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "Medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (priority === "Low") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function sortTickets(rows: SupportTicket[]) {
  return [...rows].sort((left, right) => {
    const statusDiff = (STATUS_RANK[left.status] ?? 9) - (STATUS_RANK[right.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;

    const priorityDiff = (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9);
    if (priorityDiff !== 0) return priorityDiff;

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "rose" | "amber" | "emerald" | "slate" }) {
  const className =
    tone === "rose"
      ? "border-rose-100 bg-rose-50 text-rose-700"
      : tone === "amber"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : tone === "emerald"
          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={clsx("rounded-2xl border px-4 py-3 shadow-sm", className)}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] opacity-75">{label}</p>
      <p className="mt-1 text-3xl font-black leading-none">{value}</p>
    </div>
  );
}

function StatusSelect({
  labels,
  value,
  onChange
}: {
  labels: Record<SupportTicketStatus, string>;
  value: string;
  onChange: (status: SupportTicketStatus) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as SupportTicketStatus)}
      className={clsx("w-auto rounded-full border px-3 py-1.5 text-xs font-bold outline-none transition focus:ring-2 focus:ring-brand-200", statusClass(value))}
    >
      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
    </select>
  );
}

function PriorityBadge({ labels, priority }: { labels: Record<SupportTicketPriority, string>; priority: string }) {
  return (
    <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", priorityClass(priority))}>
      {labels[priority as SupportTicketPriority] ?? priority}
    </span>
  );
}

export default function SupportTicketsAdminPage() {
  const { language, t } = useLanguage();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<SupportTicket | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<SupportTicketStatus>("Open");
  const [adminNote, setAdminNote] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | SupportTicketStatus>("");
  const [priorityFilter, setPriorityFilter] = useState<"" | SupportTicketPriority>("");
  const [loading, setLoading] = useState(true);
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchSupportTickets({ status: statusFilter, priority: priorityFilter });
      setTickets(sortTickets(rows));
      setMessage(null);
    } catch (error) {
      setMessage(process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : t.support.loadError);
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, statusFilter, t.support.loadError]);

  useEffect(() => {
    fetchCurrentAccess()
      .then(({ access }) => setAuthorized(hasPermission(access, "admin:support_tickets")))
      .catch(() => setAuthorized(false));
  }, []);

  useEffect(() => {
    if (authorized) void loadTickets();
  }, [authorized, loadTickets]);

  useEffect(() => {
    if (!selectedTicket) return;
    setSelectedStatus(selectedTicket.status as SupportTicketStatus);
    setAdminNote(selectedTicket.admin_note ?? "");
  }, [selectedTicket]);

  const summary = useMemo(() => ({
    open: tickets.filter((ticket) => ticket.status === "Open").length,
    inProgress: tickets.filter((ticket) => ticket.status === "In Progress").length,
    closed: tickets.filter((ticket) => ticket.status === "Closed").length,
    high: tickets.filter((ticket) => ticket.priority === "High" && ticket.status !== "Closed").length,
    needsAction: tickets.filter((ticket) => ticket.status !== "Closed").length
  }), [tickets]);

  const updateTicket = async (ticket: SupportTicket, status: SupportTicketStatus, note = ticket.admin_note ?? "") => {
    setSavingTicketId(ticket.id);
    setMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await updateSupportTicketAdminFields(ticket.id, { status, admin_note: note.trim() || null });
      setTickets((current) => sortTickets(current.map((item) => (item.id === updated.id ? updated : item))));
      setSelectedTicket((current) => (current?.id === updated.id ? updated : current));
      setSuccessMessage(t.support.updateSuccess.replace("{ticketNumber}", updated.ticket_number));
    } catch (error) {
      console.error("Support ticket update failed:", error);
      setMessage(process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : t.support.updateError);
    } finally {
      setSavingTicketId(null);
    }
  };

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete) return;
    setDeletingTicketId(ticketToDelete.id);
    setMessage(null);
    setSuccessMessage(null);

    try {
      await deleteSupportTicket(ticketToDelete.id);
      setTickets((current) => current.filter((ticket) => ticket.id !== ticketToDelete.id));
      setSelectedTicket((current) => (current?.id === ticketToDelete.id ? null : current));
      setSuccessMessage(t.support.deleteSuccess);
      setTicketToDelete(null);
    } catch (error) {
      console.error("Support ticket delete failed:", error);
      setMessage(process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : t.support.deleteError);
    } finally {
      setDeletingTicketId(null);
    }
  };

  if (authorized === null) {
    return <section className="surface-card p-5 text-sm text-slate-500">{t.support.checkingAdminAccess}</section>;
  }

  if (!authorized) {
    return (
      <section className="surface-card p-6">
        <h1 className="section-title">{t.support.adminOnly}</h1>
        <p className="section-subtitle">{t.support.noAdminAccess}</p>
      </section>
    );
  }

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.support.adminTitle} description={t.support.adminDescription} />
      </div>
      <p className="mb-3 text-xs font-semibold text-slate-400">{BUILD_MARKER}</p>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={t.support.openTickets} value={summary.open} tone="rose" />
        <SummaryCard label={t.support.inProgress} value={summary.inProgress} tone="amber" />
        <SummaryCard label={t.support.closed} value={summary.closed} tone="emerald" />
        <SummaryCard label={t.support.highPriority} value={summary.high} tone="slate" />
      </section>

      <section className="mt-4 surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">{t.support.adminSectionTitle}</h2>
            <p className="section-subtitle">
              {summary.needsAction ? t.support.ticketsNeedAction.replace("{count}", String(summary.needsAction)) : t.support.noTicketsNeedAction}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label>
              <span className="form-label">{t.support.status}</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | SupportTicketStatus)} className="form-input bg-white">
                {STATUSES.map((status) => <option key={status || "all"} value={status}>{status ? t.support.statusLabels[status] : t.support.allStatuses}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">{t.support.priority}</span>
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "" | SupportTicketPriority)} className="form-input bg-white">
                {PRIORITIES.map((priority) => <option key={priority || "all"} value={priority}>{priority ? t.support.priorityLabels[priority] : t.support.allPriorities}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void loadTickets()} className="btn-secondary self-end">{t.support.refresh}</button>
          </div>
        </div>

        {successMessage ? <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{successMessage}</p> : null}
        {message ? <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}

        <div className="table-shell">
          <div className="table-scroll">
            <table className="min-w-[980px] w-full text-sm">
              <thead>
                <tr>
                  {[t.support.ticket, t.support.date, t.support.user, t.support.category, t.support.priority, t.support.status, t.support.subject, t.support.action].map((heading) => (
                    <th key={heading} className="table-head-cell text-left">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="table-body-cell text-slate-500">{t.support.loadingTickets}</td></tr>
                ) : tickets.length ? tickets.map((ticket) => {
                  const highOpen = ticket.status === "Open" && ticket.priority === "High";
                  return (
                    <tr
                      key={ticket.id}
                      className={clsx(
                        "enterprise-table-row border-l-4",
                        ticket.status === "Closed" ? "border-l-emerald-200 opacity-70" : highOpen ? "border-l-rose-500 bg-rose-50/35" : ticket.status === "Open" ? "border-l-rose-300" : "border-l-amber-300"
                      )}
                    >
                      <td className="table-body-cell font-bold text-slate-950">{ticket.ticket_number}</td>
                      <td className="table-body-cell whitespace-nowrap text-slate-600">{formatDate(ticket.created_at, language)}</td>
                      <td className="table-body-cell max-w-[180px] truncate">{ticket.user_email}</td>
                      <td className="table-body-cell">{t.support.categoryLabels[ticket.category as SupportTicketCategory] ?? ticket.category}</td>
                      <td className="table-body-cell"><PriorityBadge labels={t.support.priorityLabels} priority={ticket.priority} /></td>
                      <td className="table-body-cell">
                        <StatusSelect labels={t.support.statusLabels} value={ticket.status} onChange={(status) => void updateTicket(ticket, status)} />
                      </td>
                      <td className="table-body-cell max-w-[280px] truncate font-medium text-slate-800">{ticket.subject}</td>
                      <td className="table-body-cell">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setSelectedTicket(ticket)} className="table-action-secondary">
                            {t.support.view}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTicketToDelete(ticket)}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-200"
                          >
                            {t.common.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={8} className="table-body-cell">
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                        <p className="font-semibold text-slate-800">{t.support.noTicketsTitle}</p>
                        <p className="mt-1 text-sm text-slate-500">{t.support.noTicketsDescription}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {selectedTicket ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">{selectedTicket.ticket_number}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{selectedTicket.subject}</h3>
              </div>
              <button type="button" onClick={() => setSelectedTicket(null)} className="btn-secondary min-h-8 px-3 py-1 text-xs">{t.support.close}</button>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label={t.support.user} value={selectedTicket.user_email} />
              <Info label={t.support.created} value={formatDate(selectedTicket.created_at, language)} />
              <Info label={t.support.category} value={t.support.categoryLabels[selectedTicket.category as SupportTicketCategory] ?? selectedTicket.category} />
              <Info label={t.support.priority} value={t.support.priorityLabels[selectedTicket.priority as SupportTicketPriority] ?? selectedTicket.priority} />
              <Info label={t.support.status} value={t.support.statusLabels[selectedTicket.status as SupportTicketStatus] ?? selectedTicket.status} />
              <Info label={t.support.page} value={selectedTicket.page_path || "-"} />
              <Info label={t.support.url} value={selectedTicket.current_url || "-"} wide />
              <Info label={t.support.screen} value={selectedTicket.screen_size || "-"} />
              <Info label={t.support.browser} value={selectedTicket.browser_info || "-"} wide />
              <Info label={t.support.screenshot} value={selectedTicket.screenshot_url || "-"} wide />
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap">
              {selectedTicket.description}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr]">
              <label>
                <span className="form-label">{t.support.status}</span>
                <StatusSelect labels={t.support.statusLabels} value={selectedStatus} onChange={setSelectedStatus} />
              </label>
              <label>
                <span className="form-label">{t.support.adminNote}</span>
                <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} rows={3} className="form-textarea bg-white" placeholder={t.support.adminNotePlaceholder} />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedTicket(null)} className="btn-secondary">{t.common.cancel}</button>
              <button
                type="button"
                disabled={savingTicketId === selectedTicket.id}
                onClick={() => void updateTicket(selectedTicket, selectedStatus, adminNote)}
                className="btn-primary disabled:opacity-60"
              >
                {savingTicketId === selectedTicket.id ? t.common.saving : t.support.saveChanges}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {ticketToDelete ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <h3 className="text-lg font-semibold text-slate-950">{t.support.deleteTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t.support.deleteText.replace("{ticketNumber}", ticketToDelete.ticket_number)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTicketToDelete(null)}
                className="btn-secondary"
                disabled={deletingTicketId === ticketToDelete.id}
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={deletingTicketId === ticketToDelete.id}
                onClick={() => void confirmDeleteTicket()}
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
              >
                {deletingTicketId === ticketToDelete.id ? t.support.deleting : t.support.deleteTicket}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words font-medium text-slate-800">{value}</p>
    </div>
  );
}
