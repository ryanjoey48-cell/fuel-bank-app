"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  MapPinned,
  Play,
  RefreshCw,
  Search,
  ShieldCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
import { LocationApprovalDialog } from "@/components/location-approval-dialog";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

const PROPOSAL_PAGE_SIZE = 100;

type AuditSummary = {
  totalBookings: number;
  completed: number;
  readyToBackfill: number;
  missingPickup: number;
  missingDropoff: number;
  ambiguousLocation: number;
  conflictingRoute: number;
  googleApiFailure: number;
  suspiciousDistance: number;
  protectedManualValue: number;
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
  recommendedScope: "global" | "client" | "booking";
  clientContexts: Array<{ clientId: string; clientName: string; count: number }>;
  scopeCounts: { global: number; client: number; booking: number };
  examples: Array<{ bookingId: string; clientId: string | null; clientName: string; pickup: string; dropoff: string; bookingDate: string }>;
};

type RouteIssue = {
  pickup: string;
  dropoff: string;
  clientName: string;
  status: string;
  reason: string | null;
  affectedBookingCount: number;
  existingDistancesKm: number[];
};

type DryRunItem = {
  id: string;
  item_status: string;
  exact_reason: string | null;
  suggested_correction: string | null;
  related_booking_count: number;
  proposed_values: Record<string, unknown> | null;
  booking: {
    id: string;
    booking_id: string | null;
    booking_date: string;
    pickup: string;
    dropoff: string;
    client: { name: string } | null;
  };
};

type DryRun = {
  batch: {
    id: string;
    status: string;
    total_bookings: number;
    ready_count: number;
    exception_count: number;
    processed_count: number;
    created_at: string;
  };
  items: DryRunItem[];
};

type AuditResponse = {
  audit: {
    summary: AuditSummary;
    locations: LocationIssue[];
    routes: RouteIssue[];
    approvedLocations: Array<{
      id: string;
      displayName: string;
      fullGoogleAddress: string;
      aliases: Array<{ id: string; originalAlias: string; confirmedName: string; side: "pickup" | "dropoff" | null; clientId: string | null; scope: "global" | "client"; linkedBookingCount: number }>;
    }>;
  };
  latestDryRun: DryRun | null;
};

const copy = {
  en: {
    title: "Booking Maps Audit",
    description: "Approve canonical locations, review historical route proposals, and export every exception before any booking is changed.",
    refresh: "Refresh",
    runDryRun: "Run dry run",
    runningDryRun: "Calculating dry run...",
    export: "Export exceptions",
    locations: "Location review",
    routes: "Route review",
    proposals: "Dry-run proposals",
    approved: "Approved directory",
    highVolume: "Highest-volume labels and routes appear first.",
    approve: "Approve location",
    affected: "bookings affected",
    globalAlias: "Global alias",
    clientAlias: "Client-specific alias",
    googlePlace: "Correct Google place",
    canonicalName: "Canonical display name",
    confirmApproval: "Approve and reuse",
    cancel: "Cancel",
    outsideThailand: "I have verified that this location is intentionally outside Thailand.",
    noData: "No records in this view.",
    proposed: "Proposed update",
    exception: "Exception",
    totalBookings: "Total bookings",
    completed: "Completed",
    ready: "Ready to backfill",
    missingPickup: "Missing pickup",
    missingDropoff: "Missing drop-off",
    ambiguous: "Ambiguous location",
    conflicting: "Conflicting route",
    apiFailure: "Google API failure",
    suspicious: "Suspicious distance",
    dryRunSafety: "Dry run only: this action writes proposals and route-cache entries, never Booking Diary rows.",
    loading: "Loading Booking Maps audit...",
    mapsUnavailable: "Google Maps location search is not configured.",
    manualNotAllowed: "Approval requires a verified Google Place result.",
    aliases: "Aliases",
    latestBatch: "Latest dry-run batch",
    noBatch: "No dry run has been created yet.",
    status: "Status",
    reason: "Reason",
    client: "Client",
    search: "Filter labels, clients, routes, or reasons"
  },
  th: {
    title: "ตรวจสอบแผนที่สมุดจองงาน",
    description: "อนุมัติสถานที่มาตรฐาน ตรวจสอบข้อเสนอเส้นทางย้อนหลัง และส่งออกรายการข้อยกเว้นก่อนแก้ไขงานจอง",
    refresh: "รีเฟรช",
    runDryRun: "เริ่มตรวจสอบแบบไม่แก้ข้อมูล",
    runningDryRun: "กำลังคำนวณ...",
    export: "ส่งออกรายการข้อยกเว้น",
    locations: "ตรวจสอบสถานที่",
    routes: "ตรวจสอบเส้นทาง",
    proposals: "ข้อเสนอจากการตรวจสอบ",
    approved: "สถานที่ที่อนุมัติแล้ว",
    highVolume: "ป้ายชื่อและเส้นทางที่กระทบงานจำนวนมากจะแสดงก่อน",
    approve: "อนุมัติสถานที่",
    affected: "งานจองที่ได้รับผลกระทบ",
    globalAlias: "ชื่อเรียกใช้ร่วมกัน",
    clientAlias: "ชื่อเรียกเฉพาะลูกค้า",
    googlePlace: "สถานที่ Google ที่ถูกต้อง",
    canonicalName: "ชื่อสถานที่มาตรฐาน",
    confirmApproval: "อนุมัติและนำกลับมาใช้",
    cancel: "ยกเลิก",
    outsideThailand: "ฉันตรวจสอบแล้วว่าสถานที่นี้อยู่นอกประเทศไทยโดยตั้งใจ",
    noData: "ไม่มีรายการในมุมมองนี้",
    proposed: "ข้อเสนอแก้ไข",
    exception: "ข้อยกเว้น",
    totalBookings: "งานจองทั้งหมด",
    completed: "เสร็จสมบูรณ์",
    ready: "พร้อมอัปเดต",
    missingPickup: "ไม่พบจุดรับ",
    missingDropoff: "ไม่พบจุดส่ง",
    ambiguous: "สถานที่กำกวม",
    conflicting: "เส้นทางขัดแย้ง",
    apiFailure: "Google API ล้มเหลว",
    suspicious: "ระยะทางน่าสงสัย",
    dryRunSafety: "ตรวจสอบเท่านั้น: ระบบบันทึกข้อเสนอและแคชเส้นทาง แต่จะไม่แก้ไขข้อมูลในสมุดจองงาน",
    loading: "กำลังโหลดการตรวจสอบแผนที่...",
    mapsUnavailable: "ยังไม่ได้ตั้งค่าการค้นหาสถานที่ Google Maps",
    manualNotAllowed: "การอนุมัติต้องเลือกผลลัพธ์สถานที่ที่ Google ยืนยันแล้ว",
    aliases: "ชื่อเรียก",
    latestBatch: "ชุดตรวจสอบล่าสุด",
    noBatch: "ยังไม่มีชุดตรวจสอบ",
    status: "สถานะ",
    reason: "เหตุผล",
    client: "ลูกค้า",
    search: "กรองชื่อสถานที่ ลูกค้า เส้นทาง หรือเหตุผล"
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
  if (!response.ok) throw new Error(payload.error || "Booking Maps request failed.");
  return payload;
}

function StatCard({
  label,
  value,
  tone = "slate"
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "amber" | "rose" | "purple";
}) {
  const toneClass = {
    slate: "border-slate-200 text-slate-800",
    green: "border-emerald-200 text-emerald-700",
    amber: "border-amber-200 text-amber-800",
    rose: "border-rose-200 text-rose-700",
    purple: "border-violet-200 text-violet-700"
  }[tone];
  return (
    <div className={clsx("rounded-lg border bg-white px-3 py-3 shadow-sm", toneClass)}>
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black">{value.toLocaleString()}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const danger = [
    "ambiguous_location",
    "conflicting_route",
    "google_api_failure",
    "suspicious_distance"
  ].includes(status);
  const ready = status === "ready" || status === "completed";
  return (
    <span
      className={clsx(
        "inline-flex rounded-full border px-2 py-1 text-xs font-bold",
        ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : danger
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-amber-200 bg-amber-50 text-amber-800"
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default function BookingMapsAuditPage() {
  const { language } = useLanguage();
  const c = copy[language];
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"locations" | "routes" | "proposals" | "approved">("locations");
  const [search, setSearch] = useState("");
  const [proposalPage, setProposalPage] = useState(1);
  const [approvalIssue, setApprovalIssue] = useState<LocationIssue | null>(null);
  const [nextReviewKey, setNextReviewKey] = useState<string | null>(null);
  const [savedScrollY, setSavedScrollY] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminRequest<AuditResponse>("/api/admin/booking-maps/audit"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the audit.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startApproval = (issue: LocationIssue) => {
    setSavedScrollY(window.scrollY);
    setApprovalIssue(issue);
  };

  const runDryRun = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      let batchId: string | null =
        data?.latestDryRun?.batch.status === "dry_run"
          ? data.latestDryRun.batch.id
          : null;
      let result: { dryRun: DryRun };
      do {
        result = await adminRequest<{ dryRun: DryRun }>("/api/admin/booking-maps/dry-run", {
          method: "POST",
          body: JSON.stringify({ batchId, batchSize: 100 })
        });
        batchId = result.dryRun.batch.id;
      } while (result.dryRun.batch.status !== "review");
      setNotice(
        `${c.latestBatch}: ${result.dryRun.batch.ready_count} ${c.proposed}, ${result.dryRun.batch.exception_count} ${c.exception}`
      );
      setTab("proposals");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the dry run.");
    } finally {
      setRunning(false);
    }
  };

  const downloadExceptions = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const batchId = data?.latestDryRun?.batch.id;
      const response = await fetch(
        `/api/admin/booking-maps/exceptions${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Unable to export exceptions.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `booking-maps-exceptions${batchId ? `-${batchId}` : ""}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export exceptions.");
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredLocations = useMemo(
    () =>
      (data?.audit.locations ?? []).filter((item) =>
        `${item.label} ${item.clientName} ${item.reason} ${item.status}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      ),
    [data, normalizedSearch]
  );
  const finishApproval = async () => {
    const currentIndex = filteredLocations.findIndex((item) => item === approvalIssue);
    const next = filteredLocations[currentIndex + 1] ?? filteredLocations[currentIndex - 1] ?? null;
    setApprovalIssue(null);
    setNextReviewKey(next ? `${next.side}:${next.normalizedLabel}` : null);
    await load();
    requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: "auto" }));
  };
  const filteredRoutes = useMemo(
    () =>
      (data?.audit.routes ?? []).filter((item) =>
        `${item.pickup} ${item.dropoff} ${item.clientName} ${item.reason ?? ""} ${item.status}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      ),
    [data, normalizedSearch]
  );
  const filteredProposals = useMemo(
    () =>
      (data?.latestDryRun?.items ?? []).filter((item) =>
        `${item.booking.booking_id ?? ""} ${item.booking.pickup} ${item.booking.dropoff} ${item.booking.client?.name ?? ""} ${item.exact_reason ?? ""} ${item.item_status}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      ),
    [data, normalizedSearch]
  );
  const proposalPages = Math.max(1, Math.ceil(filteredProposals.length / PROPOSAL_PAGE_SIZE));
  const visibleProposals = filteredProposals.slice(
    (proposalPage - 1) * PROPOSAL_PAGE_SIZE,
    proposalPage * PROPOSAL_PAGE_SIZE
  );

  useEffect(() => {
    setProposalPage(1);
  }, [normalizedSearch]);

  const summary = data?.audit.summary;
  const tabs = [
    { id: "locations" as const, label: c.locations, count: data?.audit.locations.length ?? 0 },
    { id: "routes" as const, label: c.routes, count: data?.audit.routes.length ?? 0 },
    { id: "proposals" as const, label: c.proposals, count: data?.latestDryRun?.items.length ?? 0 },
    { id: "approved" as const, label: c.approved, count: data?.audit.approvedLocations.length ?? 0 }
  ];

  return (
    <>
      <div className="mb-5 hidden md:block">
        <Header title={c.title} description={c.description} />
      </div>

      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-950 md:hidden">{c.title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{c.dryRunSafety}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
            {c.refresh}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void downloadExceptions()}
            disabled={!data?.latestDryRun}
          >
            <Download className="h-4 w-4" />
            {c.export}
          </button>
          <button type="button" className="btn-primary" onClick={() => void runDryRun()} disabled={running}>
            <Play className={clsx("h-4 w-4", running && "animate-pulse")} />
            {running ? c.runningDryRun : c.runDryRun}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      {loading && !data ? (
        <p className="mt-6 text-sm text-slate-500">{c.loading}</p>
      ) : summary ? (
        <section className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <StatCard label={c.totalBookings} value={summary.totalBookings} />
          <StatCard label={c.completed} value={summary.completed} tone="green" />
          <StatCard label={c.ready} value={summary.readyToBackfill} tone="purple" />
          <StatCard label={c.missingPickup} value={summary.missingPickup} tone="amber" />
          <StatCard label={c.missingDropoff} value={summary.missingDropoff} tone="amber" />
          <StatCard label={c.ambiguous} value={summary.ambiguousLocation} tone="rose" />
          <StatCard label={c.conflicting} value={summary.conflictingRoute} tone="rose" />
          <StatCard
            label={`${c.apiFailure} / ${c.suspicious}`}
            value={summary.googleApiFailure + summary.suspiciousDistance}
            tone="rose"
          />
        </section>
      ) : null}

      <section className="mt-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={clsx(
                  "min-h-10 shrink-0 border-b-2 px-3 text-sm font-bold",
                  tab === item.id
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                )}
              >
                {item.label} <span className="ml-1 text-xs">({item.count})</span>
              </button>
            ))}
          </div>
          <label className="relative block w-full xl:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="form-input bg-white pl-9"
              placeholder={c.search}
            />
          </label>
        </div>
        <p className="mt-3 text-xs font-semibold text-slate-500">{c.highVolume}</p>

        {tab === "locations" ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {filteredLocations.map((item) => (
              <article
                key={`${item.side}-${item.clientId}-${item.normalizedLabel}`}
                className={clsx("grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:grid-cols-[minmax(10rem,1.2fr)_minmax(8rem,1fr)_7rem_9rem_minmax(12rem,1.5fr)_9rem] lg:items-center", nextReviewKey === `${item.side}:${item.normalizedLabel}` && "bg-amber-50 ring-2 ring-inset ring-amber-300")}
              >
                <div className="min-w-0">
                  <p className="break-words font-bold text-slate-950">{item.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.side}</p>
                </div>
                <p className="break-words text-sm text-slate-700">{item.clientName}</p>
                <StatusBadge status={item.status} />
                <p className="text-sm font-bold text-slate-800">{item.affectedBookingCount.toLocaleString()}</p>
                <p className="break-words text-sm leading-5 text-slate-600">{item.reason}</p>
                <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => startApproval(item)}>
                  <MapPinned className="h-4 w-4" />
                  {c.approve}
                </button>
              </article>
            ))}
            {!filteredLocations.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">{c.noData}</p> : null}
          </div>
        ) : null}

        {tab === "routes" ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {filteredRoutes.map((item, index) => (
              <article key={`${item.clientName}-${item.pickup}-${item.dropoff}-${index}`} className="grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:grid-cols-[1fr_auto_1fr_minmax(8rem,0.7fr)_8rem_minmax(12rem,1.2fr)] lg:items-center">
                <p className="break-words font-bold text-slate-950">{item.pickup}</p>
                <span className="text-slate-400">→</span>
                <p className="break-words font-bold text-slate-950">{item.dropoff}</p>
                <p className="break-words text-sm text-slate-600">{item.clientName}</p>
                <div><StatusBadge status={item.status} /><p className="mt-1 text-xs font-bold text-slate-500">{item.affectedBookingCount} {c.affected}</p></div>
                <div className="text-sm leading-5 text-slate-600">
                  <p>{item.reason ?? "-"}</p>
                  {item.existingDistancesKm.length ? (
                    <p className="mt-1 text-xs">{[...new Set(item.existingDistancesKm.map((value) => value.toFixed(1)))].join(", ")} km</p>
                  ) : null}
                </div>
              </article>
            ))}
            {!filteredRoutes.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">{c.noData}</p> : null}
          </div>
        ) : null}

        {tab === "proposals" ? (
          <div className="mt-3">
            {data?.latestDryRun ? (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                <ShieldCheck className="h-5 w-5" />
                <strong>{c.latestBatch}</strong>
                <span className="break-all">{data.latestDryRun.batch.id}</span>
                <span>{data.latestDryRun.batch.ready_count} {c.proposed}</span>
                <span>{data.latestDryRun.batch.exception_count} {c.exception}</span>
              </div>
            ) : <p className="text-sm text-slate-500">{c.noBatch}</p>}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {visibleProposals.map((item) => (
                <article key={item.id} className="grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 [content-visibility:auto] lg:grid-cols-[9rem_minmax(10rem,1fr)_auto_minmax(12rem,1.2fr)_8rem] lg:items-center">
                  <div><p className="font-bold text-slate-950">{item.booking.booking_id ?? item.booking.id.slice(0, 8)}</p><p className="text-xs text-slate-500">{item.booking.booking_date}</p></div>
                  <div><p className="break-words text-sm font-semibold text-slate-900">{item.booking.pickup} → {item.booking.dropoff}</p><p className="mt-1 text-xs text-slate-500">{item.booking.client?.name ?? "-"}</p></div>
                  <StatusBadge status={item.item_status} />
                  <p className="break-words text-sm leading-5 text-slate-600">{item.exact_reason ?? (item.proposed_values ? c.proposed : "-")}</p>
                  <p className="text-sm font-bold text-slate-700">{item.related_booking_count} {c.affected}</p>
                </article>
              ))}
              {!filteredProposals.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">{c.noData}</p> : null}
            </div>
            {filteredProposals.length > PROPOSAL_PAGE_SIZE ? (
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" disabled={proposalPage <= 1} onClick={() => setProposalPage((page) => Math.max(1, page - 1))}>
                  ‹
                </button>
                <span className="text-sm font-bold text-slate-600">{proposalPage} / {proposalPages}</span>
                <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" disabled={proposalPage >= proposalPages} onClick={() => setProposalPage((page) => Math.min(proposalPages, page + 1))}>
                  ›
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "approved" ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(data?.audit.approvedLocations ?? []).map((location) => (
              <article key={location.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="break-words font-bold text-slate-950">{location.displayName}</h3>
                <p className="mt-2 break-words text-sm leading-5 text-slate-600">{location.fullGoogleAddress}</p>
                <p className="mt-3 text-xs font-bold uppercase text-slate-500">{c.aliases}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {location.aliases.map((alias) => (
                    <span key={alias.id} className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">
                      {alias.originalAlias} → {alias.confirmedName} · {alias.scope}{alias.side ? ` · ${alias.side}` : ""} · {alias.linkedBookingCount.toLocaleString()}
                    </span>
                  ))}
                </div>
              </article>
            ))}
            {!data?.audit.approvedLocations.length ? <p className="text-sm text-slate-500">{c.noData}</p> : null}
          </div>
        ) : null}
      </section>
      {approvalIssue ? <LocationApprovalDialog
        issue={approvalIssue}
        language={language}
        onClose={() => {
          setApprovalIssue(null);
          requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: "auto" }));
        }}
        onApproved={finishApproval}
      /> : null}
    </>
  );
}
