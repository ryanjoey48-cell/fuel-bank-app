"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { bangkokDateInput } from "@/lib/fleet-evidence-view";
import { formatLitres, formatThb, type FuelByType, type FuelInterval, type FuelTransaction, type VehicleFuelSummary } from "@/lib/fleet-fuel-view";
import { compareIntervalToForth, comparabilityText, type ForthDayKm } from "@/lib/fleet-fuel-comparability";
import { reviewText } from "@/lib/fleet-coverage-review";

type FuelResponse = { from: string; to: string; capturedAt: string; source: string; sourceStatus: "available" | "unavailable" | "truncated";
  capabilities: { columns: string[]; fullTankConfirmation: string; receiptChecked: boolean; stableVehicleId: boolean };
  vehicles: (VehicleFuelSummary & { reviewFlags: number | null; registryStatus?: string; transactions: FuelTransaction[] | null; intervals: FuelInterval[] | null })[] };
/** Forth evidence for the same vehicle and period, from the already-loaded EES/evidence read (cache only). Absent days are not reviewed, never zero. */
export type FuelForthContext = { days: ForthDayKm[]; reviewedDays: number; totalDays: number; providerKm: number | null; providerKmDays: number; gpsKm: number | null; candidateCount: number };

/** Display-only: an interval at or above this distance gets a review note. It does not alter or reject the reading. */
const LARGE_INTERVAL_KM = 1000;

export function fuelTypeLabel(type: string, language: "en" | "th") { return type === "unrecorded" ? (language === "th" ? "ไม่ได้บันทึกชนิด" : "Type not recorded") : type.toUpperCase(); }

/** `scope` makes the date range shared with the other vehicle tabs (controlled); without it the panel keeps its own 30-day range. */
export function FleetFuelPanel({ vehicleId, registration, language, scope, onScope, forth, onOpenDay, onLoadContext, contextLoading, onExplainMileage }: {
  /** V7.8.3: opens the focused mileage investigation for this vehicle and period (cache only). */
  onExplainMileage?: () => void; vehicleId: string | null; registration?: string; language: "en" | "th"; scope?: { from: string; to: string }; onScope?: (from: string, to: string) => void; forth?: FuelForthContext | null; onOpenDay?: (day: string) => void; /** Loads the EES records and the Forth days already held in this user's cache (no Forth request) so the review can show reviewed days and distance. */ onLoadContext?: () => void; contextLoading?: boolean }) {
  const t = (en: string, th: string) => language === "th" ? th : en; const U = { L: language === "th" ? "ลิตร" : "L", km: language === "th" ? "กม." : "km" };
  const shift = (days: number) => bangkokDateInput(new Date(Date.now() - days * 86400000));
  const [fromLocal, setFromLocal] = useState(() => shift(29));
  const [toLocal, setToLocal] = useState(bangkokDateInput);
  const from = scope?.from ?? fromLocal, to = scope?.to ?? toLocal;
  const setRange = (f: string, t2: string) => { if (scope && onScope) onScope(f, t2); else { setFromLocal(f); setToLocal(t2); } };
  const [data, setData] = useState<FuelResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  // A different date range or vehicle invalidates what was loaded: never show purchases for one period or truck under another.
  useEffect(() => { request.current?.abort(); request.current = null; setData(null); setState("idle"); }, [from, to, vehicleId]);
  function reset() { request.current?.abort(); request.current = null; setData(null); setState("idle"); }
  function preset(days: number) { reset(); setRange(shift(days - 1), bangkokDateInput()); }
  async function load() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setState("loading"); setData(null);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const { data: session } = await supabase.auth.getSession(); if (!session.session || !vehicleId) throw new Error();
      const response = await fetch(`/api/admin/forth-tracking/evidence/fuel?${new URLSearchParams({ vehicleId, from, to })}`, { headers: { Authorization: `Bearer ${session.session.access_token}` }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(); const result = await response.json() as FuelResponse;
      if (request.current === controller) { setData(result); setState("idle"); }
    } catch { if (request.current === controller) setState("failed"); } finally { clearTimeout(timeout); }
  }
  const vehicle = data?.vehicles[0] ?? null;
  const stamp = (iso: string | null) => iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
  const byType = (groups: FuelByType[] | null) => groups === null ? "—" : groups.length === 0 ? t("No purchases", "ไม่มีการซื้อ") : groups.map(g => `${fuelTypeLabel(g.fuelType, language)} ${formatLitres(g.litres, language)} ${U.L}`).join(" · ");
  const withheldCopy = (reason: string | null) => reason === "odometer_decrease_requires_review" ? t("Distance withheld: odometer decreased", "ไม่แสดงระยะทาง: เลขไมล์ลดลง") : reason === "implausible_odometer_jump" ? t("Distance withheld: implausible jump", "ไม่แสดงระยะทาง: เลขไมล์เพิ่มผิดปกติ") : reason === "identical_odometer_review" ? t("Identical readings · 0 km needs review", "เลขไมล์เท่ากัน · 0 กม. ต้องตรวจสอบ") : null;
  const km1 = (n: number) => formatLitres(n, language);
  const flagText = (tx: FuelTransaction) => tx.reviewFlags.includes("zero_litres_and_cost") ? t("Review: 0 L and ฿0.00 recorded", "ตรวจสอบ: บันทึก 0 ลิตร และ ฿0.00") : tx.reviewFlags.includes("missing_litres_or_cost") ? t("Review: litres or cost missing", "ตรวจสอบ: ไม่มีลิตรหรือจำนวนเงิน") : t(`Review: ฿${formatThb(tx.pricePerLitre, language)} per litre is outside the usual range`, `ตรวจสอบ: ฿${formatThb(tx.pricePerLitre, language)} ต่อลิตร อยู่นอกช่วงปกติ`);
  const flagged = vehicle?.transactions?.filter(x => x.reviewFlags.length > 0).length ?? 0;
  const forthDays = useMemo(() => forth?.days ?? [], [forth]);
  const comparisons = useMemo(() => new Map((vehicle?.intervals ?? []).map(i => [`${i.from.id}:${i.to.id}`, compareIntervalToForth({ fromDate: i.from.date, toDate: i.to.date, km: i.km, withheld: i.withheld }, forthDays)])), [vehicle, forthDays]);

  const outsideRange = [...comparisons.values()].filter(c => c.status === "outside_range").length;
  const comparisonCandidates = (forth?.candidateCount ?? 0) + outsideRange;
  return <section className="fleet-evidence fleet-fuel-panel v782-fuel" aria-label={t("Fuel Logs evidence", "หลักฐานจากบันทึกเชื้อเพลิง")} data-fuel-intelligence>
    <div className="fleet-evidence-heading"><span>{t("EES FUEL LOGS · READ ONLY", "บันทึกเชื้อเพลิง EES · อ่านอย่างเดียว")}</span><h3>{t("Fuel review", "ตรวจสอบเชื้อเพลิง")}{registration ? ` · ${registration}` : ""}</h3></div>
    <div className="v782-fuel-controls">
      <div className="fleet-evidence-presets" role="group" aria-label={t("Date shortcuts", "เลือกช่วงวันที่")}><button type="button" onClick={() => preset(7)}>{t("7 days", "7 วัน")}</button><button type="button" onClick={() => preset(30)}>{t("30 days", "30 วัน")}</button><button type="button" onClick={() => preset(62)}>{t("62 days", "62 วัน")}</button></div>
      <form onSubmit={event => { event.preventDefault(); void load(); }}>
        <div className="fleet-evidence-dates"><label>{t("From", "ตั้งแต่")}<input required type="date" value={from} max={to} onChange={event => { if (event.target.value) { setRange(event.target.value, to); reset(); } }} /></label><label>{t("To", "ถึง")}<input required type="date" value={to} min={from} max={bangkokDateInput()} onChange={event => { if (event.target.value) { setRange(from, event.target.value); reset(); } }} /></label></div>
        <button className="btn-secondary min-h-11" disabled={!vehicleId || state === "loading"} type="submit">{state === "loading" ? t("Reading Fuel Logs…", "กำลังอ่านบันทึกเชื้อเพลิง…") : data ? t("Reload fuel records", "โหลดบันทึกเชื้อเพลิงใหม่") : t("Review fuel evidence", "ตรวจสอบหลักฐานเชื้อเพลิง")}</button>
      </form>
    </div>
    <p className="fleet-evidence-note">{t("Asia/Bangkok · up to 62 days. Reads the existing Fuel Logs only; nothing is created or changed here.", "เวลาไทย · สูงสุด 62 วัน อ่านจากบันทึกเชื้อเพลิงเดิมเท่านั้น ไม่สร้างหรือแก้ไขข้อมูล")} <Link href="/fuel-logs">{t("Open Fuel Logs", "เปิดบันทึกเชื้อเพลิง")}</Link></p>
    <div role="status" aria-live="polite">{state === "failed" ? <p>{t("Fuel evidence could not be read. Check access, dates and connection, then retry.", "อ่านหลักฐานเชื้อเพลิงไม่ได้ โปรดตรวจสอบสิทธิ์ วันที่ และการเชื่อมต่อ แล้วลองใหม่")}</p> : null}</div>
    {!data && state !== "loading" ? <p className="v72-empty-line">{t("Press “Review fuel evidence” to read this vehicle’s purchases for the period. Nothing is read until you do.", "กด “ตรวจสอบหลักฐานเชื้อเพลิง” เพื่ออ่านการซื้อของรถคันนี้ในช่วงนี้ จะไม่มีการอ่านจนกว่าจะกด")}</p> : null}
    {data && data.sourceStatus !== "available" ? <p role="alert">{data.sourceStatus === "truncated" ? t("Too many Fuel Log rows for this period (limit 1,000). Narrow the date range. No totals are shown.", "บันทึกเชื้อเพลิงในช่วงนี้มากเกินไป (สูงสุด 1,000) โปรดลดช่วงวันที่ ไม่แสดงยอดรวม") : t("Fuel Logs are unavailable. No zero is inferred.", "บันทึกเชื้อเพลิงไม่พร้อม ไม่ถือว่าเป็นศูนย์")}</p> : null}
    {vehicle && vehicle.records === null && data?.sourceStatus === "available" ? <p role="alert">{t("This registration is shared by more than one registry vehicle, so purchases are not attributed to it.", "ทะเบียนนี้ซ้ำกับรถหลายรายการในทะเบียน จึงไม่ระบุการซื้อให้รถคันนี้")}</p> : null}
    {vehicle && vehicle.records !== null ? <>
      <dl className="v72-strip v782-fuel-top" data-fuel-summary>
        <div><dt>{reviewText("fuelPurchase", language)}</dt><dd><b>฿{formatThb(vehicle.costThb, language)}</b><small>{vehicle.records} {t("refuelling records", "ครั้ง")}{vehicle.coverage ? ` · ${vehicle.coverage.daysWithRecords} ${t("day(s)", "วัน")}` : ""} · {t("purchased, not consumed", "ซื้อ ไม่ใช่ใช้จริง")}</small></dd></div>
        <div className="v782-wide"><dt>{t("Litres purchased by fuel type", "ลิตรที่ซื้อแยกตามชนิด")}</dt><dd>{vehicle.litresByType && vehicle.litresByType.length ? vehicle.litresByType.map(g => <span key={g.fuelType} className="v771-type"><b>{formatLitres(g.litres, language)}</b> {U.L} <small>{fuelTypeLabel(g.fuelType, language)} · {g.records}</small></span>) : <b>—</b>}<small>{t("Never added across types. LPG stays separate.", "ไม่รวมข้ามชนิด LPG แยกต่างหาก")}</small></dd></div>
        <div><dt>{t("Reviewed Forth days", "วัน Forth ที่ตรวจแล้ว")}</dt><dd><b>{forth ? `${forth.reviewedDays}/${forth.totalDays}` : "—"}</b><small>{forth ? t("others are not reviewed, not zero driving", "วันอื่นยังไม่ได้ตรวจ ไม่ใช่ไม่ได้ขับ") : onLoadContext ? <button type="button" className="fleet-link-button" disabled={contextLoading} onClick={onLoadContext} data-load-forth-context>{contextLoading ? t("Loading…", "กำลังโหลด…") : t("Load reviewed days (cache only)", "โหลดวันที่ตรวจแล้ว (จากแคชเท่านั้น)")}</button> : t("load the EES records first", "โหลดข้อมูล EES ก่อน")}</small></dd></div>
        <div><dt>{t("Forth distance (reviewed days)", "ระยะทาง Forth (วันที่ตรวจแล้ว)")}</dt><dd><b>{forth && forth.providerKm !== null ? `${km1(forth.providerKm)} ${U.km}` : "—"}</b><small>{forth ? (forth.providerKm === null ? t("no reconciled reviewed day", "ไม่มีวันที่กระทบยอด") : t(`partial: ${forth.providerKmDays} day(s)`, `บางส่วน: ${forth.providerKmDays} วัน`)) : "—"}{forth && forth.gpsKm !== null ? ` · GPS ${km1(forth.gpsKm)} ${U.km}` : ""}{onExplainMileage && forth && forth.providerKm !== null && forth.gpsKm !== null ? <> · <button type="button" className="fleet-link-button" onClick={onExplainMileage} data-explain-mileage>{t("Explain mileage differences", "อธิบายความต่างของระยะทาง")}</button></> : null}</small></dd></div>
        <div><dt>{t("Latest usable odometer", "เลขไมล์ล่าสุดที่ใช้ได้")}</dt><dd><b>{vehicle.latestOdometer ? km1(vehicle.latestOdometer.km) : "—"}</b><small>{vehicle.latestOdometer ? `${U.km} · ${vehicle.latestOdometer.date}` : t("none in this period", "ไม่มีในช่วงนี้")}{vehicle.coverage ? ` · ${vehicle.coverage.withOdometer}/${vehicle.coverage.records} ${t("with odometer", "มีเลขไมล์")}` : ""}</small></dd></div>
        <div className={flagged + comparisonCandidates > 0 ? "is-attention" : ""}><dt>{reviewText("reviewCandidate", language)}</dt><dd><b>{flagged + comparisonCandidates}</b><small>{t(`${flagged} fuel record(s) · ${comparisonCandidates} source-comparison (${outsideRange} odometer interval(s) outside the Forth range)`, `${flagged} รายการเชื้อเพลิง · ${comparisonCandidates} เปรียบเทียบแหล่งข้อมูล (${outsideRange} ช่วงเลขไมล์อยู่นอกช่วง Forth)`)}</small></dd></div>
      </dl>
      {vehicle.litres === null && vehicle.litresByType && vehicle.litresByType.length > 0 ? <p className="v72-hint">{t("Mixed or unrecorded fuel types · litres are not combined", "ชนิดเชื้อเพลิงหลายชนิดหรือไม่ได้บันทึก · ไม่รวมลิตรข้ามชนิด")}.</p> : null}
      <p className="v72-hint">{data!.from} → {data!.to} · {t("read", "อ่านเมื่อ")} {stamp(data!.capturedAt)} · {t("latest entry", "บันทึกล่าสุด")} {stamp(vehicle.coverage?.latestEntryAt ?? null)}</p>

      <h4>{t("Fuel transactions", "รายการเติมเชื้อเพลิง")} · {vehicle.transactions?.length ?? 0}</h4>
      {vehicle.transactions && vehicle.transactions.length === 0 ? <p className="v72-empty-line">{t("No refuelling records in this period. This does not prove no fuel was bought elsewhere.", "ไม่มีบันทึกการเติมในช่วงนี้ ไม่ได้ยืนยันว่าไม่มีการซื้อที่อื่น")}</p> : <div className="v72-table-wrap"><table className="v72-table v72-fuel-table v782-cards" data-fuel-table>
        <thead><tr><th scope="col">{t("Date", "วันที่")}</th><th scope="col">{t("Fuel type", "ชนิด")}</th><th scope="col" className="num">{t("Litres", "ลิตร")}</th><th scope="col" className="num">{t("Cost (฿)", "จำนวนเงิน (฿)")}</th><th scope="col" className="num">{t("Odometer (km)", "เลขไมล์ (กม.)")}</th><th scope="col">{reviewText("sourceEvidence", language)}</th><th scope="col">{t("Data quality", "คุณภาพข้อมูล")}</th></tr></thead>
        <tbody>{vehicle.transactions?.map(tx => <tr key={tx.id} className={tx.reviewFlags.length > 0 ? "needs-review" : ""} data-tx={tx.id}>
          <th scope="row" data-label={t("Date", "วันที่")}>{tx.date}{onOpenDay && Boolean(forthDays.find(d => d.day === tx.date)) ? <button type="button" className="fleet-link-button" onClick={() => onOpenDay(tx.date)}>{t("Daily Activity", "กิจกรรมประจำวัน")}</button> : null}</th>
          <td data-label={t("Fuel type", "ชนิด")}>{fuelTypeLabel(tx.fuelType, language)}</td>
          <td className="num" data-label={t("Litres", "ลิตร")}>{tx.litres === null ? <span className="v72-muted">{t("missing", "ไม่มี")}</span> : formatLitres(tx.litres, language)}</td>
          <td className="num" data-label={t("Cost (฿)", "จำนวนเงิน (฿)")}>{tx.costThb === null ? <span className="v72-muted">{t("missing", "ไม่มี")}</span> : formatThb(tx.costThb, language)}</td>
          <td className="num" data-label={t("Odometer (km)", "เลขไมล์ (กม.)")}>{tx.odometerKm === null ? <span className="v72-muted">{t("not recorded", "ไม่ได้บันทึก")}</span> : formatLitres(tx.odometerKm, language)}</td>
          <td className="v72-notes" data-label={reviewText("sourceEvidence", language)}>{t("Fuel Logs", "บันทึกเชื้อเพลิง")}{tx.station ? ` · ${tx.station}` : ""}{tx.receiptChecked === true ? ` · ${t("receipt checked", "ตรวจใบเสร็จแล้ว")}` : tx.receiptChecked === false ? ` · ${t("receipt not checked", "ยังไม่ตรวจใบเสร็จ")}` : ""}<small>{t("entered", "บันทึกเมื่อ")} {stamp(tx.enteredAt)}</small></td>
          <td data-label={t("Data quality", "คุณภาพข้อมูล")}>{tx.reviewFlags.length > 0 ? <span className="v72-flag" role="note">{flagText(tx)} · {t("shown as recorded", "แสดงตามที่บันทึก")}</span> : <span className="v72-muted">{t("No flags", "ไม่มีข้อสังเกต")}</span>}</td></tr>)}</tbody></table></div>}

      <details className="v72-evidence v782-secondary" data-odometer-details><summary>{reviewText("odometerInterval", language)} · {vehicle.intervals?.length ?? 0} — {t("date-aligned comparison with Forth", "เปรียบเทียบกับ Forth ตามวันที่")}</summary>
        {!vehicle.intervals || vehicle.intervals.length === 0 ? <p className="v72-empty-line">{t("Fewer than two usable odometer readings. Distance is unknown.", "มีเลขไมล์ที่ใช้ได้น้อยกว่าสองค่า ไม่ทราบระยะทาง")}</p> : <div className="v72-table-wrap"><table className="v72-table v72-fuel-table v782-cards" data-odometer-table>
          <thead><tr><th scope="col">{t("From", "จาก")}</th><th scope="col">{t("To", "ถึง")}</th><th scope="col" className="num">{t("Start (km)", "เริ่ม (กม.)")}</th><th scope="col" className="num">{t("End (km)", "สิ้นสุด (กม.)")}</th><th scope="col" className="num">{t("Difference (km)", "ผลต่าง (กม.)")}</th><th scope="col">{t("Purchased in interval", "ซื้อในช่วงนี้")}</th><th scope="col">{t("Forth comparison", "เปรียบเทียบกับ Forth")}</th><th scope="col">{t("Evidence notes", "หมายเหตุหลักฐาน")}</th></tr></thead>
          <tbody>{vehicle.intervals.map(interval => { const large = interval.km !== null && interval.km >= LARGE_INTERVAL_KM; const cmp = comparisons.get(`${interval.from.id}:${interval.to.id}`)!; return <tr key={`${interval.from.id}:${interval.to.id}`} className={large || interval.withheld || cmp.status === "outside_range" ? "needs-review" : ""} data-large-interval={large ? "true" : undefined} data-comparison={cmp.status}>
            <th scope="row" data-label={t("From", "จาก")}>{interval.from.date}</th><td data-label={t("To", "ถึง")}>{interval.to.date}</td>
            <td className="num" data-label={t("Start (km)", "เริ่ม (กม.)")}>{formatLitres(interval.from.odometerKm, language)}</td><td className="num" data-label={t("End (km)", "สิ้นสุด (กม.)")}>{formatLitres(interval.to.odometerKm, language)}</td>
            <td className="num" data-label={t("Difference (km)", "ผลต่าง (กม.)")}><b>{interval.km === null ? "—" : formatLitres(interval.km, language)}</b></td>
            <td data-label={t("Purchased in interval", "ซื้อในช่วงนี้")}>{byType(interval.purchasedLitresByType)} · ฿{formatThb(interval.purchaseCostThb, language)}</td>
            <td data-label={t("Forth comparison", "เปรียบเทียบกับ Forth")}><span className={cmp.status === "not_comparable" ? "v72-muted" : ""}>{comparabilityText(cmp, language, km1)}</span>
              <details className="v783-odo" data-odometer-explain={interval.from.id}><summary>{t("Explain this interval", "อธิบายช่วงนี้")}</summary>
                <dl className="v783-odo-facts">
                  <div><dt>{t("Odometer start record", "บันทึกเลขไมล์เริ่มต้น")}</dt><dd>{interval.from.date} · {km1(interval.from.odometerKm)} {U.km}</dd></div>
                  <div><dt>{t("Odometer end record", "บันทึกเลขไมล์สิ้นสุด")}</dt><dd>{interval.to.date} · {km1(interval.to.odometerKm)} {U.km}</dd></div>
                  <div><dt>{t("Observed odometer difference", "ผลต่างเลขไมล์ที่สังเกตได้")}</dt><dd>{interval.km === null ? t("withheld for review", "ระงับเพื่อตรวจสอบ") : `${km1(interval.km)} ${U.km}`}</dd></div>
                  <div><dt>{t("Date interval", "ช่วงวันที่")}</dt><dd>{interval.from.date} → {interval.to.date} · {cmp.coveredDays} {t("calendar days (Bangkok)", "วันตามปฏิทิน (เวลาไทย)")} · {cmp.reviewedDays} {t("with a reviewed Forth report", "มีรายงาน Forth ที่ตรวจแล้ว")}</dd></div>
                  <div><dt>{t("Boundary uncertainty", "ความไม่แน่นอนที่ขอบช่วง")}</dt><dd>{t("Fuel Log readings have a date but no time. The first and last day are only partly inside the interval, so Forth distance is a range: the lower bound counts only the days strictly between the two readings, the upper bound adds both boundary days.", "เลขไมล์จากบันทึกเชื้อเพลิงมีวันที่แต่ไม่มีเวลา วันแรกและวันสุดท้ายอยู่ในช่วงเพียงบางส่วน ระยะ Forth จึงเป็นช่วง: ขอบล่างนับเฉพาะวันที่อยู่ระหว่างสองบันทึก ขอบบนรวมวันขอบทั้งสอง")}</dd></div>
                  {cmp.status === "not_comparable" ? <div><dt>{t("Why not compared", "ทำไมจึงไม่เปรียบเทียบ")}</dt><dd>{comparabilityText(cmp, language, km1)}{cmp.missingDays.length ? ` · ${t("days without a usable report", "วันที่ไม่มีรายงานที่ใช้ได้")}: ${cmp.missingDays.slice(0, 8).join(", ")}` : ""}</dd></div> : <>
                    <div><dt>{t("Forth lower bound", "ขอบล่างของ Forth")}</dt><dd>{km1(cmp.lowerKm)} {U.km}</dd></div>
                    <div><dt>{t("Forth upper bound", "ขอบบนของ Forth")}</dt><dd>{km1(cmp.upperKm)} {U.km}</dd></div>
                    <div><dt>{t("Result", "ผล")}</dt><dd>{cmp.status === "within_range" ? t("The odometer difference is within the range.", "ผลต่างเลขไมล์อยู่ในช่วง") : t(`The odometer difference is ${km1(cmp.gapKm)} km outside the range.`, `ผลต่างเลขไมล์อยู่นอกช่วง ${km1(cmp.gapKm)} กม.`)}</dd></div>
                    {cmp.gpsUpperKm !== null ? <div data-odometer-gps><dt>{t("GPS-derived distance, same days", "ระยะทางคำนวณจาก GPS วันเดียวกัน")}</dt><dd>{cmp.gpsLowerKm !== null ? `${km1(cmp.gpsLowerKm)}–` : ""}{km1(cmp.gpsUpperKm)} {U.km} · {t("for context only; it does not replace the Forth range", "ใช้ประกอบเท่านั้น ไม่ได้แทนช่วงของ Forth")}</dd></div> : null}
                    {cmp.openEndDays.length ? <div data-odometer-open-end><dt>{t("Trip open at midnight", "เที่ยววิ่งข้ามเที่ยงคืน")}</dt><dd>{t(`The Forth report for ${cmp.openEndDays.join(", ")} ends with a trip that has no end time (recorded as 0 km). Distance from a trip that crosses midnight can be missing from both days' Forth totals, so the Forth upper bound can understate distance. Check the GPS-derived distance and the route for those hours before treating the gap as unexplained.`, `รายงาน Forth ของวันที่ ${cmp.openEndDays.join(", ")} จบด้วยเที่ยววิ่งที่ไม่มีเวลาสิ้นสุด (บันทึกเป็น 0 กม.) ระยะทางของเที่ยวที่วิ่งข้ามเที่ยงคืนอาจไม่ถูกนับในยอด Forth ของทั้งสองวัน ขอบบนของ Forth จึงอาจต่ำกว่าจริง ให้ดูระยะทางจาก GPS และเส้นทางช่วงเวลานั้นก่อนสรุปว่าส่วนต่างอธิบายไม่ได้`)}</dd></div> : null}
                  </>}
                  <div><dt>{t("Source limitations", "ข้อจำกัดของข้อมูล")}</dt><dd>{t("Forth distance is provider-reported and reviewed days are only those read in the last 30 minutes. Odometer readings are entered by people, may be typed late, and do not show where or why distance was driven. A result outside the range is a prompt to check the two readings and the days; it does not indicate tampering, misuse or an incorrect purchase.", "ระยะ Forth เป็นค่าที่ผู้ให้บริการรายงาน และวันที่ตรวจแล้วคือวันที่อ่านใน 30 นาทีที่ผ่านมาเท่านั้น เลขไมล์เป็นข้อมูลที่คนบันทึก อาจบันทึกช้า และไม่แสดงว่าวิ่งที่ไหนหรือทำไม ผลที่อยู่นอกช่วงเป็นเพียงสัญญาณให้ตรวจเลขไมล์สองค่าและวันที่เกี่ยวข้อง ไม่ได้บ่งชี้การแก้ไข การใช้ผิด หรือการซื้อที่ไม่ถูกต้อง")}</dd></div>
                </dl></details></td>
            <td className="v72-notes" data-label={t("Evidence notes", "หมายเหตุหลักฐาน")}>
              {large ? <span className="v72-flag" role="note">{t(`Review: ${formatLitres(interval.km as number, language)} km is larger than usual for one interval · shown as recorded`, `ตรวจสอบ: ${formatLitres(interval.km as number, language)} กม. สูงกว่าปกติสำหรับหนึ่งช่วง · แสดงตามที่บันทึก`)}</span> : null}
              <span>{withheldCopy(interval.withheld) ?? t("Date-only readings · office review required", "เลขไมล์ระบุเฉพาะวันที่ · ต้องตรวจสอบ")}{interval.recordsWithoutOdometer > 0 ? ` · ${interval.recordsWithoutOdometer} ${t("purchase(s) without odometer", "รายการซื้อที่ไม่มีเลขไมล์")}` : ""}</span>
              <small>{t("Efficiency: Unknown / ไม่ทราบ", "ประสิทธิภาพ: ไม่ทราบ")} · {interval.efficiency.reason === "full_tank_evidence_unavailable" ? t("no full-tank evidence, so purchased litres are not consumed litres", "ไม่มีหลักฐานเติมเต็มถัง จึงไม่ถือว่าลิตรที่ซื้อคือลิตรที่ใช้จริง") : t("a validated full-to-full review is required", "ต้องตรวจสอบการเติมเต็มถังต่อเต็มถัง")}</small></td></tr>; })}</tbody></table></div>}
        {vehicle.intervals?.some(i => i.km !== null && i.km >= LARGE_INTERVAL_KM) ? <p className="v72-notice" role="note" data-large-interval-note>{t(`Rows marked Review have a distance of ${LARGE_INTERVAL_KM.toLocaleString("en-GB")} km or more between two odometer readings. Each is shown exactly as recorded and is not treated as an error. Possible reasons: refuelling records missing in between, a mistyped odometer reading, or a long trip. Check the two source readings.`, `แถวที่ทำเครื่องหมายตรวจสอบมีผลต่างตั้งแต่ ${LARGE_INTERVAL_KM.toLocaleString("en-GB")} กม. ระหว่างเลขไมล์สองค่า แสดงตามที่บันทึกทุกประการและไม่ถือว่าผิด อาจเกิดจากขาดบันทึกการเติมระหว่างช่วง กรอกเลขไมล์ผิด หรือเดินทางไกล โปรดตรวจเลขไมล์ต้นทางทั้งสองค่า`)}</p> : null}
        <p className="v72-hint">{t("An interval is compared with Forth only when every day it covers has a reviewed, reconciled Forth report. Readings carry a date but no time, so the comparison is a range, never a single figure, and a difference is a review candidate, not a finding. Odometer periods are never combined.", "ช่วงเลขไมล์เทียบกับ Forth เมื่อทุกวันที่ครอบคลุมมีรายงาน Forth ที่ตรวจและกระทบยอดแล้วเท่านั้น เลขไมล์มีวันที่แต่ไม่มีเวลา จึงเปรียบเทียบเป็นช่วง ไม่ใช่ตัวเลขเดียว และส่วนต่างเป็นสิ่งที่ควรตรวจสอบ ไม่ใช่ข้อสรุป ไม่รวมช่วงเลขไมล์ที่ต่างกัน")}</p>
      </details>
      <p className="v72-hint">{t("Purchased fuel is not consumed fuel. km/L and cost per km are not calculated. Historical LPG accounting for vehicle-specific rules is unchanged.", "เชื้อเพลิงที่ซื้อไม่ใช่เชื้อเพลิงที่ใช้จริง ไม่คำนวณ กม./ลิตร และต้นทุนต่อ กม. การบัญชี LPG ตามรถเดิมไม่เปลี่ยน")}{data!.capabilities.fullTankConfirmation !== "supported" ? ` ${t("The deployed Fuel Logs source has no full-tank field.", "แหล่งบันทึกเชื้อเพลิงที่ใช้งานอยู่ไม่มีช่องเติมเต็มถัง")}` : ""}</p>
    </> : null}
  </section>;
}
