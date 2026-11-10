"use client";
import { INSIGHT_COPY, coverageLabel, type DayInsights } from "@/lib/fleet-day-insights";
import { positionSourceLabel } from "@/lib/fleet-journey-copy";
import type { DaySummary } from "@/lib/fleet-vehicle-day-summary";
import type { JourneyLedger } from "@/lib/fleet-journey-ledger";
import type { ProviderDay } from "@/lib/fleet-intelligence-day";
import { reviewItemText } from "@/lib/fleet-day-review-copy";
import type { OperatingSummary } from "@/lib/fleet-day-narrative-model";

type Lang = "en" | "th";
const num = (language: Lang, v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const clock = (language: Lang, iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—");
const duration = (language: Lang, minutes: number | null) => {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h > 0 ? `${h} ${language === "th" ? "ชม." : "h"} ${m} ${language === "th" ? "นาที" : "min"}` : `${m} ${language === "th" ? "นาที" : "min"}`;
};

/**
 * Display-only rule for "the two distance sources disagree": at least 5 km and at least 10% of the larger figure.
 * It only decides whether to show a notice. No figure is adjusted and neither source is declared correct.
 */
export function distancesDisagree(providerKm: number | null, gpsKm: number | null) {
  if (providerKm === null || gpsKm === null) return false;
  const diff = Math.abs(providerKm - gpsKm);
  return diff >= 5 && diff >= 0.1 * Math.max(providerKm, gpsKm);
}

/** Daily Activity headline: which vehicle/day, how far (per source), journeys and stops, evidence quality, what needs attention. */
export function FleetDaySnapshot({ provider, model, summary, registration, day, language, restricted, visits, onExplain, operating }: {
  /** V7.8.4: the time-coverage and review reasons from the shared day model, so this is the ONE operating summary of the day (the narrative below no longer repeats it). */
  operating?: OperatingSummary | null;
  /** V7.8.3: opens the focused mileage investigation (cache only). Offered only to callers allowed to view historical journeys. */
  onExplain?: () => void;
  provider: ProviderDay | null; model: DayInsights; summary: DaySummary; registration: string; day: string; language: Lang; restricted: boolean;
  /** V7.6: the day's visit analysis, when it has completed. Counts only; null while it is not built (never shown as zero). */
  visits?: { supported: number; gpsStops: number; unknown: number; gapAffected: number } | null;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const km = t("km", "กม.");
  const providerKm = provider ? provider.sources.providerReported.value : null;
  const gpsKm = provider ? provider.sources.gpsDerived.value : null;
  const reconciled = provider?.provider.arithmetic.status === "pass";
  const disagree = distancesDisagree(providerKm, gpsKm);
  const diff = providerKm !== null && gpsKm !== null ? Math.abs(providerKm - gpsKm) : null;
  const pct = diff !== null && Math.max(providerKm ?? 0, gpsKm ?? 0) > 0 ? (diff / Math.max(providerKm ?? 0, gpsKm ?? 0)) * 100 : null;
  const a = model.activity;
  const lang = language === "th" ? 1 : 0;
  const reviewItems = operating?.review ?? [];
  const attention = model.insights.length + summary.issues.length + reviewItems.length;
  return (
    <section className="v72-snapshot" aria-label={t("Vehicle day at a glance", "ภาพรวมรถรายวัน")} data-day-snapshot>
      <div className="v72-day-head">
        <strong>{registration || "—"}</strong><span>{day} · Asia/Bangkok</span>
        <span className="v72-chip" data-coverage={model.coverage}>{coverageLabel(model.coverage, language)}</span>
      </div>
      {!provider ? (
        <p className="v72-empty-line">{t("Forth report not read for this day. Distance, journeys and stops are unknown, not zero. Press “Read Forth report & GPS” above.", "ยังไม่ได้อ่านรายงาน Forth ของวันนี้ ระยะทาง เที่ยว และจุดจอดยังไม่ทราบ ไม่ใช่ศูนย์ กด “อ่านรายงาน Forth และ GPS” ด้านบน")}</p>
      ) : (
        <>
          <dl className="v72-strip">
            {disagree ? (
              <div className="v72-strip-wide is-warn" data-distance-disagreement>
                <dt>{t("Distance · the two sources disagree", "ระยะทาง · สองแหล่งไม่ตรงกัน")}</dt>
                <dd>
                  <span><b>{num(language, providerKm)}</b> {km} <small>{t("Forth report", "รายงาน Forth")}</small></span>
                  <span><b>{num(language, gpsKm)}</b> {km} <small>{t("GPS, whole day (verified intervals)", "GPS ทั้งวัน (ช่วงที่ยืนยัน)")}</small></span>
                </dd>
              </div>
            ) : (
              <div className="v72-strip-wide">
                <dt>{t("Distance · Forth report", "ระยะทาง · รายงาน Forth")}</dt>
                <dd><span><b>{reconciled ? num(language, providerKm) : t("Withheld", "ถูกระงับ")}</b> {reconciled ? km : ""} <small>{reconciled ? t("report total reconciled", "ยอดรายงานกระทบยอดแล้ว") : t("report total not reconciled: no provider km is shown", "ยอดรายงานยังไม่กระทบยอด จึงไม่แสดงกม. ของผู้ให้บริการ")}</small></span>
                  {gpsKm !== null ? <span className="is-secondary"><b>{num(language, gpsKm)}</b> {km} <small>{t("GPS, whole day (verified intervals)", "GPS ทั้งวัน (ช่วงที่ยืนยัน)")}</small></span> : null}</dd>
              </div>
            )}
            <div><dt>{t("Moving journeys", "เที่ยวที่เคลื่อนที่")}</dt><dd><b>{a.movingJourneys === null ? "—" : a.movingJourneys}</b><small>{duration(language, a.movingMinutes)}</small></dd></div>
            <div><dt>{t("Stops in report", "จุดจอดในรายงาน")}</dt><dd><b>{a.stops === null ? "—" : a.stops}</b><small>{a.longestStopMinutes !== null ? `${t("longest", "นานสุด")} ${duration(language, a.longestStopMinutes)}` : duration(language, a.stoppedMinutes)}</small></dd></div>
            <div data-visit-groups><dt>{t("Supported visits", "การเข้าเยี่ยมที่มีหลักฐานรองรับ")}</dt><dd><b>{visits ? visits.supported : "—"}</b><small>{visits ? t(`from ${visits.gpsStops} GPS stops · ${visits.unknown} unknown area${visits.unknown === 1 ? "" : "s"}${visits.gapAffected ? ` · ${visits.gapAffected} next to a gap` : ""}`, `จาก ${visits.gpsStops} จุดจอด GPS · ${visits.unknown} พื้นที่ไม่ทราบ${visits.gapAffected ? ` · ${visits.gapAffected} ติดช่วงขาด` : ""}`) : t("not analysed yet", "ยังไม่ได้วิเคราะห์")}</small></dd></div>
            <div><dt>{t("Tracking evidence", "หลักฐานการติดตาม")}</dt><dd><b>{a.observations === null ? "—" : `${a.verifiedObservations ?? 0}/${a.observations}`}</b><small>{t("verified positions", "ตำแหน่งที่ยืนยัน")}</small></dd></div>
            {operating ? <div data-time-evidence><dt>{t("Time with evidence", "เวลาที่มีหลักฐาน")}</dt><dd><b>{operating.timeSupportedPct === null ? "—" : `${num(language, operating.timeSupportedPct, 1)}%`}</b><small>{operating.inProgress ? t("of the day so far", "ของวันนี้ถึงตอนนี้") : t("of the day", "ของวัน")}{operating.unobservedMinutes !== null ? ` · ${duration(language, operating.unobservedMinutes)} ${t("unobserved", "ไม่ได้สังเกต")}` : ""}</small></dd></div> : null}
            <div className={attention > 0 ? "is-attention" : ""}><dt>{t("Needs attention", "ต้องตรวจสอบ")}</dt><dd><b>{attention}</b><small>{attention === 0 ? t("nothing unusual", "ไม่พบความผิดปกติ") : t("see below", "ดูด้านล่าง")}</small></dd></div>
          </dl>
          {disagree ? (
            <div className="v72-notice" role="note" data-discrepancy-notice>
              <strong>{t("Review needed: distance sources differ by", "ต้องตรวจสอบ: ระยะทางสองแหล่งต่างกัน")} {num(language, diff)} {km}{pct !== null ? ` (${num(language, pct, 0)}%)` : ""}</strong>
              {onExplain ? <button type="button" className="btn-secondary min-h-11" onClick={onExplain} data-explain-difference>{t("Explain the difference", "อธิบายความต่าง")}</button> : null}
              <p>{t("The Forth report adds up its own trip segments; the GPS figure is derived from recorded positions. They measure different things and neither is confirmed correct. Nothing has been adjusted. Check the evidence section below (coverage gaps, open final segment, unverified positions) before using either figure.", "รายงาน Forth รวมจากช่วงเที่ยวของตัวเอง ส่วนระยะ GPS คำนวณจากตำแหน่งที่บันทึก ทั้งสองวัดสิ่งต่างกันและยังไม่ยืนยันว่าแหล่งใดถูกต้อง ไม่มีการปรับตัวเลข โปรดตรวจหลักฐานด้านล่าง (ช่วงที่ขาด ช่วงสุดท้ายที่ยังไม่ปิด ตำแหน่งที่ไม่ยืนยัน) ก่อนใช้ตัวเลขใดตัวเลขหนึ่ง")}</p>
            </div>
          ) : null}
          {restricted ? <p className="v72-empty-line" role="note">{t("Journey detail needs administrator authorisation. The day totals above are still shown.", "รายละเอียดเที่ยวต้องได้รับอนุญาตจากผู้ดูแลระบบ ยอดรวมรายวันด้านบนยังแสดงอยู่")}</p> : null}
          {attention > 0 ? (
            <ul className="v72-attention" data-day-attention>
              {reviewItems.slice(0, 4).map(item => <li key={item.code} data-review-item={item.code}><b>{reviewItemText(item, language)}</b></li>)}
              {model.insights.slice(0, 3).map((i) => <li key={i.id}><b>{INSIGHT_COPY[i.id].title[lang]}</b><span>{INSIGHT_COPY[i.id].action[lang]}</span></li>)}
              {summary.issues.length ? <li><b>{summary.issues.length} {t("source issue(s) to review", "เรื่องของแหล่งข้อมูลที่ต้องตรวจสอบ")}</b><span>{t("Listed in Tracking evidence & reconciliation.", "แสดงในส่วนหลักฐานการติดตามและการกระทบยอด")}</span></li> : null}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The part of a matched place the timeline needs: its observed window and its label parts. */
export type TimelinePlace = { id?: string; sourceLabel?: string; firstAt: string; lastAt: string; label: { title: string; named: boolean }; observedMinutes?: number; openStart?: boolean; openEnd?: boolean; stops?: number };
/** A place belongs to a stop row when the two observed windows overlap by at least half of the shorter one. */
const overlappingPlace = (places: readonly TimelinePlace[], start: string, end: string | null) => {
  const s0 = Date.parse(start), e0 = end ? Date.parse(end) : s0;
  return places.find(p => { const s1 = Date.parse(p.firstAt), e1 = Date.parse(p.lastAt); const overlap = Math.min(e0, e1) - Math.max(s0, s1); const shorter = Math.min(e0 - s0, e1 - s1); return overlap > 0 && overlap >= 0.5 * Math.max(shorter, 1); }) ?? null;
};

/** One chronological list for the day: report boundaries, movement, stops and tracking gaps. Boundaries are the report's own; nothing is invented. */
export type TimelineActions = {
  selectedId?: string | null;
  /** Opens the historical location map for a visit. Only runs when the user presses the button. */
  onViewLocation?: (visitId: string) => void;
  /** Opens the supervised route playback limited to a movement's own report window (Bangkok day and HH:MM). */
  onViewRoute?: (range: { day: string; start: string; end: string }) => void;
  onOpenInJourneys?: (visitId: string) => void;
};
const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const bkkDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export function FleetDayTimeline({ provider, model, language, restricted, places = [], actions }: { provider: ProviderDay | null; model: DayInsights; language: Lang; restricted: boolean; places?: readonly TimelinePlace[]; actions?: TimelineActions }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const ledger = (provider?.journeyLedger as JourneyLedger | null | undefined) ?? null;
  if (!provider || restricted) return null;
  if (!ledger) return <p className="v72-empty-line" role="note">{t("This snapshot predates journey analysis. Use Refresh from Forth to rebuild it.", "ข้อมูลนี้อ่านก่อนมีการวิเคราะห์เที่ยว โปรดกดรีเฟรชจาก Forth")}</p>;
  type Row = { key: string; start: string; end: string | null; kind: "moving" | "stopped" | "open" | "uncertain" | "gap" | "visit"; minutes: number | null; km: number | null; source: string | null; visit?: TimelinePlace };
  // V7.5: when the day's visits are loaded they replace the provider's stop rows, so one chronological list shows movement, named or unknown visits and gaps.
  const useVisits = places.length > 0;
  const rows: Row[] = [
    ...places.map<Row>((p, i) => ({ key: p.id ?? `visit-${i}`, start: p.firstAt, end: p.lastAt, kind: "visit", minutes: p.observedMinutes ?? null, km: null, source: null, visit: p })),
    ...ledger.journeys.filter((j) => !(useVisits && !j.ambiguous && j.kind === "stopped")).map<Row>((j) => ({ key: j.id, start: j.start, end: j.end, kind: j.ambiguous ? "uncertain" : j.kind === "open_final" ? "open" : j.kind === "moving" ? "moving" : "stopped", minutes: j.minutes, km: j.providerKm, source: j.positionSource })),
    ...ledger.missing.map<Row>((m, i) => ({ key: `gap-${i}`, start: m.start, end: m.end, kind: "gap", minutes: m.minutes, km: null, source: null }))
  ].sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
  const label = (k: Row["kind"]) => ({ visit: t("Visit", "เข้าเยี่ยม"), moving: t("Moving", "เคลื่อนที่"), stopped: t("Stop", "จอด"), open: t("Open final segment", "ช่วงสุดท้ายยังไม่ปิด"), uncertain: t("Uncertain", "ไม่ชัดเจน"), gap: t("No tracking data", "ไม่มีข้อมูลการติดตาม") }[k]);
  const a = model.activity;
  return (
    <section className="v72-timeline-wrap" aria-label={t("Day timeline", "ไทม์ไลน์รายวัน")} data-day-timeline>
      <h3>{t("Activity timeline", "ไทม์ไลน์กิจกรรม")}</h3>
      <p className="v72-hint">{t("First report", "รายงานแรก")} {clock(language, a.firstSegmentStart)} · {t("last report", "รายงานสุดท้าย")} {clock(language, a.lastSegmentEnd)} — {t("report boundaries, not departure or return times.", "เป็นขอบเขตของรายงาน ไม่ใช่เวลาออกหรือกลับ")}</p>
      {rows.length === 0 ? <p className="v72-empty-line">{t("The report has no segments for this day.", "รายงานไม่มีช่วงของวันนี้")}</p> : (
        <ol className="v72-timeline">
          {rows.map((r) => (
            <li key={r.key} data-kind={r.kind} data-visit-row={r.kind === "visit" ? r.key : undefined} className={r.kind === "visit" && actions?.selectedId === r.key ? "is-selected" : undefined}>
              <span className="v72-t-time">{clock(language, r.start)} → {r.end ? clock(language, r.end) : t("open", "ยังไม่ปิด")}</span>
              <span className="v72-t-kind">{label(r.kind)}{r.visit ? <b className={r.visit.label.named ? "v73-name" : "v73-name is-uncertain"}> · {r.visit.label.title}</b> : null}{r.kind === "stopped" ? (() => { const p = overlappingPlace(places, r.start, r.end); return p ? <b className={p.label.named ? "v73-name" : "v73-name is-uncertain"}> · {p.label.title}</b> : null; })() : null}{r.visit?.openStart ? <small> · {t("day starts inside", "ข้อมูลเริ่มระหว่างจอด")}</small> : null}{r.visit?.openEnd ? <small> · {t("data ends inside", "ข้อมูลสิ้นสุดระหว่างจอด")}</small> : null}</span>
              <span className="v72-t-dur">{r.visit ? `${r.visit.openStart || r.visit.openEnd ? "≥ " : ""}${duration(language, r.minutes)}` : duration(language, r.minutes)}</span>
              <span className="v72-t-km">{r.kind === "gap" ? t("km unknown", "ไม่ทราบ กม.") : r.kind === "stopped" || r.kind === "visit" ? "" : `${num(language, r.km)} ${t("km", "กม.")}`}</span>
              <span className="v72-t-src">{r.source ? positionSourceLabel(r.source as Parameters<typeof positionSourceLabel>[0], language) : r.visit ? (r.visit.sourceLabel ?? "") : ""}</span>
              <span className="v78-t-act">
                {r.kind === "visit" && r.visit?.id && actions?.onViewLocation ? <button type="button" className="v78-act" data-view-location={r.visit.id} onClick={() => actions.onViewLocation!(r.visit!.id!)}>{t("View location", "ดูตำแหน่ง")}</button> : null}
                {r.kind === "visit" && r.visit?.id && actions?.onOpenInJourneys ? <button type="button" className="v78-act is-quiet" onClick={() => actions.onOpenInJourneys!(r.visit!.id!)}>{t("In Journeys", "ในเที่ยวรถ")}</button> : null}
                {r.kind === "moving" && r.end && actions?.onViewRoute && bkkDay(r.start) === bkkDay(r.end) ? <button type="button" className="v78-act" data-view-route={r.key} onClick={() => actions.onViewRoute!({ day: bkkDay(r.start), start: hm(r.start), end: hm(r.end!) })}>{t("View route", "ดูเส้นทาง")}</button> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
