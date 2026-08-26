"use client";

import { ChevronDown, ExternalLink, Loader2, MapPinned, RotateCcw, ShieldAlert, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LocationAutocomplete, type StructuredLocation } from "@/components/location-autocomplete";
import { GoogleMapsLoader } from "@/components/google-maps-loader";
import { isRiskyGenericLocation, requiresAmbiguousGlobalConfirmation, type LocationReviewSnapshotData } from "@/lib/booking-location-review";
import { supabase } from "@/lib/supabase";

type ApprovalScope = "global" | "client" | "route" | "individual";
type ReviewSnapshot = LocationReviewSnapshotData & { snapshotVersion: string; generatedAt: string };
export type LocationApprovalPayload = {
  alias: string;
  confirmedName: string;
  snapshotVersion: string;
  clientId: string | null | undefined;
  displayName: string;
  placeId: string;
  expectedAffectedCount: number;
  outsideThailandApproved: boolean;
  scope: ApprovalScope;
  side: "pickup" | "dropoff";
  context?: { clientId: string | null; pickup: string; dropoff: string };
};

export type LocationApprovalIssue = {
  label: string;
  side: "pickup" | "dropoff" | "pickup_dropoff";
  affectedBookingCount: number;
  recommendedScope: "global" | "client" | "booking";
  clientContexts: Array<{ clientId: string | null; clientName: string; count: number }>;
  scopeCounts: { global: number; client: number; booking: number };
  examples?: Array<{ bookingId: string; clientId: string | null; clientName: string; pickup: string; dropoff: string; bookingDate: string }>;
};

type ErrorPayload = {
  error?: string;
  code?: string;
  snapshot?: ReviewSnapshot;
};

class AdminRequestError extends Error {
  constructor(readonly status: number, readonly payload: ErrorPayload) {
    super(payload.error || "Location approval request failed.");
  }
}

async function adminFetch<T>(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Authentication required.");
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({})) as T & ErrorPayload;
  if (!response.ok) throw new AdminRequestError(response.status, payload);
  return payload;
}

function mapsUrl(location: StructuredLocation) {
  const base = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.formatted_address)}`;
  return location.place_id
    ? `${base}&query_place_id=${encodeURIComponent(location.place_id.replace(/^places\//, ""))}`
    : base;
}

function reconciles(snapshot: ReviewSnapshot) {
  return (
    snapshot.uniqueAffectedBookings === snapshot.fieldOccurrences &&
    snapshot.clients.reduce((sum, client) => sum + client.count, 0) === snapshot.uniqueAffectedBookings &&
    snapshot.clients.every((client) => client.count <= snapshot.uniqueAffectedBookings)
  );
}

export function LocationApprovalDialog({ issue, language, onClose, onApproved, onReviewIndividually, onNeedsClientReview, initialSnapshot, snapshotLoader, approvalSubmitter }: {
  issue: LocationApprovalIssue;
  language: "en" | "th";
  onClose: () => void;
  onApproved: (affectedCount: number) => Promise<void> | void;
  onReviewIndividually?: () => void;
  onNeedsClientReview?: () => void;
  initialSnapshot?: ReviewSnapshot;
  snapshotLoader?: () => Promise<ReviewSnapshot>;
  approvalSubmitter?: (payload: LocationApprovalPayload) => Promise<void>;
}) {
  const side = issue.side === "pickup_dropoff" ? "pickup" : issue.side;
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(initialSnapshot ?? null);
  const [snapshotLoading, setSnapshotLoading] = useState(!initialSnapshot);
  const [snapshotReviewed, setSnapshotReviewed] = useState(true);
  const [snapshotChange, setSnapshotChange] = useState<{ previous: number; current: number } | null>(null);
  const [query, setQuery] = useState(issue.label);
  const [confirmedName, setConfirmedName] = useState(issue.label);
  const [selected, setSelected] = useState<StructuredLocation | null>(null);
  const [scope, setScope] = useState<ApprovalScope>("individual");
  const [clientKey, setClientKey] = useState("");
  const [routeKey, setRouteKey] = useState("");
  const [confirmAmbiguousGlobal, setConfirmAmbiguousGlobal] = useState(false);
  const [outsideThailandApproved, setOutsideThailandApproved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [placesAvailable, setPlacesAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((next: ReviewSnapshot, previousCount?: number, initialize = false) => {
    setSnapshot(next);
    const firstKnownClient = next.clients.find((client) => client.clientId);
    const hasUnknownClient = next.clients.some((client) => !client.clientId);
    const multipleClients = next.clients.length > 1;
    const risky = isRiskyGenericLocation(issue.label) || multipleClients;
    setClientKey((current) => next.clients.some((client) => client.key === current)
      ? current
      : firstKnownClient?.key ?? "");
    setRouteKey((current) => next.routes.some((route) => route.key === current)
      ? current
      : next.routes[0]?.key ?? "");
    if (initialize) {
      setScope(multipleClients && !hasUnknownClient && firstKnownClient ? "client" : risky ? "individual" : "global");
    }
    if (previousCount != null && previousCount !== next.uniqueAffectedBookings) {
      setSnapshotChange({ previous: previousCount, current: next.uniqueAffectedBookings });
      setSnapshotReviewed(false);
      setConfirmAmbiguousGlobal(false);
    }
  }, [issue.label]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (initialSnapshot) {
      applySnapshot(initialSnapshot, issue.affectedBookingCount, true);
      return;
    }
    let cancelled = false;
    const loadSnapshot = async () => {
      setSnapshotLoading(true);
      setError(null);
      try {
        const nextSnapshot = snapshotLoader
          ? await snapshotLoader()
          : (await adminFetch<{ snapshot: ReviewSnapshot }>(`/api/admin/booking-maps/locations/snapshot?${new URLSearchParams({ name: issue.label, side })}`)).snapshot;
        if (!cancelled) applySnapshot(nextSnapshot, issue.affectedBookingCount, true);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load the location review snapshot.");
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    };
    void loadSnapshot();
    return () => { cancelled = true; };
  }, [applySnapshot, initialSnapshot, issue.affectedBookingCount, issue.label, side, snapshotLoader]);

  const selectedClient = snapshot?.clients.find((client) => client.key === clientKey) ?? null;
  const selectedRoute = snapshot?.routes.find((route) => route.key === routeKey) ?? null;
  const affectedCount = !snapshot
    ? 0
    : scope === "client"
      ? selectedClient?.count ?? 0
      : scope === "route"
        ? selectedRoute?.count ?? 0
        : snapshot.uniqueAffectedBookings;
  const hasMultipleClients = (snapshot?.clients.length ?? 0) > 1;
  const ambiguous = isRiskyGenericLocation(issue.label) || hasMultipleClients;
  const outsideThailand = Boolean(selected?.country_code && selected.country_code.toUpperCase() !== "TH");
  const confirmedNameChanged = confirmedName.trim() !== issue.label.trim();

  const t = language === "th" ? {
    title: "อนุมัติสถานที่", original: "ชื่อเดิมในสมุดจองงาน", confirmed: "ชื่อจุดรับ/ส่งที่ยืนยันแล้วของเรา", confirmedHelp: "ชื่อนี้เป็นชื่อที่พนักงานจะเห็นและใช้ ไม่ใช่ชื่อจาก Google",
    pickup: "จุดรับ", dropoff: "จุดส่ง", allTotal: "งานที่ได้รับผลทั้งหมด", occurrences: "ช่องจุดรับ/ส่ง", future: "งานอนาคตที่ไม่รวม",
    linked: "สถานที่ Google Maps ที่เชื่อมโยง", search: "ค้นหาสถานที่ใน Google", selected: "สถานที่ Google ที่เลือก", googleName: "ชื่อสถานที่ Google", address: "ที่อยู่ที่ยืนยันแล้ว", coordinates: "พิกัด",
    open: "เปิดใน Google Maps", change: "ล้าง/เปลี่ยนสถานที่", reuse: "ขอบเขตการนำกลับมาใช้", global: "ใช้กับลูกค้าทุกรายที่มีชื่อเดิมตรงกัน", individual: "ตรวจสอบงานทั้งหมดทีละรายการ",
    advanced: "ขอบเขตเส้นทาง", client: "ใช้สำหรับลูกค้ารายนี้เท่านั้น", route: "ใช้สำหรับเส้นทางนี้เท่านั้น", warning: "ชื่อนี้ใช้กับหลายลูกค้าหรืออาจหมายถึงหลายสถานที่ แนะนำให้ตรวจสอบตามลูกค้า ห้ามใช้กับทุกลูกค้าโดยไม่ยืนยันว่าเป็นสถานที่เดียวกันจริง",
    confirmGlobal: "ฉันยืนยันว่าลูกค้าทุกรายใช้สถานที่จริงแห่งเดียวกัน", clients: "การกระจายตามลูกค้า", unknown: "ยังไม่ทราบลูกค้า", needsClient: "ต้องตรวจสอบลูกค้าก่อน", outside: "ฉันยืนยันว่าสถานที่นี้อยู่นอกประเทศไทยโดยตั้งใจ",
    cancel: "ยกเลิก", approve: "อนุมัติสถานที่สำหรับ", bookings: "งาน", review: "ตรวจสอบงานทีละรายการ", saving: "กำลังอนุมัติ...", loading: "กำลังสร้างข้อมูลตรวจสอบล่าสุด...",
    changed: "ชุดข้อมูลเปลี่ยนระหว่างการตรวจสอบ", changedDetail: "ระบบเก็บสถานที่ Google และชื่อภายในที่คุณเลือกไว้แล้ว กรุณาตรวจสอบจำนวนใหม่และยืนยันอีกครั้ง", reviewCount: "ตรวจสอบจำนวนใหม่", cutoff: "รวมงานถึงวันที่", applies: "การแก้ชื่อนี้จะใช้กับ"
  } : {
    title: "Approve location", original: "Original Booking Diary name", confirmed: "Our confirmed pickup/drop-off name", confirmedHelp: "This is the familiar company name staff will see and use. It remains separate from Google's place name.",
    pickup: "Pickup", dropoff: "Drop-off", allTotal: "unique affected bookings", occurrences: "pickup/drop-off field occurrences", future: "future bookings excluded",
    linked: "Linked Google Maps location", search: "Search Google Places", selected: "Selected Google place", googleName: "Google place name", address: "Full verified address", coordinates: "Coordinates",
    open: "Open in Google Maps", change: "Clear/change selection", reuse: "Reuse choice", global: "Use for all clients with this exact original name", individual: "Review all affected bookings individually",
    advanced: "Route-specific scope", client: "Use for this client only", route: "Use for this exact route only", warning: "This name is used by multiple clients or may represent more than one facility. Review by client is recommended. Do not reuse it for all clients unless every client genuinely uses the same physical facility.",
    confirmGlobal: "I verified that every client uses this same physical facility.", clients: "Client breakdown", unknown: "Unknown client", needsClient: "Mark as needs investigation", outside: "I confirm this location is intentionally outside Thailand.",
    cancel: "Cancel", approve: "Approve location for", bookings: "bookings", review: "Review bookings individually", saving: "Approving...", loading: "Creating the current review snapshot...",
    changed: "The review data changed", changedDetail: "Your selected Google place and confirmed company name were preserved. Review the refreshed counts and confirm again before saving.", reviewCount: "Review updated count", cutoff: "Includes bookings through", applies: "This name correction will apply to"
  };

  const sideLabel = side === "pickup" ? t.pickup : t.dropoff;
  const countsValid = Boolean(snapshot && reconciles(snapshot));
  const approvalBlocked = !selected?.place_id || !confirmedName.trim() || saving || snapshotLoading || !countsValid || affectedCount < 1 || scope === "individual" || !snapshotReviewed || requiresAmbiguousGlobalConfirmation(ambiguous, scope, confirmAmbiguousGlobal) || (outsideThailand && !outsideThailandApproved) || (scope === "client" && !selectedClient?.clientId);

  const chooseScope = (nextScope: ApprovalScope) => {
    setScope(nextScope);
    setConfirmAmbiguousGlobal(false);
  };

  const submit = async () => {
    if (approvalBlocked || !selected?.place_id || !snapshot) return;
    setSaving(true);
    setError(null);
    try {
      const payload: LocationApprovalPayload = {
          alias: issue.label,
          confirmedName: confirmedName.trim(),
          snapshotVersion: snapshot.snapshotVersion,
          clientId: scope === "client" ? selectedClient?.clientId : null,
          displayName: selected.label,
          placeId: selected.place_id,
          expectedAffectedCount: affectedCount,
          outsideThailandApproved: outsideThailand && outsideThailandApproved,
          scope,
          side,
          context: scope === "route" && selectedRoute
            ? { clientId: selectedRoute.clientId, pickup: selectedRoute.pickup, dropoff: selectedRoute.dropoff }
            : undefined
      };
      if (approvalSubmitter) await approvalSubmitter(payload);
      else await adminFetch("/api/admin/booking-maps/locations", { method: "POST", body: JSON.stringify(payload) });
      await onApproved(affectedCount);
    } catch (caught) {
      if (caught instanceof AdminRequestError && caught.payload.code === "STALE_REVIEW_SNAPSHOT" && caught.payload.snapshot) {
        const previous = snapshot.uniqueAffectedBookings;
        applySnapshot(caught.payload.snapshot, previous);
      } else {
        setError(caught instanceof Error ? caught.message : "Unable to approve this location.");
      }
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-slate-950/55 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`${t.title}: ${issue.label}`} data-testid="location-approval-modal">
    <GoogleMapsLoader />
    <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0"><p className="text-xs font-bold uppercase text-slate-500">{t.original}</p><h2 className="mt-1 break-words text-lg font-bold text-slate-950">{issue.label}</h2><div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600"><span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">{sideLabel}</span>{snapshot ? <><span><strong className="text-slate-900">{snapshot.uniqueAffectedBookings.toLocaleString()}</strong> {t.allTotal}</span><span><strong>{snapshot.fieldOccurrences.toLocaleString()}</strong> {t.occurrences}</span><span><strong>{snapshot.excludedFutureBookings.toLocaleString()}</strong> {t.future}</span></> : null}</div>{snapshot?.cutoffDate ? <p className="mt-1 text-xs text-slate-500">{t.cutoff} {snapshot.cutoffDate}</p> : null}</div>
        <button type="button" className="icon-button shrink-0" onClick={onClose} aria-label={t.cancel}><X className="h-5 w-5" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5" data-testid="location-approval-scroll">
        <div className="space-y-5">
          {snapshotLoading ? <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</div> : null}

          <section><label className="block text-sm font-bold text-slate-950" htmlFor="confirmed-location-name">{t.confirmed}</label><input id="confirmed-location-name" className="form-input mt-2 w-full" value={confirmedName} onChange={(event) => setConfirmedName(event.target.value)} maxLength={160} /><p className="mt-1 text-xs text-slate-500">{t.confirmedHelp}</p>{confirmedNameChanged ? <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs font-semibold text-blue-900">{t.applies} {affectedCount.toLocaleString()} {t.bookings} in the selected scope. The original name remains in the audit history.</p> : null}</section>

          <section><h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-950"><MapPinned className="h-4 w-4" />{t.linked}</h3><LocationAutocomplete label={t.search} value={query} onChange={setQuery} onManualInput={() => setSelected(null)} onSelectLocation={setSelected} selectedLocation={selected} required language={language} configMissingMessage="Google Maps location search is unavailable." manualEntryText="Select a verified Google result before approval." containerClassName="form-field" onConfigurationChange={(configured) => setPlacesAvailable(configured)} />
            {selected ? <div className="mt-3 min-w-0 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm"><dl className="space-y-2"><div><dt className="text-xs font-bold uppercase text-emerald-700">{t.googleName}</dt><dd className="break-words font-bold text-emerald-950">{selected.label}</dd></div><div><dt className="text-xs font-bold uppercase text-emerald-700">{t.address}</dt><dd className="break-words text-emerald-900">{selected.formatted_address}</dd></div><div><dt className="text-xs font-bold uppercase text-emerald-700">Place ID</dt><dd className="break-all text-xs text-emerald-800">{selected.place_id}</dd></div><div><dt className="text-xs font-bold uppercase text-emerald-700">{t.coordinates}</dt><dd className="text-xs text-emerald-800">{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</dd></div></dl><div className="mt-3 flex flex-wrap gap-2"><a href={mapsUrl(selected)} target="_blank" rel="noreferrer" className="btn-secondary min-h-9 text-xs"><ExternalLink className="h-4 w-4" />{t.open}</a><button type="button" className="btn-secondary min-h-9 text-xs" onClick={() => { setSelected(null); setQuery(issue.label); setOutsideThailandApproved(false); }}><RotateCcw className="h-4 w-4" />{t.change}</button></div></div> : null}
          </section>

          {snapshot ? <section className="rounded-md border border-slate-200 bg-slate-50 p-3"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-950"><Users className="h-4 w-4" />{t.clients}</h3><div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{snapshot.clients.map((client) => <div key={client.key} className="flex min-w-0 justify-between gap-2"><span className="truncate">{client.clientName || t.unknown}</span><strong>{client.count.toLocaleString()}</strong></div>)}</div><p className="mt-2 border-t border-slate-200 pt-2 text-xs font-bold text-slate-700">{snapshot.clients.reduce((sum, client) => sum + client.count, 0).toLocaleString()} / {snapshot.uniqueAffectedBookings.toLocaleString()} {t.bookings}</p></section> : null}

          {snapshot ? <section><h3 className="text-sm font-bold text-slate-950">{t.reuse}</h3><div className="mt-2 space-y-2">
          {snapshot.clients.some((client) => client.clientId) ? <label className={`flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 ${scope === "client" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white"}`}><input type="radio" name="location-scope" className="mt-1 h-4 w-4 shrink-0" checked={scope === "client"} onChange={() => chooseScope("client")} /><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-950">{t.client}</strong><select className="form-input mt-2 min-w-0 max-w-full bg-white" value={clientKey} onChange={(event) => { setClientKey(event.target.value); chooseScope("client"); }}>{snapshot.clients.filter((client) => client.clientId).map((client) => <option key={client.key} value={client.key}>{client.clientName} ({client.count})</option>)}</select>{scope === "client" ? <span className="mt-1 block text-xs font-semibold text-slate-700">{affectedCount.toLocaleString()} {t.bookings}</span> : null}</span></label> : null}
            <label className={`flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 ${scope === "global" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white"}`}><input type="radio" name="location-scope" className="mt-1 h-4 w-4 shrink-0" checked={scope === "global"} onChange={() => chooseScope("global")} /><span><strong className="block text-sm text-slate-950">{t.global}</strong><span className="mt-1 block text-xs text-slate-600">{snapshot.uniqueAffectedBookings.toLocaleString()} {t.bookings}</span></span></label>
            <label className={`flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 ${scope === "individual" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white"}`}><input type="radio" name="location-scope" className="mt-1 h-4 w-4 shrink-0" checked={scope === "individual"} onChange={() => chooseScope("individual")} /><span><strong className="block text-sm text-slate-950">{t.individual}</strong><span className="mt-1 block text-xs text-slate-600">{snapshot.uniqueAffectedBookings.toLocaleString()} {t.bookings}</span></span></label>
          </div></section> : null}

          {ambiguous ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="flex items-start gap-2 font-semibold"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{t.warning}</span></p>{scope === "global" ? <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-amber-200 pt-3 text-xs font-semibold"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={confirmAmbiguousGlobal} onChange={(event) => setConfirmAmbiguousGlobal(event.target.checked)} /><span>{t.confirmGlobal}</span></label> : null}</div> : null}

          {snapshot?.routes.length ? <details className="group rounded-md border border-slate-200"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 text-sm font-bold text-slate-800">{t.advanced}<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary><div className="border-t border-slate-200 p-3"><label className={`flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 ${scope === "route" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200"}`}><input type="radio" name="location-scope" className="mt-1 h-4 w-4 shrink-0" checked={scope === "route"} onChange={() => chooseScope("route")} /><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-950">{t.route}</strong><select className="form-input mt-2 min-w-0 max-w-full bg-white" value={routeKey} onChange={(event) => { setRouteKey(event.target.value); chooseScope("route"); }}>{snapshot.routes.map((route) => <option key={route.key} value={route.key}>{route.clientName}: {route.pickup} to {route.dropoff} ({route.count})</option>)}</select>{scope === "route" ? <span className="mt-1 block text-xs font-semibold text-slate-700">{affectedCount.toLocaleString()} {t.bookings}</span> : null}</span></label></div></details> : null}

          {snapshotChange && !snapshotReviewed ? <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950" data-testid="stale-snapshot-review"><p className="font-bold">{t.changed}: {snapshotChange.previous.toLocaleString()} to {snapshotChange.current.toLocaleString()}</p><p className="mt-1 text-xs">{t.changedDetail}</p><button type="button" className="btn-secondary mt-3" onClick={() => { setSnapshotReviewed(true); setSnapshotChange(null); setConfirmAmbiguousGlobal(false); }}>{t.reviewCount}</button></div> : null}
          {!countsValid && !snapshotLoading ? <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800">Location review counts do not reconcile. Approval is blocked.</p> : null}
          {outsideThailand ? <label className="flex cursor-pointer items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-900"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={outsideThailandApproved} onChange={(event) => setOutsideThailandApproved(event.target.checked)} /><span>{t.outside}</span></label> : null}
          {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
        {onNeedsClientReview && ambiguous ? <button type="button" className="btn-secondary mr-auto" onClick={onNeedsClientReview}>{t.needsClient}</button> : null}
        <button type="button" className="btn-secondary" onClick={onClose}>{t.cancel}</button>
        {!selected && placesAvailable === false ? null : scope === "individual" ? <button type="button" className="btn-primary" onClick={onReviewIndividually}>{t.review} ({affectedCount.toLocaleString()})</button> : <button type="button" className="btn-primary" disabled={approvalBlocked} onClick={() => void submit()}><MapPinned className="h-4 w-4" />{saving ? t.saving : `${t.approve} ${affectedCount.toLocaleString()} ${t.bookings}`}</button>}
      </footer>
    </div>
  </div>;
}
