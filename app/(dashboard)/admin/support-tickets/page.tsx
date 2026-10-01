"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteSupportTicket, fetchSupportTickets, updateSupportTicketAdminFields } from "@/lib/data";
import { hasPermission } from "@/lib/authorization";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import type { SupportTicket, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/types/database";

const STATUS_OPTIONS: SupportTicketStatus[] = ["Open", "In Progress", "Waiting", "Closed"];
const PRIORITIES: Array<"" | SupportTicketPriority> = ["", "Low", "Medium", "High"];
const STATUS_RANK: Record<string, number> = { Open: 0, "In Progress": 1, Waiting: 2, Closed: 3 };
const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
type ViewMode = "active" | "closed" | "all";

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

function MetricCard({ label, value, note, tone = "slate", onClick }: { label: string; value: number; note: string; tone?: "rose" | "amber" | "emerald" | "violet" | "slate"; onClick?: () => void }) {
  const accent = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-700" : tone === "violet" ? "text-violet-700" : "text-slate-950";
  const content = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tracking-tight", accent)}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="border-r border-slate-100 px-5 py-4 text-left transition hover:bg-violet-50/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 last:border-r-0">
      {content}
    </button>
  ) : (
    <div className="border-r border-slate-100 px-5 py-4 last:border-r-0">{content}</div>
  );
}

function StatusBadge({ labels, status }: { labels: Record<SupportTicketStatus, string>; status: string }) {
  return <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", statusClass(status))}>{labels[status as SupportTicketStatus] ?? status}</span>;
}

function PriorityBadge({ labels, priority }: { labels: Record<SupportTicketPriority, string>; priority: string }) {
  return <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", priorityClass(priority))}>{labels[priority as SupportTicketPriority] ?? priority}</span>;
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={clsx("rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5", wide && "sm:col-span-2")}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

export default function SupportTicketsAdminPage() {
  const { language, t } = useLanguage();
  const { access, loading: accessLoading } = useAccountAccess();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<SupportTicket | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<SupportTicketStatus>("Open");
  const [adminNote, setAdminNote] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [priorityFilter, setPriorityFilter] = useState<"" | SupportTicketPriority>("");
  const [statusFilter, setStatusFilter] = useState<"" | SupportTicketStatus>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const copy = (en: string, th: string) => (language === "th" ? th : en);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchSupportTickets({ status: "", priority: "" });
      setTickets(sortTickets(rows));
      setMessage(null);
    } catch (error) {
      setMessage(process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : t.support.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.support.loadError]);

  const authorized = hasPermission(access, "admin:support_tickets");

  useEffect(() => {
    if (authorized) void loadTickets();
  }, [authorized, loadTickets]);

  useEffect(() => {
    if (!selectedTicket) return;
    setSelectedStatus(selectedTicket.status as SupportTicketStatus);
    setAdminNote(selectedTicket.admin_note ?? "");
  }, [selectedTicket]);

  const summary = useMemo(() => {
    const active = tickets.filter((ticket) => ticket.status !== "Closed");
    return {
      active: active.length,
      inProgress: active.filter((ticket) => ticket.status === "In Progress").length,
      high: active.filter((ticket) => ticket.priority === "High").length,
      resolved: tickets.filter((ticket) => ticket.status === "Closed").length
    };
  }, [tickets]);

  const visibleTickets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const viewMatch = viewMode === "all" || (viewMode === "active" && ticket.status !== "Closed") || (viewMode === "closed" && ticket.status === "Closed");
      const statusMatch = !statusFilter || ticket.status === statusFilter;
      const priorityMatch = !priorityFilter || ticket.priority === priorityFilter;
      const searchMatch = !needle || ticket.ticket_number.toLowerCase().includes(needle) || ticket.subject.toLowerCase().includes(needle) || ticket.user_email.toLowerCase().includes(needle) || ticket.category.toLowerCase().includes(needle);
      return viewMatch && priorityMatch && statusMatch && searchMatch;
    });
  }, [priorityFilter, search, statusFilter, tickets, viewMode]);

  const recentResolved = useMemo(
    () =>
      [...tickets]
        .filter((ticket) => ticket.status === "Closed")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 4),
    [tickets]
  );

  const showActive = () => {
    setViewMode("active");
    setStatusFilter("");
    setPriorityFilter("");
  };

  const showInProgress = () => {
    setViewMode("active");
    setStatusFilter("In Progress");
    setPriorityFilter("");
  };

  const showHighPriority = () => {
    setViewMode("active");
    setStatusFilter("");
    setPriorityFilter("High");
  };

  const showResolved = () => {
    setViewMode("closed");
    setStatusFilter("");
    setPriorityFilter("");
  };

  const selectedIndex = selectedTicket ? visibleTickets.findIndex((ticket) => ticket.id === selectedTicket.id) : -1;

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

  if (accessLoading) return <section className="surface-card p-5 text-sm text-slate-500">{t.support.checkingAdminAccess}</section>;

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
      <section className="overflow-hidden rounded-[26px] border border-violet-100 bg-gradient-to-r from-white via-white to-violet-50 shadow-sm">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">{copy("Support centre", "ศูนย์ช่วยเหลือ")}</div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{copy("Support Tickets", "รายการคำร้องขอความช่วยเหลือ")}</h1>
            <p className="mt-1 text-sm text-slate-500">{copy("Manage staff issues and requests in one clear workflow.", "จัดการปัญหาและคำขอของพนักงานในขั้นตอนการทำงานเดียว")}</p>
          </div>
          <button type="button" onClick={() => void loadTickets()} className="btn-secondary">{t.support.refresh}</button>
        </div>
      </section>

      <section className="mt-4 grid overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard onClick={showActive} label={copy("Needs action", "ต้องดำเนินการ")} value={summary.active} note={copy("Open, in progress or waiting", "เปิด กำลังดำเนินการ หรือรอ")} tone={summary.active ? "rose" : "emerald"} />
        <MetricCard onClick={showInProgress} label={copy("In progress", "กำลังดำเนินการ")} value={summary.inProgress} note={copy("Currently being handled", "กำลังดำเนินการอยู่")} tone="amber" />
        <MetricCard onClick={showHighPriority} label={copy("High priority", "ความสำคัญสูง")} value={summary.high} note={copy("Active high-priority tickets", "รายการสำคัญสูงที่ยังไม่ปิด")} tone="violet" />
        <MetricCard onClick={showResolved} label={copy("Resolved", "แก้ไขแล้ว")} value={summary.resolved} note={copy("Closed ticket history", "ประวัติรายการที่ปิดแล้ว")} tone="emerald" />
      </section>

      <section className="mt-4 overflow-hidden rounded-[22px] border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">{copy("Admin support", "ฝ่ายช่วยเหลือผู้ดูแลระบบ")}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{viewMode === "active" ? copy("Tickets needing attention", "รายการที่ต้องดำเนินการ") : viewMode === "closed" ? copy("Resolved tickets", "รายการที่แก้ไขแล้ว") : copy("All support tickets", "รายการช่วยเหลือทั้งหมด")}</h2>
            <p className="mt-1 text-sm text-slate-500">{viewMode === "active" && summary.active === 0 ? copy("All caught up — no support tickets currently need action.", "เรียบร้อยแล้ว — ไม่มีรายการที่ต้องดำเนินการในขณะนี้") : copy(`${visibleTickets.length} ticket${visibleTickets.length === 1 ? "" : "s"} shown`, `แสดง ${visibleTickets.length} รายการ`)}</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {(["active", "closed", "all"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setViewMode(mode);
                  setStatusFilter("");
                  if (mode !== "active") setPriorityFilter("");
                }}
                className={clsx(
                  "rounded-full border px-4 py-2 text-xs font-semibold transition",
                  viewMode === mode
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-slate-800"
                )}
              >
                {mode === "active" ? copy("Active", "กำลังดำเนินการ") : mode === "closed" ? copy("Closed", "ปิดแล้ว") : copy("All", "ทั้งหมด")}
              </button>
            ))}
            {statusFilter ? (
              <button type="button" onClick={() => setStatusFilter("")} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                {copy(`Status: ${statusFilter} ×`, `สถานะ: ${statusFilter} ×`)}
              </button>
            ) : null}
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy("Search ticket number, user, category or subject", "ค้นหาเลขที่ ผู้ใช้ ประเภท หรือหัวข้อ")} className="form-input bg-white" />
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "" | SupportTicketPriority)} className="form-input bg-white">
              {PRIORITIES.map((priority) => <option key={priority || "all"} value={priority}>{priority ? t.support.priorityLabels[priority] : t.support.allPriorities}</option>)}
            </select>
          </div>
        </div>

        {successMessage ? <p className="mx-5 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 sm:mx-6">{successMessage}</p> : null}
        {message ? <p className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:mx-6">{message}</p> : null}

        {loading ? (
          <div className="px-6 py-10 text-sm text-slate-500">{t.support.loadingTickets}</div>
        ) : viewMode === "active" && summary.active === 0 ? (
          <div className="p-5 sm:p-6">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/55 px-5 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">{copy("Current status", "สถานะปัจจุบัน")}</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">{copy("All caught up", "ดำเนินการครบแล้ว")}</h3>
                  <p className="mt-1 text-sm text-slate-600">{copy("No support tickets currently need action.", "ไม่มีรายการช่วยเหลือที่ต้องดำเนินการในขณะนี้")}</p>
                </div>
                <button type="button" onClick={showResolved} className="btn-secondary whitespace-nowrap">{copy(`View ${summary.resolved} resolved`, `ดู ${summary.resolved} รายการที่ปิดแล้ว`)}</button>
              </div>
            </div>

          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-violet-50/60"><tr>
                <th className="table-head-cell text-left">{t.support.ticket}</th>
                <th className="table-head-cell text-left">{t.support.subject}</th>
                <th className="table-head-cell text-left">{t.support.user}</th>
                <th className="table-head-cell text-left">{t.support.category}</th>
                <th className="table-head-cell text-left">{t.support.priority}</th>
                <th className="table-head-cell text-left">{t.support.status}</th>
                <th className="table-head-cell text-left">{t.support.date}</th>
                <th className="table-head-cell text-right">{t.support.action}</th>
              </tr></thead>
              <tbody>
                {visibleTickets.length ? visibleTickets.map((ticket) => (
                  <tr key={ticket.id} onClick={() => setSelectedTicket(ticket)} className="cursor-pointer border-b border-slate-100 transition hover:bg-violet-50/35">
                    <td className="table-body-cell"><span className="font-bold text-brand-700">{ticket.ticket_number}</span></td>
                    <td className="table-body-cell"><p className="max-w-[330px] truncate font-semibold text-slate-900">{ticket.subject}</p></td>
                    <td className="table-body-cell max-w-[220px] truncate text-slate-600">{ticket.user_email}</td>
                    <td className="table-body-cell text-slate-600">{t.support.categoryLabels[ticket.category as SupportTicketCategory] ?? ticket.category}</td>
                    <td className="table-body-cell"><PriorityBadge labels={t.support.priorityLabels} priority={ticket.priority} /></td>
                    <td className="table-body-cell"><StatusBadge labels={t.support.statusLabels} status={ticket.status} /></td>
                    <td className="table-body-cell whitespace-nowrap text-slate-500">{formatDate(ticket.created_at, language)}</td>
                    <td className="table-body-cell text-right"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedTicket(ticket); }} className="table-action-secondary">{copy("Open →", "เปิด →")}</button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="px-6 py-12 text-center"><div className="mx-auto max-w-md rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-5 py-8"><p className="font-semibold text-slate-900">{t.support.noTicketsTitle}</p><p className="mt-1 text-sm text-slate-500">{t.support.noTicketsDescription}</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedTicket ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 backdrop-blur-[2px] sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-[24px] border border-violet-100 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
            <div className="border-b border-violet-100 bg-gradient-to-r from-white to-violet-50 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">{selectedTicket.ticket_number}</span><PriorityBadge labels={t.support.priorityLabels} priority={selectedTicket.priority} /><StatusBadge labels={t.support.statusLabels} status={selectedTicket.status} /></div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">{selectedTicket.subject}</h3>
                  <p className="mt-1 text-sm text-slate-500">{selectedTicket.user_email} · {formatDate(selectedTicket.created_at, language)}</p>
                </div>
                <button type="button" onClick={() => setSelectedTicket(null)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">{t.support.close}</button>
              </div>
            </div>

            <div className="max-h-[76vh] overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">{copy("Request", "รายละเอียดคำขอ")}</p>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{selectedTicket.description}</p></div>

                  <details className="mt-4 rounded-2xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">{copy("Technical details", "รายละเอียดทางเทคนิค")}</summary>
                    <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
                      <Info label={t.support.category} value={t.support.categoryLabels[selectedTicket.category as SupportTicketCategory] ?? selectedTicket.category} />
                      <Info label={t.support.page} value={selectedTicket.page_path || "-"} />
                      <Info label={t.support.url} value={selectedTicket.current_url || "-"} wide />
                      <Info label={t.support.screen} value={selectedTicket.screen_size || "-"} />
                      <Info label={t.support.screenshot} value={selectedTicket.screenshot_url || "-"} />
                      <Info label={t.support.browser} value={selectedTicket.browser_info || "-"} wide />
                    </div>
                  </details>
                </div>

                <div className="rounded-2xl border border-violet-100 bg-violet-50/35 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">{copy("Admin response", "การดำเนินการของผู้ดูแล")}</p>
                  <label className="mt-4 block"><span className="form-label">{t.support.status}</span><select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as SupportTicketStatus)} className={clsx("form-input bg-white font-semibold", statusClass(selectedStatus))}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{t.support.statusLabels[status]}</option>)}</select></label>
                  <label className="mt-4 block"><span className="form-label">{t.support.adminNote}</span><textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} rows={6} className="form-textarea bg-white" placeholder={t.support.adminNotePlaceholder} /></label>
                  <button type="button" disabled={savingTicketId === selectedTicket.id} onClick={() => void updateTicket(selectedTicket, selectedStatus, adminNote)} className="btn-primary mt-4 w-full disabled:opacity-60">{savingTicketId === selectedTicket.id ? t.common.saving : t.support.saveChanges}</button>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => setTicketToDelete(selectedTicket)} className="text-left text-xs font-semibold text-rose-600 hover:text-rose-700">{copy("Delete ticket", "ลบรายการ")}</button>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" disabled={selectedIndex <= 0} onClick={() => selectedIndex > 0 && setSelectedTicket(visibleTickets[selectedIndex - 1])} className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40">{copy("← Previous", "← ก่อนหน้า")}</button>
                  <button type="button" disabled={selectedIndex < 0 || selectedIndex >= visibleTickets.length - 1} onClick={() => selectedIndex >= 0 && selectedIndex < visibleTickets.length - 1 && setSelectedTicket(visibleTickets[selectedIndex + 1])} className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40">{copy("Next →", "ถัดไป →")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {ticketToDelete ? (
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <h3 className="text-lg font-semibold text-slate-950">{t.support.deleteTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.support.deleteText.replace("{ticketNumber}", ticketToDelete.ticket_number)}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setTicketToDelete(null)} className="btn-secondary" disabled={deletingTicketId === ticketToDelete.id}>{t.common.cancel}</button>
              <button type="button" disabled={deletingTicketId === ticketToDelete.id} onClick={() => void confirmDeleteTicket()} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60">{deletingTicketId === ticketToDelete.id ? t.support.deleting : t.support.deleteTicket}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
