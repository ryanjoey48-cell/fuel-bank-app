"use client";
import { useId, useMemo, useState } from "react";
import { positionSourceLabel, reconciliationLabel, reconciliationReasonLabel } from "@/lib/fleet-journey-copy";
import type { DayAnalysis } from "@/lib/fleet-vehicle-day-summary";
import type { Journey, JourneyLedger } from "@/lib/fleet-journey-ledger";
import type { ProviderDay } from "@/lib/fleet-intelligence-day";

type Lang = "en" | "th";
const ledgerOf = (provider: ProviderDay | null): JourneyLedger | null => (provider?.journeyLedger as JourneyLedger | null | undefined) ?? null;
const fmt = (language: Lang) => ({
  n: (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  time: (iso: string | null, open: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : open)
});
const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** JOBS tab: the five-category kilometre allocation and its reconciliation status. */
export function FleetJourneyAllocation({ provider, analysis, language, day }: { provider: ProviderDay | null; analysis: DayAnalysis; language: Lang; day: string }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const ledger = ledgerOf(provider);
  const { matches, allocation } = analysis;
  const { n } = fmt(language);
  const km = t("km", "กม.");
  const title = <h4>{t("Kilometre allocation", "การจัดสรรระยะทาง")} · {day}</h4>;
  if (!provider) return <section className="fleet-journey-ledger" aria-label={t("Kilometre allocation", "การจัดสรรระยะทาง")}>{title}<p>{t("Read the Forth report for this day first (Journeys tab). Kilometres are unknown until then.", "อ่านรายงาน Forth ของวันนี้ก่อน (แท็บเส้นทาง) ก่อนหน้านั้นระยะทางยังไม่ทราบ")}</p></section>;
  if (!ledger) return <section className="fleet-journey-ledger">{title}<p>{t("This snapshot was read before journey analysis existed. Use Refresh from Forth (Journeys tab) to rebuild it.", "ข้อมูลนี้อ่านก่อนมีการวิเคราะห์เที่ยวรถ โปรดกดรีเฟรชจาก Forth (แท็บเส้นทาง)")}</p></section>;
  const candidateJourneys = allocation.perJourney.filter(p => p.category === "candidate_awaiting_confirmation").length;
  return <section className="fleet-journey-ledger" aria-label={t("Kilometre allocation", "การจัดสรรระยะทาง")}>
    {title}
    <p role="status"><strong>{reconciliationLabel(allocation.reconciliation.status, language)}</strong>{allocation.reconciliation.reconciledTotalKm !== null ? ` · ${t("reconciled total", "ยอดที่กระทบยอดแล้ว")} ${n(allocation.reconciliation.reconciledTotalKm)} ${km}` : ` · ${t("no reconciled total is claimed", "ไม่อ้างยอดที่กระทบยอดแล้ว")}`}</p>
    <small>{allocation.reconciliation.reasons.map(r => reconciliationReasonLabel(r, language)).join(" · ")}</small>
    <dl className="fleet-evidence-sources" aria-live="polite">
      <div><dt>{t("1 · Confirmed job km", "1 · กม. งานที่ยืนยัน")}</dt><dd>{allocation.confirmedJobKm === null ? t("— · no approved confirmation record exists", "— · ยังไม่มีบันทึกการยืนยันที่อนุมัติ") : `${n(allocation.confirmedJobKm)} ${km}`}</dd></div>
      <div><dt>{t("2 · Supported repositioning / empty km", "2 · กม. ย้ายรถ / วิ่งเปล่าที่มีหลักฐาน")}</dt><dd>{t("— · no operational evidence; movement without a booking is not assumed empty", "— · ไม่มีหลักฐานการปฏิบัติงาน ไม่ถือว่าการวิ่งที่ไม่มีงานเป็นการวิ่งเปล่า")}</dd></div>
      <div><dt>{t("3 · Candidate km awaiting confirmation", "3 · กม. ที่อาจเป็นงาน รอการยืนยัน")}</dt><dd>{allocation.candidateKm === null ? "—" : `${n(allocation.candidateKm)} ${km} · ${candidateJourneys} ${t("journey(s)", "เที่ยว")}`}</dd></div>
      <div><dt>{t("4 · Unallocated / unresolved km", "4 · กม. ที่ยังไม่จัดสรร / ยังสรุปไม่ได้")}</dt><dd>{allocation.unallocatedKm === null ? "—" : `${n(allocation.unallocatedKm)} ${km}`}{allocation.ambiguousKm ? ` · ${t("includes", "รวม")} ${n(allocation.ambiguousKm)} ${km} ${t("ambiguous", "ที่ไม่ชัดเจน")}` : ""}</dd></div>
      <div><dt>{t("5 · Missing / unobservable", "5 · ช่วงที่ขาด / สังเกตไม่ได้")}</dt><dd>{ledger.missing.length === 0 ? t("No recording outage over 10 minutes", "ไม่มีช่วงบันทึกขาดเกิน 10 นาที") : `${ledger.missing.length} ${t("period(s)", "ช่วง")} · ${ledger.totals.missingMinutes} ${t("min", "นาที")}`} · {t("km unknown", "ไม่ทราบระยะทาง")}</dd></div>
      <div><dt>{t("Allocation check", "ตรวจการจัดสรร")}</dt><dd>{allocation.sumMatchesProvider === null ? t("No reconciled provider total, so nothing is allocated", "ไม่มียอดผู้ให้บริการที่กระทบยอด จึงไม่จัดสรร") : allocation.sumMatchesProvider ? t("Each provider km is in exactly one category", "ทุกกิโลเมตรอยู่ในหมวดเดียว") : t("Categories do not add up to the provider total: review", "ผลรวมหมวดไม่เท่ายอดผู้ให้บริการ: ต้องตรวจสอบ")}</dd></div>
      <div><dt>{t("Why not every km is attributed", "ทำไมยังระบุทุกกิโลเมตรไม่ได้")}</dt><dd>{[
        allocation.coverage !== "reconciled_complete" ? t("Forth report coverage is unverified (an open final segment is expected)", "ยังไม่ยืนยันความครอบคลุมของรายงาน Forth (มีช่วงสุดท้ายที่ยังไม่ปิด)") : null,
        allocation.confirmationSource === "not_available" ? t("no approved job-confirmation store exists", "ยังไม่มีที่เก็บการยืนยันงานที่อนุมัติ") : null,
        matches.bookingSource === "none_found" ? t("no Booking Diary job was returned for this vehicle-day, which does not mean no work was done", "ไม่พบงานในสมุดจองของรถและวันนี้ ซึ่งไม่ได้หมายความว่าไม่มีการทำงาน") : matches.bookingSource === "unavailable" ? t("Booking Diary could not be read", "อ่านสมุดจองไม่ได้") : null,
        ledger.totals.positionSource !== "gps" ? t("positions are not verified GPS, so pickup and delivery locations are not compared", "ตำแหน่งไม่ใช่ GPS ที่ยืนยัน จึงไม่เทียบจุดรับส่ง") : null
      ].filter(Boolean).join("; ")}.</dd></div>
    </dl>
  </section>;
}

type Kind = "moving" | "stopped" | "uncertain" | "open";
const kindOf = (j: Journey): Kind => (j.ambiguous ? "uncertain" : j.kind === "open_final" ? "open" : j.kind === "moving" ? "moving" : "stopped");

/** JOURNEYS tab: provider/trail/verified km kept separate, compact expandable rows, real missing history apart from normal spacing. */
/** Report segments with no log records or no duration carry no movement evidence of their own; they are grouped, never hidden or deleted. */
const isTechnicalSegment = (j: Journey) => j.issues.includes("no_log_observations") || j.observations === 0 || j.minutes === 0;

export function FleetJourneyList({ provider, analysis, language, day, onOpenPlayback, onOpenDay }: { provider: ProviderDay | null; analysis: DayAnalysis; language: Lang; day: string; onOpenPlayback?: () => void; onOpenDay?: () => void }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const ledger = ledgerOf(provider);
  const { matches, allocation } = analysis;
  const { n, time } = fmt(language);
  const km = t("km", "กม.");
  const reconciled = provider?.provider.arithmetic.status === "pass";
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState("00:00");
  const [to, setTo] = useState("23:59");
  const [kindFilter, setKindFilter] = useState<"all" | "moving">("all");
  const baseId = useId();
  const kindLabel = (k: Kind) => ({ moving: t("Moving", "เคลื่อนที่"), stopped: t("Stop", "จอด"), uncertain: t("Uncertain", "ไม่ชัดเจน"), open: t("Open final", "ช่วงสุดท้ายยังไม่ปิด") }[k]);
  const rows = useMemo(() => (ledger?.journeys ?? []).filter(j => !isTechnicalSegment(j) && hm(j.start) >= from && hm(j.start) <= to && (kindFilter === "all" || j.kind === "moving")), [ledger, from, to, kindFilter]);
  const technical = useMemo(() => (ledger?.journeys ?? []).filter(isTechnicalSegment), [ledger]);
  const title = <h4>{t("Journeys", "เที่ยวรถ")} · {day}</h4>;
  if (!provider) return <section className="fleet-journey-ledger" aria-label={t("Journeys", "เที่ยวรถ")}>{title}<p>{t("Not read for this day. Journeys and kilometres are unknown, not zero.", "ยังไม่ได้อ่านวันนี้ เที่ยวรถและระยะทางยังไม่ทราบ ไม่ใช่ศูนย์")}</p></section>;
  if (!ledger) return <section className="fleet-journey-ledger">{title}<p>{t("This snapshot was read before journey analysis existed. Use Refresh from Forth to rebuild it.", "ข้อมูลนี้อ่านก่อนมีการวิเคราะห์เที่ยวรถ โปรดกดรีเฟรชจาก Forth")}</p></section>;
  return <section className="fleet-journey-ledger" aria-label={t("Journeys", "เที่ยวรถ")}>
    {title}
    <dl className="v72-strip" data-journey-summary>
      <div><dt>{t("Provider-reported km (Forth report)", "กม. ที่ Forth รายงาน")}</dt><dd><b>{reconciled ? n(provider.sources.providerReported.value) : "—"}</b><small>{reconciled ? t("provider-reported", "ผู้ให้บริการรายงาน") : t("report total not reconciled", "ยอดรายงานยังไม่กระทบยอด")}</small></dd></div>
      <div><dt>{t("Reported trail km (unverified)", "กม. ตามเส้นทางที่รายงาน (ยังไม่ยืนยัน)")}</dt><dd><b>{n(ledger.totals.reportedTrailKm)}</b><small>{t("unverified", "ยังไม่ยืนยัน")}</small></dd></div>
      <div><dt>{t("GPS-verified km in moving segments", "กม. GPS ที่ยืนยันในช่วงเคลื่อนที่")}</dt><dd><b>{n(ledger.totals.verifiedGpsKm)}</b><small>{t("verified fixes inside provider moving segments", "ตำแหน่งที่ยืนยันภายในช่วงเคลื่อนที่ของผู้ให้บริการ")}</small></dd></div>
      <div><dt>{t("Journeys", "เที่ยวรถ")}</dt><dd><b>{ledger.journeys.filter(j => j.kind === "moving" && !j.ambiguous).length}</b><small>{ledger.journeys.filter(j => j.kind === "stopped").length} {t("stops", "จุดจอด")} · {ledger.missing.length} {t("tracking gaps", "ช่วงที่ขาด")}</small></dd></div>
    </dl>
    {(() => { const day = provider.sources.gpsDerived.value, inSeg = ledger.totals.verifiedGpsKm; if (day === null || inSeg === null || Math.abs(day - inSeg) < 0.005) return null;
      return <p className="v72-hint" data-gps-measures>{t(`GPS whole-day distance is ${n(day)} km; ${n(inSeg)} km of it lies inside the provider's moving segments. The ${n(Math.round((day - inSeg) * 100) / 100)} km difference is verified GPS movement outside those segments (for example while the report shows a stop). Different measures, not a conflict; neither replaces the provider figure.`, `ระยะทาง GPS ทั้งวันคือ ${n(day)} กม. ในนั้น ${n(inSeg)} กม. อยู่ในช่วงเคลื่อนที่ของผู้ให้บริการ ส่วนต่าง ${n(Math.round((day - inSeg) * 100) / 100)} กม. คือการเคลื่อนที่ที่ยืนยันด้วย GPS นอกช่วงเหล่านั้น (เช่นขณะที่รายงานแสดงว่าจอด) เป็นคนละวิธีวัด ไม่ใช่ความขัดแย้ง และไม่แทนที่ตัวเลขของผู้ให้บริการ`)}</p>; })()}
    <details className="v72-hint-details"><summary>{t("About these distance sources", "เกี่ยวกับแหล่งระยะทาง")}</summary><p className="fleet-evidence-note">{t("Three separate sources. The provider figure is not GPS-verified; the trail figure adds the log's own per-record distances from reported positions; GPS-verified km needs verified fixes.", "สามแหล่งแยกกัน ระยะทางของ Forth ไม่ใช่ GPS ที่ยืนยัน ระยะตามเส้นทางรวมจากระยะทางรายจุดในบันทึกของตำแหน่งที่รายงาน กม. GPS ที่ยืนยันต้องมาจากตำแหน่งที่ยืนยัน")} · {positionSourceLabel(ledger.totals.positionSource, language)}</p></details>
    <div className="fleet-journey-filters" role="group" aria-label={t("Journey filters", "ตัวกรองเที่ยว")}>
      <label>{t("Started from", "เริ่มตั้งแต่")}<input type="time" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
      <label>{t("to", "ถึง")}<input type="time" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
      <label>{t("Show", "แสดง")}<select value={kindFilter} onChange={e => setKindFilter(e.target.value === "moving" ? "moving" : "all")}><option value="all">{t("All segments", "ทุกช่วง")}</option><option value="moving">{t("Moving only", "เฉพาะเคลื่อนที่")}</option></select></label>
    </div>
    <p className="fleet-evidence-note">{t("Journey boundaries are the Forth report's own segments; none are invented. Times are Asia/Bangkok.", "ขอบเขตเที่ยวมาจากช่วงในรายงาน Forth เอง ไม่สร้างขึ้นเอง เวลาไทย")} {t(`${ledger.journeys.length} report segments: ${rows.length} shown here, ${technical.length} technical (no log records or zero duration) under Advanced evidence.`, `${ledger.journeys.length} ช่วงในรายงาน: แสดงที่นี่ ${rows.length} ช่วงเทคนิค ${technical.length} (ไม่มีบันทึกหรือระยะเวลาเป็นศูนย์) อยู่ในหลักฐานขั้นสูง`)}</p>
    <div className="v73-journey-actions" role="group" aria-label={t("Journey actions", "การดำเนินการเที่ยว")}>{onOpenPlayback ? <button type="button" className="btn-secondary" onClick={onOpenPlayback}>{t("View route on map", "ดูเส้นทางบนแผนที่")}</button> : <small>{t("Route playback needs administrator authorisation.", "การเล่นย้อนเส้นทางต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</small>}{onOpenDay ? <button type="button" className="btn-secondary" onClick={onOpenDay}>{t("Open this vehicle-day", "เปิดรถและวันนี้")}</button> : null}</div>
    <div className="v72-journey-head" aria-hidden="true"><span>#</span><span>{t("Time (Bangkok)", "เวลา (ไทย)")}</span><span>{t("Type", "ประเภท")}</span><span>{t("Distance", "ระยะทาง")}</span><span>{t("Position source", "แหล่งตำแหน่ง")}</span></div>
    <ul className="fleet-journey-rows">{rows.map(j => { const k = kindOf(j); const isOpen = Boolean(open[j.id]); const panel = `${baseId}-${j.id}`; const jobIds = matches.jobsByJourney[j.id] ?? []; const cat = allocation.perJourney.find(p => p.journeyId === j.id)?.category;
      return <li key={j.id} className={`fleet-journey-row is-${k}${isOpen ? " is-open" : ""}`}>
        <button type="button" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen(prev => ({ ...prev, [j.id]: !prev[j.id] }))}>
          <span className="fleet-journey-row-id">{j.id}</span>
          <span className="fleet-journey-row-time">{time(j.start, "")} → {time(j.end, t("open", "ยังไม่ปิด"))}</span>
          <span className="fleet-journey-row-kind">{kindLabel(k)}</span>
          <span className="fleet-journey-row-km">{n(j.providerKm)} {km}</span>
          <span className="fleet-journey-row-source" data-source={j.positionSource}>{positionSourceLabel(j.positionSource, language)}</span>
        </button>
        <div id={panel} hidden={!isOpen} className="fleet-journey-row-detail">
          <p>{t("Provider", "Forth")} {n(j.providerKm)} {km} · {t("trail", "เส้นทาง")} {n(j.reportedTrailKm)} {km} · GPS {n(j.verifiedGpsKm)} {km}{j.minutes !== null ? ` · ${j.minutes} ${t("min", "นาที")}` : ""}</p>
          <p>{j.observations} {t("records", "บันทึก")} ({j.movingObservations} {t("moving", "เคลื่อนที่")}{j.engineOnObservations !== null ? `, ${j.engineOnObservations} ${t("engine on", "เครื่องติด")}` : ""}){j.gapsInside ? ` · ${j.gapsInside} ${t("spacing(s) over 5 min inside", "ช่วงห่างเกิน 5 นาทีในเที่ยวนี้")}` : ""}</p>
          {j.issues.length ? <p role="note">{[j.issues.includes("overlaps_another_segment") ? t("overlaps another segment: kept unresolved", "ทับซ้อนช่วงอื่น: ยังไม่สรุป") : null, j.issues.includes("open_segment_with_distance") ? t("open segment with distance: kept unresolved", "ช่วงยังไม่ปิดแต่มีระยะทาง: ยังไม่สรุป") : null, j.issues.includes("no_log_observations") ? t("no log records inside", "ไม่มีบันทึกในช่วงนี้") : null].filter(Boolean).join(" · ")}</p> : null}
          {cat ? <p>{cat === "candidate_awaiting_confirmation" ? `${t("Candidate", "อาจเป็นงาน")}: ${jobIds.length} ${t("job(s)", "งาน")}` : cat === "confirmed_job" ? t("Confirmed job", "งานที่ยืนยัน") : t("Unallocated", "ยังไม่จัดสรร")}</p> : null}
        </div>
      </li>; })}</ul>
    {(() => {
      const stops = ledger.journeys.filter(j => j.kind === "stopped" && !j.ambiguous && j.minutes !== null && j.minutes >= 10).sort((x, y) => Date.parse(x.start) - Date.parse(y.start)).slice(0, 15);
      return <section className="v72-stops" data-significant-stops>
        <h4>{t("Significant stops", "จุดจอดสำคัญ")} · {stops.length}</h4>
        {stops.length === 0 ? <p className="v72-empty-line">{t("No stop of 10 minutes or more in the report for this day.", "ไม่มีจุดจอดตั้งแต่ 10 นาทีในรายงานของวันนี้")}</p> : <div className="v72-table-wrap"><table className="v72-table"><thead><tr><th scope="col">{t("From", "จาก")}</th><th scope="col">{t("To", "ถึง")}</th><th scope="col" className="num">{t("Duration (min)", "นาที")}</th><th scope="col">{t("Position source", "แหล่งตำแหน่ง")}</th></tr></thead><tbody>{stops.map(j => <tr key={j.id}><td>{time(j.start, "")}</td><td>{time(j.end, t("open", "ยังไม่ปิด"))}</td><td className="num">{j.minutes}</td><td>{positionSourceLabel(j.positionSource, language)}</td></tr>)}</tbody></table></div>}
        <p className="v72-hint">{t("Stops of 10 minutes or more from the Forth report's own segments. A stop is not a delivery or a job.", "จุดจอดตั้งแต่ 10 นาทีจากช่วงในรายงาน Forth ไม่ใช่การส่งของหรืองาน")}</p>
      </section>;
    })()}
    {technical.length ? <details className="v72-evidence" data-technical-segments><summary>{t("Technical segments", "ช่วงเทคนิค")} · {technical.length}</summary>
      <p className="v72-hint">{t("Report segments with no log records or zero duration. They are source data, kept as supplied and not counted as journeys.", "ช่วงในรายงานที่ไม่มีบันทึกหรือระยะเวลาเป็นศูนย์ เป็นข้อมูลต้นทางที่เก็บตามที่ได้รับ ไม่นับเป็นเที่ยว")}</p>
      <div className="v72-table-wrap"><table className="v72-table"><thead><tr><th scope="col">#</th><th scope="col">{t("Time (Bangkok)", "เวลา (ไทย)")}</th><th scope="col" className="num">{t("Provider km", "กม. ผู้ให้บริการ")}</th><th scope="col">{t("Reason", "สาเหตุ")}</th></tr></thead><tbody>{technical.map(j => <tr key={j.id}><th scope="row">{j.id}</th><td>{time(j.start, "")} → {time(j.end, t("open", "ยังไม่ปิด"))}</td><td className="num">{n(j.providerKm)}</td><td>{j.issues.includes("no_log_observations") || j.observations === 0 ? t("no log records", "ไม่มีบันทึก") : t("zero duration", "ระยะเวลาเป็นศูนย์")}</td></tr>)}</tbody></table></div></details> : null}
    <details className="fleet-journey-history"><summary>{t("History gaps", "ช่วงที่ประวัติขาด")} · {ledger.missing.length} {t("missing", "ขาดจริง")} · {ledger.totals.cadenceJitterGaps} {t("normal spacing", "ห่างตามรอบปกติ")}</summary>
      <p><strong>{t("Actual missing history", "ประวัติที่ขาดจริง")}</strong>: {ledger.missing.length === 0 ? t("none over 10 minutes", "ไม่มีช่วงเกิน 10 นาที") : ledger.missing.map(m => `${time(m.start, "")}–${time(m.end, "")} (${m.minutes} ${t("min", "นาที")})`).join(" · ")}. {t("Distance in these periods is unknown.", "ไม่ทราบระยะทางในช่วงเหล่านี้")}</p>
      <p><strong>{t("Normal recording spacing", "ระยะห่างการบันทึกตามปกติ")}</strong>: {ledger.totals.cadenceJitterGaps} {t("records arrived slightly over 5 minutes apart. This is the tracker's usual cadence, not missing history.", "รายการห่างกันเกิน 5 นาทีเล็กน้อย เป็นรอบปกติของตัวติดตาม ไม่ใช่ประวัติที่ขาด")}</p>
      <p><strong>{t("Outside report segments", "นอกช่วงที่รายงาน")}</strong>: {ledger.totals.outsideReportMinutes} {t("min", "นาที")} · {t("log km there", "กม. ในบันทึกช่วงนั้น")} {n(ledger.totals.outsideReportLogKm)} {km} · {t("not allocated", "ไม่จัดสรร")}</p>
    </details>
  </section>;
}
