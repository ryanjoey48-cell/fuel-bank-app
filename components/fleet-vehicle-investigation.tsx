"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatThb } from "@/lib/fleet-fuel-view";
import { compareSources, type SourceDistance } from "@/lib/fleet-fuel-view";
import { checkpointSpan, type FuelTypeGroup } from "@/lib/fleet-evidence-view";
import { CLASS_COPY, ISSUE_CLASS, OVERSIGHT_ISSUE_COPY, type OversightRow } from "@/lib/fleet-fuel-oversight";
import { driverLabel } from "@/lib/fleet-driver-attribution";
import { fuelTypeLabel } from "@/components/fleet-fuel-panel";
import { FleetVisitMap } from "@/components/fleet-visit-map";
import { FleetMileageReconciliation } from "@/components/fleet-mileage-reconciliation";
import { useDayPlaces, visitLabel } from "@/components/fleet-day-places";
import type { ProviderDay } from "@/lib/fleet-intelligence-day";
import type { JourneyLedger } from "@/lib/fleet-journey-ledger";

type Lang = "en" | "th";
export type InvestigationTarget = "fuel" | "daily" | "journeys" | "route";
type EvidenceDay = { day: string; provider: ProviderDay | null; fuelPurchases?: FuelTypeGroup[] | null; checkpoints: unknown[] | null };
type Evidence = { vehicleId: string; registration?: string; activityDays?: EvidenceDay[]; intervals: { source: string; from: string; to: string; metric: { value: number | null }; reviewRequired: boolean }[] | null };
const clock = (language: Lang, iso: string) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/**
 * Reports: one vehicle's supporting evidence for the selected period, read on demand (a single cache-only evidence request; no Forth call).
 * Purchases are never consumption and an unread day is never zero. Visit maps reuse the existing authorised inspector for a cached day.
 */
export function FleetVehicleInvestigation({ language, row, from, to, onOpen, onClose, initialRecon }: {
  /** Opens the mileage investigation straight away (from a queue entry). It is cache only. */
  initialRecon?: boolean;
  language: Lang; row: OversightRow; from: string; to: string; onOpen: (target: InvestigationTarget, day: string | null) => void; onClose: () => void;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const lang = language === "th" ? 1 : 0;
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [day, setDay] = useState<string | null>(null);
  const [mapVisit, setMapVisit] = useState<string | null>(null);
  const [recon, setRecon] = useState(Boolean(initialRecon)); // the parent remounts this panel for another vehicle or period
  const headRef = useRef<HTMLHeadingElement | null>(null);
  // V7.8.3 keyboard fix: the control that opened this panel (captured before focus moves to the heading) gets focus back on Close,
  // so a keyboard user returns to the same place in the Reports queue instead of the top of the page.
  const opener = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  const close = () => { const el = opener.current; onClose(); if (el) setTimeout(() => { if (el.isConnected) el.focus(); }, 0); };
  const n =(v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: d }));

  // Exactly one cache-only evidence request per selected vehicle and period; a late answer for another vehicle or period is ignored.
  useEffect(() => {
    const controller = new AbortController(); setState("loading"); setEvidence(null); setDay(null); setMapVisit(null);
    const timeout = setTimeout(() => controller.abort(), 30000);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
        const response = await fetch(`/api/admin/forth-tracking/evidence?${new URLSearchParams({ vehicleId: row.vehicleId, from, to })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("status");
        const body = await response.json() as Evidence;
        if (controller.signal.aborted || body.vehicleId !== row.vehicleId) return;
        setEvidence(body); setState("ready");
        const firstRead = body.activityDays?.find(d => d.provider)?.day ?? null; setDay(firstRead);
      } catch { if (!controller.signal.aborted) setState("failed"); } finally { clearTimeout(timeout); }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [row.vehicleId, from, to, row.reviewedDays]); // a new reviewed day (from the coverage review) reloads this panel; still cache-only
  useEffect(() => { headRef.current?.focus(); }, [row.vehicleId]);

  const days = evidence?.activityDays ?? [];
  const readDays = days.filter(d => d.provider);
  const places = useDayPlaces({ vehicleId: row.vehicleId, day: day ?? from, dayRead: Boolean(day), readStamp: day ?? "" });
  const visits = places.data?.visits ?? [];
  const visitRefs = visits.map(v => ({ id: v.id, firstAt: v.firstAt, lastAt: v.lastAt, title: visitLabel(v, language).title, named: visitLabel(v, language).named }));
  const driver = places.data?.read ? driverLabel(places.data.driver, language, true) : null;

  const comparison = useMemo(() => {
    if (!evidence) return null;
    const providerDays = readDays.filter(d => d.provider!.provider.arithmetic.status === "pass");
    const sum = (vals: (number | null)[]) => (vals.length && vals.every(v => v !== null) ? vals.reduce<number>((a, v) => a + (v as number), 0) : null);
    const span = evidence.intervals ? checkpointSpan(evidence.intervals as never, "fuel_logs") : null;
    const start = readDays[0]?.day ?? null, end = readDays.at(-1)?.day ?? null;
    const forth: SourceDistance = { source: "forth_provider", km: sum(providerDays.map(d => d.provider!.sources.providerReported.value)), periodStart: start, periodEnd: end, complete: false };
    const odo: SourceDistance = { source: "fuel_log_odometer", km: span?.km ?? null, periodStart: span?.from ?? null, periodEnd: span?.to ?? null, complete: false };
    return { forth, odo, result: compareSources(forth, odo), reviewRequired: span?.reviewRequired ?? false };
  }, [evidence, readDays]);

  const reason = (r: string) => r === "missing_distance" ? t("one of the two distances is not available", "ไม่มีระยะทางจากแหล่งใดแหล่งหนึ่ง") : r === "different_observation_periods" ? t("the two sources cover different dates, so they are not compared", "สองแหล่งครอบคลุมคนละช่วงวันที่ จึงไม่เปรียบเทียบ") : t("coverage is not complete, so the difference is shown only as information", "ความครอบคลุมไม่ครบ จึงแสดงส่วนต่างเป็นข้อมูลเท่านั้น");
  const label = (k: string) => k === "records" ? t("records", "รายการ") : k === "days" ? t("days", "วัน") : k === "intervals" ? t("intervals", "ช่วง") : k === "longest_min" ? t("longest gap (min)", "ช่วงขาดนานสุด (นาที)") : k === "largest_diff_km" ? t("largest difference (km)", "ส่วนต่างสูงสุด (กม.)") : k === "areas" ? t("areas", "พื้นที่") : k;

  return <section className="v781-invest" aria-label={t(`Investigation: ${row.registration}`, `ตรวจสอบ: ${row.registration}`)} data-vehicle-investigation={row.vehicleId}>
    <header className="v781-invest-head">
      <div><h4 ref={headRef} tabIndex={-1}>{row.registration}</h4><p className="v72-hint">{from === to ? from : `${from} → ${to}`} · {t("supporting evidence for this period. Read only; nothing is requested from Forth.", "หลักฐานประกอบของช่วงนี้ อ่านอย่างเดียว ไม่ร้องขอจาก Forth")}</p></div>
      <div className="v781-invest-links">
        <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("fuel", null)}>{t("Fuel Intelligence", "ข้อมูลเชื้อเพลิง")}</button>
        <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("daily", day)}>{t("Daily Activity", "กิจกรรมประจำวัน")}{day ? ` · ${day}` : ""}</button>
        <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("journeys", day)}>{t("Journeys", "เที่ยวรถ")}</button>
        <button type="button" className="btn-primary min-h-11" onClick={close}>{t("Close", "ปิด")}</button>
      </div>
    </header>
    <div role="status" aria-live="polite">{state === "loading" ? <p className="v72-hint">{t("Reading this vehicle’s evidence…", "กำลังอ่านหลักฐานของรถคันนี้…")}</p> : null}{state === "failed" ? <p role="alert">{t("This vehicle’s evidence could not be loaded. The comparison table above is unaffected.", "โหลดหลักฐานของรถคันนี้ไม่ได้ ตารางเปรียบเทียบด้านบนไม่ได้รับผลกระทบ")}</p> : null}</div>

    <dl className="v72-strip v781-facts" data-invest-facts>
      <div><dt>{t("Recorded fuel purchases", "การซื้อเชื้อเพลิงที่บันทึก")}</dt><dd><b>{row.fuelState === "recorded" ? `฿${formatThb(row.costThb, language)}` : "—"}</b><small>{row.fuelState === "recorded" ? `${(row.byType ?? []).map(g => `${fuelTypeLabel(g.fuelType, language)} ${n(g.litres)} ${language === "th" ? "ลิตร" : "L"}`).join(" · ") || "—"} · ${row.records} ${t("refuels · purchases, not consumption", "ครั้ง · การซื้อ ไม่ใช่การใช้จริง")}` : t("no fuel record loaded for this vehicle", "ไม่มีบันทึกเชื้อเพลิงของรถคันนี้ที่โหลด")}</small></dd></div>
      <div><dt>{t("Reviewed Forth days", "วัน Forth ที่ตรวจแล้ว")}</dt><dd><b>{row.reviewedDays}/{row.calendarDays}</b><small>{t(`${row.verifiedDays} verified · ${row.partlyVerifiedDays} partly · ${row.unverifiedDays} unverified. The rest are not reviewed, not zero driving.`, `ยืนยัน ${row.verifiedDays} · บางส่วน ${row.partlyVerifiedDays} · ไม่ยืนยัน ${row.unverifiedDays} ที่เหลือยังไม่ได้ตรวจ ไม่ใช่ไม่ได้ขับ`)}</small></dd></div>
      <div><dt>{t("Forth km (reviewed days only)", "กม. Forth (เฉพาะวันที่ตรวจ)")}</dt><dd><b>{n(row.providerKm)}</b><small>{row.providerKm === null ? t("no reconciled reviewed day", "ไม่มีวันที่กระทบยอด") : t(`partial: ${row.providerKmDays} day(s) · GPS-derived ${n(row.gpsKm)}`, `บางส่วน: ${row.providerKmDays} วัน · จาก GPS ${n(row.gpsKm)}`)}{row.providerKm !== null && row.gpsKm !== null ? <> · <button type="button" className="fleet-link-button" onClick={() => setRecon(true)} data-explain-mileage>{t("Explain mileage", "อธิบายระยะทาง")}</button></> : null}</small></dd></div>
    </dl>

    <h5>{t("Mileage evidence", "หลักฐานระยะทาง")}</h5>
    {comparison ? <p className="v72-hint" data-invest-comparison={comparison.result.status}>{t("Forth report vs Fuel Log odometer span", "รายงาน Forth เทียบช่วงเลขไมล์จากบันทึกเชื้อเพลิง")}: <b>{comparison.result.status === "not_comparable" ? t("not comparable", "เปรียบเทียบไม่ได้") : comparison.result.status === "incomplete" ? t("incomplete coverage", "ความครอบคลุมไม่ครบ") : comparison.result.status === "review_required" ? t("review required", "ต้องตรวจสอบ") : t("within tolerance", "อยู่ในเกณฑ์")}</b> — {reason(comparison.result.reason)}. {comparison.forth.km !== null ? `Forth ${n(comparison.forth.km)} km (${comparison.forth.periodStart}${comparison.forth.periodEnd !== comparison.forth.periodStart ? ` → ${comparison.forth.periodEnd}` : ""})` : t("No reconciled Forth day.", "ไม่มีวัน Forth ที่กระทบยอด")} · {comparison.odo.km !== null ? `${t("odometer span", "ช่วงเลขไมล์")} ${n(comparison.odo.km)} km (${comparison.odo.periodStart} → ${comparison.odo.periodEnd})` : t("No usable odometer span.", "ไม่มีช่วงเลขไมล์ที่ใช้ได้")}{comparison.reviewRequired ? ` · ${t("odometer intervals need review", "ช่วงเลขไมล์ต้องตรวจสอบ")}` : ""}</p> : null}
    {days.length ? <div className="v72-table-wrap"><table className="v72-table v781-days v782-cards" data-invest-days>
      <thead><tr><th scope="col">{t("Day", "วัน")}</th><th scope="col" className="num">{t("Forth km", "กม. Forth")}</th><th scope="col" className="num">{t("GPS km", "กม. GPS")}</th><th scope="col">{t("Verified positions", "ตำแหน่งที่ยืนยัน")}</th><th scope="col" className="num">{t("Missing (min)", "ขาด (นาที)")}</th><th scope="col">{t("Fuel purchased", "เชื้อเพลิงที่ซื้อ")}</th><th scope="col"><span className="sr-only">{t("Open", "เปิด")}</span></th></tr></thead>
      <tbody>{days.map(d => { const p = d.provider; const led = (p as { journeyLedger?: JourneyLedger | null } | null)?.journeyLedger ?? null; const fuelCost = d.fuelPurchases ?? null;
        return <tr key={d.day} data-day={d.day} className={d.day === day ? "is-active" : ""}>
          <th scope="row" data-label={t("Day", "วัน")}>{d.day}{!p ? <small>{t("not reviewed", "ยังไม่ได้ตรวจ")}</small> : null}</th>
          <td className="num" data-label={t("Forth km", "กม. Forth")}>{p ? n(p.sources.providerReported.value, 2) : "—"}</td><td className="num" data-label={t("GPS km", "กม. GPS")}>{p ? n(p.sources.gpsDerived.value, 2) : "—"}</td>
          <td data-label={t("Verified positions", "ตำแหน่งที่ยืนยัน")}>{p && p.logAvailable ? `${p.gps.verifiedObservations}/${p.gps.observations}` : "—"}</td>
          <td className="num" data-label={t("Missing (min)", "ขาด (นาที)")}>{led ? led.totals.missingMinutes : "—"}</td>
          <td data-label={t("Fuel purchased", "เชื้อเพลิงที่ซื้อ")}>{fuelCost === null ? "—" : fuelCost.length === 0 ? <span className="v72-muted">{t("none recorded", "ไม่มีบันทึก")}</span> : fuelCost.map(g => `${fuelTypeLabel(g.fuelType, language)} ${n(g.purchasedLitres)} ${language === "th" ? "ลิตร" : "L"}`).join(" · ")}</td>
          <td className="v771-actions">{p ? <button type="button" className="fleet-link-button" aria-pressed={d.day === day} onClick={() => setDay(d.day)}>{t("Visits", "การเข้าเยี่ยม")}</button> : null}<button type="button" className="fleet-link-button" onClick={() => onOpen("daily", d.day)}>{t("Daily Activity", "กิจกรรมประจำวัน")}</button></td></tr>; })}</tbody>
    </table></div> : state === "ready" ? <p className="v72-empty-line">{t("No days in this period.", "ไม่มีวันในช่วงนี้")}</p> : null}

    {recon ? <FleetMileageReconciliation key={`recon:${row.vehicleId}:${from}:${to}`} language={language} vehicleId={row.vehicleId} registration={row.registration} from={from} to={to} focusDay={day} onClose={() => setRecon(false)} onOpen={(target, d) => onOpen(target === "route" ? "route" : target === "journeys" ? "journeys" : "daily", d)} /> : null}
    <h5>{t("Important exceptions", "ข้อยกเว้นที่สำคัญ")} · {row.issues.length}</h5>
    {row.issues.length === 0 ? <p className="v72-empty-line">{t("None in the evidence loaded. This does not cover days that were not reviewed.", "ไม่พบในหลักฐานที่โหลด ไม่ครอบคลุมวันที่ยังไม่ได้ตรวจ")}</p> : <ul className="v781-issues" data-invest-issues>{row.issues.map(i => { const c = OVERSIGHT_ISSUE_COPY[i.key]; return <li key={i.key} className={`is-${i.severity}`} data-issue={i.key}>
      <span className={`fleet-review-badge is-priority-${i.severity}`}>{i.severity === "medium" ? t("Medium", "กลาง") : i.severity === "high" ? t("High", "สูง") : t("Info", "ข้อมูล")}</span> <span className={`v782-class is-${ISSUE_CLASS[i.key]}`} data-issue-class={ISSUE_CLASS[i.key]}>{CLASS_COPY[ISSUE_CLASS[i.key]][lang]}</span> <b>{c.title[lang]}</b>
      <small>{c.reason[lang]}</small><small>{Object.entries(i.evidence).map(([k, x]) => `${label(k)}: ${x}`).join(" · ")} · {c.source[lang]}</small><small>{c.action[lang]}</small>
      {i.key === "distance_sources_disagree" ? <button type="button" className="fleet-link-button" onClick={() => setRecon(true)} data-explain-issue>{t("Explain the difference", "อธิบายความต่าง")}</button> : null}
      {(i.days ?? (i.day ? [i.day] : [])).slice(0, 4).map(d => <button key={d} type="button" className="fleet-link-button" onClick={() => onOpen("daily", d)}>{t("Open", "เปิด")} {d}</button>)}</li>; })}</ul>}

    <h5>{t("Possible visits", "การเข้าเยี่ยมที่เป็นไปได้")}{day ? ` · ${day}` : ""}</h5>
    {!day ? <p className="v72-empty-line">{t("No reviewed day in this period. Read a day in Daily Activity first; nothing is read here.", "ไม่มีวันที่ตรวจแล้วในช่วงนี้ อ่านวันใน กิจกรรมประจำวัน ก่อน ที่นี่ไม่อ่านข้อมูล")}</p>
      : places.state === "forbidden" ? <p className="v72-empty-line" data-places-forbidden>{t("Visits use historical journeys and need administrator authorisation.", "การเข้าเยี่ยมใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p>
      : places.state === "loading" ? <p className="v72-hint">{t("Building visits from the cached day…", "กำลังสร้างการเข้าเยี่ยมจากวันในแคช…")}</p>
      : places.data && !places.data.read ? <p className="v72-empty-line">{t("The server no longer holds this day (about 30 minutes). Read it again in Daily Activity.", "เซิร์ฟเวอร์ไม่ได้เก็บวันนี้แล้ว (ประมาณ 30 นาที) อ่านอีกครั้งใน กิจกรรมประจำวัน")}</p>
      : places.state === "failed" ? <p role="alert">{t("Visits could not be built.", "สร้างการเข้าเยี่ยมไม่ได้")}</p>
      : visits.length === 0 ? <p className="v72-empty-line">{t("No visit was supported by this day’s positions.", "ไม่มีการเข้าเยี่ยมที่ได้รับการสนับสนุนจากตำแหน่งของวันนี้")}</p>
      : <div className="v72-table-wrap"><table className="v72-table v781-visits v782-cards" data-invest-visits><thead><tr><th scope="col">{t("Observed", "ที่สังเกตได้")}</th><th scope="col">{t("Place", "สถานที่")}</th><th scope="col"><span className="sr-only">{t("Map", "แผนที่")}</span></th></tr></thead>
        <tbody>{visits.map(v => { const l = visitLabel(v, language); return <tr key={v.id} data-visit={v.id}><th scope="row" data-label={t("Observed", "ที่สังเกตได้")}>{clock(language, v.firstAt)} – {clock(language, v.lastAt)}<small>{v.sourceQuality === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : v.sourceQuality === "mixed" ? t("partly verified", "ยืนยันบางส่วน") : t("not verified", "ไม่ยืนยัน")}</small></th><td data-label={t("Place", "สถานที่")}><b className={l.named ? "v73-name" : "v73-name is-uncertain"}>{l.title}</b><small>{l.secondary}</small></td><td className="v771-actions"><button type="button" className="fleet-link-button" data-view-location={v.id} onClick={() => setMapVisit(v.id)}>{t("View location", "ดูตำแหน่ง")}</button></td></tr>; })}</tbody></table></div>}
    {driver ? <p className="v73-driver" data-driver-attribution={places.data?.driver.status}><b>{t("Driver evidence", "หลักฐานคนขับ")}:</b> {driver.title}<small>{driver.note}</small></p> : null}
    <p className="v72-hint">{t("A visit is not proof of pickup, delivery, loading or unloading, and this panel does not detect speeding or driver conduct.", "การเข้าเยี่ยมไม่ใช่หลักฐานการรับ ส่ง ขึ้นหรือลงสินค้า และแผงนี้ไม่ตรวจจับการขับเร็วหรือพฤติกรรมคนขับ")}</p>
    {mapVisit && day && visitRefs.length ? <FleetVisitMap key={`${row.vehicleId}:${day}`} language={language} vehicleId={row.vehicleId} registration={row.registration} day={day} visits={visitRefs} visitId={mapVisit} onSelect={setMapVisit} onClose={() => setMapVisit(null)} onOpenEvidence={() => { setMapVisit(null); onOpen("daily", day); }} /> : null}
  </section>;
}
