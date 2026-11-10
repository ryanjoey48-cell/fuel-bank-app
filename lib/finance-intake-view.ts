import type { DiaryBookingSeed } from "./finance-demo-centre";

export type IntakeDatePreset = "today" | "week" | "month" | "lastMonth";
/** Calendar arithmetic uses UTC only after resolving today's Bangkok calendar date. */
export function intakeDateRange(preset: IntakeDatePreset, today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  const day = (value: Date) => value.toISOString().slice(0, 10);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const from = day(date);
    date.setUTCDate(date.getUTCDate() + 6);
    return { from, to: day(date) };
  }
  date.setUTCDate(1);
  if (preset === "lastMonth") date.setUTCMonth(date.getUTCMonth() - 1);
  const from = day(date);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { from, to: day(date) };
}

export function matchesIntakeSearch(row: DiaryBookingSeed, query: string, workOrder: string, customerJobNumber?: string | null) {
  const q = query.trim().toLowerCase();
  return !q || [row.client_name, row.driver, row.vehicle_registration, row.vehicle, row.pickup, row.dropoff,
    workOrder, row.booking_date, row.booking_date.split("-").reverse().join("/"), row.customer_job_number, customerJobNumber]
    .filter(Boolean).join(" ").toLowerCase().includes(q);
}
