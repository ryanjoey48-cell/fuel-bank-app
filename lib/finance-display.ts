/**
 * Display-only helpers for the Finance Centre. They never rewrite stored values.
 * Pure functions (no imports) so tests and documents share exactly the same formatting.
 */

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function isoParts(iso: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "").trim());
  return match ? { y: match[1], m: Number(match[2]), d: match[3] } : null;
}

/** UI date: "05 Jan 2026" (Thai: "05 ม.ค. 2026"). Calendar dates are shown as stored — no timezone shift. */
export function formatUiDate(iso: string | null | undefined, language: "en" | "th" = "en") {
  const p = isoParts(iso);
  if (!p || p.m < 1 || p.m > 12) return String(iso || "") || "—";
  return `${p.d} ${(language === "th" ? MONTHS_TH : MONTHS_EN)[p.m - 1]} ${p.y}`;
}

/** Document date: DD/MM/YYYY. */
export function formatDocDate(iso: string | null | undefined) {
  const p = isoParts(iso);
  return p ? `${p.d}/${String(p.m).padStart(2, "0")}/${p.y}` : String(iso || "") || "—";
}

/** Billing period from the earliest to the latest job date, e.g. "05/01/2026 – 31/01/2026". */
export function formatPeriod(start: string | null, end: string | null, style: "doc" | "ui" = "doc", language: "en" | "th" = "en") {
  if (!start) return "—";
  const f = (value: string) => (style === "doc" ? formatDocDate(value) : formatUiDate(value, language));
  return !end || end === start ? f(start) : `${f(start)} – ${f(end)}`;
}

/** ฿#,##0.00 — null/undefined shows a dash (blank is never shown as zero). */
export function formatThb(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `฿${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short whole-baht chip label, e.g. "฿120" or "฿120.50". */
export function formatThbShort(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `฿${value.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Time of day in Asia/Bangkok, e.g. "18:49". */
export function formatBangkokTime(at: string | number | Date | null | undefined) {
  if (at == null) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

/** Date + time in Asia/Bangkok for audit-style notes, e.g. "04/11/2026 18:49". */
export function formatBangkokDateTime(at: string | number | Date | null | undefined) {
  if (at == null) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/**
 * Thai plate display: "3ฒน9565" and "3ฒน-9565" both show as "3ฒน-9565".
 * Purely numeric/other formats (e.g. "79-2945", "700-6659") are shown unchanged apart from trimming.
 */
export function displayVehicle(value: string | null | undefined) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const thai = /^(\d{0,2}[ก-ฮ]{1,3})\s*-?\s*(\d{1,4})$/.exec(text);
  return thai ? `${thai[1]}-${thai[2]}` : text;
}

/**
 * Bookings that are clearly internal tests (e.g. driver "Joey Test", customer "EES Finance Local Test").
 * Only explicit "test" wording is used — a plate like "1998" alone is never enough. Nothing is deleted;
 * callers simply hide these from the default list.
 */
export function isLikelyTestBooking(row: { driver?: string | null; client_name?: string | null; notes?: string | null }) {
  return [row.driver, row.client_name].some((value) => /\btest\b/i.test(String(value || "")) || /ทดสอบ/.test(String(value || "")));
}
