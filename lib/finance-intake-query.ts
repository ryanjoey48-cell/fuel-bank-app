import type { Booking, DiaryBookingSeed } from "./finance-demo-centre";
import { confirmedWorkOrder } from "./finance-demo-centre";

export type IntakeQuery = {
  dateFrom: string; dateTo: string; search: string; vehicle: string; customer: string; driver: string;
  status: "waiting" | "entered" | "flagged" | "verified" | "all";
  page: number; pageSize: number;
};

export function intakePageBounds(page: number, size: number) {
  const pageSize = [25, 50, 100].includes(size) ? size : 50;
  const from = (Math.max(1, Math.floor(page) || 1) - 1) * pageSize;
  return { from, to: from + pageSize - 1, pageSize };
}

export function intakeStatusIds(bookings: Booking[], status: IntakeQuery["status"]) {
  const flagged = (job: Booking) => job.status === "discrepancy" || job.status === "needs_recheck" || !!job.financeCheck;
  return bookings.filter(job => status === "waiting" ? !!confirmedWorkOrder(job)
    : status === "flagged" ? flagged(job)
    : status === "verified" ? job.status === "verified" && !flagged(job)
    : !!confirmedWorkOrder(job) && !flagged(job)).map(job => job.id);
}

/** Escape PostgREST expression punctuation; user input is always a literal substring. */
export function intakeSearchLiteral(value: string) {
  return value.trim().replace(/[\\%_*(),\"]/g, " ").replace(/\s+/g, " ").trim();
}

/** Confirming physical paperwork requires source facts; saving an incomplete draft remains possible. */
export function intakeConfirmationBlockers(job: Pick<Booking, "client" | "date" | "pickup" | "delivery" | "vehicle" | "driver">) {
  return (["client", "date", "pickup", "delivery", "vehicle", "driver"] as const).filter(field => !job[field]?.trim() || job[field].trim() === "—");
}

/** Fixture equivalent of the server predicates; never used to download/filter live Diary data. */
export function fixtureIntakePage(rows: DiaryBookingSeed[], options: IntakeQuery, bookings: Booking[]) {
  const jobs = new Map(bookings.map(job => [job.id, job]));
  const ids = new Set(intakeStatusIds(bookings, options.status));
  const q = options.search.trim().toLowerCase();
  const matches = rows.filter(row => {
    const job = jobs.get(row.id);
    return (!options.dateFrom || row.booking_date >= options.dateFrom) && (!options.dateTo || row.booking_date <= options.dateTo)
      && (!options.vehicle || `${row.vehicle_registration || row.vehicle || ""}`.toLowerCase().includes(options.vehicle.toLowerCase()))
      && (!options.customer || (row.client_name || "").toLowerCase().includes(options.customer.toLowerCase()))
      && (!options.driver || (row.driver || "").toLowerCase().includes(options.driver.toLowerCase()))
      && (options.status === "all" || (options.status === "waiting" ? !ids.has(row.id) : ids.has(row.id)))
      && (!q || [row.id, row.booking_id, row.client_name, row.driver, row.vehicle_registration, row.vehicle, row.pickup, row.dropoff,
        row.booking_date, row.booking_date.split("-").reverse().join("/"), row.job_order_number, row.customer_job_number,
        job && confirmedWorkOrder(job), job?.adminReceipts?.customerJobNumber].filter(Boolean).join(" ").toLowerCase().includes(q));
  }).sort((a, b) => b.booking_date.localeCompare(a.booking_date) || (a.pickup_time || "").localeCompare(b.pickup_time || "") || a.id.localeCompare(b.id));
  const { from, to } = intakePageBounds(options.page, options.pageSize);
  return { rows: matches.slice(from, to + 1), count: matches.length, error: "" };
}
