"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { bangkokDateInput, type FuelTypeGroup } from "@/lib/fleet-evidence-view";
import type { SourceMetric } from "@/lib/fleet-intelligence-sources";
type FleetRow = { vehicleId: string; registration: string; metric: SourceMetric | null; arithmeticPassed: boolean; gpsKm: number | null; segments: number | null; purchaseRecords: number | null; purchasedLitres: number | null; purchaseCostThb: number | null; fuelByType: FuelTypeGroup[] | null; fuelExplanation: string; explanation: string };
type Report = { day: string; capturedAt: string; rows: FleetRow[]; fuelAvailable: boolean;
  fuel: { byType: FuelTypeGroup[] | null; matchedRecords: number; unmatchedRecords: number; vehiclesWithPurchases: number } | null;
  summary: { vehicles: number; reportedVehicles: number; unknownVehicles: number; completeVehicles: number; totalKm: number | null; vehiclesWithUsableRecords: number; vehiclesWithoutRecords: number } };
export function FleetDailyReport({ language, onVehicle }: { language: "en" | "th"; onVehicle: (registration: string) => void }) {
  const t = (en: string, th: string) => language === "th" ? th : en;
  const [day, setDay] = useState(bangkokDateInput);
  const [report, setReport] = useState<Report | null>(null);
  const [sort, setSort] = useState("registration");
  const [show, setShow] = useState<"all" | "records" | "unknown">("all");
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { const controller = request.current; request.current = null; controller?.abort(); }, []);
  function choose(next: string) { if (!next) return; const controller = request.current; request.current = null; controller?.abort(); setDay(next); setReport(null); setStatus("idle"); }
  async function read() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setStatus("loading"); setReport(null);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const session = await supabase.auth.getSession(); if (!session.data.session) throw new Error();
      const response = await fetch(`/api/admin/forth-tracking/evidence/fleet?${new URLSearchParams({ day })}`, { headers: { Authorization: `Bearer ${session.data.session.access_token}` }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(); const result = await response.json() as Report;
      if (!controller.signal.aborted) { setReport(result); setStatus("idle"); }
    } catch { if (request.current === controller) setStatus("failed"); } finally { clearTimeout(timeout); }
  }
  const rows = useMemo(() => {
    const byNumber = (pick: (r: FleetRow) => number | null) => (a: FleetRow, b: FleetRow) => (pick(b) ?? -1) - (pick(a) ?? -1) || a.registration.localeCompare(b.registration);
    const compare = sort === "distance" ? byNumber(r => r.arithmeticPassed ? r.metric?.value ?? null : null)
      : sort === "cost" ? byNumber(r => r.purchaseCostThb)
      : sort === "records" ? byNumber(r => r.purchaseRecords)
      : sort === "unknown" ? (a: FleetRow, b: FleetRow) => Number(a.metric?.value != null) - Number(b.metric?.value != null) || a.registration.localeCompare(b.registration)
      : (a: FleetRow, b: FleetRow) => a.registration.localeCompare(b.registration);
    // "Has records" = reconciled provider distance or at least one recorded purchase; everything else is unknown.
    const hasRecord = (r: FleetRow) => (r.arithmeticPassed && r.metric?.value != null) || (r.purchaseRecords ?? 0) > 0;
    return [...(report?.rows ?? [])].filter(r => show === "all" || (show === "records") === hasRecord(r)).sort(compare);
  }, [report, sort, show]);
  const n = (value: number | null | undefined) => value === null || value === undefined ? "—" : value.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: 2 });
  const baht = (value: number | null | undefined) => value === null || value === undefined ? "—" : value.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fuelLabel = (type: string) => type === "unrecorded" ? t("Fuel type not recorded", "ไม่ได้บันทึกชนิดเชื้อเพลิง") : type.toUpperCase();
  const providerCopy = (row: FleetRow) => row.explanation === "not_read_in_this_session" ? t("No provider snapshot read in your session; distance unknown", "ยังไม่ได้อ่านข้อมูลผู้ให้บริการในเซสชันนี้ ไม่ทราบระยะทาง") : row.explanation === "provider_totals_not_reconciled" ? t("Provider totals did not reconcile; distance withheld", "ยอดผู้ให้บริการไม่ตรงกัน ไม่แสดงระยะทาง") : row.explanation === "provider_coverage_unverified" ? t("Reconciled provider value; full-day coverage unverified", "ค่าผู้ให้บริการกระทบยอดแล้ว ยังไม่ยืนยันความครอบคลุมทั้งวัน") : t("Complete evidence", "หลักฐานครบ");
  const fuelCopy = (row: FleetRow) => row.fuelExplanation === "fuel_source_unavailable" ? t("Fuel Log source unavailable", "แหล่งบันทึกเชื้อเพลิงไม่พร้อม") : row.fuelExplanation === "registration_not_unique" ? t("Registration not unique in registry; fuel not attributed", "ทะเบียนซ้ำในทะเบียนรถ ไม่ระบุเชื้อเพลิงให้รถคันนี้") : row.fuelExplanation === "no_purchases_recorded" ? t("No purchases recorded this day", "ไม่มีบันทึกการซื้อในวันนี้") : row.fuelExplanation === "mixed_fuel_types" ? t("Mixed fuel types; litres shown per type", "หลายชนิดเชื้อเพลิง แสดงลิตรแยกตามชนิด") : t("Recorded purchases", "มีบันทึกการซื้อ");
  const yesterday = bangkokDateInput(new Date(Date.now() - 86400000));
  return <section className="fleet-evidence fleet-daily-report" aria-label={t("Fleet daily report", "รายงานกองรถรายวัน")}>
    <div className="fleet-evidence-heading"><span>{t("EES · READ ONLY", "EES · อ่านอย่างเดียว")}</span><h3>{t("Fleet daily comparison", "เปรียบเทียบกองรถรายวัน")}</h3></div>
    <div className="fleet-evidence-presets" role="group" aria-label={t("Date shortcuts", "เลือกวันที่")}><button type="button" aria-pressed={day === bangkokDateInput()} onClick={() => choose(bangkokDateInput())}>{t("Today", "วันนี้")}</button><button type="button" aria-pressed={day === yesterday} onClick={() => choose(yesterday)}>{t("Yesterday", "เมื่อวาน")}</button></div>
    <form onSubmit={event => { event.preventDefault(); void read(); }}><label>{t("Bangkok date", "วันที่ประเทศไทย")}<input type="date" required value={day} max={bangkokDateInput()} onChange={event => choose(event.target.value)} /></label><button className="btn-secondary" disabled={status === "loading"}>{status === "loading" ? t("Reading…", "กำลังอ่าน…") : t("Refresh daily summary", "อัปเดตสรุปรายวัน")}</button></form>
    <p>{t("Provider and GPS evidence comes from your bounded vehicle/day reads in this server session (up to 30 minutes). This report never downloads full-fleet history. Fuel purchases come from existing EES Fuel Logs. Registry vehicles may include inactive entries.", "ระยะทางผู้ให้บริการและ GPS มาจากการอ่านรถ/วันที่คุณร้องขอในเซสชันเซิร์ฟเวอร์นี้ (ไม่เกิน 30 นาที) รายงานนี้ไม่ดาวน์โหลดประวัติทั้งกองรถ ยอดซื้อเชื้อเพลิงมาจากบันทึกเชื้อเพลิง EES ทะเบียนรถอาจรวมรถที่ไม่ใช้งาน")}</p>
    <p role="status">{status === "failed" ? t("Summary unavailable. Check access and connection, then retry.", "สรุปไม่พร้อม โปรดตรวจสอบสิทธิ์และการเชื่อมต่อแล้วลองใหม่") : ""}</p>
    {report ? <><p className="fleet-evidence-period">{report.day} · {t("Asia/Bangkok", "เวลาไทย")}</p>
      <div className="fleet-evidence-metrics">
        <div><span>{t("Vehicles with usable records", "รถที่มีข้อมูลใช้งานได้")}</span><strong>{report.summary.vehiclesWithUsableRecords}/{report.summary.vehicles}</strong></div>
        <div><span>{t("No usable record · unknown", "ไม่มีข้อมูล · ไม่ทราบ")}</span><strong>{report.summary.vehiclesWithoutRecords}</strong></div>
        <div><span>{t("Reconciled provider km read", "รถที่อ่านระยะทางผู้ให้บริการแล้ว")}</span><strong>{report.summary.reportedVehicles}/{report.summary.vehicles}</strong></div>
        <div><span>{t("Complete fleet total · km", "ยอดกองรถที่ครบ · กม.")}</span><strong>{n(report.summary.totalKm)}</strong></div>
      </div>
      <p className="fleet-evidence-note">{t(`Fleet distance is withheld unless every listed vehicle has reconciled, complete evidence for exactly this day (currently ${report.summary.completeVehicles} complete). Partial provider figures are never summed into a fleet total.`, `ไม่แสดงระยะทางรวมกองรถจนกว่ารถทุกคันจะมีหลักฐานครบและกระทบยอดตรงสำหรับวันนี้ (ครบแล้ว ${report.summary.completeVehicles} คัน) ไม่รวมตัวเลขบางส่วนเป็นยอดกองรถ`)}</p>
      <h4>{t("Fleet fuel purchases", "การซื้อเชื้อเพลิงของกองรถ")}</h4>
      {!report.fuel ? <p>{t("Fuel Log source unavailable. No zero is inferred.", "แหล่งบันทึกเชื้อเพลิงไม่พร้อม ไม่ถือว่าเป็นศูนย์")}</p> : <>
        {report.fuel.byType && report.fuel.byType.length > 0 ? <ul className="fleet-evidence-list">{report.fuel.byType.map(group => <li key={group.fuelType}><strong>{fuelLabel(group.fuelType)}</strong><span>{n(group.purchasedLitres)} L {t("purchased", "ที่ซื้อ")} · ฿{baht(group.costThb)} · {group.records} {t("records", "รายการ")}</span></li>)}</ul> : <p>{t("No fuel purchases recorded for registry vehicles on this day.", "ไม่มีบันทึกการซื้อเชื้อเพลิงของรถในทะเบียนวันนี้")}</p>}
        <small>{t(`${report.fuel.vehiclesWithPurchases} vehicles with purchases · ${report.fuel.matchedRecords} records matched to one registry vehicle · ${report.fuel.unmatchedRecords} unmatched records excluded.`, `รถที่มีการซื้อ ${report.fuel.vehiclesWithPurchases} คัน · จับคู่รถได้ ${report.fuel.matchedRecords} รายการ · ไม่รวม ${report.fuel.unmatchedRecords} รายการที่จับคู่ไม่ได้`)}</small>
        <p className="fleet-evidence-note">{t("Purchased litres are not consumed litres. Fuel types are shown as recorded and never added together. No km/L or cost/km is calculated. Historical vehicle-specific LPG accounting is unchanged.", "ลิตรที่ซื้อไม่ใช่ลิตรที่ใช้จริง แสดงชนิดเชื้อเพลิงตามที่บันทึกและไม่รวมข้ามชนิด ไม่คำนวณ กม./ลิตร หรือต้นทุน/กม. การบัญชี LPG ตามรถเดิมไม่เปลี่ยน")}</p>
      </>}
      <label>{t("Sort", "เรียงตาม")}<select value={sort} onChange={event => setSort(event.target.value)}><option value="registration">{t("Registration", "ทะเบียน")}</option><option value="distance">{t("Provider km · descending", "กม. ผู้ให้บริการ · มากก่อน")}</option><option value="cost">{t("Fuel cost · descending", "ค่าเชื้อเพลิง · มากก่อน")}</option><option value="records">{t("Refuelling records · descending", "จำนวนการเติม · มากก่อน")}</option><option value="unknown">{t("Unknown distance first", "ไม่ทราบระยะทางก่อน")}</option></select></label>
      <label>{t("Show", "แสดง")}<select value={show} onChange={event => setShow(event.target.value as typeof show)}><option value="all">{t("All registry vehicles", "รถทั้งหมดในทะเบียน")}</option><option value="records">{t("With usable records", "เฉพาะที่มีข้อมูล")}</option><option value="unknown">{t("Without records · unknown", "ไม่มีข้อมูล · ไม่ทราบ")}</option></select></label>
      <p className="fleet-evidence-note" role="status">{t(`Showing ${rows.length} of ${report.rows.length} vehicles.`, `แสดง ${rows.length} จาก ${report.rows.length} คัน`)}</p>
      {rows.length === 0 ? <p>{t("No vehicles match this filter.", "ไม่มีรถที่ตรงกับตัวกรองนี้")}</p> : null}
      <ul className="fleet-evidence-list">{rows.map(row => <li key={row.vehicleId}>
        <button type="button" onClick={() => onVehicle(row.registration)}><strong>{row.registration}</strong> → {t("Review vehicle day", "ตรวจสอบรถรายวัน")}</button>
        <span>{t("Provider / GPS km", "กม. ผู้ให้บริการ / GPS")}: {n(row.arithmeticPassed ? row.metric?.value ?? null : null)} / {n(row.gpsKm)}{row.segments !== null ? ` · ${row.segments} ${t("report segments", "ช่วงรายงาน")}` : ""}</span>
        <small>{providerCopy(row)}</small>
        <span>{t("Purchased L / THB", "ลิตรที่ซื้อ / บาท")}: {row.fuelByType && row.fuelByType.length > 0 && row.purchasedLitres === null ? row.fuelByType.map(g => `${fuelLabel(g.fuelType)} ${n(g.purchasedLitres)} L`).join(" · ") : n(row.purchasedLitres)} / {baht(row.purchaseCostThb)}</span>
        <small>{fuelCopy(row)}</small>
      </li>)}</ul>
      <small>{t("Captured", "อ่านเมื่อ")}: {new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(report.capturedAt))}</small>
    </> : null}
  </section>;
}
