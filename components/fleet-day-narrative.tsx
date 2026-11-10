"use client";
import { useMemo, useRef, useState } from "react";
import type { ProviderDay } from "@/lib/fleet-intelligence-day";
import type { JourneyLedger } from "@/lib/fleet-journey-ledger";
import type { Visit } from "@/lib/fleet-day-places-server";
import { visitLabel } from "@/components/fleet-day-places";
import type { TimelineActions } from "@/components/fleet-day-snapshot";
import { BUCKET_COPY, DEPARTURE_COPY, RELATION_COPY, type ChronoMovement, type ChronoRow, type TimeBuckets } from "@/lib/fleet-day-chronology";
import { COVERAGE_DEFINITIONS, REASON_COPY } from "@/lib/fleet-coverage-truth";
import { CROSS_MIDNIGHT_COPY, CROSS_MIDNIGHT_LIMITS, nextBangkokDay } from "@/lib/fleet-cross-midnight";
import { buildDayNarrativeModel, type DayNarrativeModel } from "@/lib/fleet-day-narrative-model";

export { crossMidnightDay } from "@/lib/fleet-day-narrative-model";

type Lang = "en" | "th";
const clockFmt = (language: Lang) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const bkkDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/**
 * Daily Activity (V7.8.4): one operating-day narrative. Nothing here fetches: it renders the provider day the user already read, the visit analysis
 * already loaded, and (for cross-midnight checks) neighbouring days that are ALREADY in this user's cache. Source intervals are kept as they are;
 * the chronology says how movements relate to visit windows, and the time accounting counts every second once.
 */
export function FleetDayNarrative({ language, day, provider, restricted, visits, previousDay, nextDay, nextDayRequested, actions, onSelectVisit, model }: {
  /** The shared day model. When the page already built it for the operating summary it is passed in, so both read the same figures; otherwise it is built here. */
  model?: DayNarrativeModel | null;
  language: Lang; day: string; provider: ProviderDay | null; restricted: boolean;
  /** The day's visit analysis, or null while it is not built (never shown as zero). */
  visits: readonly Visit[] | null;
  previousDay: ProviderDay | null; nextDay: ProviderDay | null;
  /** Whether the next day is inside the loaded range; when it is not, continuity cannot be checked and nothing is requested. */
  nextDayRequested: boolean;
  actions: TimelineActions; onSelectVisit?: (id: string | null) => void;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const L = language === "th" ? 1 : 0;
  const clock = (iso: string) => clockFmt(language).format(new Date(iso));
  const dur = (m: number | null) => (m === null ? "—" : m >= 60 ? `${Math.floor(m / 60)} ${t("h", "ชม.")} ${m % 60} ${t("min", "นาที")}` : `${m} ${t("min", "นาที")}`);
  const num = (n: number | null, d = 1) => (n === null ? "—" : n.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: d }));
  const ledger = (provider?.journeyLedger as JourneyLedger | null | undefined) ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const visitById = useMemo(() => new Map((visits ?? []).map(v => [v.id, v])), [visits]);

  const built = useMemo(() => (model !== undefined ? model : buildDayNarrativeModel({ day, provider, visits, previousDay, nextDay })), [model, day, provider, visits, previousDay, nextDay]);
  const chrono = built?.chrono ?? null, coverage = built?.coverage ?? null, total = built?.total ?? null, endBoundary = built?.endBoundary ?? null, startBoundary = built?.startBoundary ?? null;

  if (!provider || restricted) return null;
  if (!ledger || !built || !chrono || !coverage || !total || !endBoundary) return <p className="v72-empty-line" role="note">{t("This snapshot predates journey analysis. Use Refresh from Forth to rebuild it.", "ข้อมูลนี้อ่านก่อนมีการวิเคราะห์เที่ยว โปรดกดรีเฟรชจาก Forth")}</p>;

  const rows = chrono.rows;
  const sel = rows.find(r => r.key === selected) ?? null;
  const choose = (key: string | null) => { opener.current = key && document.activeElement instanceof HTMLElement ? document.activeElement : opener.current; setSelected(key); const r = rows.find(x => x.key === key); onSelectVisit?.(r?.kind === "visit" ? r.id : null); if (key) setTimeout(() => headRef.current?.focus(), 0); };
  const closeInspector = () => { const el = opener.current; setSelected(null); onSelectVisit?.(null); if (el) setTimeout(() => { if (el.isConnected) el.focus(); }, 0); };

  const kindLabel = (r: ChronoRow) => r.kind === "driving" ? t("Driving", "กำลังขับ") : r.kind === "visit" ? t("Possible site visit", "อาจเป็นการเข้าสถานที่") : r.kind === "movement_in_visit" ? t("Movement within visit", "เคลื่อนที่ภายในการเข้าเยี่ยม") : r.kind === "unknown" ? t("Unknown interval", "ช่วงที่ไม่ทราบ") : t("Open provider segment", "ช่วงของผู้ให้บริการที่ยังไม่ปิด");
  const sourceLabel = (s: string) => s === "provider_segment" ? t("Forth segment", "ช่วงของ Forth") : s === "provider_and_gps" ? t("Forth segment + GPS", "ช่วงของ Forth + GPS") : t("GPS only", "GPS เท่านั้น");
  const routeBtn = (start: string, end: string | null, key: string) => end && actions.onViewRoute && bkkDay(start) === bkkDay(end) ? <button type="button" className="v78-act" data-view-route={key} onClick={() => actions.onViewRoute!({ day: bkkDay(start), start: hm(start), end: hm(end) })}>{t("View historical route", "ดูเส้นทางย้อนหลัง")}</button> : null;
  const mvLine = (m: ChronoMovement) => `${clock(m.start)} → ${clock(m.end)} · ${dur(m.minutes)}${m.providerKm !== null ? ` · ${num(m.providerKm)} ${t("km Forth", "กม. Forth")}` : ""}${m.gpsKm !== null ? ` · ${num(m.gpsKm)} ${t("km GPS", "กม. GPS")}` : ""}`;

  const rowView = (r: ChronoRow) => {
    const isSel = selected === r.key || (r.kind === "visit" && actions.selectedId === r.id);
    const when = r.kind === "movement_in_visit" ? `${clock(r.movement.start)} → ${clock(r.movement.end)}` : `${clock(r.start)} → ${r.end ? clock(r.end) : t("open", "ยังไม่ปิด")}`;
    const visit = r.kind === "visit" ? visitById.get(r.id) : undefined; const label = visit ? visitLabel(visit, language) : null;
    return (
      <li key={r.key} data-chrono-row={r.key} data-chrono-kind={r.kind} data-visit-row={r.kind === "visit" ? r.id : undefined} className={`v784-row is-${r.kind}${isSel ? " is-selected" : ""}`} style={r.depth === 1 ? { marginInlineStart: "1.4rem" } : undefined}>
        <span className="v784-time">{when}</span>
        <span className="v784-what"><b>{kindLabel(r)}</b>
          {label ? <span className={label.named ? "v73-name" : "v73-name is-uncertain"}> · {label.title}</span> : null}
          {r.kind === "visit" ? <small>{t("window", "ช่วงเวลา")} {dur(r.spanMinutes)} · {t("supported stationary ≥", "จอดนิ่งที่มีหลักฐาน ≥")} {dur(r.supportedMinutes)}{r.bridgedMinutes > 0 ? ` · ${t("bridged", "ช่วงเชื่อม")} ${dur(r.bridgedMinutes)}` : ""}{r.openStart || r.openEnd ? ` · ${t("day edge inside the visit", "ขอบของวันอยู่ในการเข้าเยี่ยม")}` : ""}</small> : null}
          {r.kind === "visit" && r.movementInside > 0 ? <small className={r.departure === "sources_disagree" ? "v784-warn" : ""}>{r.movementInside} {t("movement(s) inside", "การเคลื่อนที่ภายใน")} · {DEPARTURE_COPY[r.departure][L]}</small> : null}
          {r.kind === "movement_in_visit" ? <small>{mvLine(r.movement)} · {r.movement.source === "provider_segment" ? t("Forth segment", "ช่วงของ Forth") : t("GPS interval", "ช่วง GPS")}{r.movement.relation ? ` · ${RELATION_COPY[r.movement.relation][L]}` : ""}</small> : null}
          {r.kind === "driving" ? <small>{sourceLabel(r.source)}{r.providerKm !== null ? ` · ${num(r.providerKm)} ${t("km Forth", "กม. Forth")}` : ""}{r.gpsKm !== null ? ` · ${num(r.gpsKm)} ${t("km GPS", "กม. GPS")}` : ""}{r.notInProviderReport ? ` · ${t("not in the Forth report", "ไม่อยู่ในรายงาน Forth")}` : ""}{r.overlapsVisit ? ` · ${RELATION_COPY[r.overlapsVisit.relation][L]} (${r.overlapsVisit.id})` : ""}</small> : null}
          {r.kind === "unknown" ? <small>{dur(r.minutes)} · {r.reasons.map(x => x === "gps_spacing" ? t("GPS spacing", "ระยะห่าง GPS") : t("provider log gap", "ช่วง log ขาด")).join(" + ")}</small> : null}
          {r.kind === "open_segment" ? <small>{t("The report has a segment with no end time (recorded as 0 km).", "รายงานมีช่วงที่ไม่มีเวลาสิ้นสุด (บันทึกเป็น 0 กม.)")}</small> : null}
        </span>
        <span className="v784-act">
          {r.kind === "visit" && actions.onViewLocation ? <button type="button" className="v78-act" data-view-location={r.id} onClick={() => actions.onViewLocation!(r.id)}>{t("View location", "ดูตำแหน่ง")}</button> : null}
          {r.kind === "visit" ? <button type="button" className="v78-act is-quiet" onClick={() => choose(r.key)} aria-pressed={selected === r.key}>{t("Open visit detail", "เปิดรายละเอียดการเข้าเยี่ยม")}</button> : null}
          {r.kind === "visit" && actions.onOpenInJourneys ? <button type="button" className="v78-act is-quiet" onClick={() => actions.onOpenInJourneys!(r.id)}>{t("Open in Journeys", "เปิดในเที่ยวรถ")}</button> : null}
          {r.kind === "driving" ? routeBtn(r.start, r.end, r.key) : null}
          {r.kind === "movement_in_visit" ? routeBtn(r.movement.start, r.movement.end, r.key) : null}
          {r.kind !== "visit" ? <button type="button" className="v78-act is-quiet" onClick={() => choose(r.key)} aria-pressed={selected === r.key}>{t("Inspect", "ตรวจสอบ")}</button> : null}
        </span>
      </li>
    );
  };

  const b = chrono.accounting.buckets, ws = Math.max(1, chrono.accounting.windowSeconds);
  const crossCards = [{ b: startBoundary, edge: "start" as const }, { b: endBoundary, edge: "end" as const }].filter(x => x.b && (x.b.status === "continuation_observed" || (x.edge === "end" && x.b.openSegment && x.b.status !== "not_applicable")));
  const cov = coverage;

  return (
    <section className="v784-narrative" aria-label={t("Operating day", "วันปฏิบัติงาน")} data-v784-narrative data-day-timeline>

      <div className="v784-coverage" data-coverage-card>
        <h3>{t("How complete is the evidence?", "หลักฐานครบถ้วนแค่ไหน?")}</h3>
        <ul>
          <li><b>{cov.positions.verifiedPct === null ? "—" : `${num(cov.positions.verifiedPct)}%`}</b> {t("of the positions that arrived are GPS-verified.", "ของตำแหน่งที่ได้รับมีการยืนยัน GPS")}</li>
          <li><b>{cov.time ? `${num(cov.time.supportedPct)}%` : "—"}</b> {t("of the time has position evidence;", "ของเวลามีหลักฐานตำแหน่ง;")} <b>{cov.time ? dur(Math.round(cov.time.unobservedSeconds / 60)) : "—"}</b> {t("is unobserved", "ไม่ได้สังเกต")}{cov.time ? ` (${cov.time.short.intervals} ${t("single spacings", "ช่วงห่างเดี่ยว")}${cov.time.chained.intervals ? ` · ${cov.time.chained.intervals} ${t("back-to-back pairs", "คู่ที่ติดกัน")}` : ""} · ${cov.time.long.intervals} ${t("outages over 10 minutes", "ช่วงขาดนานเกิน 10 นาที")}; ${t("longest run", "ช่วงยาวสุด")} ${dur(Math.round(cov.time.longestRunSeconds / 60))})` : ""}.</li>
          <li><b>{cov.providerLogGaps ? cov.providerLogGaps.count : "—"}</b> {t("provider log gaps over 10 minutes.", "ช่วงที่ log ของผู้ให้บริการขาดเกิน 10 นาที")}{cov.providerLogGaps && cov.providerLogGaps.cadenceJitterGaps > 0 ? ` ${cov.providerLogGaps.cadenceJitterGaps} ${t("shorter spacing(s) of 5–10 minutes are not counted here.", "ช่วงห่าง 5–10 นาทีที่สั้นกว่าไม่นับที่นี่")}` : ""}</li>
          <li>{t("Provider report", "รายงานผู้ให้บริการ")}: <b>{cov.provider.state === "reconciled" ? t("reconciled", "กระทบยอดแล้ว") : cov.provider.state === "withheld" ? t("withheld", "ถูกระงับ") : t("not read", "ยังไม่ได้อ่าน")}</b>{cov.provider.openSegments ? ` · ${cov.provider.openSegments} ${t("open segment(s)", "ช่วงที่ยังไม่ปิด")}` : ""}.</li>
        </ul>
        {cov.time && cov.time.long.intervals === 0 && cov.time.unobservedSeconds > 0 && cov.providerLogGaps?.count === 0 ? <p className="v784-note" role="note" data-cadence-note>{t("No gap in the provider log is longer than 10 minutes, and the longest unobserved run here is ", "ไม่มีช่วงใน log ของผู้ให้บริการที่ขาดเกิน 10 นาที และช่วงที่ไม่ได้สังเกตยาวสุดคือ ")}{dur(Math.round(cov.time.longestRunSeconds / 60))}{t(". Positions arrive about every 5 minutes, and the GPS distance rule treats any spacing over exactly 5 minutes as unobserved, so a report that is a few seconds late makes the whole interval unobserved. This is a rule effect, not evidence of a tracking outage. The rule and its figures are unchanged.", " ตำแหน่งมาถึงประมาณทุก 5 นาที และการคำนวณระยะ GPS ถือว่าช่วงที่ห่างเกิน 5 นาทีพอดีเป็นช่วงที่ไม่ได้สังเกต รายงานที่ช้าไปไม่กี่วินาทีจึงทำให้ทั้งช่วงเป็นไม่ได้สังเกต นี่เป็นผลของกฎ ไม่ใช่หลักฐานว่าระบบติดตามขัดข้อง กฎและตัวเลขไม่เปลี่ยน")}</p> : null}
        {cov.flags.verificationIsNotCoverage || cov.flags.zeroLogGapsButUnobservedTime ? <p className="v784-note" role="note">{cov.flags.verificationIsNotCoverage ? t("Every position that arrived is verified, but that does not mean the whole day was tracked. ", "ทุกตำแหน่งที่ได้รับผ่านการยืนยัน แต่ไม่ได้หมายความว่าติดตามได้ทั้งวัน ") : ""}{cov.flags.zeroLogGapsButUnobservedTime ? t("The provider log shows no gap because it only counts spacing over 10 minutes; the GPS distance rule treats any spacing over 5 minutes as unobserved. Unobserved time is never counted as stationary.", "log ของผู้ให้บริการไม่แสดงช่วงขาดเพราะนับเฉพาะที่ห่างเกิน 10 นาที ส่วนการคำนวณระยะทาง GPS ถือว่าห่างเกิน 5 นาทีคือไม่ได้สังเกต เวลาที่ไม่ได้สังเกตไม่ถูกนับเป็นการจอดนิ่ง") : ""}</p> : null}
      </div>

      {total.state === "withheld" ? (
        <div className="v784-withheld" data-provider-withheld>
          <h3>{t("Why the Forth day total is withheld", "เหตุใดจึงระงับยอดรวมรายวันของ Forth")}</h3>
          <ul>{total.reasons.map(r => <li key={r.code} data-withhold-code={r.code}>{language === "th" ? r.th : r.en}</li>)}</ul>
          <dl className="v784-figures">
            <div><dt>{t("Report's own total", "ยอดรวมของรายงานเอง")}</dt><dd>{num(total.assertedTotalKm, 2)} {t("km", "กม.")}</dd></div>
            <div><dt>{t("Sum of the segments it lists", "ผลรวมของช่วงที่รายงานแสดง")}</dt><dd>{num(total.segmentSumKm, 2)} {t("km", "กม.")} · {total.segmentCount} {t("segments", "ช่วง")}{total.differenceKm !== null ? ` · ${t("difference", "ผลต่าง")} ${num(total.differenceKm, 2)}` : ""}{total.sumMayBeIncomplete ? ` · ${t("may be incomplete", "อาจไม่ครบ")}` : ""}</dd></div>
            <div><dt>{t("Reported trail (log), a different source", "ระยะตามเส้นทางจาก log ซึ่งเป็นคนละแหล่ง")}</dt><dd>{num(total.reportedTrailKm, 2)} {t("km", "กม.")}</dd></div>
            <div><dt>{t("GPS-derived, whole day", "ที่คำนวณจาก GPS ทั้งวัน")}</dt><dd>{num(total.gpsKm, 2)} {t("km", "กม.")}</dd></div>
          </dl>
          {total.differenceKm === 0 && total.sumMayBeIncomplete ? <p className="v784-note" data-sum-matches>{t("The listed segments add up exactly to the report's own total (difference 0.00 km), so an unreadable row, if its distance were counted in that total, would carry none. The total is still withheld because the rule withholds rather than assumes what an unreadable row contains.", "ช่วงที่แสดงรวมกันได้เท่ากับยอดรวมของรายงานเอง (ต่าง 0.00 กม.) หากแถวที่อ่านไม่ได้ถูกนับในยอดนั้น แถวนั้นก็ไม่มีระยะทาง แต่ยอดยังถูกระงับ เพราะกฎคือระงับ ไม่ใช่สันนิษฐานว่าแถวที่อ่านไม่ได้มีอะไรอยู่")}</p> : null}
          <p className="v784-note">{t("The trail and GPS figures are shown for comparison only. None of them is accepted as the provider total, and the total stays withheld until the report itself reconciles.", "ระยะตามเส้นทางและ GPS แสดงเพื่อเปรียบเทียบเท่านั้น ไม่มีค่าใดถูกรับเป็นยอดของผู้ให้บริการ และยอดจะยังถูกระงับจนกว่ารายงานจะกระทบยอดได้")}</p>
        </div>
      ) : null}

      {crossCards.map(({ b: c, edge }) => c ? (
        <div key={edge} className="v784-cross" data-cross-midnight={c.status}>
          <h3>{edge === "start" ? t("Continues from the previous day", "ต่อเนื่องจากวันก่อนหน้า") : t("Crosses midnight into the next day", "ข้ามเที่ยงคืนไปวันถัดไป")}</h3>
          <p>{CROSS_MIDNIGHT_COPY[c.status][L]}</p>
          {c.status === "continuation_observed" && c.gpsKm ? <>
            <p>{t("GPS-observed", "GPS สังเกตได้")} {clock(c.observedStart!)} {edge === "start" ? t("(previous day)", "(วันก่อนหน้า)") : ""} → {clock(c.observedEnd!)}{edge === "end" ? t(" (next day)", " (วันถัดไป)") : ""} · <b>{num(c.gpsKm.total, 2)} {t("km", "กม.")}</b> ({num(c.gpsKm.previousDay, 2)} + {num(c.gpsKm.nextDay, 2)}) · {t("provider allocation", "การจัดสรรของผู้ให้บริการ")}: {c.providerAllocation === "none_found" ? t("none found", "ไม่พบ") : t("partly found", "พบบางส่วน")}</p>
            <ul>{c.windows.map(w => <li key={w.start}>{w.day} {clock(w.start)} → {clock(w.end)} · {dur(w.minutes)} · {num(w.km, 2)} {t("km", "กม.")}</li>)}</ul>
            {c.openSegment ? <p>{t("Open provider segment from", "ช่วงของผู้ให้บริการที่ยังไม่ปิดตั้งแต่")} {clock(c.openSegment.start)}{c.firstProviderSegmentNextDay ? ` · ${t("first next-day segment", "ช่วงแรกของวันถัดไป")} ${clock(c.firstProviderSegmentNextDay)}` : ""}.</p> : null}
            <ul className="v784-limits">{c.limits.map(k => <li key={k}>{CROSS_MIDNIGHT_LIMITS[k][L]}</li>)}</ul>
          </> : null}
          {edge === "end" && c.status === "next_day_not_reviewed" ? <p className="v784-note">{nextDayRequested ? t("The next day is in range but has not been read.", "วันถัดไปอยู่ในช่วงแต่ยังไม่ได้อ่าน") : t(`Include ${nextBangkokDay(day)} in the range and read it in Daily Activity if you need this check.`, `เพิ่มวันที่ ${nextBangkokDay(day)} ในช่วงและอ่านใน Daily Activity หากต้องการตรวจสอบนี้`)}</p> : null}
        </div>
      ) : null)}

      <div className="v784-day">
        <div>
          <h3>{t("Activity timeline", "ไทม์ไลน์กิจกรรม")}</h3>
          <p className="v72-hint">{t("Every row is a source interval as recorded. A visit is a window of grouped GPS stops; movement inside it is nested and explained, not subtracted.", "ทุกแถวคือช่วงตามที่แหล่งข้อมูลบันทึก การเข้าเยี่ยมคือช่วงของจุดจอด GPS ที่รวมกัน การเคลื่อนที่ภายในจะแสดงซ้อนและอธิบาย ไม่ได้หักออก")}</p>
          {rows.length === 0 ? <p className="v72-empty-line">{t("No driving, visits or unknown intervals to show for this day.", "ไม่มีการขับ การเข้าเยี่ยม หรือช่วงที่ไม่ทราบให้แสดงสำหรับวันนี้")}</p> : <ol className="v784-timeline">{rows.map(rowView)}</ol>}
        </div>
        {sel ? (
          <aside className="v784-inspector" role="region" aria-labelledby="v784-inspector-title" data-chrono-inspector>
            <h4 id="v784-inspector-title" ref={headRef} tabIndex={-1}>{kindLabel(sel)}</h4>
            {(() => {
              if (sel.kind === "visit") { const v = visitById.get(sel.id); return <>
                <p>{clock(sel.start)} → {clock(sel.end)} · {t("window", "ช่วงเวลา")} {dur(sel.spanMinutes)}</p>
                <p>{t("Supported stationary", "จอดนิ่งที่มีหลักฐาน")} ≥ {dur(sel.supportedMinutes)}{sel.bridgedMinutes > 0 ? ` · ${t("bridged interruptions", "ช่วงเชื่อมที่ไม่นับ")} ${dur(sel.bridgedMinutes)}` : ""}{sel.unobservedInsideMinutes !== null ? ` · ${t("unobserved inside the window", "ไม่ได้สังเกตภายในช่วง")} ${dur(sel.unobservedInsideMinutes)}` : ""}</p>
                <p>{DEPARTURE_COPY[sel.departure][L]}</p>
                {v ? <ul>{v.stops.map(s => <li key={s.id}>{s.id}: {clock(s.firstAt)} → {clock(s.lastAt)} · {s.observations} {t("positions", "ตำแหน่ง")}</li>)}</ul> : null}
                {v && v.joins.length ? <ul>{v.joins.map(j => <li key={j.fromStopId + j.toStopId}>{j.fromStopId}→{j.toStopId}: {j.interruptionMinutes} {t("min between", "นาทีระหว่างกัน")}, {t("farthest", "ไกลสุด")} {j.farthestBetweenM} {t("m from the site", "ม. จากสถานที่")}{j.maxSpeedBetweenKph !== null ? `, ${t("top speed", "ความเร็วสูงสุด")} ${j.maxSpeedBetweenKph} ${t("km/h", "กม./ชม.")}` : ""}</li>)}</ul> : null}
                <p className="v72-hint">{t("A grouped visit is evidence, not a confirmed visit or a completed job.", "การเข้าเยี่ยมที่รวมกันเป็นหลักฐาน ไม่ใช่การยืนยันการเข้าเยี่ยมหรืองานที่เสร็จ")}</p></>; }
              if (sel.kind === "movement_in_visit") return <><p>{mvLine(sel.movement)}</p>{sel.movement.relation ? <p>{RELATION_COPY[sel.movement.relation][L]}</p> : null}{sel.movement.siteEvidence ? <p>{t("Positions between the stops stayed within", "ตำแหน่งระหว่างจุดจอดอยู่ภายใน")} {sel.movement.siteEvidence.farthestBetweenM} {t("m of the site", "ม. จากสถานที่")}.</p> : null}</>;
              if (sel.kind === "driving") return <><p>{clock(sel.start)} → {sel.end ? clock(sel.end) : t("open", "ยังไม่ปิด")} · {dur(sel.minutes)}</p><p>{sourceLabel(sel.source)}{sel.positionSource ? ` · ${t("positions", "ตำแหน่ง")}: ${sel.positionSource}` : ""}</p><p>{t("Forth", "Forth")} {num(sel.providerKm)} · {t("GPS", "GPS")} {num(sel.gpsKm)} · {t("log trail", "ระยะตาม log")} {num(sel.trailKm)} {t("km", "กม.")}</p>{sel.notInProviderReport ? <p>{t("No Forth segment covers this movement. It is shown separately and is not added to any provider total.", "ไม่มีช่วงของ Forth ครอบคลุมการเคลื่อนที่นี้ แสดงแยกและไม่ถูกบวกเข้ายอดของผู้ให้บริการ")}</p> : null}{sel.ambiguous ? <p>{t("The provider segment is ambiguous (overlap or open with distance).", "ช่วงของผู้ให้บริการไม่ชัดเจน (ทับซ้อนหรือยังไม่ปิดแต่มีระยะทาง)")}</p> : null}</>;
              if (sel.kind === "unknown") return <><p>{clock(sel.start)} → {clock(sel.end)} · {dur(sel.minutes)}</p><p>{t("No usable position pair, so distance and stay time here are unknown. This is never counted as stationary time.", "ไม่มีคู่ตำแหน่งที่ใช้ได้ ระยะทางและเวลาจอดช่วงนี้จึงไม่ทราบ และไม่นับเป็นการจอดนิ่ง")}</p></>;
              return <p>{t("Forth's report has a segment that starts at", "รายงาน Forth มีช่วงที่เริ่มเมื่อ")} {clock(sel.start)} {t("with no end time. Its distance is recorded as 0 km, so a trip still running at midnight can be missing from the day total.", "และไม่มีเวลาสิ้นสุด ระยะทางถูกบันทึกเป็น 0 กม. เที่ยวที่ยังวิ่งอยู่ตอนเที่ยงคืนจึงอาจไม่อยู่ในยอดรวมของวัน")}</p>;
            })()}
            <button type="button" className="btn-secondary min-h-11" onClick={closeInspector}>{t("Close", "ปิด")}</button>
          </aside>
        ) : null}
      </div>

      <details className="v72-evidence v784-advanced" data-day-accounting>
        <summary>{t("Advanced evidence · time accounting and definitions", "หลักฐานขั้นสูง · การนับเวลาและคำนิยาม")}</summary>
        <p className="v72-hint">{t("Every second of the elapsed day is counted once, in one row. Sources that disagree stay in their own row.", "ทุกวินาทีของวันที่ผ่านไปถูกนับครั้งเดียวในหนึ่งแถว แหล่งที่ไม่ตรงกันจะอยู่ในแถวของตัวเอง")}</p>
        <div className="v72-table-wrap"><table className="v72-table v782-cards"><thead><tr><th scope="col">{t("Category", "หมวด")}</th><th scope="col" className="num">{t("Time", "เวลา")}</th><th scope="col" className="num">{t("Share", "สัดส่วน")}</th><th scope="col">{t("Meaning", "ความหมาย")}</th></tr></thead>
          <tbody>{(Object.keys(b) as (keyof TimeBuckets)[]).map(k => <tr key={k} data-bucket={k}><th scope="row" data-label={t("Category", "หมวด")}>{BUCKET_COPY[k].label[L]}</th><td className="num" data-label={t("Time", "เวลา")}>{dur(Math.round(b[k] / 60))}</td><td className="num" data-label={t("Share", "สัดส่วน")}>{num((b[k] / ws) * 100)}%</td><td data-label={t("Meaning", "ความหมาย")}>{BUCKET_COPY[k].note[L]}</td></tr>)}</tbody></table></div>
        <p className="v72-hint">{t("Total", "รวม")} {dur(Math.round(chrono.accounting.sumSeconds / 60))} = {t("elapsed window", "ช่วงที่ผ่านไป")} {dur(Math.round(chrono.accounting.windowSeconds / 60))}{chrono.accounting.gpsAvailable ? "" : ` · ${t("no GPS log was read, so nothing outside provider segments and stops is observed", "ไม่ได้อ่าน log GPS จึงไม่มีช่วงนอกเหนือจากช่วงของผู้ให้บริการและจุดจอดที่สังเกตได้")}`}.</p>
        {cov.time && Object.keys(cov.time.byReason).length ? <p className="v72-hint">{t("Unobserved time by cause", "เวลาที่ไม่ได้สังเกตแยกตามสาเหตุ")}: {Object.entries(cov.time.byReason).map(([k, v]) => `${(REASON_COPY[k] ?? REASON_COPY.unknown_reason)[L]} ${dur(Math.round(v.seconds / 60))}`).join(" · ")}</p> : null}
        <dl className="v784-defs">{COVERAGE_DEFINITIONS.map(d => <div key={d.id}><dt>{d.title[L]}</dt><dd>{d.text[L]}</dd></div>)}</dl>
      </details>
    </section>
  );
}
