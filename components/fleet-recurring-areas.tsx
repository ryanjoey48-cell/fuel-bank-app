"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { previousBangkokDay } from "@/lib/fleet-day-review";
import { candidateText } from "@/lib/fleet-location-candidate";
import { candidateName, matchLabel, proximityLabel, reasonLabel, statusLabel, uncertaintyLabel } from "@/lib/fleet-location-match";
import { describeArea, flagLabel, hintLabel, kindLabel, type MovementPattern, type RecurringArea, type RecurringAnalysis } from "@/lib/fleet-recurring-areas";

type Lang = "en" | "th";
type Response = {
  range: { from: string; to: string }; vehiclesConsidered: number; vehicleDaysInRange: number; vehicleDaysIncluded: number;
  included: { registration: string; days: string[] }[]; directory: { forthSavedLocations: number | null; officeConfirmedPins: number | null };
  analysis: RecurringAnalysis; note: string;
  driverCoverage?: { vehicleDays: number; confirmed: number; supporting: number; conflicting: number; unknown: number; sourceRead: boolean };
};
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const MAX_SHOWN = 8;

/**
 * Recurring places for reviewed vehicle-days. Opening it reads only vehicle-days already in this user's server memory: it never
 * contacts Forth. Coordinates are shown only here, only to authorised callers (the server decides), rounded and never saved.
 */
export function FleetRecurringAreas({ language, vehicleId = null, onOpenDay }: { language: Lang; vehicleId?: string | null; onOpenDay?: (registration: string, day: string) => void }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const [to, setTo] = useState(() => previousBangkokDay());
  const [span, setSpan] = useState(14);
  const [data, setData] = useState<Response | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "failed">("loading");
  const [showAll, setShowAll] = useState(false);
  const [showRoadside, setShowRoadside] = useState(false);
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);
  // V7.2: one focused detail panel at a time instead of one expanding card per area.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On narrow screens the detail opens below the table, so bring it into view when a row is chosen.
  useEffect(() => {
    if (selectedId && typeof window !== "undefined" && window.matchMedia?.("(max-width: 1099px)").matches) document.getElementById("v72-area-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);
  const [reviewError, setReviewError] = useState<{ id: string; message: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const from = shiftDay(to, -(span - 1));

  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; const id = ++generation.current;
    setState("loading");
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
      const query = new URLSearchParams({ from: shiftDay(to, -(span - 1)), to, ...(vehicleId ? { vehicleId } : {}) });
      const response = await fetch(`/api/admin/forth-tracking/evidence/recurring?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
      if (id !== generation.current) return;
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("status");
      setData(await response.json() as Response); setState("ready");
    } catch { if (id === generation.current && !controller.signal.aborted) setState("failed"); } finally { clearTimeout(timeout); }
  }, [to, span, vehicleId]);
  // Cache-only: safe to run on open and whenever the range changes.
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { request.current?.abort(); }, []);

  const lang = language === "th" ? 1 : 0;
  const sample = data?.analysis.sample;
  const allAreas = data?.analysis.areas ?? [];
  const roadsideCount = allAreas.filter(a => a.flags.includes("short_stays_only_possible_roadside")).length;
  const areas = showRoadside ? allAreas : allAreas.filter(a => !a.flags.includes("short_stays_only_possible_roadside")); const shown = showAll ? areas : areas.slice(0, MAX_SHOWN);
  const patternText = (p: MovementPattern) => p.kind === "return_to_area"
    ? t(`Returned to ${p.from} later the same day on ${p.days} days (${p.vehicles} vehicle${p.vehicles === 1 ? "" : "s"})`, `กลับมาที่ ${p.from} ในวันเดียวกัน ${p.days} วัน (${p.vehicles} คัน)`)
    : t(`${p.from} then ${p.to} on ${p.days} days (${p.vehicles} vehicle${p.vehicles === 1 ? "" : "s"})`, `${p.from} แล้วไป ${p.to} ใน ${p.days} วัน (${p.vehicles} คัน)`);
  // Creates a short-lived, server-held candidate and opens the Locations Directory with only an opaque token in the URL.
  async function reviewLocation(area: RecurringArea) {
    if (opening) return;
    setOpening(area.id); setReviewError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
      const response = await fetch("/api/admin/forth-tracking/evidence/recurring/candidate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ action: "create", from, to, areaId: area.id, vehicleId, expected: { latitude: area.centroid.latitude, longitude: area.centroid.longitude } }) });
      if (response.status === 201) { const result = await response.json() as { token: string }; router.push(`/locations?candidate=${encodeURIComponent(result.token)}`); return; }
      const message = response.status === 403 ? candidateText("forbidden", language) : response.status === 410 ? candidateText("expired", language) : response.status === 409 ? t("The list changed. It was refreshed; choose the area again.", "รายการเปลี่ยนไป โหลดใหม่แล้ว โปรดเลือกจุดอีกครั้ง") : candidateText("failed", language);
      setReviewError({ id: area.id, message }); if (response.status === 409) void load();
    } catch { setReviewError({ id: area.id, message: candidateText("failed", language) }); } finally { setOpening(null); }
  }
  const coords = (a: RecurringArea) => `${a.centroid.latitude.toFixed(4)}, ${a.centroid.longitude.toFixed(4)}`;

  // V7.3 fleet-level location summary (Reports). Counts come from the same reviewed days; nothing here extends beyond them.
  const groupOf = (a: RecurringArea) => { const s = a.siteMatch?.status; return s === "likely_directory_match" || s === "reviewed_site_boundary" ? "named" : s === "possible_directory_match" || s === "multiple_nearby_locations" ? "possible" : "unknown"; };
  const namedAreas = allAreas.filter(a => groupOf(a) === "named" && a.distinctDays >= 2).sort((x, y) => y.distinctDays - x.distinctDays || y.visits - x.visits).slice(0, 3);
  const unknownRecurring = allAreas.filter(a => groupOf(a) === "unknown" && a.distinctDays >= 2 && !a.flags.includes("short_stays_only_possible_roadside")).length;
  const gapAreas = allAreas.filter(a => a.flags.includes("next_to_tracking_gap")).length;
  const selected = shown.find(a => a.id === selectedId) ?? areas.find(a => a.id === selectedId) ?? null;
  const sourceText = (q: string) => q === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : q === "mixed" ? t("partly verified", "ยืนยันบางส่วน") : t("not verified", "ไม่ยืนยัน");
  const areaSubtitle = (a: RecurringArea) => { const label = matchLabel(a.siteMatch, language, a.id); const trace = `${a.id} · ${a.distinctDays} ${t(a.distinctDays === 1 ? "reviewed day" : "reviewed days", "วันที่ตรวจสอบ")}`; return label.secondary && label.secondary !== a.id ? `${label.secondary} · ${trace}` : trace; };
  const qualityText = (a: RecurringArea) => a.quality.verified === a.visits ? t("All verified", "ยืนยันทั้งหมด") : a.quality.verified === 0 ? t("None verified", "ไม่ยืนยันเลย") : t("Partly verified", "ยืนยันบางส่วน");

  return <section className="fleet-evidence fleet-recurring v72-recurring" aria-label={t("Recurring places", "จุดที่เกิดซ้ำ")} data-recurring-areas data-scope={vehicleId ? "vehicle" : "fleet"}>
    <div className="v72-section-head">
      <h3>{vehicleId ? t("Recurring places for this vehicle", "จุดที่รถคันนี้ไปซ้ำ") : t("Recurring places and movement patterns", "จุดที่เกิดซ้ำและรูปแบบการเดินทาง")}</h3>
      <span className="v72-tag">{t("EES · read only · reviewed days only", "EES · อ่านอย่างเดียว · เฉพาะวันที่ตรวจสอบ")}</span>
    </div>
    <div className="fleet-review-controls v72-inline-controls">
      <label>{t("Last day", "วันสุดท้าย")}<input type="date" value={to} max={previousBangkokDay()} onChange={event => { if (event.target.value) setTo(event.target.value); }} /></label>
      <label>{t("Days", "จำนวนวัน")}<select value={span} onChange={event => setSpan(Number(event.target.value))}><option value={7}>7</option><option value={14}>14</option><option value={31}>31</option></select></label>
    </div>
    <details className="v72-hint-details"><summary>{t("About this view", "เกี่ยวกับมุมมองนี้")}</summary><p className="fleet-evidence-note">{t("Uses only vehicle-days you have already read in this session (up to 30 minutes). Nothing is requested from Forth and nothing is saved. Repeat evidence counts distinct days, not visits.", "ใช้เฉพาะข้อมูลรายวันที่คุณอ่านไว้แล้วในเซสชันนี้ (สูงสุด 30 นาที) ไม่ขอข้อมูลจาก Forth และไม่บันทึกอะไร หลักฐานการเกิดซ้ำนับเป็นจำนวนวันที่แตกต่างกัน ไม่ใช่จำนวนครั้ง")}</p></details>
    <div role="status" aria-live="polite">
      {state === "loading" && !data ? <p>{t("Loading…", "กำลังโหลด…")}</p> : null}
      {state === "forbidden" ? <p role="note" data-recurring-forbidden>{t("Recurring places are built from historical journeys and need administrator authorisation.", "จุดที่เกิดซ้ำสร้างจากประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p> : null}
      {state === "failed" ? <p role="alert">{t("Could not load recurring places. Check access and connection, then retry.", "โหลดจุดที่เกิดซ้ำไม่ได้ โปรดตรวจสอบสิทธิ์และการเชื่อมต่อแล้วลองใหม่")} <button type="button" className="fleet-link-button" onClick={() => void load()}>{t("Retry", "ลองใหม่")}</button></p> : null}
    </div>
    {state === "ready" && data && sample ? <>
      <p className="v72-sample" data-sample role="status"><b>{t(`Included: ${data.vehicleDaysIncluded} of ${data.vehicleDaysInRange} vehicle-days`, `รวม ${data.vehicleDaysIncluded} จาก ${data.vehicleDaysInRange} วันของรถ`)}</b> · {t(`${sample.vehicles} vehicle${sample.vehicles === 1 ? "" : "s"}, ${sample.days} day${sample.days === 1 ? "" : "s"}. Days not read are not represented, so this is not a fleet-wide picture.`, `${sample.vehicles} คัน ${sample.days} วัน วันที่ยังไม่ได้อ่านไม่ถูกรวม จึงไม่ใช่ภาพรวมทั้งกองรถ`)}</p>
      {data.vehicleDaysIncluded === 0 ? <p className="v72-empty-line" data-recurring-empty>{t("No vehicle-days have been read in this range. Read days from the daily review first; this panel never reads Forth itself.", "ยังไม่ได้อ่านข้อมูลรายวันในช่วงนี้ โปรดอ่านจากหน้าตรวจสอบรายวันก่อน หน้านี้ไม่อ่าน Forth เอง")}</p>
        : areas.length === 0 ? <p className="v72-empty-line" data-recurring-none>{t("No stopping areas were found in the included days.", "ไม่พบจุดจอดในวันที่รวม")}</p> : null}
      {!vehicleId && allAreas.length ? <section className="v73-fleet-places" data-fleet-places>
        <dl className="v72-strip">
          <div><dt>{t("Stopping areas found", "พื้นที่จอดที่พบ")}</dt><dd><b>{allAreas.length}</b><small>{t("in the reviewed days", "ในวันที่ตรวจสอบ")}</small></dd></div>
          <div><dt>{t("Likely known locations", "น่าจะเป็นสถานที่ที่รู้จัก")}</dt><dd><b>{allAreas.filter(a => groupOf(a) === "named").length}</b><small>{t("Forth saved points, not office-verified", "จุดที่บันทึกใน Forth ยังไม่ยืนยัน")}</small></dd></div>
          <div><dt>{t("Possible or ambiguous", "อาจตรง/ไม่ชัดเจน")}</dt><dd><b>{allAreas.filter(a => groupOf(a) === "possible").length}</b><small>{allAreas.filter(a => a.siteMatch?.status === "multiple_nearby_locations").length} {t("with several nearby companies", "มีหลายบริษัทใกล้เคียง")}</small></dd></div>
          <div className={unknownRecurring > 0 ? "is-attention" : ""}><dt>{t("Recurring unknown places", "จุดที่ไปซ้ำแต่ไม่ทราบ")}</dt><dd><b>{unknownRecurring}</b><small>{t("2+ days, no saved location", "2 วันขึ้นไป ไม่มีสถานที่ที่บันทึก")}</small></dd></div>
          <div><dt>{t("Next to tracking gaps", "ติดช่วงที่ขาดข้อมูล")}</dt><dd><b>{gapAreas}</b><small>{t("areas", "พื้นที่")}</small></dd></div>
          <div className={(data.driverCoverage?.conflicting ?? 0) > 0 ? "is-attention" : ""}><dt>{t("Driver evidence", "หลักฐานผู้ขับ")}</dt><dd><b>{data.driverCoverage ? `${data.driverCoverage.supporting}/${data.driverCoverage.vehicleDays}` : "—"}</b><small>{data.driverCoverage ? t(`supporting · ${data.driverCoverage.confirmed} confirmed · ${data.driverCoverage.conflicting} conflicting · ${data.driverCoverage.unknown} unknown`, `หลักฐานประกอบ · ยืนยัน ${data.driverCoverage.confirmed} · ขัดแย้ง ${data.driverCoverage.conflicting} · ไม่ทราบ ${data.driverCoverage.unknown}`) : t("not available", "ไม่มีข้อมูล")}</small></dd></div>
        </dl>
        {namedAreas.length ? <p className="v72-detail-line" data-frequent-known><b>{t("Most repeated known locations", "สถานที่ที่รู้จักที่ไปซ้ำมากที่สุด")}:</b> {namedAreas.map(a => `${matchLabel(a.siteMatch, language, a.id).title} (${a.distinctDays} ${t("days", "วัน")}, ${a.vehicles.length} ${t("vehicles", "คัน")})`).join(" · ")}</p> : null}
      </section> : null}
      {data.analysis.limits.length ? <details className="v72-hint-details" data-limits><summary>{t("Limits of this analysis", "ข้อจำกัดของการวิเคราะห์")} · {data.analysis.limits.length}</summary><ul className="fleet-evidence-list">{data.analysis.limits.map(l => <li key={l}><small>{l}</small></li>)}</ul></details> : null}
      {areas.length ? <div className={`v72-recurring-grid${selected ? " has-detail" : ""}`}>
        <div className="v72-areas-pane">
          <p className="v72-hint">{t(`Showing ${shown.length} of ${areas.length} areas, most repeated first. Select a row for its evidence.`, `แสดง ${shown.length} จาก ${areas.length} จุด เรียงตามที่เกิดซ้ำมากสุด เลือกแถวเพื่อดูหลักฐาน`)}</p>
          <div className="v72-table-wrap"><table className="v72-table v72-areas-table">
            <thead><tr><th scope="col">{t("Area", "จุด")}</th><th scope="col" className="num">{t("Days", "วัน")}</th><th scope="col" className="num">{t("Visits", "ครั้ง")}</th><th scope="col" className="num">{t("Vehicles", "คัน")}</th><th scope="col" className="num">{t("Typical stay", "จอดปกติ")}</th><th scope="col">{t("GPS quality", "คุณภาพ GPS")}</th><th scope="col"><span className="sr-only">{t("Review", "ตรวจสอบ")}</span></th></tr></thead>
            <tbody>{shown.map(a => <tr key={a.id} data-area={a.id} data-kind={a.kind} className={selected?.id === a.id ? "is-active" : ""}>
              <th scope="row"><button type="button" aria-pressed={selected?.id === a.id} aria-controls="v72-area-detail" onClick={() => setSelectedId(current => current === a.id ? null : a.id)}><b className={a.siteMatch && matchLabel(a.siteMatch, language, a.id).named ? "v73-name" : "v73-name is-uncertain"}>{matchLabel(a.siteMatch, language, a.id).title}</b><small>{areaSubtitle(a)}</small></button></th>
              <td className="num">{a.distinctDays}</td><td className="num">{a.visits}</td><td className="num">{a.vehicles.length}</td>
              <td className="num">{a.stayMinutes.median} {t("min", "นาที")}</td>
              <td><span className={`v72-quality is-${a.quality.verified === a.visits ? "ok" : a.quality.verified === 0 ? "none" : "mixed"}`}>{qualityText(a)}</span><small>{a.quality.verified}/{a.visits}</small></td>
              <td><button type="button" className="fleet-link-button" aria-expanded={selected?.id === a.id} aria-controls="v72-area-detail" onClick={() => setSelectedId(current => current === a.id ? null : a.id)}>{selected?.id === a.id ? t("Close", "ปิด") : t("Details", "รายละเอียด")}</button></td>
            </tr>)}</tbody>
          </table></div>
          {roadsideCount > 0 ? <p className="v72-hint" data-roadside-note>{showRoadside ? t(`Showing ${roadsideCount} short-stop spot${roadsideCount === 1 ? "" : "s"} (every stay under 10 minutes: possibly traffic, a junction or a roadside stop).`, `แสดงจุดจอดสั้น ${roadsideCount} จุด (ทุกครั้งต่ำกว่า 10 นาที อาจเป็นการจราจร สี่แยก หรือจอดข้างทาง)`) : t(`${roadsideCount} short-stop spot${roadsideCount === 1 ? " is" : "s are"} hidden (every stay under 10 minutes: possibly traffic, a junction or a roadside stop).`, `ซ่อนจุดจอดสั้น ${roadsideCount} จุด (ทุกครั้งต่ำกว่า 10 นาที อาจเป็นการจราจร สี่แยก หรือจอดข้างทาง)`)} <button type="button" className="fleet-link-button" onClick={() => setShowRoadside(v => !v)}>{showRoadside ? t("Hide them", "ซ่อน") : t("Show them", "แสดง")}</button></p> : null}
          {areas.length > MAX_SHOWN ? <button type="button" className="btn-secondary" onClick={() => setShowAll(v => !v)}>{showAll ? t("Show fewer", "แสดงน้อยลง") : t(`Show all ${areas.length}`, `แสดงทั้งหมด ${areas.length}`)}</button> : null}
        </div>
        {selected ? <aside id="v72-area-detail" className="v72-area-detail" aria-label={`${t("Area detail", "รายละเอียดจุด")} ${selected.id}`} data-area-detail={selected.id}>
          <div className="v72-detail-head"><div><h4>{matchLabel(selected.siteMatch, language, selected.id).title}</h4><span className="v72-tag">{selected.id}</span><span className="v72-tag">{kindLabel(selected.kind, language)}</span></div><button type="button" className="fleet-link-button" onClick={() => setSelectedId(null)}>{t("Close", "ปิด")}</button></div>
          <p className="v72-detail-line">{selected.distinctDays} {t("days", "วัน")} · {selected.visits} {t("visits", "ครั้ง")} · {selected.vehicles.length} {t("vehicles", "คัน")} · {t("typical stay", "จอดปกติ")} {selected.stayMinutes.median} {t("min", "นาที")} · {t("longest supported", "นานสุดที่รองรับ")} {selected.stayMinutes.longestSupported} {t("min", "นาที")}</p>
          <p className="v72-detail-line">{selected.quality.verified}/{selected.visits} {t("visits on verified GPS", "ครั้งที่เป็น GPS ที่ยืนยัน")} · {hintLabel(selected.placeHint, language)}</p>
          {selected.siteMatch ? <section className="v73-site-match" data-site-match={selected.siteMatch.status}>
            <h5>{t("Directory match", "การจับคู่สมุดสถานที่")} · {statusLabel(selected.siteMatch.status, language)}</h5>
            {selected.siteMatch.primary ? <p className="v72-detail-line"><b>{candidateName(selected.siteMatch.primary, language)}</b> · {selected.siteMatch.primary.distanceM} m {t("from its saved point", "จากจุดที่บันทึก")} ({proximityLabel(selected.siteMatch.primary.proximity, language)}){selected.siteMatch.primary.groupLayer ? ` · ${t("group", "กลุ่ม")} ${selected.siteMatch.primary.groupLayer}` : ""}{selected.siteMatch.primary.entrances > 1 ? ` · ${selected.siteMatch.primary.entrances} ${t("saved entrances", "ทางเข้าที่บันทึก")}` : ""}</p> : null}
            {selected.siteMatch.alternatives.length ? <p className="v72-detail-line">{t("Also nearby", "ใกล้เคียงอื่น")}: {selected.siteMatch.alternatives.map(x => `${candidateName(x, language)} (${x.distanceM} m)`).join(" · ")}</p> : null}
            {selected.siteMatch.reasons.length ? <ul className="v72-plain-list">{selected.siteMatch.reasons.map(r => <li key={r}>{reasonLabel(r, language)}</li>)}</ul> : null}
            <p className="v72-detail-line"><b>{t("Why this is not certain", "ทำไมจึงยังไม่แน่นอน")}</b></p>
            <ul className="v72-plain-list">{selected.siteMatch.uncertainty.map(u => <li key={u}>{uncertaintyLabel(u, language)}</li>)}</ul>
            <p className="v72-hint">{t("GPS quality and site-match confidence are separate: verified positions do not confirm which company was visited.", "คุณภาพ GPS กับความมั่นใจในการจับคู่สถานที่แยกกัน ตำแหน่งที่ยืนยันไม่ได้ยืนยันว่าเป็นบริษัทใด")}</p>
          </section> : null}
          <h5>{t("Supporting visits", "การเข้าจุดที่สนับสนุน")} · {selected.visitList.length}</h5>
          <div className="v72-table-wrap"><table className="v72-table" data-area-visits><thead><tr><th scope="col">{t("Vehicle", "รถ")}</th><th scope="col">{t("Day", "วัน")}</th><th scope="col" className="num">{t("Observed (min)", "สังเกตได้ (นาที)")}</th><th scope="col">{t("Source", "แหล่ง")}</th><th scope="col"><span className="sr-only">{t("Open", "เปิด")}</span></th></tr></thead>
            <tbody>{selected.visitList.map(v => <tr key={`${v.registration}${v.firstAt}`}><td>{v.registration}</td><td>{v.day}</td><td className="num">{v.stayMinutesObserved}</td><td>{sourceText(v.sourceQuality)}</td><td>{onOpenDay ? <button type="button" className="fleet-link-button" onClick={() => onOpenDay(v.registration, v.day)}>{t("Open this day", "เปิดวันนี้")}</button> : null}</td></tr>)}</tbody></table></div>
          {!selected.siteMatch && selected.matches.length ? <><h5>{t("Nearby directory points", "จุดในสมุดรายชื่อที่อยู่ใกล้")}</h5><ul className="v72-plain-list">{selected.matches.map(m => <li key={m.name}>{m.name} · {m.distanceM} m · <small>{m.source === "forth_saved_location" ? t("Forth saved, not office-verified", "บันทึกใน Forth ยังไม่ยืนยัน") : t("office-confirmed", "สำนักงานยืนยัน")}</small></li>)}</ul></> : null}
          <h5>{t("Limitations and alternative explanations", "ข้อจำกัดและคำอธิบายอื่นที่เป็นไปได้")}</h5>
          <ul className="v72-plain-list">{describeArea(selected, language).map(line => <li key={line}>{line}</li>)}{selected.flags.map(f => <li key={f} data-flag={f}>{flagLabel(f, language)}</li>)}</ul>
          <p className="v72-detail-line"><small>{t("Approximate centre (not saved)", "จุดศูนย์กลางโดยประมาณ (ไม่ได้บันทึก)")}: {coords(selected)} · ±{selected.radiusM} m</small> <button type="button" className="fleet-link-button" onClick={() => { void navigator.clipboard?.writeText(coords(selected)).catch(() => undefined); }}>{t("Copy", "คัดลอก")}</button></p>
          <p className="v72-detail-actions"><button type="button" className="btn-secondary min-h-11" data-review-location={selected.id} disabled={opening !== null} onClick={() => void reviewLocation(selected)} aria-label={`${candidateText("reviewLocation", language)} ${selected.id}`}>{opening === selected.id ? candidateText("opening", language) : candidateText("reviewLocation", language)}</button> <small>{candidateText("notSaved", language)}</small></p>
          {reviewError?.id === selected.id ? <p role="alert" data-review-error>{reviewError.message}</p> : null}
        </aside> : null}
      </div> : null}
      {data.analysis.patterns.length ? <section className="v72-patterns"><h4>{t("Repeated movement patterns", "รูปแบบการเดินทางที่เกิดซ้ำ")}</h4><ul className="v72-plain-list" data-patterns>{data.analysis.patterns.slice(0, 6).map(p => <li key={`${p.kind}${p.from}${p.to}`}>{patternText(p)}</li>)}</ul>
        <p className="v72-hint">{t("A repeated route is not a completed job, and the first or last stop of a day is not assumed to be a depot.", "เส้นทางที่ซ้ำไม่ใช่งานที่เสร็จสิ้น และจุดแรกหรือจุดสุดท้ายของวันไม่ถือว่าเป็นคลัง")}</p></section> : null}
    </> : null}
  </section>;
}
