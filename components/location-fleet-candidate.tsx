"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getLocationDisplayName, type LocationPin } from "@/lib/locations-directory";
import { CANDIDATE_COPY, candidateText, isHandoffToken, nearbyKnownLocations, type CandidatePayload, type KnownLocation } from "@/lib/fleet-location-candidate";
import { describeArea, flagLabel, hintLabel, kindLabel } from "@/lib/fleet-recurring-areas";
import { metersBetween } from "@/lib/fleet-job-movement";

type Lang = "en" | "th";
export const FLEET_SUGGESTION_MARKER_ID = "fleet-suggestion";
type LocationLike = { id: string; company_name: string; thai_name: string | null; destination_type: string } & Record<string, unknown>;
export type FleetMarker = { id: string; latitude: number; longitude: number; label: string; kind: "fleet_suggestion" };
// The token is read from the address bar exactly once per page load and then removed from it. It is kept here (module scope, in memory)
// so React remounting this component (Strict Mode in development, or the page changing tree while access loads) does not lose it.
// A real browser refresh clears this variable and the address bar no longer has the token, so nothing reopens.
let capturedToken: string | null | undefined;
export function takeCandidateToken(): string | null {
  if (capturedToken !== undefined) return capturedToken;
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href); const token = url.searchParams.get("candidate");
  capturedToken = token;
  if (token !== null) { url.searchParams.delete("candidate"); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`); }
  return capturedToken;
}
export function forgetCandidateToken() { capturedToken = null; }
type State = { status: "idle" } | { status: "loading" } | { status: "ready"; candidate: CandidatePayload } | { status: "expired" | "forbidden" | "failed" | "dismissed" };

/**
 * Receives an UNSAVED location suggestion from Fleet Tracking. The URL carries only an opaque, short-lived token (never
 * coordinates); it is removed from the address bar immediately after reading. The server decides who may open it. Nothing is
 * saved, verified or changed here: saving still uses the existing pin workflow with its own permissions.
 */
export function LocationFleetCandidate({ language, canEdit, locations, mapPins, focusTick, onReady, onSuggestedCandidate, onDismissed, onMarkers }: {
  language: Lang; canEdit: boolean; locations: readonly LocationLike[]; mapPins: readonly LocationPin[]; focusTick: number; onReady?: () => void; onDismissed?: () => void;
  onSuggestedCandidate: (point: { latitude: number; longitude: number }) => void; onMarkers: (markers: FleetMarker[]) => void;
}) {
  const t = (key: keyof typeof CANDIDATE_COPY) => candidateText(key, language);
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compareId, setCompareId] = useState("");
  const tokenRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  // Read the token once, then take it out of the address bar and history so a refresh or a shared link cannot reopen it.
  useEffect(() => {
    const token = takeCandidateToken();
    if (!token) return;
    if (!isHandoffToken(token)) { setState({ status: "failed" }); return; }
    tokenRef.current = token; setState({ status: "loading" });
    const controller = new AbortController();
    void (async () => {
      try {
        const access = (await supabase.auth.getSession()).data.session?.access_token; if (!access) throw new Error("session");
        const response = await fetch("/api/admin/forth-tracking/evidence/recurring/candidate", { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal, body: JSON.stringify({ action: "open", token }) });
        if (response.status === 403 || response.status === 401) { setState({ status: "forbidden" }); return; }
        if (response.status === 410 || response.status === 404) { setState({ status: "expired" }); return; }
        if (!response.ok) throw new Error("status");
        const { candidate } = await response.json() as { candidate: CandidatePayload };
        if (!isValidPayload(candidate)) throw new Error("payload");
        setState({ status: "ready", candidate });
      } catch { if (!controller.signal.aborted) setState({ status: "failed" }); }
    })();
    return () => controller.abort();
  }, []);

  const candidate = state.status === "ready" ? state.candidate : null;
  // The marker and the editor's unsaved candidate follow the candidate. Dismissing removes both. Nothing is saved.
  const onMarkersRef = useRef(onMarkers); onMarkersRef.current = onMarkers;
  const onSuggestedRef = useRef(onSuggestedCandidate); onSuggestedRef.current = onSuggestedCandidate;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const onDismissedRef = useRef(onDismissed); onDismissedRef.current = onDismissed;
  useEffect(() => {
    if (!candidate) { onMarkersRef.current([]); return; }
    onMarkersRef.current([{ id: FLEET_SUGGESTION_MARKER_ID, latitude: candidate.area.latitude, longitude: candidate.area.longitude, label: CANDIDATE_COPY.markerLabel[language === "th" ? 1 : 0], kind: "fleet_suggestion" }]);
    onReadyRef.current?.();
    if (canEdit) onSuggestedRef.current({ latitude: candidate.area.latitude, longitude: candidate.area.longitude });
    window.setTimeout(() => headingRef.current?.focus(), 50);
    return () => onMarkersRef.current([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.area.id, candidate?.createdAt, canEdit, language]);
  // A click on the map marker brings the evidence into view.
  useEffect(() => { if (focusTick > 0 && candidate) { setCollapsed(false); sectionRef.current?.scrollIntoView?.({ block: "nearest" }); window.setTimeout(() => headingRef.current?.focus(), 30); } }, [focusTick, candidate]);

  const known: KnownLocation[] = useMemo(() => {
    const byId = new Map(locations.map(l => [l.id, l]));
    return mapPins.flatMap(pin => { const l = byId.get(pin.location_id); return l ? [{ id: `${l.id}:${pin.pin_type}`, name: getLocationDisplayName(l as never, language), category: l.destination_type, latitude: pin.latitude, longitude: pin.longitude, verifiedPin: pin.pin_status === "manual_confirmed" }] : []; });
  }, [locations, mapPins, language]);
  const nearby = useMemo(() => (candidate ? nearbyKnownLocations({ latitude: candidate.area.latitude, longitude: candidate.area.longitude }, known, 500, 5) : []), [candidate, known]);
  const compared = candidate && compareId ? known.find(k => k.id === compareId) : null;

  const dismiss = useCallback(async () => {
    const token = tokenRef.current; tokenRef.current = null; forgetCandidateToken(); setState({ status: "dismissed" }); onDismissedRef.current?.();
    if (!token) return;
    try { const access = (await supabase.auth.getSession()).data.session?.access_token; if (access) await fetch("/api/admin/forth-tracking/evidence/recurring/candidate", { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ action: "dismiss", token }) }); } catch { /* the server entry also expires by itself */ }
  }, []);
  const back = () => { if (window.history.length > 1) router.back(); else router.push("/fleet-tracking"); };
  const fmtDay = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—");
  const coords = candidate ? `${candidate.area.latitude.toFixed(6)}, ${candidate.area.longitude.toFixed(6)}` : "";
  const min = t("minutes");

  if (state.status === "idle") return null;
  const message = state.status === "loading" ? null : state.status === "expired" ? t("expired") : state.status === "forbidden" ? t("forbidden") : state.status === "failed" ? t("failed") : state.status === "dismissed" ? t("dismissed") : null;
  return <section ref={sectionRef} className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm" aria-labelledby="fleet-candidate-title" data-fleet-candidate data-state={state.status}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 id="fleet-candidate-title" ref={headingRef} tabIndex={-1} className="text-base font-bold text-violet-950 outline-none">{t("heading")}</h2>
      <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold" onClick={back}>{t("back")}</button>
    </div>
    <div role="status" aria-live="polite">
      {state.status === "loading" ? <p className="mt-2 text-sm text-slate-600">{t("opening")}</p> : null}
      {message ? <p className="mt-2 text-sm text-slate-700" data-candidate-message>{message}</p> : null}
    </div>
    {candidate ? <>
      <p className="mt-2 text-sm font-semibold text-violet-900" data-not-saved>{t("notSaved")}</p>
      <p className="mt-1 text-xs leading-5 text-slate-700">{t("notCustomer")}</p>
      {!canEdit ? <p className="mt-1 text-xs text-amber-800" data-read-only>{t("readOnly")}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-violet-300 bg-white px-3 text-xs font-semibold" data-keep-unsaved onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed}>{collapsed ? t("heading") : t("keepUnsaved")}</button>
        <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold" data-copy-coordinates onClick={() => { void navigator.clipboard?.writeText(coords).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }).catch(() => undefined); }}>{copied ? t("copied") : t("copy")}</button>
        {canEdit ? <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold" data-use-candidate onClick={() => onSuggestedCandidate({ latitude: candidate.area.latitude, longitude: candidate.area.longitude })}>{t("useCandidate")}</button> : null}
        <button type="button" className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-800" data-dismiss onClick={() => void dismiss()}>{t("dismiss")}</button>
      </div>
      {!collapsed ? <div className="mt-3 grid gap-3 text-sm" data-candidate-evidence>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
          <div><dt className="font-semibold text-slate-500">{t("reviewedDays")}</dt><dd>{candidate.evidence.distinctDays}</dd></div>
          <div><dt className="font-semibold text-slate-500">{t("vehicles")}</dt><dd>{candidate.evidence.vehicles.length} · {candidate.evidence.vehicles.join(", ")}</dd></div>
          <div><dt className="font-semibold text-slate-500">{t("visits")}</dt><dd>{candidate.evidence.visits}</dd></div>
          <div className="col-span-2"><dt className="font-semibold text-slate-500">{t("firstLast")}</dt><dd>{fmtDay(candidate.evidence.firstSeen)} → {fmtDay(candidate.evidence.lastSeen)}</dd></div>
          <div><dt className="font-semibold text-slate-500">{t("stay")}</dt><dd>{candidate.evidence.stayMinutes.min} / {candidate.evidence.stayMinutes.median} / {candidate.evidence.stayMinutes.longestSupported} {min}</dd></div>
          <div className="col-span-2 sm:col-span-3"><dt className="font-semibold text-slate-500">{t("gps")}</dt><dd>{candidate.evidence.quality.verified} {t("verified")} · {candidate.evidence.quality.mixed} {t("mixed")} · {candidate.evidence.quality.unverified} {t("unverified")}</dd></div>
        </dl>
        <p className="text-xs"><span className="font-semibold text-slate-500">{kindLabel(candidate.area.kind, language)}</span> · {hintLabel(candidate.area.placeHint, language)}</p>
        <div>
          <h3 className="text-xs font-bold text-slate-700">{t("nearby")}</h3>
          {nearby.length === 0 && candidate.matches.length === 0 ? <p className="text-xs text-slate-700" data-unknown-area>{t("nearbyNone")}</p> : <>
            {nearby.length + candidate.matches.length > 1 ? <p className="text-xs text-amber-800">{t("nearbyMany")}</p> : null}
            <ul className="mt-1 grid gap-1 text-xs" data-nearby>
              {nearby.map(k => <li key={k.id}>{k.name} · {k.distanceM} m · {k.verifiedPin ? t("verifiedPin") : t("noVerifiedPin")}</li>)}
              {candidate.matches.map(m => <li key={m.id}>{m.name} · {m.distanceM} m · {m.source === "forth_saved_location" ? (language === "th" ? "บันทึกใน Forth ยังไม่ยืนยัน" : "Forth saved location, not office-verified") : t("verifiedPin")}</li>)}
            </ul></>}
        </div>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">{t("compare")}
          <select className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal" value={compareId} onChange={event => setCompareId(event.target.value)} data-compare>
            <option value="">{t("comparePick")}</option>{known.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
          {compared ? <span className="font-normal" data-compare-result>{compared.name}: {Math.round(metersBetween({ latitude: candidate.area.latitude, longitude: candidate.area.longitude }, compared))} m · {compared.verifiedPin ? t("verifiedPin") : t("noVerifiedPin")}</span> : null}
        </label>
        <div>
          <h3 className="text-xs font-bold text-slate-700">{t("uncertainty")}</h3>
          <ul className="mt-1 grid gap-1 text-xs text-slate-700">{describeArea({ ...areaForDescribe(candidate) }, language).map(line => <li key={line}>{line}</li>)}{candidate.evidence.flags.map(f => <li key={f}>{flagLabel(f, language)}</li>)}<li>{t("limitedSample")} ({candidate.sample.vehicleDaysIncluded}/{candidate.sample.vehicleDaysInRange})</li></ul>
        </div>
        <div><h3 className="text-xs font-bold text-slate-700">{t("provenance")}</h3><p className="text-xs leading-5 text-slate-700">{t("provenanceText")}</p></div>
        <p className="text-xs leading-5 text-slate-500" data-transient>{t("transient")}</p>
      </div> : null}
    </> : null}
  </section>;
}

function isValidPayload(c: unknown): c is CandidatePayload {
  const p = c as CandidatePayload | null;
  return !!p && p.version === 1 && p.label === "suggested_from_vehicle_evidence" && typeof p.area?.latitude === "number" && typeof p.area?.longitude === "number" && Math.abs(p.area.latitude) <= 90 && Math.abs(p.area.longitude) <= 180 && Array.isArray(p.evidence?.vehicles) && Array.isArray(p.matches);
}
/** describeArea only needs the summary fields, which the candidate carries. */
function areaForDescribe(c: CandidatePayload) {
  return { id: c.area.id, centroid: { latitude: c.area.latitude, longitude: c.area.longitude }, radiusM: c.area.radiusM, kind: c.area.kind, placeHint: c.area.placeHint, matches: c.matches, visits: c.evidence.visits, vehicleDays: c.evidence.vehicleDays, distinctDays: c.evidence.distinctDays, vehicles: c.evidence.vehicles, firstSeen: c.evidence.firstSeen, lastSeen: c.evidence.lastSeen, days: c.evidence.days, stayMinutes: c.evidence.stayMinutes, quality: c.evidence.quality, visitsNextToGap: c.evidence.visitsNextToGap, daysWithKnownMissingTracking: c.evidence.daysWithKnownMissingTracking, flags: c.evidence.flags, nearestOtherAreaM: c.evidence.nearestOtherAreaM, visitList: [] };
}
