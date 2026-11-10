"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import { attachEesLeafletBasemap, eesLeafletAttributionHtml, eesLeafletMapInitOptions } from "@/lib/ees-map-tiles-leaflet";
import { mapMatchesRequest, mapText, type MapCandidate, type VisitMapData } from "@/lib/fleet-visit-map";
import { reasonLabel, statusLabel, uncertaintyLabel, type MatchReason, type MatchStatus, type MatchUncertainty } from "@/lib/fleet-location-match";

type Lang = "en" | "th";
export type MapVisitRef = { id: string; firstAt: string; lastAt: string; title: string; named: boolean };
type Ready = Extract<VisitMapData, { status: "ready" | "no_location_evidence" }>;

const clock = (language: Lang, iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—");
const dur = (language: Lang, m: number) => { const h = Math.floor(m / 60), r = m % 60; return h > 0 ? `${h} ${language === "th" ? "ชม." : "h"} ${r} ${language === "th" ? "นาที" : "min"}` : `${r} ${language === "th" ? "นาที" : "min"}`; };

/**
 * Historical visit inspector. It mounts only after the user presses "View location" and reads ONE visit through the authorised, cache-only
 * visit-map route. A late answer for another vehicle, day or visit is dropped. Three kinds of marker stay visually and textually distinct:
 * observed vehicle positions (circles), the Forth saved-point candidates (diamonds), and the visit's centre of observation (cross).
 */
export function FleetVisitMap({ language, vehicleId, registration, day, visits, visitId, onSelect, onClose, onOpenEvidence }: {
  language: Lang; vehicleId: string; registration: string; day: string; visits: readonly MapVisitRef[]; visitId: string;
  onSelect: (id: string) => void; onClose: () => void; onOpenEvidence?: (id: string) => void;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const index = visits.findIndex(v => v.id === visitId);
  const current = index >= 0 ? visits[index] : null;
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "failed" | "stale">("loading");
  const [data, setData] = useState<VisitMapData | null>(null);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Load exactly the requested visit; a response that no longer matches the request (vehicle, day, visit) is discarded.
  useEffect(() => {
    const want = { vehicleId, day, visitId };
    const controller = new AbortController(); setState("loading"); setData(null);
    const timeout = setTimeout(() => controller.abort(), 20000);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
        const response = await fetch(`/api/admin/forth-tracking/evidence/visit-map?${new URLSearchParams({ vehicleId, day, visit: visitId })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 403) { setState("forbidden"); return; }
        if (!response.ok) throw new Error("status");
        const body = await response.json() as VisitMapData;
        if (controller.signal.aborted) return;
        if (!mapMatchesRequest(body, want)) { setState("stale"); return; }
        setData(body); setState("ready");
      } catch { if (!controller.signal.aborted) setState("failed"); } finally { clearTimeout(timeout); }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [vehicleId, day, visitId]);

  // Map instance: created once while the inspector is open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await import("leaflet");
      const L = (loaded as unknown as { default?: typeof import("leaflet") }).default ?? loaded;
      if (cancelled || !mapNode.current) return;
      const instance = L.map(mapNode.current, { ...eesLeafletMapInitOptions(), zoomControl: true, maxZoom: 19 }).setView([13.742, 100.523], 12);
      instance.attributionControl?.setPrefix(false);
      instance.attributionControl?.addAttribution(eesLeafletAttributionHtml());
      await attachEesLeafletBasemap(L, instance);
      layer.current = L.layerGroup().addTo(instance); map.current = instance; leaflet.current = L; setMapReady(true);
    })().catch(() => { if (!cancelled) setMapError(true); });
    return () => { cancelled = true; map.current?.remove(); map.current = null; layer.current = null; leaflet.current = null; setMapReady(false); };
  }, []);

  const ready = data && (data.status === "ready" || data.status === "no_location_evidence") ? (data as Ready) : null;
  const sites: MapCandidate[] = ready?.candidates ?? [];

  // Draw only the evidence of the loaded visit.
  useEffect(() => {
    const L = leaflet.current, group = layer.current, instance = map.current;
    if (!mapReady || !L || !group || !instance) return;
    group.clearLayers();
    if (!ready || ready.status !== "ready" || !ready.centre) return;
    const pts: [number, number][] = [];
    for (const p of ready.positions) {
      const during = p.phase === "during";
      const colour = p.verified ? "#5b21b6" : "#c2410c";
      L.circleMarker([p.latitude, p.longitude], { radius: during ? 6 : 4, color: colour, weight: 2, fillColor: colour, fillOpacity: p.verified ? (during ? 0.9 : 0.4) : 0.15, dashArray: p.verified ? undefined : "3 3" })
        .bindTooltip(`${clock(language, p.at)} · ${p.verified ? mapText("verified", language) : mapText("unverified", language)} · ${during ? t("during the visit", "ระหว่างการเข้าเยี่ยม") : p.phase === "before" ? t("shortly before", "ก่อนหน้าเล็กน้อย") : t("shortly after", "หลังจากนั้นเล็กน้อย")}${p.speedKph !== null ? ` · ${Math.round(p.speedKph)} km/h` : ""}`).addTo(group);
      if (during) pts.push([p.latitude, p.longitude]); // context positions stay on the map but do not set the zoom
    }
    L.marker([ready.centre.latitude, ready.centre.longitude], { icon: L.divIcon({ className: "v78-pin v78-pin-centre", html: "<span>+</span>", iconSize: [26, 26], iconAnchor: [13, 13] }), keyboard: false })
      .bindTooltip(t("Centre of the observed positions (not a company location)", "ศูนย์กลางของตำแหน่งที่สังเกตได้ (ไม่ใช่ที่ตั้งบริษัท)")).addTo(group);
    pts.push([ready.centre.latitude, ready.centre.longitude]);
    for (const c of ready.candidates) {
      const cls = c.role === "primary" ? "v78-pin-primary" : c.role === "alternative" ? "v78-pin-alt" : "v78-pin-near";
      L.marker([c.latitude, c.longitude], { icon: L.divIcon({ className: `v78-pin ${cls}`, html: "<span></span>", iconSize: [18, 18], iconAnchor: [9, 9] }), keyboard: false })
        .bindTooltip(`${language === "th" && c.thaiName ? c.thaiName : c.name} · ${c.distanceM} m · ${t("Forth saved point, not office-verified", "จุดที่บันทึกใน Forth ยังไม่ยืนยันโดยสำนักงาน")}`).addTo(group);
      if (c.role !== "nearby" || c.distanceM <= 150) pts.push([c.latitude, c.longitude]);
    }
    instance.invalidateSize();
    instance.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
  }, [mapReady, ready, language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Escape closes, arrows step through visits. Focus starts on Close.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Focus starts on Close, Tab stays inside the dialog, and focus returns to the button that opened it.
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { const el = opener.current; if (el && document.contains(el)) el.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !overlayRef.current) return;
      const items = [...overlayRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, [tabindex]:not([tabindex='-1'])")].filter(x => !x.closest(".leaflet-control-container") || x.tagName === "A" || x.tagName === "BUTTON");
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const quality = ready ? (ready.visit.sourceQuality === "verified_gps" ? mapText("verified", language) : ready.visit.sourceQuality === "mixed" ? t("Partly verified GPS", "GPS ยืนยันบางส่วน") : mapText("unverified", language)) : "";
  const matchTitle = useMemo(() => {
    if (!ready) return "";
    const s = ready.match.status;
    if (s === "likely_directory_match" || s === "reviewed_site_boundary") return mapText("likely", language);
    if (s === "possible_directory_match") return mapText("possible", language);
    if (s === "multiple_nearby_locations") return mapText("multiple", language);
    return mapText("unknown", language);
  }, [ready, language]);

  return (
    <div ref={overlayRef} className="v78-map-overlay" role="dialog" aria-modal="true" aria-label={`${mapText("details", language)} · ${registration} · ${day}`} data-visit-map data-visit-map-vehicle={vehicleId} data-visit-map-day={day} data-visit-map-visit={visitId}>
      <div className="v78-map-shell">
        <header className="v78-map-head">
          <div><h3>{current ? current.title : visitId}</h3><p>{registration} · {day} · {current ? `${clock(language, current.firstAt)} – ${clock(language, current.lastAt)}` : ""}{visits.length ? ` · ${index + 1}/${visits.length}` : ""}</p></div>
          <div className="v78-map-nav" role="group" aria-label={t("Visit navigation", "เลือกการเข้าเยี่ยม")}>
            <button type="button" className="btn-secondary min-h-11" disabled={index <= 0} onClick={() => onSelect(visits[index - 1].id)}>← {mapText("prev", language)}</button>
            <button type="button" className="btn-secondary min-h-11" disabled={index < 0 || index >= visits.length - 1} onClick={() => onSelect(visits[index + 1].id)}>{mapText("next", language)} →</button>
            {onOpenEvidence ? <button type="button" className="btn-secondary min-h-11" onClick={() => onOpenEvidence(visitId)}>{mapText("evidence", language)}</button> : null}
            <button type="button" ref={closeRef} className="btn-primary min-h-11" onClick={onClose}>{mapText("close", language)}</button>
          </div>
        </header>
        <div className="v78-map-body">
          <div className="v78-map-stage">
            <div ref={mapNode} className="v78-map-canvas" aria-label={t("Historical visit map", "แผนที่การเข้าเยี่ยมย้อนหลัง")} />
            {mapError ? <p role="alert" className="v78-map-note">{t("The map could not load. The evidence is listed beside it.", "โหลดแผนที่ไม่ได้ หลักฐานแสดงอยู่ข้างๆ")}</p> : null}
            {state === "loading" ? <p className="v78-map-note" role="status">{t("Loading this visit’s evidence…", "กำลังโหลดหลักฐานของการเข้าเยี่ยมนี้…")}</p> : null}
            {state === "forbidden" ? <p className="v78-map-note" role="alert">{t("Visit maps use historical positions and need administrator authorisation.", "แผนที่การเข้าเยี่ยมใช้ตำแหน่งย้อนหลัง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p> : null}
            {state === "failed" || state === "stale" ? <p className="v78-map-note" role="alert">{t("This visit could not be loaded. Nothing is shown rather than a guess.", "โหลดการเข้าเยี่ยมนี้ไม่ได้ จึงไม่แสดงอะไรแทนการเดา")}</p> : null}
            {state === "ready" && data && (data.status === "day_not_held" || data.status === "visit_not_found") ? <p className="v78-map-note" role="status">{data.status === "day_not_held" ? t("The server no longer holds this day (kept about 30 minutes). Read the Forth report again, then reopen the map.", "เซิร์ฟเวอร์ไม่ได้เก็บข้อมูลวันนี้แล้ว (เก็บประมาณ 30 นาที) อ่านรายงาน Forth อีกครั้งแล้วเปิดแผนที่ใหม่") : t("This visit no longer exists in the refreshed day. Choose another visit.", "ไม่มีการเข้าเยี่ยมนี้แล้วในข้อมูลที่รีเฟรช เลือกการเข้าเยี่ยมอื่น")}</p> : null}
            {ready && ready.status === "no_location_evidence" ? <p className="v78-map-note" role="status" data-map-unavailable>{t("No usable location evidence for this visit, so no map position is shown.", "ไม่มีหลักฐานตำแหน่งที่ใช้ได้สำหรับการเข้าเยี่ยมนี้ จึงไม่แสดงตำแหน่งบนแผนที่")}</p> : null}
            <ul className="v78-legend" aria-label={t("Map key", "คำอธิบายแผนที่")}>
              <li><i className="v78-key v78-key-ok" />{t("Observed position · verified GPS", "ตำแหน่งที่สังเกตได้ · GPS ที่ยืนยัน")}</li>
              <li><i className="v78-key v78-key-un" />{t("Observed position · unverified (dashed)", "ตำแหน่งที่สังเกตได้ · ไม่ยืนยัน (เส้นประ)")}</li>
              <li><i className="v78-key v78-key-primary" />{t("Forth saved point · closest candidate", "จุดที่บันทึกใน Forth · ผู้สมัครที่ใกล้สุด")}</li>
              <li><i className="v78-key v78-key-alt" />{t("Forth saved point · alternative", "จุดที่บันทึกใน Forth · ทางเลือก")}</li>
              <li><i className="v78-key v78-key-near" />{t("Other nearby saved point", "จุดที่บันทึกอื่นใกล้เคียง")}</li>
            </ul>
          </div>
          <aside className="v78-map-side" aria-label={mapText("details", language)} aria-live="polite">
            {ready ? <>
              <h4>{matchTitle}{ready.match.primaryName ? ` · ${ready.match.primaryName}` : ""}</h4>
              <p className="v72-hint">{statusLabel(ready.match.status as MatchStatus, language)}. {sites.length ? t("Saved points come from Forth and are not office-verified. ", "จุดที่บันทึกมาจาก Forth ซึ่งสำนักงานยังไม่ยืนยัน ") : t("No saved point is near enough to name this place. ", "ไม่มีจุดที่บันทึกใกล้พอที่จะตั้งชื่อสถานที่นี้ ")}{t("A visit is not proof of pickup, delivery, loading or unloading.", "การเข้าเยี่ยมไม่ใช่หลักฐานการรับ ส่ง ขึ้นหรือลงสินค้า")}</p>
              <dl className="v78-facts">
                <div><dt>{mapText("window", language)}</dt><dd>{t("arrived", "มาถึง")} {ready.visit.openStart ? t("unknown (day data starts inside)", "ไม่ทราบ (ข้อมูลเริ่มระหว่างจอด)") : `${clock(language, ready.visit.arrival.earliest)}–${clock(language, ready.visit.arrival.latest)}`} · {t("left", "ออก")} {ready.visit.openEnd ? t("unknown (day data ends inside)", "ไม่ทราบ (ข้อมูลสิ้นสุดระหว่างจอด)") : `${clock(language, ready.visit.departure.earliest)}–${clock(language, ready.visit.departure.latest)}`}</dd></div>
                <div><dt>{t("Supported dwell", "เวลาจอดที่มีหลักฐาน")}</dt><dd>{ready.visit.openStart || ready.visit.openEnd ? "≥ " : ""}{dur(language, ready.visit.observedMinutes)}{ready.visit.maxMinutes !== null && !ready.visit.openStart && !ready.visit.openEnd ? ` · ${t("up to", "สูงสุด")} ${dur(language, ready.visit.maxMinutes)}` : ""}</dd></div>
                <div><dt>{t("GPS reliability", "ความน่าเชื่อถือของ GPS")}</dt><dd>{quality} · {ready.positionCounts.verifiedShown} {t("verified", "ยืนยัน")} / {ready.positionCounts.unverifiedShown} {t("unverified positions shown", "ตำแหน่งที่ไม่ยืนยันที่แสดง")}{ready.positionCounts.downsampled ? ` · ${t("thinned for display", "ลดจำนวนเพื่อการแสดงผล")} (${ready.positionCounts.shown}/${ready.positionCounts.total})` : ""}</dd></div>
                <div><dt>{t("Underlying stop observations", "จุดจอดที่เป็นฐาน")}</dt><dd>{ready.visit.stops} {t("GPS stops", "จุดจอด GPS")} · {ready.visit.observations} {t("positions", "ตำแหน่ง")}{ready.visit.spreadM >= 1 ? ` · ${t("stops spread over", "จุดจอดกระจายในรัศมี")} ${Math.round(ready.visit.spreadM)} m` : ""}</dd></div>
                <div><dt>{mapText("gap", language)}</dt><dd>{ready.visit.nextToGap ? t("Next to a tracking gap: the stay is a lower bound.", "ติดช่วงขาดข้อมูล เวลาจอดเป็นค่าต่ำสุด") : t("No tracking gap beside this visit.", "ไม่มีช่วงขาดข้อมูลติดกับการเข้าเยี่ยมนี้")}{ready.visit.interruptions ? ` · ${ready.visit.interruptions} ${t("short breaks bridged", "การหยุดสั้นที่เชื่อมไว้")}` : ""}{ready.visit.missingReports ? ` · ${ready.visit.missingReports} ${t("missing report(s), unobserved time not counted", "รายงานที่ขาด เวลาที่ไม่ได้สังเกตไม่นับ")}` : ""}</dd></div>
              </dl>
              <h5>{mapText("nearbySites", language)} · {sites.length}</h5>
              {sites.length === 0 ? <p className="v72-hint">{t("No saved point within 250 m. The visit is not given a company name.", "ไม่มีจุดที่บันทึกในระยะ 250 ม. จึงไม่ตั้งชื่อบริษัทให้การเข้าเยี่ยมนี้")}</p> : (
                <div className="v72-table-wrap"><table className="v72-table v78-candidates" data-map-candidates>
                  <thead><tr><th scope="col">{t("Saved point", "จุดที่บันทึก")}</th><th scope="col" className="num">{t("Distance", "ระยะ")}</th><th scope="col">{t("Role", "บทบาท")}</th></tr></thead>
                  <tbody>{sites.map(c => <tr key={c.id} data-candidate-role={c.role}><th scope="row">{language === "th" && c.thaiName ? c.thaiName : c.name}<small>{c.source === "office_confirmed_pin" ? t("Office-confirmed pin", "หมุดที่สำนักงานยืนยัน") : t("Forth saved point · not office-verified", "จุดที่บันทึกใน Forth · ยังไม่ยืนยัน")}</small></th><td className="num">{c.distanceM} m</td><td>{c.role === "primary" ? t("Closest candidate", "ผู้สมัครที่ใกล้สุด") : c.role === "alternative" ? t("Alternative", "ทางเลือก") : t("Nearby", "ใกล้เคียง")}</td></tr>)}</tbody>
                </table></div>
              )}
              <h5>{t("Why this match", "ทำไมจึงจับคู่แบบนี้")}</h5>
              <ul className="v72-plain-list">
                {ready.match.reasons.map(r => <li key={r}>{reasonLabel(r as MatchReason, language)}</li>)}
                {ready.match.uncertainty.map(u => <li key={u}>{uncertaintyLabel(u as MatchUncertainty, language)}</li>)}
                <li>{t("The Forth diameter field is shown nowhere as a boundary: its unit is not verified.", "ไม่ใช้ฟิลด์เส้นผ่านศูนย์กลางของ Forth เป็นขอบเขต เพราะยังไม่ยืนยันหน่วย")}</li>
              </ul>
            </> : state === "loading" ? null : <p className="v72-hint">{t("Evidence for this visit is not available.", "ไม่มีหลักฐานของการเข้าเยี่ยมนี้")}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
