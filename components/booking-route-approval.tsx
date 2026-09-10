"use client";

import clsx from "clsx";
import { CheckCircle2, ChevronDown, ExternalLink, MapPinned, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocationAutocomplete, type StructuredLocation } from "@/components/location-autocomplete";
import { fetchJson } from "@/lib/http";
import type { TrafficAwareRouteEstimate } from "@/lib/route-planning";
import { supabase } from "@/lib/supabase";
import type { RouteApprovalLocation, RouteApprovalQueue, RouteApprovalStatus } from "@/lib/booking-route-approvals";

type FilterKey = "repeat" | "unconfirmed" | "confirmed" | "needs_review" | "all";

const copyByLanguage = {
  en: {
    title: "Route Approval",
    subtitle: "Approve repeated pickup/drop-off routes once, then confirm every matching booking.",
    repeatRoutes: "Repeat routes",
    confirmed: "Confirmed",
    remaining: "Remaining",
    bookingsConfirmed: "Bookings confirmed",
    bookingsAwaiting: "Bookings awaiting route verification",
    needsReview: "Needs review",
    repeat: "Repeat routes",
    unconfirmed: "Unconfirmed",
    all: "All routes",
    bookingsAffected: "bookings affected",
    activeDates: "active dates",
    pickup: "Pickup",
    dropoff: "Drop-off",
    bookingDiary: "Booking Diary",
    google: "Google",
    formattedAddress: "Formatted address",
    placeId: "Place ID",
    coordinates: "Coordinates",
    distance: "Distance",
    pending: "Pending verification",
    reopened: "Reopened",
    matched: "Maps matched",
    approveRoute: "Approve Route",
    reopenRoute: "Reopen route",
    calculateDistance: "Calculate distance",
    calculating: "Calculating...",
    reviewBookings: "Review bookings",
    hideBookings: "Hide bookings",
    refresh: "Refresh",
    loading: "Loading route approval queue...",
    noRows: "No routes match this filter.",
    selectVerifiedLocations: "Select verified Google Maps pickup and drop-off locations before approval.",
    routeApproved: "Route approved and matching bookings confirmed.",
    routeReopened: "Route reopened and matching bookings marked as unconfirmed.",
    mapsUnavailable: "Unable to calculate Google Maps distance. Please confirm both Maps locations.",
    exactGrouping: "Grouped by normalized pickup and drop-off only. Manual Booking Diary names are preserved.",
    job: "Job",
    client: "Client",
    driver: "Driver",
    vehicle: "Vehicle"
  },
  th: {
    title: "อนุมัติเส้นทาง",
    subtitle: "อนุมัติเส้นทางจุดรับ/จุดส่งที่ซ้ำกันครั้งเดียว แล้วให้งานจองที่ตรงกันได้รับการยืนยัน",
    repeatRoutes: "เส้นทางซ้ำ",
    confirmed: "ยืนยันแล้ว",
    remaining: "คงเหลือ",
    bookingsConfirmed: "งานจองที่ยืนยันแล้ว",
    bookingsAwaiting: "งานจองที่รอยืนยันเส้นทาง",
    needsReview: "ต้องตรวจสอบ",
    repeat: "เส้นทางซ้ำ",
    unconfirmed: "ยังไม่ยืนยัน",
    all: "ทุกเส้นทาง",
    bookingsAffected: "งานจองที่ได้รับผล",
    activeDates: "วันที่ใช้งาน",
    pickup: "จุดรับ",
    dropoff: "จุดส่ง",
    bookingDiary: "Booking Diary",
    google: "Google",
    formattedAddress: "ที่อยู่เต็ม",
    placeId: "Place ID",
    coordinates: "พิกัด",
    distance: "ระยะทาง",
    pending: "รอยืนยัน",
    reopened: "เปิดตรวจใหม่",
    matched: "พบตำแหน่ง Maps",
    approveRoute: "อนุมัติเส้นทาง",
    reopenRoute: "เปิดตรวจใหม่",
    calculateDistance: "คำนวณระยะทาง",
    calculating: "กำลังคำนวณ...",
    reviewBookings: "ดูงานจอง",
    hideBookings: "ซ่อนงานจอง",
    refresh: "รีเฟรช",
    loading: "กำลังโหลดคิวอนุมัติเส้นทาง...",
    noRows: "ไม่มีเส้นทางที่ตรงกับตัวกรอง",
    selectVerifiedLocations: "กรุณาเลือกตำแหน่ง Google Maps จุดรับและจุดส่งก่อนอนุมัติ",
    routeApproved: "อนุมัติเส้นทางแล้ว และยืนยันงานจองที่ตรงกันแล้ว",
    routeReopened: "เปิดตรวจเส้นทางใหม่แล้ว และตั้งค่างานจองที่ตรงกันเป็นยังไม่ยืนยัน",
    mapsUnavailable: "ไม่สามารถคำนวณระยะทาง Google Maps ได้ กรุณายืนยันตำแหน่ง Maps ทั้งจุดรับและจุดส่ง",
    exactGrouping: "จัดกลุ่มจากจุดรับและจุดส่งที่ normalize แล้วเท่านั้น โดยคงชื่อ Booking Diary เดิมไว้",
    job: "งาน",
    client: "ลูกค้า",
    driver: "คนขับ",
    vehicle: "รถ"
  }
} as const;

async function adminRequest<T>(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Authentication required.");
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Route approval request failed.");
  return payload as T;
}

function structured(location: RouteApprovalLocation): StructuredLocation | null {
  if (!location.googlePlaceId || location.latitude == null || location.longitude == null) return null;
  return {
    label: location.displayName || location.fullGoogleAddress || "",
    formatted_address: location.fullGoogleAddress || location.displayName,
    place_id: location.googlePlaceId,
    lat: location.latitude,
    lng: location.longitude,
    verified: true
  };
}

function locationPayload(location: StructuredLocation | null, fallbackName: string): RouteApprovalLocation {
  return {
    displayName: location?.label || fallbackName,
    fullGoogleAddress: location?.formatted_address || null,
    googlePlaceId: location?.place_id || null,
    latitude: Number.isFinite(location?.lat) ? location?.lat ?? null : null,
    longitude: Number.isFinite(location?.lng) ? location?.lng ?? null : null
  };
}

function statusCopy(status: RouteApprovalStatus, c: (typeof copyByLanguage)[keyof typeof copyByLanguage]) {
  if (status === "confirmed") return c.confirmed;
  if (status === "needs_review") return c.needsReview;
  if (status === "reopened") return c.reopened;
  return c.pending;
}

function statusClass(status: RouteApprovalStatus) {
  if (status === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "needs_review" || status === "reopened") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatDistance(value: number | null) {
  return value != null && Number.isFinite(value) && value > 0 ? `${value.toFixed(1)} km` : "-";
}

function mapsUrl(placeId: string | null, address: string | null) {
  if (!address) return null;
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", address);
  if (placeId) url.searchParams.set("query_place_id", placeId.replace(/^places\//, ""));
  return url.toString();
}

function LocationReview({
  title,
  original,
  value,
  text,
  language,
  onText,
  onSelect
}: {
  title: string;
  original: string;
  value: StructuredLocation | null;
  text: string;
  language: "en" | "th";
  onText: (value: string) => void;
  onSelect: (value: StructuredLocation | null) => void;
}) {
  const c = copyByLanguage[language];
  const link = mapsUrl(value?.place_id ?? null, value?.formatted_address ?? null);
  return <section className="rounded-md border border-slate-200 bg-white p-3">
    <h3 className="text-sm font-bold text-slate-950">{title}</h3>
    <p className="mt-2 text-xs font-bold uppercase text-slate-500">{c.bookingDiary}</p>
    <p className="break-words text-sm font-semibold text-slate-800">{original || "-"}</p>
    <div className="mt-3">
      <LocationAutocomplete
        label={c.google}
        value={text}
        onChange={onText}
        onManualInput={() => onSelect(null)}
        onSelectLocation={onSelect}
        selectedLocation={value}
        language={language}
        configMissingMessage={c.mapsUnavailable}
        manualEntryText={c.selectVerifiedLocations}
      />
    </div>
    {value ? <dl className="mt-3 space-y-1 text-xs text-slate-600">
      <div><dt className="font-bold text-slate-500">{c.formattedAddress}</dt><dd className="break-words">{value.formatted_address}</dd></div>
      <div><dt className="font-bold text-slate-500">{c.placeId}</dt><dd className="break-all">{value.place_id}</dd></div>
      <div><dt className="font-bold text-slate-500">{c.coordinates}</dt><dd>{value.lat}, {value.lng}</dd></div>
      {link ? <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-brand-700"><ExternalLink className="h-3.5 w-3.5" />Google Maps</a> : null}
    </dl> : null}
  </section>;
}

export function BookingRouteApproval({ active, language, onAvailabilityChange }: {
  active: boolean;
  language: "en" | "th";
  onAvailabilityChange: (count: number) => void;
}) {
  const c = copyByLanguage[language];
  const [queue, setQueue] = useState<RouteApprovalQueue | null>(null);
  const [filter, setFilter] = useState<FilterKey>("repeat");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [pickupText, setPickupText] = useState("");
  const [dropoffText, setDropoffText] = useState("");
  const [pickup, setPickup] = useState<StructuredLocation | null>(null);
  const [dropoff, setDropoff] = useState<StructuredLocation | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [routeUrl, setRouteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [distanceLoading, setDistanceLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminRequest<RouteApprovalQueue>("/api/admin/booking-maps/route-approvals");
      setQueue(result);
      onAvailabilityChange(result.summary.repeatRoutesRemaining);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load route approvals.");
      onAvailabilityChange(0);
    } finally {
      setLoading(false);
    }
  }, [onAvailabilityChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const routes = useMemo(() => {
    const rows = queue?.routes ?? [];
    if (filter === "confirmed") return rows.filter((route) => route.status === "confirmed");
    if (filter === "unconfirmed") return rows.filter((route) => route.status !== "confirmed");
    if (filter === "needs_review") return rows.filter((route) => route.status === "needs_review" || route.status === "reopened");
    return rows;
  }, [filter, queue]);
  const selected = routes.find((route) => route.key === selectedKey) ?? routes[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setSelectedKey(selected.key);
    const selectedPickup = structured(selected.pickup);
    const selectedDropoff = structured(selected.dropoff);
    setPickup(selectedPickup);
    setDropoff(selectedDropoff);
    setPickupText(selectedPickup?.formatted_address || selected.pickup.fullGoogleAddress || selected.displayPickup);
    setDropoffText(selectedDropoff?.formatted_address || selected.dropoff.fullGoogleAddress || selected.displayDropoff);
    setDistanceKm(selected.googleDistanceKm);
    setRouteUrl(selected.googleMapsRouteUrl);
    setMessage(null);
    setError(null);
  }, [selected]);

  const calculateDistance = async () => {
    if (!pickup?.place_id || !dropoff?.place_id) {
      setError(c.mapsUnavailable);
      return;
    }
    setDistanceLoading(true);
    setError(null);
    try {
      const result = await fetchJson<TrafficAwareRouteEstimate>("/api/distance-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: pickup,
          destination: dropoff,
          requireVerifiedPoints: true
        })
      });
      const meters = Number(result.data?.distanceMeters);
      if (!Number.isFinite(meters) || meters <= 0) throw new Error(c.mapsUnavailable);
      setDistanceKm(Math.round((meters / 1000) * 10) / 10);
      const url = new URL("https://www.google.com/maps/dir/");
      url.searchParams.set("api", "1");
      url.searchParams.set("origin", pickup.formatted_address);
      url.searchParams.set("destination", dropoff.formatted_address);
      url.searchParams.set("origin_place_id", pickup.place_id.replace(/^places\//, ""));
      url.searchParams.set("destination_place_id", dropoff.place_id.replace(/^places\//, ""));
      setRouteUrl(url.toString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c.mapsUnavailable);
    } finally {
      setDistanceLoading(false);
    }
  };

  const approve = async () => {
    if (!selected || !pickup?.place_id || !dropoff?.place_id) {
      setError(c.selectVerifiedLocations);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await adminRequest<{ affectedBookings: number; queue: RouteApprovalQueue }>("/api/admin/booking-maps/route-approvals", {
        method: "POST",
        body: JSON.stringify({
          action: "approve",
          route: {
            normalizedPickup: selected.normalizedPickup,
            normalizedDropoff: selected.normalizedDropoff,
            displayPickup: selected.displayPickup,
            displayDropoff: selected.displayDropoff,
            pickup: locationPayload(pickup, selected.displayPickup),
            dropoff: locationPayload(dropoff, selected.displayDropoff),
            googleDistanceKm: distanceKm,
            routeDistanceMeters: distanceKm ? Math.round(distanceKm * 1000) : null,
            googleMapsRouteUrl: routeUrl
          }
        })
      });
      setQueue(result.queue);
      onAvailabilityChange(result.queue.summary.repeatRoutesRemaining);
      setMessage(`${c.routeApproved} ${result.affectedBookings.toLocaleString()} ${c.bookingsAffected}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to approve route.");
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    if (!selected?.approvalId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await adminRequest<{ affectedBookings: number; queue: RouteApprovalQueue }>("/api/admin/booking-maps/route-approvals", {
        method: "POST",
        body: JSON.stringify({ action: "reopen", approvalId: selected.approvalId })
      });
      setQueue(result.queue);
      onAvailabilityChange(result.queue.summary.repeatRoutesRemaining);
      setMessage(`${c.routeReopened} ${result.affectedBookings.toLocaleString()} ${c.bookingsAffected}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reopen route.");
    } finally {
      setSaving(false);
    }
  };

  if (!active) return null;
  if (loading) return <p className="py-10 text-center text-sm text-slate-500">{c.loading}</p>;

  const summary = queue?.summary;
  return <section className="mt-4 grid gap-4">
    <header className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="badge-muted w-fit">{c.title}</p>
          <h2 className="mt-2 text-lg font-bold text-slate-950">{c.subtitle}</h2>
          <p className="mt-1 text-xs text-slate-500">{c.exactGrouping}</p>
        </div>
        <button type="button" className="btn-secondary gap-2" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />{c.refresh}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label={c.repeatRoutes} value={summary?.repeatRoutesFound ?? 0} />
        <Metric label={c.confirmed} value={summary?.repeatRoutesConfirmed ?? 0} tone="green" />
        <Metric label={c.remaining} value={summary?.repeatRoutesRemaining ?? 0} tone="amber" />
        <Metric label={c.bookingsConfirmed} value={summary?.bookingsCoveredByConfirmedRoutes ?? 0} tone="green" />
        <Metric label={c.bookingsAwaiting} value={summary?.bookingsAwaitingRouteVerification ?? 0} tone="amber" />
        <Metric label={c.needsReview} value={summary?.needsReview ?? 0} tone="amber" />
      </div>
    </header>

    <div className="flex flex-wrap gap-2">
      {(["repeat", "unconfirmed", "confirmed", "needs_review", "all"] as const).map((key) => (
        <button key={key} type="button" onClick={() => setFilter(key)} className={clsx("booking-diary-tab", filter === key && "booking-diary-tab-active")}>
          {key === "needs_review" ? c.needsReview : c[key]}
        </button>
      ))}
    </div>

    {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{message}</p> : null}
    {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}

    {!selected ? <p className="rounded-md border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">{c.noRows}</p> : (
      <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
        <div className="max-h-[70vh] overflow-auto rounded-md border border-slate-200 bg-white">
          {routes.map((route) => <button
            key={route.key}
            type="button"
            onClick={() => setSelectedKey(route.key)}
            className={clsx("block w-full border-b border-slate-100 p-3 text-left transition hover:bg-slate-50", selected.key === route.key && "bg-brand-50")}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-bold text-slate-950">{route.displayPickup} <span className="text-brand-600">-&gt;</span> {route.displayDropoff}</p>
              <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold", statusClass(route.status))}>{statusCopy(route.status, c)}</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-600">{route.bookingCount.toLocaleString()} {c.bookingsAffected} · {route.activeDateCount.toLocaleString()} {c.activeDates}</p>
          </button>)}
        </div>

        <article className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-950">{selected.displayPickup} <span className="text-brand-600">-&gt;</span> {selected.displayDropoff}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">{selected.bookingCount.toLocaleString()} {c.bookingsAffected} · {selected.firstBookingDate} - {selected.latestBookingDate}</p>
            </div>
            <span className={clsx("inline-flex w-fit items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold", statusClass(selected.status))}>
              {selected.status === "confirmed" ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {statusCopy(selected.status, c)}
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <LocationReview title={c.pickup} original={selected.displayPickup} value={pickup} text={pickupText} language={language} onText={setPickupText} onSelect={setPickup} />
            <LocationReview title={c.dropoff} original={selected.displayDropoff} value={dropoff} text={dropoffText} language={language} onText={setDropoffText} onSelect={setDropoff} />
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-bold text-slate-950"><MapPinned className="mr-1 inline h-4 w-4 text-brand-700" />{c.distance}: {formatDistance(distanceKm)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary gap-2" disabled={distanceLoading || !pickup?.place_id || !dropoff?.place_id} onClick={() => void calculateDistance()}>
                  <RefreshCw className={clsx("h-4 w-4", distanceLoading && "animate-spin")} />{distanceLoading ? c.calculating : c.calculateDistance}
                </button>
                {routeUrl ? <a href={routeUrl} target="_blank" rel="noreferrer" className="btn-secondary gap-2"><ExternalLink className="h-4 w-4" />Google Maps</a> : null}
              </div>
            </div>
            {selected.needsReviewReasons.length ? <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{selected.needsReviewReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="mt-2 text-xs font-semibold text-emerald-700">{c.matched}</p>}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary gap-2" disabled={saving || !pickup?.place_id || !dropoff?.place_id} onClick={() => void approve()}>
              <CheckCircle2 className="h-4 w-4" />{c.approveRoute}
            </button>
            {selected.status === "confirmed" && selected.approvalId ? <button type="button" className="btn-secondary gap-2" disabled={saving} onClick={() => void reopen()}>
              <RotateCcw className="h-4 w-4" />{c.reopenRoute}
            </button> : null}
          </div>

          <section className="mt-4 border-t border-slate-200 pt-4">
            <button type="button" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700" onClick={() => setExpandedKey(expandedKey === selected.key ? null : selected.key)}>
              <ChevronDown className={clsx("h-4 w-4 transition-transform", expandedKey === selected.key && "rotate-180")} />
              {expandedKey === selected.key ? c.hideBookings : c.reviewBookings}
            </button>
            {expandedKey === selected.key ? <div className="mt-3 max-h-72 overflow-auto rounded-md border border-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">{c.client}</th><th className="p-2">{c.job}</th><th className="p-2">{c.driver}</th><th className="p-2">{c.vehicle}</th></tr></thead>
                <tbody>{selected.bookings.map((booking) => <tr key={booking.id} className="border-t border-slate-100"><td className="p-2">{booking.bookingDate}</td><td className="p-2">{booking.clientName || "-"}</td><td className="p-2">{booking.jobOrderNumber || booking.bookingReference || "-"}</td><td className="p-2">{booking.driver || "-"}</td><td className="p-2">{booking.vehicleRegistration || "-"}</td></tr>)}</tbody>
              </table>
            </div> : null}
          </section>
        </article>
      </div>
    )}
  </section>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" }) {
  return <div className={clsx(
    "rounded-md border bg-white p-3",
    tone === "green" ? "border-emerald-200" : tone === "amber" ? "border-amber-200" : "border-slate-200"
  )}>
    <p className="text-xs font-bold text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-bold text-slate-950">{value.toLocaleString()}</p>
  </div>;
}
