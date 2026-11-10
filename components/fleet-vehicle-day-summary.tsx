"use client";
import { issueLabel, positionSourceLabel, provenanceLabel, reconciliationLabel, reconciliationReasonLabel } from "@/lib/fleet-journey-copy";
import type { DaySummary } from "@/lib/fleet-vehicle-day-summary";

type Lang = "en" | "th";
/** One compact summary per vehicle-day. Each figure has its source underneath; an unknown figure is an em dash, never zero. */
export function FleetVehicleDaySummary({ summary, registration, language }: { summary: DaySummary; registration: string; language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const n = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  const km = t("km", "กม.");
  const prov = (p: Parameters<typeof provenanceLabel>[0]) => provenanceLabel(p, language);
  const row = (key: string, label: string, value: React.ReactNode, source: React.ReactNode) => <div key={key}><dt>{label}</dt><dd>{value}<small className="fleet-summary-source">{source}</small></dd></div>;
  const s = summary;
  return <section className="fleet-day-summary" aria-label={t("Vehicle-day summary", "สรุปรายวันของรถ")}>
    <h4>{t("Vehicle-day summary", "สรุปรายวันของรถ")} · {registration || "—"} · {s.day} · Asia/Bangkok</h4>
    <p role="status"><strong>{reconciliationLabel(s.completeness.status, language)}</strong> · {s.completeness.reasons.map(r => reconciliationReasonLabel(r, language)).join(" · ") || "—"}</p>
    <dl className="fleet-evidence-sources">
      {row("reported", t("Reported Forth km", "กม. ที่ Forth รายงาน"), s.reportedKm.value === null ? "—" : `${n(s.reportedKm.value)} ${km}`, prov(s.reportedKm.source))}
      {row("journeys", t("Report journeys", "เที่ยวในรายงาน"), s.reportJourneys.moving === null ? "—" : `${s.reportJourneys.moving} ${t("moving", "เคลื่อนที่")} · ${s.reportJourneys.stops} ${t("stops", "จอด")}${s.reportJourneys.openFinal ? ` · ${s.reportJourneys.openFinal} ${t("open", "ยังไม่ปิด")}` : ""}`, prov(s.reportJourneys.source))}
      {row("trail", t("Reported trail km", "กม. ตามเส้นทางที่รายงาน"), s.trailKm.value === null ? "—" : `${n(s.trailKm.value)} ${km}${s.trailKm.differenceKm !== null ? ` (${s.trailKm.differenceKm > 0 ? "+" : ""}${n(s.trailKm.differenceKm)} ${km} ${t("vs report", "เทียบรายงาน")}, ${n(s.trailKm.differencePct, 1)}%)` : ""}`, prov(s.trailKm.source))}
      {row("position", t("Position confidence", "ความน่าเชื่อถือของตำแหน่ง"), `${positionSourceLabel(s.positionConfidence.positionSource, language)}${s.positionConfidence.observations !== null ? ` · ${s.positionConfidence.verifiedObservations ?? 0} / ${s.positionConfidence.observations} ${t("verified", "ยืนยัน")}` : ""}`, prov(s.positionConfidence.source))}
      {row("jobs", t("Job assignments", "งานที่จับคู่"), s.jobs.found === "unavailable" ? t("Booking Diary unavailable", "อ่านสมุดจองไม่ได้") : s.jobs.found === "none_found" ? t("No booking found (not proof of no work)", "ไม่พบงาน (ไม่ได้ยืนยันว่าไม่มีงาน)") : `${s.jobs.candidate} ${t("candidate", "อาจตรงกัน")} · ${s.jobs.needsReview} ${t("need review", "ต้องตรวจสอบ")} · ${s.jobs.unplaced} ${t("not placed", "ยังไม่จับคู่เที่ยว")}`, prov(s.jobs.source))}
      {row("confirmed", t("Confirmed job km", "กม. งานที่ยืนยัน"), s.confirmedKm.value === null ? `— · ${t("no approved confirmation record exists", "ยังไม่มีบันทึกการยืนยันที่อนุมัติ")}` : `${n(s.confirmedKm.value)} ${km}`, prov(s.confirmedKm.source))}
      {row("candidate", t("Candidate km awaiting review", "กม. ที่อาจเป็นงาน รอตรวจสอบ"), s.candidateKm === null ? "—" : `${n(s.candidateKm)} ${km}`, prov("ees_derived"))}
      {row("unallocated", t("Unallocated / unresolved km", "กม. ที่ยังไม่จัดสรร / ยังสรุปไม่ได้"), s.unallocatedKm === null ? "—" : `${n(s.unallocatedKm)} ${km}`, prov("ees_derived"))}
      {row("complete", t("Source completeness", "ความครบถ้วนของข้อมูลต้นทาง"), s.completeness.coverage === "reconciled_complete" ? t("Reconciled, coverage complete", "กระทบยอดแล้ว ครบทั้งวัน") : s.completeness.coverage === "reconciled_coverage_unverified" ? t("Reconciled, coverage unverified", "กระทบยอดแล้ว ยังไม่ยืนยันความครอบคลุม") : s.completeness.coverage === "not_reconciled" ? t("Not reconciled", "ยังไม่กระทบยอด") : t("Not read", "ยังไม่ได้อ่าน"), prov("forth_parking_report"))}
      {row("fuel", t("Fuel purchased", "เชื้อเพลิงที่ซื้อ"), s.fuel.records === null ? "—" : s.fuel.records === 0 ? t("No purchases recorded", "ไม่มีบันทึกการซื้อ") : `${s.fuel.litres === null ? t("litres mixed or unknown", "ลิตรผสมหรือไม่ทราบ") : `${n(s.fuel.litres)} L`} · ฿${n(s.fuel.costThb)} · ${s.fuel.records} ${t("record(s)", "รายการ")}`, prov(s.fuel.source))}
      {row("odometer", t("Odometer checkpoints", "เลขไมล์"), s.odometer.fuelLogs === null && s.odometer.weekly === null ? t("Source unavailable", "แหล่งข้อมูลไม่พร้อม") : `${t("Fuel Logs", "เชื้อเพลิง")} ${s.odometer.fuelLogs?.filter(c => c.km !== null).map(c => n(c.km, 0)).join(", ") || "—"} · ${t("Weekly", "รายสัปดาห์")} ${s.odometer.weekly?.filter(c => c.km !== null).map(c => n(c.km, 0)).join(", ") || "—"}`, `${prov("fuel_log_odometer")} · ${prov("weekly_mileage_odometer")}`)}
      {row("discrepancy", t("Mileage discrepancies", "ความต่างของระยะทาง"), s.discrepancies.filter(d => d.status === "review_required").length ? s.discrepancies.filter(d => d.status === "review_required").map(d => `${d.pair}: ${n(d.differenceKm)} ${km}`).join(" · ") : t("None found in comparable same-period sources", "ไม่พบในแหล่งที่เทียบช่วงเวลาเดียวกันได้"), prov("source_comparison"))}
    </dl>
    <h5>{t("Issues requiring review", "เรื่องที่ต้องตรวจสอบ")} · {s.issues.length}</h5>
    {s.issues.length === 0 ? <p>{t("No issues found in the available evidence.", "ไม่พบปัญหาในหลักฐานที่มี")}</p> : <ul className="fleet-evidence-list">{s.issues.map(i => <li key={i}>{issueLabel(i, language)}</li>)}</ul>}
  </section>;
}
