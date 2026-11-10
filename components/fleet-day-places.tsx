"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DayPlaces, Visit } from "@/lib/fleet-day-places-server";
import { candidateName, matchLabel, proximityLabel, reasonLabel, statusLabel, uncertaintyLabel, type SiteMatch } from "@/lib/fleet-location-match";
import { splitReasonLabel } from "@/lib/fleet-visit-grouping";
import { driverLabel } from "@/lib/fleet-driver-attribution";

type Lang = "en" | "th";
export type DayPlacesState = { data: DayPlaces | null; state: "idle" | "loading" | "ready" | "forbidden" | "failed" };

const clock = (language: Lang, iso: string) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const duration = (language: Lang, minutes: number) => { const h = Math.floor(minutes / 60), m = minutes % 60; return h > 0 ? `${h} ${language === "th" ? "ชม." : "h"} ${m} ${language === "th" ? "นาที" : "min"}` : `${m} ${language === "th" ? "นาที" : "min"}`; };

/** The label parts a visit gets, derived once from the visit-level match (the full evidence of the visit decides, never a single stop). */
export function visitLabel(visit: Visit, language: Lang) {
  const m: SiteMatch = { ...visit.match, gpsQuality: visit.sourceQuality, primary: visit.match.primary ? { ...visit.match.primary, category: null, source: visit.match.primary.source as "forth_saved_location", pointId: "" } : null, alternatives: visit.match.alternatives.map(a => ({ ...a, groupLayer: null, category: null, source: "forth_saved_location" as const, proximity: "far" as const, referenceRadiusM: 50, forthDiameterRaw: null, entrances: 1, pointId: "" })) };
  return matchLabel(m, language);
}

/**
 * One read-only request for a vehicle-day the caller has already read (their own server memory; never Forth). It only runs once the day
 * has been read, and only names, distances, windows and counts come back: no coordinates. Shared by the visit table and the timeline.
 */
export function useDayPlaces({ vehicleId, day, dayRead, readStamp = "" }: { vehicleId: string | null; day: string; dayRead: boolean; /** Changes whenever a new provider day arrives for this vehicle-day (for example after an explicit Forth refresh), so the visit analysis is rebuilt from it. It adds no Forth request: the route only reads this user's own server memory. */ readStamp?: string }): DayPlacesState {
  const [data, setData] = useState<DayPlaces | null>(null);
  const [state, setState] = useState<DayPlacesState["state"]>("idle");
  useEffect(() => {
    setData(null);
    if (!vehicleId || !dayRead) { setState("idle"); return; }
    const controller = new AbortController(); setState("loading");
    const timeout = setTimeout(() => controller.abort(), 20000);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
        const response = await fetch(`/api/admin/forth-tracking/evidence/day-places?${new URLSearchParams({ vehicleId, day })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 403) { setState("forbidden"); return; }
        if (!response.ok) throw new Error("status");
        setData(await response.json() as DayPlaces); setState("ready");
      } catch { if (!controller.signal.aborted) setState("failed"); } finally { clearTimeout(timeout); }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [vehicleId, day, dayRead, readStamp]);
  return { data, state };
}

/**
 * Daily Activity / Journeys: the day's VISITS (GPS stops grouped only where the evidence supports it), the saved-directory place each
 * visit is near, the driver attribution, and how the different stop counts fit together. The original stops stay inside each visit.
 */
export function FleetDayPlaces({ places: source, language, dayRead, providerStops, canSeeDriverNames = true, onViewRoute, selectedId, onSelectedChange, onViewLocation }: {
  places: DayPlacesState; language: Lang; dayRead: boolean; canSeeDriverNames?: boolean;
  /** V7.8: the selected visit is shared with Daily Activity and the map inspector. When omitted the list keeps its own selection. */
  selectedId?: string | null; onSelectedChange?: (id: string | null) => void; onViewLocation?: (id: string) => void;
  /** Stop entries in the Forth report for the same day (a different source). */
  providerStops?: { total: number; zeroDuration: number } | null; onViewRoute?: () => void;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const { data, state } = source;
  const [own, setOwn] = useState<string | null>(null);
  const controlled = onSelectedChange !== undefined;
  const selected = controlled ? (selectedId ?? null) : own;
  const setSelected = (next: string | null | ((c: string | null) => string | null)) => { const value = typeof next === "function" ? next(selected) : next; if (controlled) onSelectedChange!(value); else setOwn(value); };
  const [view, setView] = useState<"time" | "place">("time");
  const [showShort, setShowShort] = useState(false);
  useEffect(() => { if (!controlled) setOwn(null); }, [data, controlled]);
  if (!dayRead) return null;
  const visits = data?.visits ?? [];
  const named = visits.filter(v => v.match.status === "likely_directory_match" || v.match.status === "reviewed_site_boundary").length;
  const possible = visits.filter(v => v.match.status === "possible_directory_match" || v.match.status === "multiple_nearby_locations").length;
  const unknown = visits.length - named - possible;
  const driver = data ? driverLabel(data.driver, language, canSeeDriverNames) : null;
  const detail = visits.find(v => v.id === selected) ?? null;
  const SHORT_MINUTES = 10; // display filter only: nothing is removed from the data or from the visit detail
  const shortCount = visits.filter(v => v.observedMinutes < SHORT_MINUTES && v.id !== selected).length;
  const shown = showShort ? visits : visits.filter(v => v.observedMinutes >= SHORT_MINUTES || v.id === selected);
  const placeKey = (v: Visit) => (v.match.primary && (v.match.status === "likely_directory_match" || v.match.status === "reviewed_site_boundary" || v.match.status === "possible_directory_match") ? v.match.primary.name : "");
  const placeGroups = (() => { const m = new Map<string, Visit[]>(); for (const v of shown) { const k = placeKey(v); m.set(k, [...(m.get(k) ?? []), v]); } return [...m.entries()].sort((x, y) => (x[0] === "" ? 1 : y[0] === "" ? -1 : y[1].length - x[1].length)).map(([k, items]) => ({ key: k || "unknown", title: k || t("No saved place nearby", "ไม่มีสถานที่ที่บันทึกใกล้เคียง"), items })); })();
  const visitRow = (v: Visit, label: ReturnType<typeof visitLabel>) => (
    <tr key={v.id} className={selected === v.id ? "is-active" : ""} data-place-status={v.match.status} data-visit={v.id}>
      <th scope="row">{clock(language, v.firstAt)} – {clock(language, v.lastAt)}{v.openStart ? <small>{t("day starts here", "ข้อมูลเริ่มที่นี่")}</small> : null}{v.openEnd ? <small>{t("data ends here", "ข้อมูลสิ้นสุดที่นี่")}</small> : null}</th>
      <td><b className={label.named ? "v73-name" : "v73-name is-uncertain"}>{label.title}</b><small>{statusLabel(v.match.status, language)}{v.match.primary ? ` · ${v.match.primary.distanceM} m ${t("from saved point", "จากจุดที่บันทึก")}` : ""}</small>{label.secondary && !label.named ? <small>{label.secondary}</small> : null}<small className="v75-q">{qualityText(v.sourceQuality)} · {v.stops.length} {t("stops", "จุดจอด")}</small></td>
      <td className="num">{stayText(v)}{v.interruptions ? <small>{v.interruptions} {t("short breaks bridged", "การหยุดสั้นที่เชื่อมไว้")}</small> : null}</td>
      <td>{qualityText(v.sourceQuality)}</td>
      <td className="num">{v.stops.length}</td>
      <td><button type="button" className="fleet-link-button" aria-pressed={selected === v.id} aria-controls="v73-place-detail" onClick={() => setSelected(c => (c === v.id ? null : v.id))}>{selected === v.id ? t("Close", "ปิด") : t("Details", "รายละเอียด")}</button>{onViewLocation ? <button type="button" className="fleet-link-button v78-view-location" data-view-location={v.id} onClick={() => onViewLocation(v.id)}>{t("View location", "ดูตำแหน่ง")}</button> : null}</td>
    </tr>
  );
  const qualityText = (q: Visit["sourceQuality"]) => (q === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : q === "mixed" ? t("partly verified", "ยืนยันบางส่วน") : t("not verified", "ไม่ยืนยัน"));
  const stayText = (v: Visit) => `${v.openStart || v.openEnd ? "≥ " : ""}${duration(language, v.observedMinutes)}`;

  return (
    <section className="v73-places v75-visits" aria-label={t("Visits and places", "การเข้าเยี่ยมและสถานที่")} data-day-places>
      <div className="v72-section-head"><h3>{t("Visits and places", "การเข้าเยี่ยมและสถานที่")}</h3><span className="v72-tag">{t("Saved directory · read only", "สมุดสถานที่ที่บันทึก · อ่านอย่างเดียว")}</span></div>
      <div role="status" aria-live="polite">
        {state === "loading" ? <p className="v72-hint">{t("Grouping stops and matching saved locations…", "กำลังจัดกลุ่มจุดจอดและจับคู่สถานที่…")}</p> : null}
        {state === "forbidden" ? <p className="v72-empty-line" data-places-forbidden>{t("Named visits use historical journeys and need administrator authorisation.", "การเข้าเยี่ยมที่มีชื่อใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p> : null}
        {state === "failed" ? <p className="v72-empty-line" role="alert">{t("Visits could not be built right now. The journey data above is unaffected.", "สร้างการเข้าเยี่ยมไม่ได้ในขณะนี้ ข้อมูลเที่ยวด้านบนไม่ได้รับผลกระทบ")}</p> : null}
      </div>
      {data && !data.read ? <p className="v72-empty-line">{t("The server no longer holds this day (it is kept for about 30 minutes). Press Read again to rebuild its visits.", "เซิร์ฟเวอร์ไม่ได้เก็บข้อมูลวันนี้แล้ว (เก็บประมาณ 30 นาที) กดอ่านอีกครั้งเพื่อสร้างการเข้าเยี่ยมใหม่")}</p> : null}
      {driver ? <p className="v73-driver" data-driver-attribution={data?.driver.status}><b>{t("Driver", "คนขับ")}:</b> {driver.title}<small>{driver.note}</small></p> : null}
      {data?.read ? (
        <>
          <p className="v72-sample" data-places-summary><b>{visits.length} {t("visits", "การเข้าเยี่ยม")}</b> · {named} {t("likely known", "น่าจะรู้จัก")} · {possible} {t("possible or ambiguous", "อาจตรง/ไม่ชัดเจน")} · {unknown} {t("unknown", "ไม่ทราบ")}{data.driveBys.length ? ` · ${data.driveBys.length} ${t("drive-bys", "การผ่าน")}` : ""}
            <span> · {t(`from ${data.counts.gpsStops} GPS stops; matched against ${data.directory.usable} of ${data.directory.total} saved locations (Forth saved points, not office-verified)`, `จาก ${data.counts.gpsStops} จุดจอด GPS จับคู่กับ ${data.directory.usable} จาก ${data.directory.total} สถานที่ที่บันทึก (จุดที่บันทึกใน Forth ยังไม่ยืนยันโดยสำนักงาน)`)}</span></p>
          <details className="v72-evidence v75-reconcile" data-stop-reconciliation>
            <summary>{t("How the stop counts fit together", "จำนวนจุดจอดแต่ละแหล่งสอดคล้องกันอย่างไร")}</summary>
            <div className="v72-table-wrap"><table className="v72-table">
              <thead><tr><th scope="col">{t("Count", "รายการ")}</th><th scope="col" className="num">{t("Number", "จำนวน")}</th><th scope="col">{t("What it is", "คืออะไร")}</th></tr></thead>
              <tbody>
                <tr><th scope="row">{t("Forth report stop entries", "รายการจุดจอดในรายงาน Forth")}</th><td className="num">{providerStops ? providerStops.total : "—"}</td><td>{providerStops ? t(`${providerStops.zeroDuration} have zero duration. These are the provider's own parking entries: a different source, kept as supplied.`, `${providerStops.zeroDuration} รายการมีระยะเวลาเป็นศูนย์ เป็นรายการจอดของผู้ให้บริการเอง เป็นคนละแหล่งข้อมูล เก็บตามที่ได้รับ`) : t("Report not available for this day.", "ไม่มีรายงานของวันนี้")}</td></tr>
                <tr><th scope="row">{t("GPS-observed stops", "จุดจอดที่สังเกตจาก GPS")}</th><td className="num">{data.counts.gpsStops}</td><td>{t("Slow, compact runs of positions found by the stop detector (a stop ends when positions drift over 75 m from where it began). A truck parked in one lot can show as many stops.", "ช่วงตำแหน่งที่ช้าและอยู่ใกล้กันที่ตัวตรวจจับพบ (จุดจอดสิ้นสุดเมื่อตำแหน่งห่างจากจุดเริ่มเกิน 75 ม.) รถที่จอดในลานเดียวอาจแสดงเป็นหลายจุดจอด")}</td></tr>
                <tr><th scope="row">{t("Visits (grouped)", "การเข้าเยี่ยม (จัดกลุ่มแล้ว)")}</th><td className="num">{data.counts.visits + data.counts.driveBys}</td><td>{t(`Stops joined only with evidence: same place, a short break with continuous tracking, no trip away. ${data.counts.splitsKept} neighbouring pairs were kept apart.`, `จุดจอดที่รวมกันเมื่อมีหลักฐานเท่านั้น ที่เดียวกัน หยุดพักสั้น ติดตามต่อเนื่อง ไม่ได้ออกไปไกล ${data.counts.splitsKept} คู่ที่ติดกันถูกแยกไว้`)}</td></tr>
                <tr><th scope="row">{t("of which drive-bys", "ในนั้นเป็นการผ่าน")}</th><td className="num">{data.counts.driveBys}</td><td>{t("Under 5 minutes in total: passing by, not a visit.", "รวมน้อยกว่า 5 นาที เป็นการผ่าน ไม่ใช่การเข้าเยี่ยม")}</td></tr>
                <tr><th scope="row">{t("Visits next to a tracking gap", "การเข้าเยี่ยมที่ติดช่วงขาดข้อมูล")}</th><td className="num">{data.counts.gapAffectedVisits}</td><td>{t("Start or end not fully observed; the stay is a lower bound.", "ไม่ได้สังเกตการเริ่มหรือสิ้นสุดครบ เวลาจอดเป็นค่าต่ำสุด")}</td></tr>
                <tr><th scope="row">{t("Unknown stopping areas", "พื้นที่จอดที่ไม่ทราบ")}</th><td className="num">{data.counts.unknownVisits}</td><td>{t("No saved location within 250 m. Not given a company name.", "ไม่มีสถานที่ที่บันทึกในระยะ 250 ม. ไม่ตั้งชื่อบริษัทให้")}</td></tr>
              </tbody>
            </table></div>
            <p className="v72-hint">{t("Nothing is replaced: the provider entries and every GPS stop remain available below and in Advanced evidence.", "ไม่มีอะไรถูกแทนที่ รายการของผู้ให้บริการและทุกจุดจอด GPS ยังดูได้ด้านล่างและในหลักฐานขั้นสูง")}</p>
          </details>
          {visits.length === 0 ? <p className="v72-empty-line">{t("No visit was supported by this day's positions.", "ไม่มีการเข้าเยี่ยมที่ได้รับการสนับสนุนจากตำแหน่งของวันนี้")}</p> : (
            <>
              <div className="v75-view-controls" role="group" aria-label={t("Visit list options", "ตัวเลือกรายการเข้าเยี่ยม")}>
                <button type="button" className="fleet-link-button" aria-pressed={view === "time"} onClick={() => setView("time")}>{t("By time", "ตามเวลา")}</button>
                <button type="button" className="fleet-link-button" aria-pressed={view === "place"} onClick={() => setView("place")}>{t("By place (view only)", "ตามสถานที่ (มุมมองเท่านั้น)")}</button>
                {shortCount > 0 ? <button type="button" className="fleet-link-button" aria-pressed={showShort} onClick={() => setShowShort(v => !v)}>{showShort ? t(`Hide ${shortCount} short visits (under 10 min)`, `ซ่อน ${shortCount} การเข้าเยี่ยมสั้น (ไม่ถึง 10 นาที)`) : t(`Show ${shortCount} short visits (under 10 min)`, `แสดง ${shortCount} การเข้าเยี่ยมสั้น (ไม่ถึง 10 นาที)`)}</button> : null}
              </div>
              {view === "place" ? <p className="v72-hint" data-place-view-note>{t("Grouped by the saved place each visit is near, for reading only. Visits are not merged: each stays a separate visit with its own times.", "จัดกลุ่มตามสถานที่ที่บันทึกซึ่งแต่ละการเข้าเยี่ยมอยู่ใกล้ เพื่อการอ่านเท่านั้น ไม่ได้รวมการเข้าเยี่ยม แต่ละครั้งยังแยกกันและมีเวลาของตนเอง")}</p> : null}
              <div className="v72-table-wrap"><table className="v72-table v73-places-table">
                <caption className="sr-only">{data.registration} · {data.day}</caption>
                <thead><tr><th scope="col">{t("Observed", "ที่สังเกตได้")}</th><th scope="col">{t("Place", "สถานที่")}</th><th scope="col" className="num">{t("Stay", "จอด")}</th><th scope="col">{t("GPS", "GPS")}</th><th scope="col" className="num">{t("Stops", "จุดจอด")}</th><th scope="col"><span className="sr-only">{t("Details", "รายละเอียด")}</span></th></tr></thead>
                {(view === "place" ? placeGroups : [{ key: "all", title: null as string | null, items: shown }]).map(g => <tbody key={g.key}>
                  {g.title !== null ? <tr className="v75-group-row" data-place-group><th scope="colgroup" colSpan={6}>{g.title} · {g.items.length} {t("visits", "การเข้าเยี่ยม")} · {t("total observed stay", "เวลาจอดที่สังเกตได้รวม")} {duration(language, g.items.reduce((n, v) => n + v.observedMinutes, 0))}</th></tr> : null}
                  {g.items.map(v => { const label = visitLabel(v, language); return visitRow(v, label); })}
                </tbody>)}
              </table></div>
            </>
          )}
          {data.driveBys.length ? <details className="v72-evidence" data-drive-bys><summary>{t("Drive-by only", "ผ่านเท่านั้น")} · {data.driveBys.length}</summary><p className="v72-hint">{t("Under 5 minutes in total: treated as passing by, not as a visit, and not matched to a place. Kept as supplied.", "รวมน้อยกว่า 5 นาที ถือว่าผ่านไป ไม่ใช่การเข้าเยี่ยม และไม่จับคู่สถานที่ เก็บตามที่ได้รับ")}</p><div className="v72-table-wrap"><table className="v72-table"><thead><tr><th scope="col">{t("Observed", "ที่สังเกตได้")}</th><th scope="col" className="num">{t("Stationary (min)", "หยุดนิ่ง (นาที)")}</th><th scope="col">{t("GPS", "GPS")}</th></tr></thead><tbody>{data.driveBys.map((p, i) => <tr key={`${p.firstAt}-${i}`}><th scope="row">{clock(language, p.firstAt)} – {clock(language, p.lastAt)}</th><td className="num">{p.observedMinutes}</td><td>{qualityText(p.sourceQuality)}</td></tr>)}</tbody></table></div></details> : null}
          {detail ? (
            <aside id="v73-place-detail" className="v72-area-detail" aria-label={t("Visit detail", "รายละเอียดการเข้าเยี่ยม")} data-place-detail data-visit-detail={detail.id}>
              <div className="v72-detail-head"><div><h4>{visitLabel(detail, language).title}</h4><span className="v72-tag">{detail.id}</span><span className="v72-tag">{statusLabel(detail.match.status, language)}</span></div><button type="button" className="fleet-link-button" onClick={() => setSelected(null)}>{t("Close", "ปิด")}</button></div>
              <p className="v72-detail-line">{data.registration} · {data.day} · {clock(language, detail.firstAt)} – {clock(language, detail.lastAt)} · {qualityText(detail.sourceQuality)}</p>
              <h5>{t("Arrival, departure and stay (observed evidence)", "มาถึง ออก และเวลาจอด (หลักฐานที่สังเกตได้)")}</h5>
              <ul className="v72-plain-list">
                <li>{t("Arrival", "มาถึง")}: {detail.openStart ? t("unknown: the day's data begins inside this visit", "ไม่ทราบ ข้อมูลของวันเริ่มภายในการเข้าเยี่ยมนี้") : `${t("between", "ระหว่าง")} ${detail.arrivalWindow.earliest ? clock(language, detail.arrivalWindow.earliest) : "—"} ${t("and", "ถึง")} ${clock(language, detail.arrivalWindow.latest)}`}</li>
                <li>{t("Departure", "ออก")}: {detail.openEnd ? t("unknown: the day's data ends inside this visit", "ไม่ทราบ ข้อมูลของวันสิ้นสุดภายในการเข้าเยี่ยมนี้") : `${t("between", "ระหว่าง")} ${clock(language, detail.departureWindow.earliest)} ${t("and", "ถึง")} ${detail.departureWindow.latest ? clock(language, detail.departureWindow.latest) : "—"}`}</li>
                <li>{t("Observed stay", "จอดที่สังเกตได้")}: {stayText(detail)} {detail.openStart || detail.openEnd ? t("(lower bound only)", "(ค่าต่ำสุดเท่านั้น)") : detail.maxMinutes !== null ? `${t("up to", "สูงสุด")} ${duration(language, detail.maxMinutes)}` : ""}{detail.spanMinutes > detail.observedMinutes ? ` · ${t("first to last observation", "จากการสังเกตแรกถึงสุดท้าย")} ${duration(language, detail.spanMinutes)}` : ""}</li>
              </ul>
              <p className="v72-hint">{t("Observed windows, not exact times: they lie between recorded positions. Tracking gaps are never counted as time at the site.", "ช่วงที่สังเกตได้ ไม่ใช่เวลาที่แน่นอน อยู่ระหว่างตำแหน่งที่บันทึก ช่วงที่ขาดข้อมูลไม่นับเป็นเวลาที่อยู่ในสถานที่")}</p>
              <h5>{t("Original GPS stops", "จุดจอด GPS เดิม")} · {detail.stops.length}</h5>
              <div className="v72-table-wrap"><table className="v72-table" data-visit-stops>
                <thead><tr><th scope="col">{t("Stop", "จุดจอด")}</th><th scope="col">{t("Observed", "ที่สังเกตได้")}</th><th scope="col" className="num">{t("Min", "นาที")}</th><th scope="col">{t("GPS", "GPS")}</th><th scope="col">{t("Matched alone to", "จับคู่เมื่อแยกเดี่ยวกับ")}</th></tr></thead>
                <tbody>{detail.stops.map(s => <tr key={s.id}><th scope="row">{s.id}</th><td>{clock(language, s.firstAt)} – {clock(language, s.lastAt)}</td><td className="num">{s.observedMinutes}</td><td>{qualityText(s.sourceQuality)}</td><td>{s.matchName ?? statusLabel(s.matchStatus, language)}</td></tr>)}</tbody>
              </table></div>
              {detail.stopLevelNames.length ? <p className="v72-detail-line" data-label-differences>{t("Taken alone, some stops matched a different name:", "เมื่อแยกเดี่ยว บางจุดจอดจับคู่กับชื่ออื่น")} {detail.stopLevelNames.join(" · ")}. {t("The label above uses the whole visit's evidence.", "ป้ายด้านบนใช้หลักฐานของการเข้าเยี่ยมทั้งหมด")}</p> : null}
              <h5>{t("Why these stops were grouped", "ทำไมจึงจัดจุดจอดเหล่านี้เป็นกลุ่มเดียว")}</h5>
              {detail.joins.length === 0 ? <p className="v72-hint">{t("A single stop: nothing was grouped.", "จุดจอดเดียว ไม่มีการจัดกลุ่ม")}</p> : <div className="v72-table-wrap"><table className="v72-table" data-visit-joins>
                <thead><tr><th scope="col">{t("Joined", "เชื่อม")}</th><th scope="col" className="num">{t("Break (min)", "หยุดพัก (นาที)")}</th><th scope="col" className="num">{t("Apart (m)", "ห่างกัน (ม.)")}</th><th scope="col" className="num">{t("Positions between", "ตำแหน่งระหว่างกลาง")}</th><th scope="col" className="num">{t("Farthest away (m)", "ไกลสุด (ม.)")}</th><th scope="col" className="num">{t("Largest spacing (min)", "ช่วงห่างสูงสุด (นาที)")}</th></tr></thead>
                <tbody>{detail.joins.map(j => <tr key={`${j.fromStopId}-${j.toStopId}`}><th scope="row">{j.fromStopId} → {j.toStopId}</th><td className="num">{j.interruptionMinutes}</td><td className="num">{j.separationM}</td><td className="num">{j.observationsBetween}</td><td className="num">{j.farthestBetweenM}</td><td className="num">{j.largestSpacingMinutes}{j.missingReport ? <small>{t("a report was missing: this time is unobserved and not counted as stay", "ขาดรายงานหนึ่งครั้ง เวลานี้ไม่ได้สังเกตและไม่นับเป็นเวลาจอด")}</small> : null}</td></tr>)}</tbody>
              </table></div>}
              {data.splits.some(s => detail.stops.some(x => x.id === s.fromStopId || x.id === s.toStopId)) ? <><h5>{t("Kept apart from neighbouring stops", "แยกจากจุดจอดที่อยู่ติดกัน")}</h5><ul className="v72-plain-list">{data.splits.filter(s => detail.stops.some(x => x.id === s.fromStopId || x.id === s.toStopId)).map(s => <li key={`${s.fromStopId}-${s.toStopId}`}>{s.fromStopId} / {s.toStopId}: {splitReasonLabel(s.reason, language)} <small>({t(`break ${s.interruptionMinutes} min · ${s.observationsBetween} positions between · largest spacing between positions ${s.largestSpacingMinutes} min · ${s.separationM} m apart`, `หยุด ${s.interruptionMinutes} นาที · ${s.observationsBetween} ตำแหน่งระหว่างกลาง · ช่วงห่างระหว่างตำแหน่งสูงสุด ${s.largestSpacingMinutes} นาที · ห่าง ${s.separationM} ม.`)})</small></li>)}</ul></> : null}
              <h5>{t("Place match", "การจับคู่สถานที่")}</h5>
              {detail.match.primary ? <p className="v72-detail-line"><b>{candidateName(detail.match.primary, language)}</b> · {detail.match.primary.distanceM} m {t("from its saved point", "จากจุดที่บันทึก")} ({proximityLabel(detail.match.primary.proximity, language)}){detail.match.primary.forthDiameterRaw ? ` · ${t("Forth diameter field", "ฟิลด์เส้นผ่านศูนย์กลางของ Forth")} ${detail.match.primary.forthDiameterRaw} (${t("unit unverified, not used as a boundary", "ยังไม่ยืนยันหน่วย ไม่ใช้เป็นขอบเขต")})` : ""}{detail.match.primary.groupLayer ? ` · ${t("group", "กลุ่ม")} ${detail.match.primary.groupLayer}` : ""}{detail.match.primary.entrances > 1 ? ` · ${detail.match.primary.entrances} ${t("saved entrances", "ทางเข้าที่บันทึก")}` : ""}</p> : <p className="v72-hint">{t("No saved location within 250 m.", "ไม่มีสถานที่ที่บันทึกในระยะ 250 ม.")}</p>}
              {detail.match.primary?.eesSuggestion ? <p className="v72-detail-line" data-ees-suggestion><b>{t("Possible EES directory record", "รายการในสมุดสถานที่ EES ที่อาจตรงกัน")}:</b> {detail.match.primary.eesSuggestion.eesName} · <small>{t("a name suggestion only: nothing is linked or saved, and the EES record has no coordinates.", "เป็นข้อเสนอจากชื่อเท่านั้น ไม่มีการเชื่อมหรือบันทึก และรายการ EES ไม่มีพิกัด")}</small></p> : null}
              {detail.match.alternatives.length ? <><h5>{t("Other nearby saved locations", "สถานที่อื่นที่บันทึกไว้ใกล้เคียง")}</h5><ul className="v72-plain-list">{detail.match.alternatives.map(a => <li key={a.name}>{candidateName(a, language)} · {a.distanceM} m</li>)}</ul></> : null}
              {detail.match.reasons.length ? <><h5>{t("Supporting evidence", "หลักฐานที่สนับสนุน")}</h5><ul className="v72-plain-list">{detail.match.reasons.map(r => <li key={r}>{reasonLabel(r, language)}</li>)}</ul></> : null}
              <h5>{t("Why this is not certain", "ทำไมจึงยังไม่แน่นอน")}</h5>
              <ul className="v72-plain-list">{detail.match.uncertainty.map(u => <li key={u}>{uncertaintyLabel(u, language)}</li>)}<li>{t("A visit is not proof of pickup, delivery, loading or unloading.", "การเข้าเยี่ยมไม่ใช่หลักฐานการรับ ส่ง ขึ้นหรือลงสินค้า")}</li></ul>
              <p className="v72-detail-actions">{onViewRoute ? <button type="button" className="btn-secondary min-h-11" onClick={onViewRoute}>{t("View route on map", "ดูเส้นทางบนแผนที่")}</button> : null} <Link href="/locations" className="btn-secondary min-h-11">{t("Open Locations Directory", "เปิดสมุดสถานที่")}</Link> <small>{t("Nothing is saved or changed here. Use Recurring places → Review location to open an unsaved candidate.", "ไม่มีการบันทึกหรือแก้ไขที่นี่ ใช้ จุดที่เกิดซ้ำ → ตรวจสอบสถานที่ เพื่อเปิดผู้สมัครที่ยังไม่บันทึก")}</small></p>
            </aside>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
