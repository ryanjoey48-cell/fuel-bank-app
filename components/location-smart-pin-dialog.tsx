"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowUpRight, Check, LoaderCircle, MapPin, RefreshCw, RotateCcw, X } from "lucide-react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import styles from "./location-smart-pin-dialog.module.css";
import { getLocationDisplayName, getLocationMapUrl, type LocationPin } from "@/lib/locations-directory";
import { initialSmartPinState, smartPinReducer, type GeoapifyCandidate } from "@/lib/location-geocoding";
import type { Translation } from "@/lib/translations";

type SmartPinLocation = {
  id: string;
  company_name: string;
  thai_name: string | null;
  alternative_names: string[];
  address: string;
  province: string | null;
  google_maps_url: string | null;
};

type CandidateWithToken = GeoapifyCandidate & { confirmationToken: string };
type LookupResponse = { candidates: CandidateWithToken[]; found: boolean };
type Props = {
  location: SmartPinLocation | null;
  language: "en" | "th";
  copy: Translation["locations"];
  onLookup: (locationId: string, signal: AbortSignal) => Promise<LookupResponse>;
  onSave: (locationId: string, confirmationToken: string, signal: AbortSignal) => Promise<LocationPin>;
  onClose: () => void;
};

type ApiFailure = Error & { code?: string };

function CandidatePreviewMap({ candidate, label }: { candidate: CandidateWithToken | null; label: string }) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let activeMap: LeafletMap | null = null;

    async function initialize() {
      if (!nodeRef.current) return;
      try {
        const leafletModule = await import("leaflet");
        const Leaflet = (leafletModule as unknown as { default?: typeof import("leaflet") }).default ?? leafletModule;
        if (disposed || !nodeRef.current) return;
        const map = Leaflet.map(nodeRef.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
        activeMap = map;
        mapRef.current = map;
        leafletRef.current = Leaflet;
        Leaflet.tileLayer(process.env.NEXT_PUBLIC_EES_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
        }).addTo(map);
        map.fitBounds([[5.6, 97.3], [20.5, 105.7]], { padding: [10, 10], maxZoom: 7 });
        setReady(true);
        window.setTimeout(() => map.invalidateSize(), 0);
      } catch {
        if (!disposed) setReady(false);
      }
    }

    void initialize();
    return () => {
      disposed = true;
      activeMap?.remove();
      if (mapRef.current === activeMap) mapRef.current = null;
      leafletRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!map || !Leaflet || !ready) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!candidate) return;
    markerRef.current = Leaflet.circleMarker([candidate.latitude, candidate.longitude], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#6d28d9",
      fillOpacity: 1
    }).addTo(map);
    map.setView([candidate.latitude, candidate.longitude], 16, { animate: true });
  }, [candidate, ready]);

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
    <div ref={nodeRef} className={styles.previewMap} role="application" aria-label={label} />
    {!ready && <p className="border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">{label}</p>}
  </div>;
}

export function LocationSmartPinDialog({ location, language, copy, onLookup, onSave, onClose }: Props) {
  const [state, dispatch] = useReducer(smartPinReducer, initialSmartPinState);
  const [savedPin, setSavedPin] = useState<LocationPin | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const didStartLookupRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const cancelLookup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runLookup = useCallback(async () => {
    if (!location) return;
    cancelLookup();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "lookup_started" });
    try {
      const result = await onLookup(location.id, controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "lookup_succeeded", candidates: result.candidates });
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = error as ApiFailure;
      const limited = failure.code === "RATE_LIMITED" || failure.code === "DAILY_LIMIT" || failure.code === "PROVIDER_RATE_LIMITED";
      dispatch({ type: "lookup_failed", reason: limited ? "rate_limit" : "lookup" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [cancelLookup, location, onLookup]);

  const reset = useCallback(() => {
    cancelLookup();
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
    setSavedPin(null);
    dispatch({ type: "reset" });
  }, [cancelLookup]);

  const close = useCallback(() => {
    cancelLookup();
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
    dispatch({ type: "reset" });
    onClose();
  }, [cancelLookup, onClose]);

  useEffect(() => {
    if (!location || didStartLookupRef.current) return;
    didStartLookupRef.current = true;
    titleRef.current?.focus();
    void runLookup();
  }, [location, runLookup]);

  useEffect(() => {
    if (!location) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [location, close]);

  const selected = state.candidates.find((candidate) => candidate.id === state.selectedId) ?? null;
  const googleMapsUrl = location ? getLocationMapUrl(location) : null;

  async function confirmLocation() {
    if (!location || !selected || state.stage === "saving") return;
    const controller = new AbortController();
    saveAbortRef.current = controller;
    dispatch({ type: "save_started" });
    try {
      const pin = await onSave(location.id, selected.confirmationToken, controller.signal);
      if (controller.signal.aborted) return;
      setSavedPin(pin);
      dispatch({ type: "save_succeeded" });
    } catch {
      if (controller.signal.aborted) return;
      dispatch({ type: "save_failed" });
    } finally {
      if (saveAbortRef.current === controller) saveAbortRef.current = null;
    }
  }

  if (!location) return null;

  const displayName = getLocationDisplayName(location, language);
  const candidateButtonClass = "flex min-h-14 items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ";

  return <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-slate-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="smart-pin-title" className="my-auto flex max-h-[95dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-brand-700">EES Fuel Bank</p>
          <h2 id="smart-pin-title" ref={titleRef} tabIndex={-1} className="mt-0.5 break-words text-xl font-bold text-slate-950 outline-none">{copy.findOnMap}</h2>
          <p className="mt-1 break-words text-sm text-slate-600">{displayName}</p>
        </div>
        <button type="button" onClick={close} aria-label={copy.cancel} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" aria-hidden="true" /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          {location.thai_name && language === "en" && <p className="break-words text-sm font-semibold text-slate-700">{location.thai_name}</p>}
          {location.thai_name && language === "th" && <p className="break-words text-sm font-semibold text-slate-700">{location.company_name}</p>}
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-5 text-slate-700">{location.address}{location.province ? ", " + location.province : ""}</p>
        </div>

        {state.stage === "searching" && <p className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-3 text-sm font-semibold text-brand-900" role="status" aria-live="polite"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.searchingLocation}</p>}
        {state.stage === "not_found" && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm font-semibold text-amber-950" role="status">{copy.locationNotFound}</p>}
        {state.stage === "lookup_error" && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900" role="alert">{state.error === "rate_limit" ? copy.lookupRateLimited : copy.lookupFailed}</p>}
        {state.stage === "save_error" && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900" role="alert">{copy.pinSaveError}</p>}
        {state.stage === "saved" && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-900" role="status"><Check className="h-4 w-4" aria-hidden="true" />{copy.pinSaveSuccess}</p>}

        {state.candidates.length > 0 && state.stage !== "saved" && <>
          <div>
            <p className="text-sm font-bold text-slate-900">{copy.chooseMatchingPlace}</p>
            <div className="mt-2 grid gap-2">
              {state.candidates.map((candidate) => <button key={candidate.id} type="button" aria-pressed={state.selectedId === candidate.id} onClick={() => dispatch({ type: "selected", id: candidate.id })} className={candidateButtonClass + (state.selectedId === candidate.id ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200")}>
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-bold text-slate-950">{candidate.name}</span>
                  <span className="mt-0.5 block break-words text-sm leading-5 text-slate-600">{candidate.formattedAddress}</span>
                </span>
                {state.selectedId === candidate.id && <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />}
              </button>)}
            </div>
          </div>
          <CandidatePreviewMap candidate={selected} label={copy.proposedLocationMap} />
          {selected && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-950" role="note">{copy.reviewPinBeforeSave}</p>}
          <p className="text-xs leading-5 text-slate-500">{copy.geocodeAttribution}: <a className="font-semibold text-brand-700 underline underline-offset-2" href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> · <a className="font-semibold text-brand-700 underline underline-offset-2" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
        </>}

        {googleMapsUrl && <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={close}><MapPin className="h-4 w-4" aria-hidden="true" />{copy.openGoogleMaps}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>}
        {state.stage === "saved" && savedPin && <p className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">{savedPin.latitude.toFixed(6)}, {savedPin.longitude.toFixed(6)}</p>}
      </div>

      <footer className="sticky bottom-0 flex shrink-0 flex-wrap gap-2 border-t border-slate-200 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
        <button type="button" onClick={close} className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50">{copy.cancel}</button>
        <button type="button" onClick={reset} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50"><RotateCcw className="h-4 w-4" aria-hidden="true" />{copy.reset}</button>
        {state.stage === "idle" && <button type="button" onClick={() => void runLookup()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 font-bold text-white hover:bg-brand-800"><MapPin className="h-4 w-4" aria-hidden="true" />{copy.findOnMap}</button>}
        {(state.stage === "not_found" || state.stage === "lookup_error" || state.stage === "choosing") && <button type="button" onClick={() => void runLookup()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 font-bold text-white hover:bg-brand-800"><RefreshCw className="h-4 w-4" aria-hidden="true" />{copy.retryLookup}</button>}
        {state.stage === "save_error" && selected && <button type="button" onClick={() => void confirmLocation()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 font-bold text-white hover:bg-brand-800"><RefreshCw className="h-4 w-4" aria-hidden="true" />{copy.retrySave}</button>}
        {state.stage === "choosing" && <button type="button" disabled={!selected} onClick={() => void confirmLocation()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />{copy.confirmLocationSave}</button>}
        {state.stage === "saving" && <button type="button" disabled className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 font-bold text-white opacity-70"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.saving}</button>}
        {state.stage === "saved" && <button type="button" onClick={close} className="min-h-12 flex-1 rounded-xl bg-brand-700 px-3 font-bold text-white hover:bg-brand-800">{copy.done}</button>}
      </footer>
    </section>
  </div>;
}
