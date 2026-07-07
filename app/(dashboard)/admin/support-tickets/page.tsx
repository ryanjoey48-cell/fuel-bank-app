"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/header";
import { fetchSupportTickets, updateSupportTicketStatus } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import type { SupportTicket, SupportTicketPriority, SupportTicketStatus } from "@/types/database";

const ADMIN_EMAIL = "joeryan09@outlook.com";
const STATUSES: Array<"" | SupportTicketStatus> = ["", "Open", "In Progress", "Waiting", "Closed"];
const PRIORITIES: Array<"" | SupportTicketPriority> = ["", "Low", "Medium", "High"];

function isAdmin(email?: string | null, role?: string | null) {
  return (email ?? "").toLowerCase() === ADMIN_EMAIL || (role ?? "").toLowerCase() === "admin";
}

function getRole(metadata: Record<string, unknown> | undefined) {
  const role = metadata?.role;
  return typeof role === "string" ? role : "";
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function SupportTicketsAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | SupportTicketStatus>("");
  const [priorityFilter, setPriorityFilter] = useState<"" | SupportTicketPriority>("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchSupportTickets({ status: statusFilter, priority: priorityFilter });
      setTickets(rows);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load support tickets.");
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, statusFilter]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      const role = getRole(user?.user_metadata as Record<string, unknown> | undefined) || getRole(user?.app_metadata as Record<string, unknown> | undefined);
      setAuthorized(isAdmin(user?.email, role));
    });
  }, []);

  useEffect(() => {
    if (authorized) void loadTickets();
  }, [authorized, loadTickets]);

  const changeStatus = async (ticket: SupportTicket, status: SupportTicketStatus) => {
    try {
      const updated = await updateSupportTicketStatus(ticket.id, status);
      setTickets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedTicket((current) => (current?.id === updated.id ? updated : current));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update ticket status.");
    }
  };

  if (authorized === null) {
    return <section className="surface-card p-5 text-sm text-slate-500">Checking admin access...</section>;
  }

  if (!authorized) {
    return (
      <section className="surface-card p-6">
        <h1 className="section-title">Admin only</h1>
        <p className="section-subtitle">You do not have access to support tickets.</p>
      </section>
    );
  }

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title="Support Tickets" description="Review and update Fuel Bank support requests." />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Admin Support</h2>
            <p className="section-subtitle">Filter by status and priority, then open a ticket for full details.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label>
              <span className="form-label">Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | SupportTicketStatus)} className="form-input bg-white">
                {STATUSES.map((status) => <option key={status || "all"} value={status}>{status || "All statuses"}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">Priority</span>
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "" | SupportTicketPriority)} className="form-input bg-white">
                {PRIORITIES.map((priority) => <option key={priority || "all"} value={priority}>{priority || "All priorities"}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void loadTickets()} className="btn-secondary self-end">Refresh</button>
          </div>
        </div>

        {message ? <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}

        <div className="table-shell">
          <div className="table-scroll">
            <table className="min-w-[920px] w-full text-sm">
              <thead>
                <tr>
                  {["Ticket", "Date", "User", "Category", "Priority", "Status", "Subject", "Action"].map((heading) => (
                    <th key={heading} className="table-head-cell text-left">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="table-body-cell text-slate-500">Loading tickets...</td></tr>
                ) : tickets.length ? tickets.map((ticket) => (
                  <tr key={ticket.id} className="enterprise-table-row">
                    <td className="table-body-cell font-bold text-slate-950">{ticket.ticket_number}</td>
                    <td className="table-body-cell whitespace-nowrap text-slate-600">{formatDate(ticket.created_at)}</td>
                    <td className="table-body-cell max-w-[180px] truncate">{ticket.user_email}</td>
                    <td className="table-body-cell">{ticket.category}</td>
                    <td className="table-body-cell">{ticket.priority}</td>
                    <td className="table-body-cell">
                      <select value={ticket.status} onChange={(event) => void changeStatus(ticket, event.target.value as SupportTicketStatus)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold">
                        {STATUSES.filter(Boolean).map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                    <td className="table-body-cell max-w-[280px] truncate font-medium text-slate-800">{ticket.subject}</td>
                    <td className="table-body-cell">
                      <button type="button" onClick={() => setSelectedTicket(ticket)} className="table-action-secondary">View</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="table-body-cell text-slate-500">No support tickets found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {selectedTicket ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">{selectedTicket.ticket_number}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{selectedTicket.subject}</h3>
              </div>
              <button type="button" onClick={() => setSelectedTicket(null)} className="btn-secondary min-h-8 px-3 py-1 text-xs">Close</button>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="User" value={selectedTicket.user_email} />
              <Info label="Role" value={selectedTicket.user_role || "-"} />
              <Info label="Category" value={selectedTicket.category} />
              <Info label="Priority" value={selectedTicket.priority} />
              <Info label="Status" value={selectedTicket.status} />
              <Info label="Page" value={selectedTicket.page_path || "-"} />
              <Info label="URL" value={selectedTicket.current_url || "-"} wide />
              <Info label="Screen" value={selectedTicket.screen_size || "-"} />
              <Info label="Browser" value={selectedTicket.browser_info || "-"} wide />
              <Info label="Screenshot" value={selectedTicket.screenshot_url || "-"} wide />
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap">
              {selectedTicket.description}
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
