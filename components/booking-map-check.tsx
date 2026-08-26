"use client";

import { Check, CheckCircle2, ExternalLink, Flag, Plus, Search, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationAutocomplete, type StructuredLocation } from "@/components/location-autocomplete";
import { createClient } from "@/lib/data";
import { supabase } from "@/lib/supabase";

type ClientSuggestion = {
  id: string;
  name: string;
  routeUses: number;
  confidence: "high" | "medium" | "low";
  reason: string;
};
type LocationValue = {
  displayName: string;
  fullGoogleAddress: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
};
type CheckField<T> = { confirmed: boolean; value: T | null; confirmedBy: string | null; confirmedAt: string | null };
type Review = {
  client: CheckField<{ id: string; name: string }>;
  pickup: CheckField<LocationValue>;
  dropoff: CheckField<LocationValue>;
  disposition: "active" | "skipped" | "investigation";
};
type RelatedBooking = {
  id: string;
  bookingDate: string;
  reference: string | null;
  clientName: string;
  pickup: string;
  dropoff: string;
  pickupPlaceId?: string | null;
  dropoffPlaceId?: string | null;
};
type BookingCheck = {
  id: string;
  bookingDate: string;
  bookingReference: string | null;
  jobOrderNumber: string | null;
  warehouseNumber: string | null;
  original: { clientId: string | null; clientName: string; pickup: string; dropoff: string };
  review: Review | null;
  status: "unchecked" | "partial" | "completed" | "investigation";
  disposition: "active" | "skipped" | "investigation";
  clientSuggestions: ClientSuggestion[];
  pickup: { candidate: LocationValue | null; confidence: string; reason: string; candidates: Array<{ placeId: string | null; address: string | null; count: number }> };
  dropoff: { candidate: LocationValue | null; confidence: string; reason: string; candidates: Array<{ placeId: string | null; address: string | null; count: number }> };
  routeUseCount: number;
  previousBookings: RelatedBooking[];
  matchingBookingCount: number;
};
type ResponseData = {
  clients: Array<{ id: string; name: string }>;
  totals: { unchecked: number; partial: number; completed: number; investigation: number };
  remaining: number;
  futureBookingsExcluded: number;
  checks: BookingCheck[];
};

const text = {
  en: {
    title: "Booking check", remaining: "remaining", unchecked: "Unchecked", partial: "Partially checked", completed: "Completed", investigation: "Needs investigation",
    allClients: "All clients", date: "Date", pickup: "Pickup", dropoff: "Drop-off", bookingDate: "Booking date", reference: "Job / warehouse number", client: "Current client",
    clientConfirmed: "Client confirmed", pickupConfirmed: "Pickup confirmed", dropoffConfirmed: "Drop-off confirmed", confidence: "confidence", openMaps: "Open in Google Maps",
    previous: "Previous bookings with this client or route", routeUses: "Exact route uses", confirmAll: "Confirm all and next", confirmClient: "Confirm client", confirmPickup: "Confirm pickup",
    confirmDropoff: "Confirm drop-off", editClient: "Edit client", changePickup: "Change/search pickup", changeDropoff: "Change/search drop-off", skip: "Skip for later",
    investigate: "Mark as needs investigation", matching: "Apply to matching bookings", affected: "bookings will receive these confirmations", noRows: "No bookings match these filters.", loading: "Loading booking checks..."
  },
  th: {
    title: "ตรวจสอบงานจอง", remaining: "รายการคงเหลือ", unchecked: "ยังไม่ตรวจ", partial: "ตรวจบางส่วน", completed: "เสร็จแล้ว", investigation: "ต้องตรวจสอบเพิ่มเติม",
    allClients: "ลูกค้าทั้งหมด", date: "วันที่", pickup: "จุดรับ", dropoff: "จุดส่ง", bookingDate: "วันที่จอง", reference: "เลขงาน / เลขคลัง", client: "ลูกค้าปัจจุบัน",
    clientConfirmed: "ยืนยันลูกค้าแล้ว", pickupConfirmed: "ยืนยันจุดรับแล้ว", dropoffConfirmed: "ยืนยันจุดส่งแล้ว", confidence: "ความมั่นใจ", openMaps: "เปิดใน Google Maps",
    previous: "งานก่อนหน้าที่มีลูกค้าหรือเส้นทางเดียวกัน", routeUses: "จำนวนครั้งของเส้นทางเดียวกัน", confirmAll: "ยืนยันทั้งหมดและรายการถัดไป", confirmClient: "ยืนยันลูกค้า", confirmPickup: "ยืนยันจุดรับ",
    confirmDropoff: "ยืนยันจุดส่ง", editClient: "แก้ไขลูกค้า", changePickup: "ค้นหา/เปลี่ยนจุดรับ", changeDropoff: "ค้นหา/เปลี่ยนจุดส่ง", skip: "ข้ามไว้ก่อน",
    investigate: "ทำเครื่องหมายว่าต้องตรวจสอบ", matching: "ใช้กับงานจองที่ตรงกัน", affected: "งานจองจะได้รับการยืนยันนี้", noRows: "ไม่มีงานจองที่ตรงกับตัวกรอง", loading: "กำลังโหลดรายการตรวจสอบ..."
  }
} as const;

async function request<T>(path: string, init?: RequestInit) {
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
  if (!response.ok) throw new Error(payload.error || "Booking check request failed.");
  return payload as T;
}

function structured(value: LocationValue | null): StructuredLocation | null {
  if (!value?.googlePlaceId) return null;
  return {
    label: value.displayName,
    formatted_address: value.fullGoogleAddress,
    place_id: value.googlePlaceId,
    lat: value.latitude,
    lng: value.longitude,
    verified: true
  };
}

function locationValue(value: StructuredLocation | null): LocationValue | null {
  if (!value?.place_id) return null;
  return {
    displayName: value.label,
    fullGoogleAddress: value.formatted_address,
    googlePlaceId: value.place_id,
    latitude: value.lat,
    longitude: value.lng
  };
}

function mapsUrl(placeId: string, address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}&query_place_id=${encodeURIComponent(placeId.replace(/^places\//, ""))}`;
}

export function BookingMapCheck({ active, language, focus, onClearFocus, onAvailabilityChange }: {
  active: boolean;
  language: "en" | "th";
  focus: { label: string; side: "pickup" | "dropoff" | "pickup_dropoff" } | null;
  onClearFocus: () => void;
  onAvailabilityChange: (count: number) => void;
}) {
  const c = text[language];
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("unchecked");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pickupFilter, setPickupFilter] = useState("");
  const [dropoffFilter, setDropoffFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastHandledId, setLastHandledId] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [pickupText, setPickupText] = useState("");
  const [dropoffText, setDropoffText] = useState("");
  const [pickup, setPickup] = useState<StructuredLocation | null>(null);
  const [dropoff, setDropoff] = useState<StructuredLocation | null>(null);
  const [applyMatching, setApplyMatching] = useState(false);
  const [matchingPreview, setMatchingPreview] = useState<{ count: number; bookings: RelatedBooking[] } | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const clientSelectionOverride = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await request<ResponseData>("/api/admin/booking-maps/booking-checks");
      setData(result);
      onAvailabilityChange(result.remaining);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load booking checks.");
    } finally {
      setLoading(false);
    }
  }, [onAvailabilityChange]);

  useEffect(() => {
    if (active) {
      void load();
      return;
    }
    void request<{ remaining: number }>("/api/admin/booking-maps/booking-checks?summary=true")
      .then((result) => onAvailabilityChange(result.remaining))
      .catch(() => onAvailabilityChange(0));
  }, [active, load, onAvailabilityChange]);

  const clients = useMemo(() => [...new Set((data?.checks ?? []).map((item) => item.original.clientName))].sort(), [data]);
  const filtered = useMemo(() => (data?.checks ?? [])
    .filter((item) => {
      if (!focus) return true;
      const expected = focus.label.normalize("NFC").trim().toLocaleLowerCase("th-TH");
      const pickupMatches = item.original.pickup.normalize("NFC").trim().toLocaleLowerCase("th-TH") === expected;
      const dropoffMatches = item.original.dropoff.normalize("NFC").trim().toLocaleLowerCase("th-TH") === expected;
      return focus.side === "pickup" ? pickupMatches : focus.side === "dropoff" ? dropoffMatches : pickupMatches || dropoffMatches;
    })
    .filter((item) => status === "all" || item.status === status)
    .filter((item) => !clientFilter || item.original.clientName === clientFilter)
    .filter((item) => !dateFilter || item.bookingDate === dateFilter)
    .filter((item) => !pickupFilter || item.original.pickup.toLocaleLowerCase().includes(pickupFilter.toLocaleLowerCase()))
    .filter((item) => !dropoffFilter || item.original.dropoff.toLocaleLowerCase().includes(dropoffFilter.toLocaleLowerCase()))
    .sort((a, b) => Number(a.id === lastHandledId) - Number(b.id === lastHandledId) || Number(a.disposition === "skipped") - Number(b.disposition === "skipped") || b.bookingDate.localeCompare(a.bookingDate)),
  [clientFilter, data, dateFilter, dropoffFilter, focus, lastHandledId, pickupFilter, status]);
  const current = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!current) return;
    const selectedClient = clientSelectionOverride.current || current.review?.client.value?.id || current.original.clientId || current.clientSuggestions[0]?.id || "";
    clientSelectionOverride.current = null;
    const selectedPickup = structured(current.review?.pickup.value ?? current.pickup.candidate);
    const selectedDropoff = structured(current.review?.dropoff.value ?? current.dropoff.candidate);
    setSelectedId(current.id);
    setClientId(selectedClient);
    setPickup(selectedPickup);
    setDropoff(selectedDropoff);
    setPickupText(selectedPickup?.formatted_address || current.original.pickup);
    setDropoffText(selectedDropoff?.formatted_address || current.original.dropoff);
    setApplyMatching(false);
    setMatchingPreview(null);
  }, [current]);

  useEffect(() => {
    if (!applyMatching || !current) return;
    let cancelled = false;
    void request<{ count: number; bookings: RelatedBooking[] }>(`/api/admin/booking-maps/booking-checks?matching=true&bookingId=${encodeURIComponent(current.id)}`)
      .then((result) => { if (!cancelled) setMatchingPreview(result); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to preview matching bookings."); });
    return () => { cancelled = true; };
  }, [applyMatching, current]);

  const selectedClientSuggestion = current?.clientSuggestions.find((client) => client.id === clientId) ?? null;
  const selectedClientRecord = data?.clients.find((client) => client.id === clientId) ?? null;
  const selectedClient = selectedClientRecord ? {
    ...selectedClientRecord,
    confidence: selectedClientSuggestion?.confidence ?? "low",
    reason: selectedClientSuggestion?.reason ?? "Selected from the existing client directory; confirm manually."
  } : null;
  const matchingPreviewReady = !applyMatching || matchingPreview?.count === current?.matchingBookingCount;
  const focusedBookingCount = useMemo(() => {
    if (!focus) return 0;
    const expected = focus.label.normalize("NFC").trim().toLocaleLowerCase("th-TH");
    return (data?.checks ?? []).filter((item) => {
      const pickupMatches = item.original.pickup.normalize("NFC").trim().toLocaleLowerCase("th-TH") === expected;
      const dropoffMatches = item.original.dropoff.normalize("NFC").trim().toLocaleLowerCase("th-TH") === expected;
      return focus.side === "pickup" ? pickupMatches : focus.side === "dropoff" ? dropoffMatches : pickupMatches || dropoffMatches;
    }).length;
  }, [data, focus]);

  const addClient = async () => {
    if (!newClientName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createClient(newClientName);
      setNewClientName("");
      clientSelectionOverride.current = result.client.id;
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add client.");
    } finally {
      setSaving(false);
    }
  };

  const save = async (action: string) => {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      await request("/api/admin/booking-maps/booking-checks", {
        method: "POST",
        body: JSON.stringify({
          bookingId: current.id,
          action,
          applyMatching: action.startsWith("confirm") && applyMatching,
          client: selectedClient ? { id: selectedClient.id, name: selectedClient.name } : null,
          pickup: locationValue(pickup),
          dropoff: locationValue(dropoff)
        })
      });
      setLastHandledId(current.id);
      setSelectedId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save booking check.");
    } finally {
      setSaving(false);
    }
  };

  if (!active) return null;
  if (loading) return <p className="py-10 text-center text-sm text-slate-500">{c.loading}</p>;

  return <section className="mt-4 min-w-0">
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 className="text-lg font-bold text-slate-950">{c.title}</h2><p className="mt-1 text-sm font-bold text-amber-700">{data?.remaining.toLocaleString()} {c.remaining}</p></div>
      <button className="btn-secondary" type="button" onClick={() => void load()}><Search className="h-4 w-4" />Refresh</button>
    </div>
    {error ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
    {focus ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900"><p><strong>{focus.label}</strong> · {focusedBookingCount.toLocaleString()} {language === "th" ? "งานจองที่ได้รับผลกระทบ" : "affected bookings"}</p><button type="button" className="inline-flex items-center gap-1 font-bold" onClick={onClearFocus}><X className="h-4 w-4" />{language === "th" ? "แสดงทั้งหมด" : "Show all"}</button></div> : null}
    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {(["unchecked", "partial", "completed", "investigation"] as const).map((key) => <button key={key} type="button" onClick={() => setStatus(key)} className={`rounded-md border p-3 text-left ${status === key ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}><span className="block text-xs font-bold text-slate-500">{c[key]}</span><span className="mt-1 block text-lg font-bold text-slate-950">{data?.totals[key] ?? 0}</span></button>)}
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <select className="form-input bg-white" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="unchecked">{c.unchecked}</option><option value="partial">{c.partial}</option><option value="completed">{c.completed}</option><option value="investigation">{c.investigation}</option></select>
      <select className="form-input bg-white" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="">{c.allClients}</option>{clients.map((name) => <option key={name}>{name}</option>)}</select>
      <input type="date" className="form-input bg-white" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label={c.date} />
      <input className="form-input bg-white" value={pickupFilter} onChange={(event) => setPickupFilter(event.target.value)} placeholder={c.pickup} />
      <input className="form-input bg-white" value={dropoffFilter} onChange={(event) => setDropoffFilter(event.target.value)} placeholder={c.dropoff} />
    </div>

    {!current ? <p className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">{c.noRows}</p> : <article className="mt-4 rounded-md border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-bold text-slate-500">{c.bookingDate}</p><p className="font-bold text-slate-950">{current.bookingDate}</p><p className="mt-1 text-sm text-slate-600">{c.reference}: {current.jobOrderNumber || current.warehouseNumber || current.bookingReference || "-"}</p></div>
        <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-slate-200 px-2 py-1">{current.status}</span><span className="rounded-full border border-slate-200 px-2 py-1">{c.routeUses}: {current.routeUseCount}</span></div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="min-w-0 rounded-md border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-950">{c.client}</h3>{current.review?.client.confirmed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}</div>
          <p className="mt-1 break-words text-sm text-slate-700">{current.original.clientName}</p>
          <label className="mt-3 block"><span className="form-label">{c.editClient}</span><select className="form-input bg-white" value={clientId} onChange={(event) => setClientId(event.target.value)}>{(data?.clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <div className="mt-2 flex gap-2"><input className="form-input min-w-0 bg-white" value={newClientName} onChange={(event) => setNewClientName(event.target.value)} placeholder={language === "th" ? "เพิ่มชื่อลูกค้าใหม่" : "Add a client name"} /><button type="button" className="btn-secondary shrink-0" disabled={saving || !newClientName.trim()} onClick={() => void addClient()} aria-label={language === "th" ? "เพิ่มลูกค้า" : "Add client"}><Plus className="h-4 w-4" /></button></div>
          {selectedClient ? <div className="mt-2 text-xs text-slate-600"><p className="font-bold">{selectedClient.confidence} {c.confidence}</p><p className="mt-1">{selectedClient.reason}</p></div> : null}
          <button className="btn-secondary mt-3" type="button" disabled={saving || !matchingPreviewReady || !selectedClient} onClick={() => void save("confirm_client")}><Check className="h-4 w-4" />{c.confirmClient}</button>
        </section>

        <LocationField title={c.pickup} original={current.original.pickup} confirmed={Boolean(current.review?.pickup.confirmed)} confidence={current.pickup.confidence} reason={current.pickup.reason} candidates={current.pickup.candidates} value={pickupText} selected={pickup} language={language} onText={setPickupText} onSelect={setPickup} confirmLabel={c.confirmPickup} changeLabel={c.changePickup} openLabel={c.openMaps} saving={saving || !matchingPreviewReady} onConfirm={() => void save("confirm_pickup")} />
        <LocationField title={c.dropoff} original={current.original.dropoff} confirmed={Boolean(current.review?.dropoff.confirmed)} confidence={current.dropoff.confidence} reason={current.dropoff.reason} candidates={current.dropoff.candidates} value={dropoffText} selected={dropoff} language={language} onText={setDropoffText} onSelect={setDropoff} confirmLabel={c.confirmDropoff} changeLabel={c.changeDropoff} openLabel={c.openMaps} saving={saving || !matchingPreviewReady} onConfirm={() => void save("confirm_dropoff")} />
      </div>

      <section className="mt-4 border-t border-slate-200 pt-4"><h3 className="text-sm font-bold text-slate-950">{c.previous}</h3><div className="mt-2 max-h-56 overflow-auto"><table className="min-w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">{c.date}</th><th className="p-2">{c.client}</th><th className="p-2">{c.pickup}</th><th className="p-2">{c.dropoff}</th></tr></thead><tbody>{current.previousBookings.map((booking) => <tr key={booking.id} className="border-t border-slate-100"><td className="p-2">{booking.bookingDate}</td><td className="p-2">{booking.clientName}</td><td className="p-2 break-words">{booking.pickup}</td><td className="p-2 break-words">{booking.dropoff}</td></tr>)}</tbody></table></div></section>

      {current.matchingBookingCount > 1 ? <section className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3"><label className="flex items-start gap-2 text-sm font-bold text-amber-900"><input type="checkbox" className="mt-1" checked={applyMatching} onChange={(event) => setApplyMatching(event.target.checked)} />{c.matching} ({current.matchingBookingCount})</label>{applyMatching ? <><p className="mt-2 text-xs text-amber-800">{matchingPreview?.count ?? 0} {c.affected}</p><div className="mt-2 max-h-52 overflow-auto rounded-md border border-amber-200 bg-white"><table className="min-w-full text-left text-xs"><tbody>{(matchingPreview?.bookings ?? []).map((booking) => <tr key={booking.id} className="border-b border-slate-100"><td className="p-2">{booking.bookingDate}</td><td className="p-2">{booking.clientName}</td><td className="p-2">{booking.pickup} → {booking.dropoff}</td></tr>)}</tbody></table></div></> : null}</section> : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4"><button type="button" className="btn-primary" disabled={saving || !matchingPreviewReady || !selectedClient || !pickup?.place_id || !dropoff?.place_id} onClick={() => void save("confirm_all")}><CheckCircle2 className="h-4 w-4" />{c.confirmAll}</button><button type="button" className="btn-secondary" disabled={saving} onClick={() => void save("skip")}><SkipForward className="h-4 w-4" />{c.skip}</button><button type="button" className="btn-secondary" disabled={saving} onClick={() => void save("investigate")}><Flag className="h-4 w-4" />{c.investigate}</button></div>
    </article>}
  </section>;
}

function LocationField({ title, original, confirmed, confidence, reason, candidates, value, selected, language, onText, onSelect, confirmLabel, changeLabel, openLabel, saving, onConfirm }: {
  title: string; original: string; confirmed: boolean; confidence: string; reason: string;
  candidates: Array<{ placeId: string | null; address: string | null; count: number }>;
  value: string; selected: StructuredLocation | null; language: "en" | "th";
  onText: (value: string) => void; onSelect: (value: StructuredLocation | null) => void;
  confirmLabel: string; changeLabel: string; openLabel: string; saving: boolean; onConfirm: () => void;
}) {
  return <section className="min-w-0 rounded-md border border-slate-200 p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-950">{title}</h3>{confirmed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}</div>
    <p className="mt-1 break-words text-sm font-semibold text-slate-700">{original}</p>
    <div className="mt-2 text-xs text-slate-600"><p className="font-bold">{confidence} confidence</p><p className="mt-1">{reason}</p></div>
    <div className="mt-3"><LocationAutocomplete label={changeLabel} value={value} onChange={onText} onManualInput={() => onSelect(null)} onSelectLocation={onSelect} selectedLocation={selected} required language={language} configMissingMessage="Google Maps search is unavailable." manualEntryText="Select a verified Google result." /></div>
    {selected ? <div className="mt-2 break-words text-xs text-slate-600"><p>{selected.formatted_address}</p><p className="mt-1 break-all">{selected.place_id}</p><a className="mt-2 inline-flex items-center gap-1 font-bold text-brand-700" href={mapsUrl(selected.place_id || "", selected.formatted_address)} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />{openLabel}</a></div> : null}
    {candidates.length ? <div className="mt-3 border-t border-slate-100 pt-2">{candidates.slice(0, 3).map((candidate, index) => <div key={`${candidate.placeId}:${index}`} className="mt-1 flex gap-2 text-xs"><span className="min-w-0 flex-1 break-words">{candidate.count}× {candidate.address || candidate.placeId}</span>{candidate.placeId ? <a href={mapsUrl(candidate.placeId, candidate.address || original)} target="_blank" rel="noreferrer" aria-label={openLabel}><ExternalLink className="h-3.5 w-3.5 text-brand-700" /></a> : null}</div>)}</div> : null}
    <button className="btn-secondary mt-3" type="button" disabled={saving || !selected?.place_id} onClick={onConfirm}><Check className="h-4 w-4" />{confirmLabel}</button>
  </section>;
}
