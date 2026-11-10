"use client";
import { ATTENTION_FLAGS, INTEGRITY_COPY, type IntegrityFlag, type IntegrityReport } from "@/lib/booking-diary-integrity";

type Lang = "en" | "th";
const INFO_FLAGS: IntegrityFlag[] = ["missing_registration", "missing_pickup_time", "vehicle_id_not_linked", "same_route_other_truck", "missing_work_order", "driver_not_linked", "late_entry"];

/**
 * Read-only data checks for the Booking Diary. It only counts and explains; it never edits, merges or deletes a booking.
 * Counts cover every loaded booking, not only the ones the current filters show.
 */
export function BookingIntegritySummary({ report, language }: { report: IntegrityReport; language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const label = (f: IntegrityFlag) => INTEGRITY_COPY[f][language === "th" ? 1 : 0];
  const attention = ATTENTION_FLAGS.filter(f => report.counts[f] > 0);
  return <details className="booking-integrity-summary mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" data-integrity-summary>
    <summary className="cursor-pointer font-semibold text-slate-700">
      {t("Data checks", "ตรวจสอบข้อมูล")} · {report.attentionTotal === 0 ? t("nothing needs attention", "ไม่มีรายการที่ต้องตรวจสอบ") : t(`${report.attentionTotal} of ${report.total} bookings need attention`, `${report.attentionTotal} จาก ${report.total} การจองต้องตรวจสอบ`)}
    </summary>
    <p className="mt-2 text-xs text-slate-600" role="note">{t("These checks only explain what looks incomplete or in conflict. Nothing is changed, merged or deleted. Several rows on the same route can be separate trucks.", "การตรวจสอบนี้เพียงอธิบายสิ่งที่ดูไม่ครบหรือขัดแย้ง ไม่มีการแก้ไข รวม หรือลบข้อมูล หลายแถวในเส้นทางเดียวกันอาจเป็นรถคนละคัน")}</p>
    {attention.length ? <ul className="mt-2 grid gap-1">{attention.map(f => <li key={f} className="text-amber-800" data-flag={f}>{report.counts[f]} · {label(f)}</li>)}</ul> : null}
    {report.coordinateConflicts.length ? <div className="mt-2" data-coordinate-conflicts>
      <strong className="text-xs text-slate-700">{t("Customer names stored at different places", "ชื่อลูกค้าที่ถูกบันทึกหลายตำแหน่ง")}</strong>
      <ul className="mt-1 grid gap-1 text-xs text-slate-700">{report.coordinateConflicts.slice(0, 8).map(c => <li key={c.name}>{c.name} · {c.places} {t("places", "ตำแหน่ง")} · {t("up to", "ห่างสูงสุด")} {c.spreadKm} km · {c.bookings} {t("bookings", "การจอง")}</li>)}</ul>
    </div> : null}
    <ul className="mt-2 grid gap-1 text-xs text-slate-600">{INFO_FLAGS.filter(f => report.counts[f] > 0).map(f => <li key={f} data-flag={f}>{report.counts[f]} · {label(f)}</li>)}</ul>
  </details>;
}
