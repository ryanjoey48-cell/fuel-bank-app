"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { originHeaders } from "@/lib/fleet-request-origin";
import type { LocationEvidence, LocationEvidenceStop } from "@/lib/fleet-location-evidence";
import { formatBangkokTime } from "@/lib/fleet-job-movement-view";

type Lang = "en" | "th";
type Vehicle = { id: string; vehicle_reg: string };
export type EvidenceMarker = { id: string; latitude: number; longitude: number; label: string };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

/**
 * STAGE B (read only). Shows stop evidence from ONE vehicle-day beside the pin editor. Nothing here is saved, proposed or verified:
 * the stops are candidates for a person to look at, the markers are grey and unsaved, and "use as candidate position" only fills
 * the editor's existing unsaved candidate; the editor's own source text and Save step still decide. Authorised callers only (server).
 */
export function LocationEvidencePanel({ language, locationName, anchor, focusId, onMarkers, onUseAsCandidate }: { language: Lang; locationName: string; focusId?: string | null; anchor: { latitude: number; longitude: number } | null; onMarkers: (markers: EvidenceMarker[]) => void; onUseAsCandidate: (point: { latitude: number; longitude: number }) => void }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [day, setDay] = useState(today());
  const [state, setState] = useState<"idle" | "reading" | "loading" | "not_read" | "ready" | "restricted" | "failed">("idle");
  const [evidence, setEvidence] = useState<LocationEvidence | null>(null);
  const [registration, setRegistration] = useState("");
  const [recorded, setRecorded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.from("vehicles").select("id,vehicle_reg").eq("active", true).order("vehicle_reg").then(result => { if (!cancelled && !result.error) setVehicles((result.data ?? []) as Vehicle[]); });
    return () => { cancelled = true; };
  }, []);
  // Switching site, vehicle or day drops the previous evidence and its markers: nothing lingers on the map.
  useEffect(() => { setEvidence(null); setState("idle"); onMarkers([]); }, [vehicleId, day, locationName, onMarkers]);

  const authHeaders = useCallback(async () => {
    const session = await supabase.auth.getSession();
    return session.data.session ? { Authorization: `Bearer ${session.data.session.access_token}` } : null;
  }, []);

  const readDay = useCallback(async () => {
    if (!vehicleId) return;
    const headers = await authHeaders(); if (!headers) { setState("failed"); return; }
    setState("reading");
    try {
      const response = await fetch(`/api/admin/forth-tracking/evidence/provider?${new URLSearchParams({ vehicleId, day })}`, { method: "POST", headers: { ...headers, ...originHeaders("locations_evidence_panel") }, cache: "no-store" });
      setState(response.ok ? "idle" : response.status === 403 ? "restricted" : "failed");
      if (response.ok) await showStops();
    } catch { setState("failed"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, day, authHeaders]);

  const showStops = useCallback(async () => {
    if (!vehicleId) return;
    const headers = await authHeaders(); if (!headers) { setState("failed"); return; }
    setState("loading");
    try {
      const response = await fetch("/api/admin/forth-tracking/evidence/location-stops", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ vehicleId, day, anchor }), cache: "no-store" });
      if (response.status === 403) { setState("restricted"); return; }
      const data = await response.json();
      if (!response.ok) { setState("failed"); return; }
      if (data.status === "day_not_read") { setState("not_read"); return; }
      setRegistration(data.registration ?? ""); setRecorded(typeof data.provider?.observations === "number" ? data.provider.observations : null); setEvidence(data.evidence as LocationEvidence); setState("ready");
      onMarkers((data.evidence as LocationEvidence).stops.map((s: LocationEvidenceStop, i: number) => ({ id: `${vehicleId}-${day}-${i}`, latitude: s.centroid.latitude, longitude: s.centroid.longitude, label: `${i + 1} · ${formatBangkokTime(s.firstAt, language) ?? ""}–${formatBangkokTime(s.lastAt, language) ?? ""} · ${t("candidate, not saved", "ตัวเลือก ไม่ได้บันทึก")}` })));
    } catch { setState("failed"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, day, anchor, authHeaders, onMarkers, language]);

  const quality = (s: LocationEvidenceStop) => s.sourceQuality === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : s.sourceQuality === "mixed" ? t("mixed quality", "คุณภาพผสม") : t("unverified positions", "ตำแหน่งที่ยังไม่ยืนยัน");
  const note = (n: LocationEvidenceStop["notes"][number]) => ({
    outside_the_150m_matching_radius: t("outside the 150 m matching radius", "อยู่นอกรัศมีจับคู่ 150 ม."),
    next_to_telemetry_gap: t("next to a gap in tracking", "ถัดจากช่วงที่ข้อมูลติดตามขาด"),
    at_edge_of_day_data: t("touches the start or end of the day's data, so the arrival or departure is unknown", "อยู่ที่ต้นหรือท้ายของข้อมูลวันนี้ จึงไม่ทราบเวลาถึงหรือออก"),
    positions_not_all_verified_gps: t("positions not all verified GPS", "ตำแหน่งไม่ได้ยืนยัน GPS ทั้งหมด"),
    could_belong_to_a_neighbouring_site: t("may belong to a neighbouring site", "อาจเป็นของสถานที่ข้างเคียง")
  })[n];
  const maxDay = useMemo(today, []);
  useEffect(() => {
    const index = focusId?.startsWith(`${vehicleId}-${day}-`) ? Number(focusId.slice(`${vehicleId}-${day}-`.length)) : NaN;
    if (Number.isInteger(index)) document.getElementById(`evidence-stop-${index}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId, vehicleId, day]);
  const hhmm = (v: string | null) => formatBangkokTime(v, language) ?? t("unknown", "ไม่ทราบ");

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="location-evidence-title" data-stage="B-read-only">
    <h3 id="location-evidence-title" className="font-bold text-slate-900">{t("Evidence from vehicles", "หลักฐานจากรถ")} · {locationName || t("choose a site", "เลือกสถานที่")}</h3>
    <p className="mt-1 text-xs text-slate-600" role="note">{t("Read only. Stops from one vehicle-day appear as grey candidates on the map. Nothing is saved, proposed or verified here, and a stop is not proof it is this customer's site. Dwell is not unloading time.", "อ่านอย่างเดียว การหยุดจากรถหนึ่งคันในหนึ่งวันแสดงเป็นตัวเลือกสีเทาบนแผนที่ ไม่มีการบันทึก เสนอ หรือยืนยันที่นี่ และการหยุดไม่ใช่หลักฐานว่าเป็นสถานที่ของลูกค้านี้ เวลาที่อยู่ไม่ใช่เวลาขนถ่าย")}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold text-slate-700">{t("Vehicle", "รถ")}
        <select className="min-h-11 rounded-lg border border-slate-300 px-2 text-sm font-normal" value={vehicleId} onChange={event => setVehicleId(event.target.value)}>
          <option value="">{t("Choose a vehicle", "เลือกรถ")}</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_reg}</option>)}
        </select></label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">{t("Day (Bangkok)", "วันที่ (เวลาไทย)")}
        <input type="date" className="min-h-11 rounded-lg border border-slate-300 px-2 text-sm font-normal" value={day} max={maxDay} onChange={event => event.target.value && setDay(event.target.value)} /></label>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" disabled={!vehicleId || state === "reading" || state === "loading"} onClick={() => void showStops()}>{state === "loading" ? t("Looking…", "กำลังค้นหา…") : t("Show stops from the day already read", "แสดงจุดหยุดจากวันที่อ่านแล้ว")}</button>
      <button type="button" className="min-h-11 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white" disabled={!vehicleId || state === "reading" || state === "loading"} onClick={() => void readDay()}>{state === "reading" ? t("Reading Forth…", "กำลังอ่าน Forth…") : t("Read this day from Forth (read only)", "อ่านวันนี้จาก Forth (อ่านอย่างเดียว)")}</button>
    </div>
    <div role="status" aria-live="polite" className="mt-2 text-sm">
      {state === "not_read" ? <p>{t("This vehicle-day has not been read yet. Use “Read this day from Forth”: one report and log request, no changes.", "ยังไม่ได้อ่านวันนี้ของรถคันนี้ กด “อ่านวันนี้จาก Forth” (คำขอรายงานและบันทึกหนึ่งครั้ง ไม่มีการเปลี่ยนแปลง)")}</p> : null}
      {state === "restricted" ? <p>{t("Stop evidence uses historical journeys and needs administrator authorisation.", "หลักฐานการหยุดใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p> : null}
      {state === "failed" ? <p role="alert">{t("Evidence could not be read. Check access and try again.", "อ่านหลักฐานไม่ได้ โปรดตรวจสอบสิทธิ์แล้วลองใหม่")}</p> : null}
    </div>
    {evidence && state === "ready" ? <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-600">{registration} · {day} · {evidence.observations.total} {t("positions used", "ตำแหน่งที่ใช้")}{recorded !== null && recorded !== evidence.observations.total ? ` ${t("of", "จาก")} ${recorded} ${t("recorded", "ที่บันทึก")}` : ""} ({evidence.observations.verified} {t("verified GPS", "GPS ที่ยืนยัน")}, {evidence.observations.unverified} {t("not verified", "ยังไม่ยืนยัน")}) · {evidence.mode === "near_anchor" ? t(`within ${evidence.searchRadiusM} m of the current position`, `ภายใน ${evidence.searchRadiusM} ม. จากตำแหน่งปัจจุบัน`) : t("whole day (this site has no position yet)", "ทั้งวัน (สถานที่นี้ยังไม่มีตำแหน่ง)")}{evidence.anchorOnRoad ? ` · ${t("a vehicle passed the current position at road speed: it may be a roadside pin", "มีรถผ่านตำแหน่งปัจจุบันด้วยความเร็วบนถนน อาจเป็นหมุดริมถนน")}` : ""}</p>
      {evidence.stops.length === 0 ? <p className="text-sm">{t("No stop of two or more positions was found.", "ไม่พบการหยุดตั้งแต่สองตำแหน่ง")}</p>
        : <ol className="space-y-2">{evidence.stops.map((s, i) => <li key={i} id={`evidence-stop-${i}`} className={`rounded-xl border border-dashed p-3 text-sm ${focusId === `${vehicleId}-${day}-${i}` ? "border-brand-600 bg-brand-50 ring-2 ring-brand-600" : "border-slate-300"}`} data-candidate-index={i + 1} data-focused={focusId === `${vehicleId}-${day}-${i}` ? "true" : undefined}>
          <p className="font-semibold">{i + 1} · {hhmm(s.firstAt)}–{hhmm(s.lastAt)} · {t("stayed", "อยู่")} {s.stayMinutes.min}{s.stayMinutes.max === null ? "+" : ` ${t("to", "ถึง")} ${s.stayMinutes.max}`} {t("min", "นาที")} · {s.observations} {t("positions", "ตำแหน่ง")}</p>
          <p className="text-xs text-slate-600">{t("Arrival between", "ถึงระหว่าง")} {s.arrivalWindow.earliest ? hhmm(s.arrivalWindow.earliest) : t("unknown", "ไม่ทราบ")} {t("and", "และ")} {hhmm(s.arrivalWindow.latest)} · {t("left between", "ออกระหว่าง")} {hhmm(s.departureWindow.earliest)} {t("and", "และ")} {s.departureWindow.latest ? hhmm(s.departureWindow.latest) : t("unknown", "ไม่ทราบ")}</p>
          <p className="text-xs text-slate-600">{quality(s)}{s.distanceFromAnchorM !== null ? ` · ${s.distanceFromAnchorM} m ${t("from the current position", "จากตำแหน่งปัจจุบัน")}` : ""}{s.weight !== null ? ` · ${t("evidence weight", "น้ำหนักหลักฐาน")} ${s.weight}/100` : ""} · {t("candidate, not saved", "ตัวเลือก ไม่ได้บันทึก")}</p>
          {s.visitLabel ? <p className="text-xs text-slate-700" data-visit-group={s.visitLabel}>{t(`Part of visit ${s.visitLabel}: ${s.visitStops} adjacent stops at one place with a short interruption and continuous tracking. Each stop stays listed.`, `ส่วนหนึ่งของการเข้าพื้นที่ ${s.visitLabel}: ${s.visitStops} การหยุดติดกันในที่เดียวกัน มีการหยุดชะงักสั้นและข้อมูลต่อเนื่อง ทุกการหยุดยังแสดงแยก`)}</p> : null}
          {s.notes.length ? <p className="text-xs text-amber-800">{s.notes.map(note).join(" · ")}</p> : null}
          <p className="text-xs text-slate-500">{t("Coordinates (not saved)", "พิกัด (ไม่ได้บันทึก)")}: {s.centroid.latitude.toFixed(5)}, {s.centroid.longitude.toFixed(5)}</p>
          <button type="button" className="mt-2 min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-semibold" onClick={() => onUseAsCandidate(s.centroid)}>{t("Use as unsaved candidate position in the editor", "ใช้เป็นตำแหน่งตัวเลือกในตัวแก้ไข (ไม่ได้บันทึก)")}</button>
        </li>)}</ol>}
      <ul className="list-disc pl-5 text-xs text-slate-600">{evidence.limitations.map(l => <li key={l}>{l}</li>)}</ul>
    </div> : null}
  </section>;
}
