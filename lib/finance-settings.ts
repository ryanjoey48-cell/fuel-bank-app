/**
 * Finance Centre settings shared by server and browser.
 *
 * The single stored copy lives on the server (see lib/finance-settings-server.ts, file
 * `.ees-local/finance-test/settings.json`). Only active Admin / Super Admin accounts can change it, and the
 * server re-checks that on every save. FINANCE_SETTINGS_DEFAULTS is used only until an Admin first saves.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export type FinanceSettings = {
  /** ISO date (YYYY-MM-DD). Booking Diary jobs dated before this never count as "Waiting for work order". */
  startDate: string;
};

/**
 * Operational cutover: normal Finance Centre operations start on 1 November 2026. Bookings dated earlier were processed before the
 * digital Finance workflow; they stay in the Booking Diary (nothing is deleted or marked invoiced) and are reached through
 * "Historical Bookings". The date is changeable by an Admin and persists on the server.
 */
export const FINANCE_CUTOVER_DATE = "2026-11-01";
export const FINANCE_SETTINGS_DEFAULTS: FinanceSettings = { startDate: FINANCE_CUTOVER_DATE };

/** The calendar day before an ISO date (the last day of the historical range). */
export function dayBefore(iso: string) {
  const match = ISO_DATE.exec(iso);
  if (!match) return "";
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1)).toISOString().slice(0, 10);
}


export function isValidFinanceStartDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeFinanceSettings(value: unknown): FinanceSettings {
  const row = value && typeof value === "object" ? (value as Partial<FinanceSettings>) : {};
  return { startDate: isValidFinanceStartDate(row.startDate) ? row.startDate : FINANCE_SETTINGS_DEFAULTS.startDate };
}

/** True when a booking date (YYYY-MM-DD…) is before the Finance start date. Missing dates are not hidden. */
export function isBeforeFinanceStart(bookingDate: string | null | undefined, startDate: string) {
  const date = String(bookingDate || "").slice(0, 10);
  if (!date || !startDate) return false;
  return date < startDate;
}
