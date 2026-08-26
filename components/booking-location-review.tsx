"use client";

import { Check, CheckCircle2, ExternalLink, Flag, MapPin, Pencil, RotateCcw, Search, ShieldAlert, SkipForward, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationApprovalDialog } from "@/components/location-approval-dialog";
import { supabase } from "@/lib/supabase";

type Confidence = "high" | "medium" | "low";
type ReviewDisposition = "skipped" | "manual";
type Example = {
  bookingId: string;
  bookingReference: string | null;
  bookingDate: string;
  clientId: string | null;
  clientName: string;
  pickup: string;
  dropoff: string;
  side: "pickup" | "dropoff";
  placeId: string | null;
  address: string | null;
  routeUrl: string | null;
};
type LocationIssue = {
  label: string;
  normalizedLabel: string;
  clientId: string | null;
  clientName: string;
  side: "pickup" | "dropoff" | "pickup_dropoff";
  status: string;
  reason: string;
  affectedBookingCount: number;
  examples: Example[];
  recommendation: {
    confidence: Confidence;
    reason: string;
    recommended: { placeId: string | null; address: string | null; count: number } | null;
    candidates: Array<{ placeId: string | null; address: string | null; count: number }>;
    routes: Array<{ route: string; count: number }>;
  };
  recommendedScope: "global" | "client" | "booking";
  clientContexts: Array<{ clientId: string | null; clientName: string; count: number }>;
  scopeCounts: { global: number; client: number; booking: number };
};
type AuditResponse = {
  audit: {
    locations: LocationIssue[];
    approvedLocations: Array<{
      id: string;
      displayName: string;
      fullGoogleAddress: string;
      googlePlaceId: string;
      aliases: Array<{
        id: string;
        originalAlias: string;
        confirmedName: string;
        normalizedAlias: string;
        side: "pickup" | "dropoff" | null;
        clientId: string | null;
        scope: "global" | "client";
        linkedBookingCount: number;
      }>;
    }>;
  };
};

let auditRequest: Promise<AuditResponse> | null = null;

const copy = {
  en: {
    title: "Location review",
    intro: "Review exact diary labels using booking history and verified Google Places.",
    search: "Search location or route",
    allSides: "Pickup and drop-off",
    pickup: "Pickup",
    dropoff: "Drop-off",
    allClients: "All clients",
    allConfidence: "All confidence",
    allStatuses: "Unresolved and approved",
    unresolved: "Unresolved",
    approved: "Approved",
    affected: "bookings affected",
    examples: "Previous booking examples",
    evidence: "Previous mapped evidence",
    routes: "Matching routes",
    recommendation: "Recommendation",
    openMaps: "Open in Google Maps",
    approveAll: "Approve all exact matches",
    approveContext: "Approve this client context",
    bookingOnly: "Approve this booking only",
    searchChange: "Search/change location",
    skip: "Skip / manual review",
    selectedPlace: "Correct Google place",
    canonicalName: "Canonical display name",
    confirm: "Approve and reuse",
    cancel: "Cancel",
    scopeWarning: "This label can represent different facilities. The narrowest scope is recommended.",
    noEvidence: "No previous verified map evidence",
    noRows: "No locations match these filters.",
    confidence: "confidence",
    previousUses: "previous uses",
    loading: "Loading location review..."
  },
  th: {
    title: "ตรวจสอบสถานที่",
    intro: "ตรวจสอบชื่อสถานที่ในสมุดงานโดยใช้ประวัติการจองและสถานที่ Google ที่ยืนยันแล้ว",
    search: "ค้นหาสถานที่หรือเส้นทาง",
    allSides: "จุดรับและจุดส่ง",
    pickup: "จุดรับ",
    dropoff: "จุดส่ง",
    allClients: "ลูกค้าทั้งหมด",
    allConfidence: "ความมั่นใจทั้งหมด",
    allStatuses: "รอตรวจสอบและอนุมัติแล้ว",
    unresolved: "รอตรวจสอบ",
    approved: "อนุมัติแล้ว",
    affected: "งานจองที่ได้รับผลกระทบ",
    examples: "ตัวอย่างงานจองก่อนหน้า",
    evidence: "หลักฐานแผนที่เดิม",
    routes: "เส้นทางที่ตรงกัน",
    recommendation: "คำแนะนำ",
    openMaps: "เปิดใน Google Maps",
    approveAll: "อนุมัติชื่อที่ตรงกันทั้งหมด",
    approveContext: "อนุมัติเฉพาะบริบทลูกค้านี้",
    bookingOnly: "อนุมัติเฉพาะงานจองนี้",
    searchChange: "ค้นหา/เปลี่ยนสถานที่",
    skip: "ข้าม / ตรวจสอบด้วยตนเอง",
    selectedPlace: "สถานที่ Google ที่ถูกต้อง",
    canonicalName: "ชื่อสถานที่มาตรฐาน",
    confirm: "อนุมัติและนำกลับมาใช้",
    cancel: "ยกเลิก",
    scopeWarning: "ชื่อนี้อาจหมายถึงหลายสถานที่ ระบบจึงแนะนำขอบเขตที่แคบที่สุด",
    noEvidence: "ไม่มีหลักฐานแผนที่เดิมที่ยืนยันได้",
    noRows: "ไม่มีสถานที่ที่ตรงกับตัวกรอง",
    confidence: "ความมั่นใจ",
    previousUses: "ครั้งที่เคยใช้",
    loading: "กำลังโหลดรายการตรวจสอบสถานที่..."
  }
} as const;

async function adminRequest<T>(path: string, init?: RequestInit) {
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
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Location review request failed.");
  return payload;
}

function googleMapsSearchUrl(placeId: string | null, address: string | null, fallback: string) {
  const query = address || fallback;
  const base = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return placeId ? `${base}&query_place_id=${encodeURIComponent(placeId.replace(/^places\//, ""))}` : base;
}

export function BookingLocationReview({
  active,
  language,
  userId,
  onAvailabilityChange,
  onOpenBooking
}: {
  active: boolean;
  language: "en" | "th";
  userId: string;
  onAvailabilityChange: (count: number) => void;
  onOpenBooking: (bookingId: string) => void;
}) {
  const c = copy[language];
  const reviewLabels = language === "th" ? {
    manual: "ทำเครื่องหมายให้ตรวจสอบด้วยตนเอง",
    skipped: "ข้ามแล้ว",
    returnToReview: "นำกลับมาตรวจสอบ",
    remaining: "รอตรวจสอบ",
    selectedMap: "เปิดสถานที่ที่เลือกใน Google Maps"
  } : {
    manual: "Mark for manual review",
    skipped: "Skipped",
    returnToReview: "Return to review",
    remaining: "remaining",
    selectedMap: "Open selected place in Google Maps"
  };
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [side, setSide] = useState("all");
  const [client, setClient] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const [status, setStatus] = useState<"all" | "unresolved" | "approved" | "manual" | "skipped">("unresolved");
  const [dispositions, setDispositions] = useState<Record<string, ReviewDisposition>>({});
  const [approvalIssue, setApprovalIssue] = useState<LocationIssue | null>(null);
  const [nextReviewKey, setNextReviewKey] = useState<string | null>(null);
  const [savedScrollY, setSavedScrollY] = useState(0);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [editingAliasName, setEditingAliasName] = useState("");
  const [undoAliasId, setUndoAliasId] = useState<string | null>(null);
  const [mappingBusy, setMappingBusy] = useState<string | null>(null);
  const reviewTopRef = useRef<HTMLElement | null>(null);
  const storageKey = `booking-location-review:${userId}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      setDispositions(saved ? JSON.parse(saved) as Record<string, ReviewDisposition> : {});
    } catch {
      setDispositions({});
    }
  }, [storageKey]);

  const saveDispositions = useCallback((next: Record<string, ReviewDisposition>) => {
    setDispositions(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    requestAnimationFrame(() => reviewTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [storageKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      auditRequest ??= adminRequest<AuditResponse>("/api/admin/booking-maps/audit?view=location-review")
        .finally(() => { auditRequest = null; });
      const result = await auditRequest;
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load location review.");
      onAvailabilityChange(0);
    } finally {
      setLoading(false);
    }
  }, [onAvailabilityChange]);

  useEffect(() => { void load(); }, [load]);

  const clients = useMemo(() => [...new Set((data?.audit.locations ?? []).flatMap((item) => item.clientContexts.map((context) => context.clientName)))].sort(), [data]);
  const remainingCount = useMemo(
    () => (data?.audit.locations ?? []).filter((item) => !dispositions[`${item.side}:${item.normalizedLabel}`]).length,
    [data, dispositions]
  );

  useEffect(() => { onAvailabilityChange(remainingCount); }, [onAvailabilityChange, remainingCount]);

  const unresolved = useMemo(() => (data?.audit.locations ?? []).filter((item) => {
    const text = `${item.label} ${item.clientName} ${item.examples.map((row) => `${row.pickup} ${row.dropoff}`).join(" ")}`.toLocaleLowerCase();
    const disposition = dispositions[`${item.side}:${item.normalizedLabel}`];
    const statusMatches = status === "all"
      ? true
      : status === "unresolved"
        ? !disposition
        : status === "manual" || status === "skipped"
          ? disposition === status
          : false;
    return statusMatches &&
      (!search || text.includes(search.toLocaleLowerCase())) &&
      (side === "all" || item.side === side || item.side === "pickup_dropoff") &&
      (client === "all" || item.clientContexts.some((context) => context.clientName === client)) &&
      (confidence === "all" || item.recommendation.confidence === confidence);
  }), [client, confidence, data, dispositions, search, side, status]);

  const setDisposition = (item: LocationIssue, disposition: ReviewDisposition) => {
    saveDispositions({ ...dispositions, [`${item.side}:${item.normalizedLabel}`]: disposition });
  };

  const clearDisposition = (item: LocationIssue) => {
    const next = { ...dispositions };
    delete next[`${item.side}:${item.normalizedLabel}`];
    saveDispositions(next);
  };

  const startApproval = (item: LocationIssue) => {
    setSavedScrollY(window.scrollY);
    setApprovalIssue(item);
  };

  const finishApproval = async () => {
    const currentIndex = unresolved.findIndex((item) => item === approvalIssue);
    const next = unresolved[currentIndex + 1] ?? unresolved[currentIndex - 1] ?? null;
    setApprovalIssue(null);
    setNextReviewKey(next ? `${next.side}:${next.normalizedLabel}` : null);
    await load();
    requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: "auto" }));
  };

  const saveMappingName = async (aliasId: string) => {
    setMappingBusy(aliasId);
    setError(null);
    try {
      await adminRequest(`/api/admin/booking-maps/locations/${encodeURIComponent(aliasId)}`, {
        method: "PATCH",
        body: JSON.stringify({ confirmedName: editingAliasName })
      });
      setEditingAliasId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to edit the approved mapping.");
    } finally {
      setMappingBusy(null);
    }
  };

  const undoMapping = async (aliasId: string) => {
    setMappingBusy(aliasId);
    setError(null);
    try {
      await adminRequest(`/api/admin/booking-maps/locations/${encodeURIComponent(aliasId)}`, { method: "DELETE" });
      setUndoAliasId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to undo the approved mapping.");
    } finally {
      setMappingBusy(null);
    }
  };

  if (!active) return null;
  if (loading) return <p className="py-10 text-center text-sm text-slate-500">{c.loading}</p>;

  return <section ref={reviewTopRef} className="mt-4 min-w-0 scroll-mt-4">
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 className="text-lg font-bold text-slate-950">{c.title}</h2><p className="mt-1 text-sm text-slate-600">{c.intro}</p><p className="mt-1 text-xs font-bold text-amber-700">{remainingCount.toLocaleString()} {reviewLabels.remaining}</p></div>
      <button type="button" className="btn-secondary" onClick={() => void load()}><Search className="h-4 w-4" />{c.searchChange}</button>
    </div>
    {error ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <input className="form-input bg-white lg:col-span-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={c.search} />
      <select className="form-input bg-white" value={side} onChange={(event) => setSide(event.target.value)}><option value="all">{c.allSides}</option><option value="pickup">{c.pickup}</option><option value="dropoff">{c.dropoff}</option></select>
      <select className="form-input bg-white" value={client} onChange={(event) => setClient(event.target.value)}><option value="all">{c.allClients}</option>{clients.map((name) => <option key={name}>{name}</option>)}</select>
      <select className="form-input bg-white" value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="all">{c.allConfidence}</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <select className="form-input bg-white" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">{c.allStatuses}</option><option value="unresolved">{c.unresolved}</option><option value="manual">{reviewLabels.manual}</option><option value="skipped">{reviewLabels.skipped}</option><option value="approved">{c.approved}</option></select>
    </div>

    {status !== "approved" ? <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white">
      {unresolved.map((item) => {
        const mapUrl = item.recommendation.recommended
          ? googleMapsSearchUrl(item.recommendation.recommended.placeId, item.recommendation.recommended.address, item.label)
          : null;
        const safest = item.recommendedScope;
        const itemKey = `${item.side}:${item.normalizedLabel}`;
        return <article key={itemKey} className={nextReviewKey === itemKey ? "bg-amber-50 p-4 ring-2 ring-inset ring-amber-300 sm:p-5" : "p-4 sm:p-5"}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-base font-bold text-slate-950">{item.label}</h3><span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{item.affectedBookingCount.toLocaleString()} {c.affected}</span><span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600">{item.recommendation.confidence} {c.confidence}</span></div><p className="mt-1 text-sm text-slate-600">{item.clientName} · {item.side.replace("pickup_dropoff", `${c.pickup} / ${c.dropoff}`)}</p></div>
            <div className="flex flex-wrap gap-2">{mapUrl ? <a className="btn-secondary min-h-9 text-xs" href={mapUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{c.openMaps}</a> : null}<button type="button" className="btn-secondary min-h-9 text-xs" onClick={() => startApproval(item)}><Search className="h-4 w-4" />{c.searchChange}</button></div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-3"><div><p className="text-xs font-bold uppercase text-slate-500">{c.recommendation}</p><p className="mt-1 text-sm font-semibold text-slate-900">{item.recommendation.recommended?.address || c.noEvidence}</p><p className="mt-1 text-sm leading-5 text-slate-600">{item.recommendation.reason}</p>{safest !== "global" ? <p className="mt-2 flex gap-2 text-xs font-semibold text-amber-800"><ShieldAlert className="h-4 w-4 shrink-0" />{c.scopeWarning}</p> : null}</div>
              <div><p className="text-xs font-bold uppercase text-slate-500">{c.evidence}</p>{item.recommendation.candidates.length ? item.recommendation.candidates.slice(0, 4).map((candidate, index) => <div key={`${candidate.placeId ?? candidate.address}:${index}`} className="mt-1 flex min-w-0 items-start gap-2 text-xs text-slate-600"><span className="min-w-0 flex-1 break-words">{candidate.count} {c.previousUses} · {candidate.address || candidate.placeId}</span><a href={googleMapsSearchUrl(candidate.placeId, candidate.address, item.label)} target="_blank" rel="noreferrer" className="shrink-0 text-brand-700" aria-label={c.openMaps}><ExternalLink className="h-3.5 w-3.5" /></a></div>) : <p className="mt-1 text-xs text-slate-500">{c.noEvidence}</p>}</div>
              <div><p className="text-xs font-bold uppercase text-slate-500">{c.routes}</p>{item.recommendation.routes.map((route) => <p key={route.route} className="mt-1 break-words text-xs text-slate-600">{route.count} · {route.route}</p>)}</div></div>
            <div><p className="text-xs font-bold uppercase text-slate-500">{c.examples}</p><div className="mt-2 divide-y divide-slate-100 border-y border-slate-100">{item.examples.map((example) => <div key={example.bookingId} className="grid gap-1 py-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]"><span className="font-bold text-slate-700">{example.bookingDate}</span><div className="min-w-0"><p className="break-words font-semibold text-slate-900">{example.clientName} · {example.pickup} → {example.dropoff}</p><p className="break-all text-slate-500">{example.placeId || example.address || c.noEvidence}</p>{example.routeUrl ? <a href={example.routeUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">Google Maps</a> : null}</div></div>)}</div></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3"><button type="button" className="btn-primary" onClick={() => startApproval(item)}><CheckCircle2 className="h-4 w-4" />{language === "th" ? "อนุมัติสถานที่" : "Approve location"} ({item.affectedBookingCount})</button><button type="button" className="btn-secondary" disabled={!item.examples[0]} onClick={() => item.examples[0] && onOpenBooking(item.examples[0].bookingId)}><MapPin className="h-4 w-4" />{c.bookingOnly} ({item.scopeCounts.booking})</button>{dispositions[itemKey] ? <button type="button" className="btn-secondary" onClick={() => clearDisposition(item)}><RotateCcw className="h-4 w-4" />{reviewLabels.returnToReview}</button> : <><button type="button" className="btn-secondary" onClick={() => setDisposition(item, "skipped")}><SkipForward className="h-4 w-4" />{language === "th" ? "ข้ามตอนนี้" : "Skip for now"}</button><button type="button" className="btn-secondary" onClick={() => setDisposition(item, "manual")}><Flag className="h-4 w-4" />{reviewLabels.manual}</button></>}</div>
        </article>;
      })}
      {!unresolved.length ? <p className="px-4 py-10 text-center text-sm text-slate-500">{c.noRows}</p> : null}
    </div> : null}

    {status === "approved" || status === "all" ? <div className="mt-4 grid gap-3 md:grid-cols-2">{(data?.audit.approvedLocations ?? []).flatMap((item) => item.aliases.map((alias) => <article key={alias.id} className="rounded-md border border-emerald-200 bg-white p-4"><dl className="space-y-2 text-sm"><div><dt className="text-xs font-bold uppercase text-slate-500">Original alias</dt><dd className="break-words font-semibold text-slate-900">{alias.originalAlias}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Our confirmed location name</dt><dd>{editingAliasId === alias.id ? <div className="mt-1 flex gap-2"><input className="form-input min-w-0 flex-1" value={editingAliasName} onChange={(event) => setEditingAliasName(event.target.value)} maxLength={160} /><button type="button" className="icon-button" disabled={mappingBusy === alias.id || !editingAliasName.trim()} onClick={() => void saveMappingName(alias.id)} aria-label="Save confirmed location name"><Check className="h-4 w-4" /></button><button type="button" className="icon-button" onClick={() => setEditingAliasId(null)} aria-label="Cancel editing"><X className="h-4 w-4" /></button></div> : <span className="break-words font-bold text-slate-950">{alias.confirmedName}</span>}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Google Maps place</dt><dd className="font-semibold text-emerald-900">{item.displayName}</dd><dd className="mt-1 break-words text-slate-600">{item.fullGoogleAddress}</dd><dd className="mt-1 break-all text-xs text-slate-500">Place ID: {item.googlePlaceId}</dd></div><div className="grid grid-cols-2 gap-2"><div><dt className="text-xs font-bold uppercase text-slate-500">Scope</dt><dd>{alias.scope}{alias.side ? ` · ${alias.side}` : ""}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Linked bookings</dt><dd className="font-bold">{alias.linkedBookingCount.toLocaleString()}</dd></div></div></dl><div className="mt-4 flex flex-wrap gap-2 border-t border-emerald-100 pt-3">{editingAliasId !== alias.id ? <button type="button" className="btn-secondary min-h-9 text-xs" onClick={() => { setEditingAliasId(alias.id); setEditingAliasName(alias.confirmedName); setUndoAliasId(null); }}><Pencil className="h-4 w-4" />Edit</button> : null}{undoAliasId === alias.id ? <><span className="self-center text-xs font-semibold text-rose-700">Undo this mapping?</span><button type="button" className="btn-danger min-h-9 text-xs" disabled={mappingBusy === alias.id} onClick={() => void undoMapping(alias.id)}>Confirm undo</button><button type="button" className="btn-secondary min-h-9 text-xs" onClick={() => setUndoAliasId(null)}>Cancel</button></> : <button type="button" className="btn-secondary min-h-9 text-xs" onClick={() => { setUndoAliasId(alias.id); setEditingAliasId(null); }}><Undo2 className="h-4 w-4" />Undo</button>}</div></article>))}</div> : null}

    {approvalIssue ? <LocationApprovalDialog
      issue={approvalIssue}
      language={language}
      onClose={() => {
        setApprovalIssue(null);
        requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: "auto" }));
      }}
      onApproved={finishApproval}
      onReviewIndividually={() => approvalIssue.examples[0] && onOpenBooking(approvalIssue.examples[0].bookingId)}
      onNeedsClientReview={() => {
        setDisposition(approvalIssue, "manual");
        setApprovalIssue(null);
        requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: "auto" }));
      }}
    /> : null}

  </section>;
}
