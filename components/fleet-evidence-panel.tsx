"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { FleetProviderDayPanel } from "@/components/fleet-provider-day-panel";
import { FleetJobReviewPanel } from "@/components/fleet-job-review-panel";
import { FleetJobTimeline } from "@/components/fleet-job-timeline";
import { FleetJourneyAllocation, FleetJourneyList } from "@/components/fleet-journey-ledger-panel";
import { FleetFuelPanel } from "@/components/fleet-fuel-panel";
import { FleetVehicleDaySummary } from "@/components/fleet-vehicle-day-summary";
import { FleetDayInsights } from "@/components/fleet-day-insights";
import { FleetDaySnapshot } from "@/components/fleet-day-snapshot";
import { FleetDayNarrative } from "@/components/fleet-day-narrative";
import { nextBangkokDay } from "@/lib/fleet-cross-midnight";
import { buildDayNarrativeModel, operatingSummaryOf } from "@/lib/fleet-day-narrative-model";
import { fuelReviewCandidates } from "@/lib/fleet-fuel-review";
import { FleetDayPlaces, useDayPlaces, visitLabel } from "@/components/fleet-day-places";
import { FleetVisitMap } from "@/components/fleet-visit-map";
import { FleetMileageReconciliation, type ReconTarget } from "@/components/fleet-mileage-reconciliation";
import { reselectVisit } from "@/lib/fleet-visit-map";
import { matchLabel } from "@/lib/fleet-location-match";
import { FleetFuelReview, FleetKmFuelTable, FleetOperatingStrip, type HistoryDay, type OdometerSpan } from "@/components/fleet-operating-history";
import { buildDayInsights } from "@/lib/fleet-day-insights";
import { FleetRecurringAreas } from "@/components/fleet-recurring-areas";
import { analyseDay, buildVehicleDaySummary } from "@/lib/fleet-vehicle-day-summary";
import { summarizeDayJobWarnings, type DayJobWarning } from "@/lib/fleet-booking-quality";
import { FORTH_DISTANCE_SEMANTICS, FORTH_QUESTIONS } from "@/lib/fleet-distance-ledger";
import type { JourneyLedger } from "@/lib/fleet-journey-ledger";
import { compareSources, type SourceDistance } from "@/lib/fleet-fuel-view";
import type { ProviderDay, suggestDayJobs, dayAttribution } from "@/lib/fleet-intelligence-day";
import { supabase } from "@/lib/supabase";
import { originHeaders } from "@/lib/fleet-request-origin";
import { bangkokDateInput, checkpointSpan, type FuelTypeGroup } from "@/lib/fleet-evidence-view";
import type { OdometerCheckpoint } from "@/lib/fleet-intelligence-mileage";
import type { SourceMetric } from "@/lib/fleet-intelligence-sources";
import type { BookingSnapshot } from "@/lib/fleet-intelligence-ees-source";

type Evidence = {
  vehicleId: string; registration?: string; fromDay: string; toDay: string; capturedAt: string;
  day: { bookings: BookingSnapshot[] } | null;
  mileage: { checkpoints: OdometerCheckpoint[]; sourceStatus?: { fuel: string; weekly: string } } | null;
  activityDays?: { day: string; provider: ProviderDay | null; jobs: ReturnType<typeof suggestDayJobs> | null; attribution?: ReturnType<typeof dayAttribution>; fuelPurchases?: FuelTypeGroup[] | null; checkpoints: OdometerCheckpoint[] | null }[];
  intervals: { source: string; from: string; to: string; metric: SourceMetric; reviewRequired: boolean }[] | null;
};
export type VehicleSection = "overview" | "today" | "jobs" | "journeys" | "fuel" | "health" | "daily" | "journeys_jobs";
export type EvidenceScope = { from: string; to: string; day: string };
const DAYS_BACK = 6;
const shiftDay = (days: number) => bangkokDateInput(new Date(Date.now() - days * 86400000));

/**
 * One workspace per selected vehicle. It stays mounted while the drawer tab changes (the tab only decides what is visible),
 * so the date scope, the loaded read-only evidence and the Forth day reads survive tab switches. The parent keys it by vehicle,
 * so another vehicle can never show this one's evidence.
 */
export function FleetEvidencePanel({ vehicleId, language, section, onNavigate, onOpenPlayback, gpsHealth, initialDay, initialScope, onScopeChange }: {
  /** V7.1: the shell keeps one date scope across workspaces and vehicles; it only seeds the controls and never triggers a read. */
  initialScope?: EvidenceScope | null; onScopeChange?: (scope: EvidenceScope) => void;
  /** Set by a drill-down from the fleet daily review: the scope starts on exactly this Bangkok day. */
  initialDay?: string;
  vehicleId: string | null; language: "en" | "th"; section: string;
  onNavigate?: (section: VehicleSection) => void; onOpenPlayback?: (range?: { day: string; start: string; end: string }) => void; gpsHealth?: ReactNode;
}) {
  const t = (en: string, th: string) => language === "th" ? th : en;
  const validInitialDay = initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) && initialDay <= bangkokDateInput() ? initialDay : null;
  const seed = validInitialDay ? { from: validInitialDay, to: validInitialDay, day: validInitialDay } : initialScope && /^\d{4}-\d{2}-\d{2}$/.test(initialScope.from) && /^\d{4}-\d{2}-\d{2}$/.test(initialScope.to) && initialScope.from <= initialScope.to && initialScope.to <= bangkokDateInput() ? initialScope : null;
  const [from, setFrom] = useState(() => seed?.from ?? shiftDay(DAYS_BACK));
  const [to, setTo] = useState(() => seed?.to ?? bangkokDateInput());
  const [selectedDay, setSelectedDay] = useState(() => seed?.day ?? bangkokDateInput());
  const [data, setData] = useState<Evidence | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const batchRef = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number; error: string | null } | null>(null);
  useEffect(() => () => { generation.current++; requestRef.current?.abort(); batchRef.current?.abort(); }, []);

  // Drill-down from the fleet review: load the already-cached evidence for that day once (no Forth request is made by this read).
  useEffect(() => { if (validInitialDay && vehicleId) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recurring places: opening one of this vehicle's dates moves the scope to that day and reads the already-cached evidence once.
  const [autoLoadTick, setAutoLoadTick] = useState(0);
  useEffect(() => { if (autoLoadTick > 0 && vehicleId) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadTick]);
  function openRecurringDay(day: string) { setScope(day, day); setAutoLoadTick(tick => tick + 1); onNavigate?.("today"); }

  function invalidate() { generation.current++; requestRef.current?.abort(); setData(null); setState("idle"); }
  function setScope(nextFrom: string, nextTo: string) { invalidate(); setFrom(nextFrom); setTo(nextTo); setSelectedDay(nextTo); onScopeChange?.({ from: nextFrom, to: nextTo, day: nextTo }); }
  function chooseDay(day: string) { setSelectedDay(day); onScopeChange?.({ from, to, day }); }
  function preset(days: number, yesterday = false) { const end = yesterday ? shiftDay(1) : bangkokDateInput(); setScope(bangkokDateInput(new Date(Date.parse(`${end}T12:00:00+07:00`) - (days - 1) * 86400000)), end); }

  /** Re-reads the evidence for the current scope. Earlier evidence stays visible while it loads; only a scope change clears it. */
  async function load() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestId = ++generation.current;
    setState("loading");
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session || !vehicleId) throw new Error();
      const response = await fetch(`/api/admin/forth-tracking/evidence?${new URLSearchParams({ vehicleId, from, to })}`, { headers: { Authorization: `Bearer ${session.session.access_token}` }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as Evidence;
      if (requestId !== generation.current) return;
      setData(result); setState("ready");
    } catch { if (requestId === generation.current) setState("failed"); }
    finally { clearTimeout(timeout); }
  }
  /** Operator-requested, sequential, read-only provider reads: at most 7 unread days, stopping at the first provider error. */
  async function readUnreadDays() {
    if (!vehicleId || !data?.activityDays) return;
    const pending = data.activityDays.filter(row => !row.provider).map(row => row.day).slice(0, 7);
    if (pending.length === 0) return;
    batchRef.current?.abort(); const controller = new AbortController(); batchRef.current = controller; setBatch({ done: 0, total: pending.length, error: null });
    try {
      const { data: session } = await supabase.auth.getSession(); if (!session.session) throw new Error("session");
      for (let i = 0; i < pending.length; i++) {
        const response = await fetch(`/api/admin/forth-tracking/evidence/provider?${new URLSearchParams({ vehicleId, day: pending[i] })}`, { method: "POST", headers: { Authorization: `Bearer ${session.session.access_token}`, ...originHeaders("journeys_unread_batch") }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50000)]), cache: "no-store" });
        if (!response.ok) { setBatch({ done: i, total: pending.length, error: response.status === 429 ? "rate_limited" : response.status === 503 || response.status === 401 || response.status === 403 ? "provider_unavailable" : "failed" }); await load(); return; }
        setBatch({ done: i + 1, total: pending.length, error: null });
      }
      await load();
    } catch { if (!controller.signal.aborted) { setBatch(b => ({ done: b?.done ?? 0, total: b?.total ?? 0, error: "failed" })); await load(); } }
  }

  const activeDay = selectedDay >= from && selectedDay <= to ? selectedDay : to;
  const active = data?.activityDays?.find(row => row.day === activeDay);
  const days = data?.activityDays?.map(row => row.day) ?? [];
  const value = (n: number | null | undefined) => n === null || n === undefined ? "—" : n.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: 2 });
  const baht = (n: number | null | undefined) => n === null || n === undefined ? "—" : n.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fuelLabel = (type: string) => type === "unrecorded" ? t("Fuel type not recorded", "ไม่ได้บันทึกชนิดเชื้อเพลิง") : type.toUpperCase();
  const fuelLine = (groups: FuelTypeGroup[] | null | undefined) => groups === null || groups === undefined ? "—" : groups.length === 0 ? t("No purchases recorded", "ไม่มีบันทึกการซื้อ") : groups.map(g => `${fuelLabel(g.fuelType)} ${value(g.purchasedLitres)} L · ฿${baht(g.costThb)}`).join(" · ");
  const spans = data?.mileage ? (["fuel_logs", "weekly_mileage"] as const).map(source => ({ source, span: checkpointSpan(data.intervals, source) })) : [];
  const enteredDate = (timestamp: string) => Number.isFinite(Date.parse(timestamp))
    ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium" }).format(new Date(timestamp))
    : t("Unknown entry date", "ไม่ทราบวันที่บันทึก");
  const fuelSpan = spans.find(x => x.source === "fuel_logs")?.span ?? null, weeklySpan = spans.find(x => x.source === "weekly_mileage")?.span ?? null;
  const dayProvider = active?.provider ?? null;
  const comparisonSources: SourceDistance[] = [
    { source: "forth_provider", km: dayProvider && dayProvider.provider.arithmetic.status === "pass" ? dayProvider.sources.providerReported.value : null, periodStart: dayProvider ? activeDay : null, periodEnd: dayProvider ? activeDay : null, complete: dayProvider?.sources.providerReported.completeness === "complete" },
    { source: "forth_gps", km: dayProvider?.sources.gpsDerived.value ?? null, periodStart: dayProvider ? activeDay : null, periodEnd: dayProvider ? activeDay : null, complete: dayProvider?.sources.gpsDerived.completeness === "complete" },
    { source: "fuel_log_odometer", km: fuelSpan?.km ?? null, periodStart: fuelSpan?.from ?? null, periodEnd: fuelSpan?.to ?? null, complete: false },
    { source: "weekly_odometer", km: weeklySpan?.km ?? null, periodStart: weeklySpan?.from ?? null, periodEnd: weeklySpan?.to ?? null, complete: false }
  ];
  const comparisonPairs: [SourceDistance, SourceDistance][] = [[comparisonSources[0], comparisonSources[2]], [comparisonSources[0], comparisonSources[3]], [comparisonSources[1], comparisonSources[2]], [comparisonSources[2], comparisonSources[3]]];
  // Journey detail is released by the server only to callers allowed to see historical journeys.
  const journeyAccess = (dayProvider as { journeyAccess?: string } | null)?.journeyAccess;
  const journeyRestricted = journeyAccess === "requires_authorisation";
  const journeyLedger = ((dayProvider as { journeyLedger?: unknown } | null)?.journeyLedger as JourneyLedger | null | undefined) ?? null;
  const analysis = analyseDay({ day: activeDay, journeyLedger, providerReconciled: dayProvider?.provider.arithmetic.status === "pass", providerComplete: dayProvider?.sources.providerReported.completeness === "complete" && !dayProvider?.provider.segments.some(x => !x.end),
    providerKm: dayProvider ? dayProvider.sources.providerReported.value : null,
    jobs: active?.jobs == null ? null : active.jobs.map(j => ({ jobId: j.jobId, workOrder: j.workOrder, pickupTime: j.pickupTime, bookingAssignment: j.bookingAssignment === "stable_vehicle_id" ? "stable_vehicle_id" as const : "registration_only" as const })) });
  const fuelGroupsDay = active?.fuelPurchases ?? null;
  const summary = buildVehicleDaySummary({ day: activeDay, providerRead: Boolean(dayProvider), journeyLedger, journeysRestricted: journeyRestricted, analysis,
    providerKm: dayProvider ? dayProvider.sources.providerReported.value : null, providerReconciled: dayProvider?.provider.arithmetic.status === "pass",
    gpsObservations: dayProvider?.logAvailable ? dayProvider.gps.observations : null, gpsVerifiedObservations: dayProvider?.logAvailable ? dayProvider.gps.verifiedObservations : null,
    fuel: fuelGroupsDay === null ? null : { records: fuelGroupsDay.reduce((n, g) => n + g.records, 0), litres: fuelGroupsDay.length === 0 ? 0 : fuelGroupsDay.length === 1 && fuelGroupsDay[0].fuelType !== "unrecorded" ? fuelGroupsDay[0].purchasedLitres : null, costThb: fuelGroupsDay.length === 0 ? 0 : fuelGroupsDay.some(g => g.costThb === null) ? null : fuelGroupsDay.reduce((n, g) => n + g.costThb!, 0) },
    fuelOdometer: active?.checkpoints?.filter(c => c.source === "fuel_logs").map(c => ({ id: c.id, km: c.odometerKm })) ?? null,
    weeklyOdometer: active?.checkpoints?.filter(c => c.source === "weekly_mileage").map(c => ({ id: c.id, km: c.odometerKm, baseline: c.baseline })) ?? null,
    comparisons: comparisonPairs.map(([a, b]) => { const r = compareSources(a, b); return { pair: `${a.source}↔${b.source}`, status: r.status, differenceKm: r.differenceKm }; }) });
  // V6: booking-independent day view. It never reads bookings, so it is identical when the diary has no records.
  const dayInsights = buildDayInsights({ day: activeDay, providerRead: Boolean(dayProvider), providerKm: dayProvider ? dayProvider.sources.providerReported.value : null, providerReconciled: dayProvider?.provider.arithmetic.status === "pass",
    ledger: journeyLedger, journeysRestricted: journeyRestricted, observations: dayProvider?.logAvailable ? dayProvider.gps.observations : null, verifiedObservations: dayProvider?.logAvailable ? dayProvider.gps.verifiedObservations : null, receivedObservations: dayProvider?.logAvailable ? dayProvider.gps.observations : null });
  const jobWarnings = useMemo(() => active?.jobs ? summarizeDayJobWarnings(active.jobs) : null, [active?.jobs]);
  const warningLabel: Record<DayJobWarning, string> = {
    missing_pickup_time: t("no scheduled pickup time (cannot be placed on a journey)", "ไม่มีเวลารับตามแผน (จับคู่กับเที่ยวไม่ได้)"),
    same_time_booking: t("same pickup time as another booking (conflict)", "เวลารับตรงกับการจองอื่น (ขัดแย้ง)"),
    registration_only_assignment: t("vehicle matched by registration text only (no vehicle ID)", "จับคู่รถด้วยข้อความทะเบียนเท่านั้น (ไม่มีรหัสรถ)"),
    missing_work_order: t("no work order reference", "ไม่มีเลขใบงาน"),
    missing_pickup_or_delivery_coordinates: t("no pickup or delivery coordinates", "ไม่มีพิกัดจุดรับหรือจุดส่ง")
  };
  const go = (to2: VehicleSection) => onNavigate?.(to2);
  const link = (to2: VehicleSection, label: string) => <button type="button" className="fleet-link-button" onClick={() => go(to2)}>{label}</button>;
  const isDaily = section === "daily", isJJ = section === "journeys_jobs";
  const showToday = section === "today" || isDaily, showJourneys = section === "journeys" || isJJ, showJobs = section === "jobs" || isJJ;
  const needsScopeBar = showToday || showJourneys || showJobs;
  const registration = data?.registration ?? "";
  // V7.4: one shared, cache-only request for the day's named stops (table and timeline). It runs only after the day has been read.
  const dayReadStamp = dayProvider ? `${dayProvider.sources.providerReported.sourceTimestamp ?? ""}|${dayProvider.sources.gpsDerived.sourceTimestamp ?? ""}|${dayProvider.logAvailable ? dayProvider.gps.observations : "-"}` : "";
  const dayPlaces = useDayPlaces({ vehicleId, day: activeDay, dayRead: (isDaily || isJJ) && Boolean(dayProvider) && !journeyRestricted, readStamp: dayReadStamp });
  // V7.8.4: one model for the operating summary and the narrative, built once from days already loaded (never requested).
  const prevDayForModel = new Date(Date.parse(`${activeDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const dayNarrative = useMemo(() => buildDayNarrativeModel({ day: activeDay, provider: dayProvider, visits: dayPlaces.data?.read ? dayPlaces.data.visits : null,
    previousDay: data?.activityDays?.find(d => d.day === prevDayForModel)?.provider ?? null, nextDay: data?.activityDays?.find(d => d.day === nextBangkokDay(activeDay))?.provider ?? null }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [activeDay, dayProvider, dayPlaces.data, data]);
  const prevDayOf = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const providerStops = journeyLedger ? { total: journeyLedger.journeys.filter(j => j.kind === "stopped").length, zeroDuration: journeyLedger.journeys.filter(j => j.kind === "stopped" && j.minutes === 0).length } : null;
  const viewRoute = journeyAccess === "granted" && onOpenPlayback ? () => onOpenPlayback() : undefined;
  // V7.8: one selected visit shared by Daily Activity, Journeys and the map inspector. The map reads nothing until "View location" is pressed.
  const [selectedVisit, setSelectedVisit] = useState<{ id: string; firstAt: string; lastAt: string; day: string } | null>(null);
  const [mapVisitId, setMapVisitId] = useState<string | null>(null);
  // V7.8.3: one focused mileage investigation (cache-only). It opens only on request and closes when the vehicle or period changes.
  const [reconOpen, setReconOpen] = useState(false);
  useEffect(() => { setReconOpen(false); }, [vehicleId, from, to]);
  const visitRefs = (dayPlaces.data?.visits ?? []).map(v => ({ id: v.id, firstAt: v.firstAt, lastAt: v.lastAt, title: visitLabel(v, language).title, named: visitLabel(v, language).named }));
  const placesStamp = (dayPlaces.data?.visits ?? []).map(v => v.id + v.firstAt + v.lastAt).join("|");
  // A new day or a refreshed analysis: keep the selection only if the same observed window still exists, otherwise clear it. Ids are positional.
  useEffect(() => {
    setSelectedVisit(prev => { if (!prev) return null; if (prev.day !== activeDay) return null; const id = reselectVisit(prev, dayPlaces.data?.visits ?? []); const v = (dayPlaces.data?.visits ?? []).find(x => x.id === id); return v ? { id: v.id, firstAt: v.firstAt, lastAt: v.lastAt, day: activeDay } : null; });
    setMapVisitId(prev => { if (!prev) return null; const sel = (dayPlaces.data?.visits ?? []).some(v => v.id === prev); return sel ? prev : null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesStamp, activeDay, vehicleId]);
  const chooseVisit = (id: string | null) => { if (!id) { setSelectedVisit(null); return; } const v = (dayPlaces.data?.visits ?? []).find(x => x.id === id); setSelectedVisit(v ? { id: v.id, firstAt: v.firstAt, lastAt: v.lastAt, day: activeDay } : null); };
  const timelineActions = {
    selectedId: selectedVisit?.id ?? null,
    onViewLocation: journeyAccess === "granted" ? (id: string) => { chooseVisit(id); setMapVisitId(id); } : undefined,
    onViewRoute: journeyAccess === "granted" && onOpenPlayback ? (range: { day: string; start: string; end: string }) => onOpenPlayback(range) : undefined,
    onOpenInJourneys: (id: string) => { chooseVisit(id); onNavigate?.("journeys"); }
  };

  // V7.3: read-only per-day view of what has been reviewed. Unread days stay "not reviewed", never zero, and nothing here triggers a read.
  const historyDays: HistoryDay[] = (data?.activityDays ?? []).map(row => {
    const p = row.provider; const ledger = (p as { journeyLedger?: JourneyLedger | null } | null)?.journeyLedger ?? null;
    return { day: row.day, read: Boolean(p), providerKm: p ? p.sources.providerReported.value : null, providerReconciled: p?.provider.arithmetic.status === "pass", gpsKm: p ? p.sources.gpsDerived.value : null,
      stops: ledger ? ledger.journeys.filter(j => j.kind === "stopped" && !j.ambiguous && j.minutes !== null && j.minutes >= 10).length : null, missingMinutes: ledger ? ledger.totals.missingMinutes : null,
      fuel: row.fuelPurchases ?? null, odometerReadings: row.checkpoints === null ? null : row.checkpoints.length };
  });
  const historySpans: OdometerSpan[] = [
    fuelSpan ? { label: t("Fuel Log odometer span", "ช่วงเลขไมล์จากบันทึกเชื้อเพลิง"), km: fuelSpan.km, from: fuelSpan.from, to: fuelSpan.to, reviewRequired: fuelSpan.reviewRequired } : null,
    weeklySpan ? { label: t("Weekly odometer span", "ช่วงเลขไมล์รายสัปดาห์"), km: weeklySpan.km, from: weeklySpan.from, to: weeklySpan.to, reviewRequired: weeklySpan.reviewRequired } : null
  ];

  const fuelCandidates = data && historyDays.length ? fuelReviewCandidates({ days: historyDays, spans: historySpans, intervals: (data.intervals ?? []).map(i => ({ source: i.source, from: i.from, to: i.to, withheld: i.metric.value === null })) }) : [];
  // V7.8.2: Forth evidence for the fuel review, from the already-loaded cache-only read. Unreviewed days are absent (not zero).
  const forthContext = data?.activityDays ? (() => {
    const read = data.activityDays.filter(d => d.provider);
    const reconciled = read.filter(d => d.provider!.provider.arithmetic.status === "pass" && d.provider!.sources.providerReported.value !== null);
    const sum = (vals: number[]) => Math.round(vals.reduce((n, v) => n + v, 0) * 100) / 100;
    const gps = read.map(d => d.provider!.sources.gpsDerived.value).filter((v): v is number => v !== null);
    return { days: read.map(d => ({ day: d.day, providerKm: d.provider!.sources.providerReported.value, reconciled: d.provider!.provider.arithmetic.status === "pass",
      openAtDayEnd: (d.provider!.provider.segments ?? []).at(-1)?.end === null, gpsKm: d.provider!.sources.gpsDerived.value })), reviewedDays: read.length, totalDays: data.activityDays.length,
      providerKm: reconciled.length ? sum(reconciled.map(d => d.provider!.sources.providerReported.value as number)) : null, providerKmDays: reconciled.length, gpsKm: gps.length ? sum(gps) : null, candidateCount: fuelCandidates.length };
  })() : null;

  const openReconTarget = (target: ReconTarget, d: string) => { chooseDay(d); if (target === "route") onOpenPlayback?.({ day: d, start: "00:00", end: "23:59" }); else if (target === "journeys") go("journeys"); else go("daily"); };
  const reconPanel = vehicleId ? <FleetMileageReconciliation key={`recon:${vehicleId}:${from}:${to}`} language={language} vehicleId={vehicleId} registration={registration} from={from} to={to} focusDay={activeDay} onOpen={openReconTarget} onClose={() => setReconOpen(false)} /> : null;

  /* JOBS: journeys against Booking Diary, kilometre allocation and the temporary review. Optional and secondary in V7.2. */
  const jobsView = (
  <div hidden={!showJobs} className="fleet-vehicle-view" data-view="jobs">
    {isJJ ? <p className="fleet-evidence-note v71-jobs-lead">{t("Optional · Booking Diary links. Journeys above work without bookings.", "ไม่บังคับ · เชื่อมกับสมุดจอง ส่วนเที่ยวรถด้านบนใช้ได้โดยไม่ต้องมีการจอง")}</p> : null}
    {!data && state !== "loading" ? <p>{t("Review the evidence for a date range first.", "ตรวจสอบหลักฐานของช่วงวันที่ก่อน")}</p> : null}
    {active ? <>
      <p className="fleet-evidence-note">{t("Booking vehicle assignments are source records. Matches are unconfirmed suggestions and scores are evidence weights, not probabilities. No kilometres are allocated automatically.", "การจัดรถจากสมุดจองเป็นข้อมูลต้นทาง การจับคู่เป็นข้อเสนอที่ยังไม่ยืนยัน คะแนนเป็นน้ำหนักหลักฐาน ไม่ใช่ความน่าจะเป็น และไม่จัดสรรระยะทางอัตโนมัติ")}</p>
      {journeyRestricted ? <p className="fleet-evidence-note" role="note">{t("Journey detail and job review use historical journeys and need administrator authorisation.", "รายละเอียดเที่ยวและการตรวจสอบงานใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p>
        : <FleetJourneyAllocation key={`alloc:${vehicleId}:${activeDay}`} provider={dayProvider} analysis={analysis} language={language} day={activeDay} />}
      {jobWarnings && jobWarnings.total > 0 && Object.values(jobWarnings.counts).some(c => c > 0) ? <div className="fleet-job-warnings" role="note"><strong>{t("Booking data quality for this day", "คุณภาพข้อมูลการจองของวันนี้")}</strong><ul>{(Object.keys(jobWarnings.counts) as DayJobWarning[]).filter(k => jobWarnings.counts[k] > 0).map(k => <li key={k}>{jobWarnings.counts[k]} {t("of", "จาก")} {jobWarnings.total}: {warningLabel[k]}</li>)}</ul></div> : null}
      {active.jobs === null ? <p>{t("Booking Diary source unavailable.", "แหล่งสมุดจองไม่พร้อม")}</p>
        : !journeyRestricted ? <>
          <FleetJobTimeline key={`job-timeline:${vehicleId}:${activeDay}`} jobs={active.jobs} analysis={analysis} ledger={journeyLedger} registration={registration} language={language} day={activeDay} />
          <FleetJobReviewPanel key={`job-review:${vehicleId}:${activeDay}`} jobs={active.jobs} analysis={analysis} ledger={journeyLedger} registration={registration} language={language} day={activeDay} />
        </> : null}
      <p><Link href="/booking-diary">{t("Open Booking Diary", "เปิดสมุดจอง")}</Link></p>
    </> : data ? <p>{t("No evidence row for the selected day.", "ไม่มีหลักฐานของวันที่เลือก")}</p> : null}
  </div>
  );

  return <section className="fleet-evidence fleet-vehicle-workspace" data-section={section} hidden={!["today", "jobs", "journeys", "fuel", "health", "daily", "journeys_jobs"].includes(section)} aria-label={t("Vehicle evidence", "หลักฐานของรถ")}>
    {needsScopeBar ? <div className="fleet-evidence-scope v7-scope">
      <div className="v7-scope-top">
        <div className="fleet-evidence-presets" role="group" aria-label={t("Date shortcuts", "เลือกช่วงวันที่")}><button type="button" onClick={() => preset(1)}>{t("Today", "วันนี้")}</button><button type="button" onClick={() => preset(1, true)}>{t("Yesterday", "เมื่อวาน")}</button><button type="button" onClick={() => preset(7)}>{t("Last 7 days", "7 วันที่ผ่านมา")}</button></div>
      </div>
      <form onSubmit={event => { event.preventDefault(); void load(); }}>
        <div className="fleet-evidence-dates"><label>{t("From", "ตั้งแต่")}<input required type="date" value={from} max={to} onChange={event => { if (event.target.value) setScope(event.target.value, to); }} /></label><label>{t("To", "ถึง")}<input required type="date" value={to} min={from} max={bangkokDateInput()} onChange={event => { if (event.target.value) setScope(from, event.target.value); }} /></label>
        {days.length > 1 ? <label className="fleet-evidence-day-select">{t("Selected day", "วันที่เลือก")}<select value={activeDay} onChange={event => chooseDay(event.target.value)}>{days.map(d => <option key={d} value={d}>{d}</option>)}</select></label> : null}</div>
        <button className="btn-secondary v7-scope-primary" disabled={!vehicleId || state === "loading"} type="submit">{state === "loading" ? t("Reading sources…", "กำลังอ่านข้อมูล…") : data ? t("Reload EES records", "โหลดข้อมูล EES ใหม่") : t("Load EES records", "โหลดข้อมูล EES")}</button>
      </form>
      {!vehicleId ? <p className="v7-scope-note">{t("A unique EES vehicle match is required before reading records.", "ต้องจับคู่รถ EES ได้เพียงคันเดียวก่อนอ่านบันทึก")}</p> : null}
      <div className="v7-scope-status" role="status" aria-live="polite">
        <span className="v7-scope-tag">{t("EES · read only", "EES · อ่านอย่างเดียว")}</span>
        {state === "failed" ? <span role="alert">{t("Evidence could not be read. Check access, dates and connection, then retry.", "อ่านหลักฐานไม่ได้ โปรดตรวจสอบสิทธิ์ วันที่ และการเชื่อมต่อ แล้วลองใหม่")}</span>
          : state === "loading" && data ? <span>{t("Refreshing; earlier evidence stays until the new read finishes.", "กำลังรีเฟรช หลักฐานก่อนหน้าจะคงอยู่จนอ่านเสร็จ")}</span>
          : state === "loading" ? <span>{t("Reading sources…", "กำลังอ่านข้อมูล…")}</span>
          : data ? <span>{t("EES records loaded (fuel, mileage, bookings)", "โหลดข้อมูล EES แล้ว (เชื้อเพลิง ไมล์ การจอง)")} · {from === to ? from : `${from} → ${to}`}</span>
          : <span>{t("EES records not loaded yet. Nothing is requested until you press Load.", "ยังไม่ได้โหลดข้อมูล EES จะไม่มีการร้องขอจนกว่าจะกดโหลด")}</span>}
      </div>
      <details className="fleet-evidence-more" data-scope-help><summary>{t("How this works · Asia/Bangkok", "วิธีทำงาน · เวลาไทย")}</summary><p className="fleet-evidence-note">{t("Up to 62 days. Source reads happen only when requested; the same range and loaded evidence are kept when you change tabs.", "สูงสุด 62 วัน อ่านเมื่อกดเท่านั้น ช่วงวันที่และหลักฐานที่โหลดแล้วจะคงอยู่เมื่อเปลี่ยนแท็บ")}</p></details>
    </div> : null}

    {/* One Forth day-read control shared by Daily Activity and Journeys, so a read in one is never lost in the other. */}
    {showJourneys || isDaily ? <FleetProviderDayPanel key={`${vehicleId}:${activeDay}`} vehicleId={vehicleId} day={activeDay} language={language} initial={active?.provider ?? null} onRead={() => void load()} variant={isDaily || isJJ ? "bar" : "full"} /> : null}

    {/* TODAY: what the vehicle did on the selected day, in one summary. Detail lives in Journeys and Jobs. */}
    <div hidden={!showToday} className="fleet-vehicle-view" data-view="today">
      {!data && state !== "loading" ? <p>{t("Choose a date range and review the evidence. Missing evidence stays unknown, never zero.", "เลือกช่วงวันที่แล้วตรวจสอบหลักฐาน หลักฐานที่ขาดยังคงเป็นไม่ทราบ ไม่ใช่ศูนย์")}</p> : null}
      {!isDaily && data?.activityDays && data.activityDays.length > 1 ? <div className="v72-table-wrap"><table className="v72-table v72-days-table"><caption>{t("Days in range", "วันในช่วงที่เลือก")}</caption><thead><tr><th scope="col">{t("Day", "วัน")}</th><th scope="col" className="num">{t("Forth km", "กม. Forth")}</th><th scope="col" className="num">{t("GPS km", "กม. GPS")}</th><th scope="col" className="num">{t("Odometer readings", "เลขไมล์")}</th><th scope="col">{t("Fuel purchased", "เชื้อเพลิงที่ซื้อ")}</th></tr></thead><tbody>{data.activityDays.map(row => <tr key={row.day} className={activeDay === row.day ? "is-active" : ""}><th scope="row"><button type="button" aria-pressed={activeDay === row.day} onClick={() => chooseDay(row.day)}>{row.day}</button></th><td className="num">{row.provider ? value(row.provider.sources.providerReported.value) : <span className="v72-muted">{t("not read", "ยังไม่ได้อ่าน")}</span>}</td><td className="num">{row.provider ? value(row.provider.sources.gpsDerived.value) : "—"}</td><td className="num">{row.checkpoints === null ? "—" : row.checkpoints.length}</td><td>{fuelLine(row.fuelPurchases)}</td></tr>)}</tbody></table></div> : null}
      {isDaily && active ? <>
        <FleetDaySnapshot operating={operatingSummaryOf(dayNarrative)} provider={dayProvider} model={dayInsights} summary={summary} registration={registration} day={activeDay} language={language} restricted={journeyRestricted} onExplain={journeyAccess === "granted" && vehicleId ? () => setReconOpen(true) : undefined} visits={dayPlaces.data?.read ? { supported: dayPlaces.data.counts.visits, gpsStops: dayPlaces.data.counts.gpsStops, unknown: dayPlaces.data.counts.unknownVisits, gapAffected: dayPlaces.data.counts.gapAffectedVisits } : null} />
        {reconOpen && vehicleId && journeyAccess === "granted" ? reconPanel : null}
        <p className="v77-dayline" data-day-other-evidence><b>{t("Fuel records for this day", "บันทึกเชื้อเพลิงของวันนี้")}:</b> {fuelLine(fuelGroupsDay)} · <b>{t("Odometer readings", "เลขไมล์")}:</b> {active?.checkpoints ? active.checkpoints.length : "—"} · {link("fuel", t("Open fuel", "ดูเชื้อเพลิง"))}<small> {t("Purchases are not consumption.", "การซื้อไม่ใช่การใช้เชื้อเพลิง")}</small></p>
        <FleetDayNarrative model={dayNarrative} language={language} day={activeDay} provider={dayProvider} restricted={journeyRestricted} visits={dayPlaces.data?.read ? dayPlaces.data.visits : null} previousDay={data?.activityDays?.find(d => d.day === prevDayOf(activeDay))?.provider ?? null} nextDay={data?.activityDays?.find(d => d.day === nextBangkokDay(activeDay))?.provider ?? null} nextDayRequested={nextBangkokDay(activeDay) <= to} actions={timelineActions} onSelectVisit={chooseVisit} />
        {/* V7.8: the timeline above is the primary view; the full visit table and evidence stay available, collapsed, so the day is not summarised twice. */}
        <details className="v72-evidence v78-visit-details" data-daily-visit-details open={Boolean(selectedVisit)}><summary>{t("Visit details and stop evidence", "รายละเอียดการเข้าเยี่ยมและหลักฐานจุดจอด")}{dayPlaces.data?.read ? ` · ${dayPlaces.data.counts.visits}` : ""}</summary>
          <FleetDayPlaces places={dayPlaces} language={language} dayRead={Boolean(dayProvider) && !journeyRestricted} providerStops={providerStops} onViewRoute={viewRoute} selectedId={selectedVisit?.id ?? null} onSelectedChange={chooseVisit} onViewLocation={timelineActions.onViewLocation} />
        </details>
        {data?.activityDays && data.activityDays.length > 1 ? <details className="v72-evidence" data-days-in-range><summary>{t("Other days in this range", "วันอื่นในช่วงที่เลือก")} · {data.activityDays.length}</summary><div className="v72-table-wrap"><table className="v72-table v72-days-table"><caption>{t("Days in range", "วันในช่วงที่เลือก")}</caption><thead><tr><th scope="col">{t("Day", "วัน")}</th><th scope="col" className="num">{t("Forth km", "กม. Forth")}</th><th scope="col" className="num">{t("GPS km", "กม. GPS")}</th><th scope="col" className="num">{t("Odometer readings", "เลขไมล์")}</th><th scope="col">{t("Fuel purchased", "เชื้อเพลิงที่ซื้อ")}</th></tr></thead><tbody>{data.activityDays.map(row => <tr key={row.day} className={activeDay === row.day ? "is-active" : ""}><th scope="row"><button type="button" aria-pressed={activeDay === row.day} onClick={() => chooseDay(row.day)}>{row.day}</button></th><td className="num">{row.provider ? value(row.provider.sources.providerReported.value) : <span className="v72-muted">{t("not read", "ยังไม่ได้อ่าน")}</span>}</td><td className="num">{row.provider ? value(row.provider.sources.gpsDerived.value) : "—"}</td><td className="num">{row.checkpoints === null ? "—" : row.checkpoints.length}</td><td>{fuelLine(row.fuelPurchases)}</td></tr>)}</tbody></table></div></details> : null}
        <details className="v72-evidence" data-tracking-evidence><summary>{t("Tracking evidence & reconciliation", "หลักฐานการติดตามและการกระทบยอด")}</summary>
          <FleetDayInsights model={dayInsights} registration={registration} language={language} />
          <FleetVehicleDaySummary summary={summary} registration={registration} language={language} />
          <FleetProviderDayPanel key={`details:${vehicleId}:${activeDay}`} vehicleId={vehicleId} day={activeDay} language={language} initial={active?.provider ?? null} onRead={() => void load()} variant="details" />
          <div className="v71-health-details" data-daily-health><h4>{t("GPS health & tracking coverage", "สถานะ GPS และความครอบคลุมการติดตาม")}</h4>{gpsHealth}</div>
        </details>
        <p className="fleet-vehicle-links">{link("journeys", t("Open journeys", "ดูเที่ยวรถ"))} · {link("fuel", t("Open fuel", "ดูเชื้อเพลิง"))}</p>
      </> : active ? <>
        <FleetDayInsights model={dayInsights} registration={registration} language={language} />
        <FleetVehicleDaySummary summary={summary} registration={registration} language={language} />
        <p className="fleet-vehicle-links">{!dayProvider ? <>{t("Forth report not read for this day.", "ยังไม่ได้อ่านรายงาน Forth ของวันนี้")} </> : null}{link("journeys", t("Open journeys", "ดูเที่ยวรถ"))} · {link("jobs", t("Open job review", "ดูการตรวจสอบงาน"))} · {link("fuel", t("Open fuel", "ดูเชื้อเพลิง"))}</p>
      </> : data ? <p>{t("No evidence row for the selected day.", "ไม่มีหลักฐานของวันที่เลือก")}</p> : null}
    </div>

    {/* JOURNEYS: Forth report retrieval and the movement history. */}
    <div hidden={!showJourneys} className="fleet-vehicle-view" data-view="journeys">
      {isJJ && historyDays.length ? <FleetOperatingStrip days={historyDays} language={language} /> : null}
      {data?.activityDays?.some(row => !row.provider) ? <><button className="btn-secondary" type="button" disabled={batch !== null && batch.error === null && batch.done < batch.total} onClick={() => void readUnreadDays()}>{batch && batch.error === null && batch.done < batch.total ? t(`Reading ${batch.done + 1} of ${batch.total}…`, `กำลังอ่าน ${batch.done + 1} จาก ${batch.total}…`) : t(`Read Forth report for unread days (max 7)`, `อ่านรายงาน Forth สำหรับวันที่ยังไม่ได้อ่าน (สูงสุด 7)`)}</button>
        <small>{t("Reads one day at a time, read-only, stops at the first provider error.", "อ่านทีละวัน อ่านอย่างเดียว หยุดเมื่อผู้ให้บริการตอบผิดพลาดครั้งแรก")}</small></> : null}
      {batch?.error ? <p role="alert">{batch.error === "rate_limited" ? t("Forth rate limit reached. Stopped safely; wait and retry.", "ถึงขีดจำกัดของ Forth หยุดอย่างปลอดภัย โปรดรอแล้วลองใหม่") : batch.error === "provider_unavailable" ? t("Forth is unavailable or not authorised right now. Stopped safely; days read so far are kept.", "Forth ไม่พร้อมหรือไม่มีสิทธิ์ในขณะนี้ หยุดอย่างปลอดภัย วันที่อ่านแล้วยังคงอยู่") : t("A provider read failed. Stopped safely.", "การอ่านจากผู้ให้บริการล้มเหลว หยุดอย่างปลอดภัย")}</p> : null}
      {isJJ ? <FleetDayPlaces places={dayPlaces} language={language} dayRead={Boolean(dayProvider) && !journeyRestricted} providerStops={providerStops} onViewRoute={viewRoute} selectedId={selectedVisit?.id ?? null} onSelectedChange={chooseVisit} onViewLocation={timelineActions.onViewLocation} /> : null}
      {journeyRestricted
        ? <p className="fleet-evidence-note" role="note">{t("Journey detail uses historical journeys and needs administrator authorisation. The Forth day total above is still shown.", "รายละเอียดเที่ยวใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ ยอดรวมรายวันจาก Forth ด้านบนยังแสดงอยู่")}</p>
        : <FleetJourneyList key={`journeys:${vehicleId}:${activeDay}`} provider={dayProvider} analysis={analysis} language={language} day={activeDay} onOpenPlayback={journeyAccess === "granted" && onOpenPlayback ? () => onOpenPlayback() : undefined} onOpenDay={() => go("today")} />}
      {vehicleId ? <FleetRecurringAreas key={`recurring:${vehicleId}`} language={language} vehicleId={vehicleId} onOpenDay={(_registration, day) => openRecurringDay(day)} /> : null}
      {isJJ && dayProvider ? <details className="v72-evidence" data-advanced-evidence><summary>{t("Advanced evidence · Forth report detail", "หลักฐานขั้นสูง · รายละเอียดรายงาน Forth")}</summary><FleetProviderDayPanel key={`details:${vehicleId}:${activeDay}`} vehicleId={vehicleId} day={activeDay} language={language} initial={active?.provider ?? null} onRead={() => void load()} variant="details" /></details> : null}
      <p className="fleet-vehicle-links">{journeyAccess === "granted" && onOpenPlayback ? <button type="button" className="btn-secondary" onClick={() => onOpenPlayback()}>{t("Open route playback (supervised admin)", "เปิดการเล่นย้อนเส้นทาง (ผู้ดูแลที่ควบคุม)")}</button> : <small>{journeyRestricted ? t("Route playback is restricted to authorised administrators.", "การเล่นย้อนเส้นทางจำกัดเฉพาะผู้ดูแลระบบที่ได้รับอนุญาต") : t("Route playback becomes available here after the Forth report is read by an authorised administrator.", "การเล่นย้อนเส้นทางจะแสดงที่นี่หลังผู้ดูแลที่ได้รับอนุญาตอ่านรายงาน Forth")}</small>}</p>
    </div>

    {isJJ ? <details className="v72-optional" data-optional-jobs><summary>{t("Optional · Booking & job matches", "ไม่บังคับ · การจองและการจับคู่งาน")}</summary>{jobsView}</details> : jobsView}

    {/* FUEL: purchases (Fuel Logs) and odometer evidence. Purchased is never consumed. */}
    <div hidden={section !== "fuel"} className="fleet-vehicle-view" data-view="fuel">
      {/* V7.8.2: the fuel review leads (summary, then chronological transactions); source comparisons and day-by-day evidence are secondary. */}
      {reconOpen && vehicleId && journeyAccess === "granted" ? reconPanel : null}
      <FleetFuelPanel onExplainMileage={journeyAccess === "granted" && vehicleId ? () => setReconOpen(true) : undefined} vehicleId={vehicleId} registration={registration} language={language} scope={{ from, to }} onScope={(f, t2) => setScope(f, t2)} forth={forthContext} onOpenDay={day => { chooseDay(day); go("daily"); }} onLoadContext={() => void load()} contextLoading={state === "loading"} />
      {data && historyDays.length ? <><FleetFuelReview language={language} candidates={fuelCandidates} />
        <details className="v72-evidence v782-secondary" data-day-evidence><summary>{t("Day-by-day evidence", "หลักฐานรายวัน")} · {historyDays.length}</summary><FleetOperatingStrip days={historyDays} language={language} /></details></> : null}
      <details className="fleet-evidence-odometer" open={false}><summary>{t("Odometer evidence and source comparison", "หลักฐานเลขไมล์และการเปรียบเทียบแหล่งข้อมูล")}</summary>
        {!data ? <><p>{t("Reads Fuel Logs and Weekly Mileage odometer readings for the same date range. Nothing is written.", "อ่านเลขไมล์จากบันทึกเชื้อเพลิงและเลขไมล์รายสัปดาห์ในช่วงวันที่เดียวกัน ไม่มีการเขียนข้อมูล")}</p><button className="btn-secondary" type="button" disabled={!vehicleId || state === "loading"} onClick={() => void load()}>{state === "loading" ? t("Reading sources…", "กำลังอ่านข้อมูล…") : t("Read odometer evidence", "อ่านหลักฐานเลขไมล์")}</button>{state === "failed" ? <p role="alert">{t("Evidence could not be read. Retry.", "อ่านหลักฐานไม่ได้ โปรดลองใหม่")}</p> : null}</> : <>
          <FleetKmFuelTable days={historyDays} spans={historySpans} language={language} />
          {spans.map(({ source, span }) => <p key={source}>{source === "fuel_logs" ? t("Fuel-log odometer span", "ช่วงเลขไมล์จากบันทึกเชื้อเพลิง") : t("Weekly odometer span", "ช่วงเลขไมล์รายสัปดาห์")}: <strong>{span ? `${value(span.km)} km` : "—"}</strong> {span ? `(${span.from} → ${span.to}, ${span.intervals} ${t("intervals", "ช่วง")}${span.reviewRequired ? `, ${t("date-only · office review required", "วันที่เท่านั้น · ต้องตรวจสอบ")}` : ""})` : t("withheld: no readings, or a missing/reset/conflicting interval", "ไม่แสดง: ไม่มีเลขไมล์ หรือมีช่วงขาด/รีเซ็ต/ขัดแย้ง")}</p>)}
          {(() => {
            const name = (s: SourceDistance["source"]) => s === "forth_provider" ? t("Forth provider", "ผู้ให้บริการ Forth") : s === "forth_gps" ? t("Forth GPS-derived", "GPS จาก Forth") : s === "fuel_log_odometer" ? t("Fuel Log odometer", "เลขไมล์จากบันทึกเชื้อเพลิง") : t("Weekly Mileage odometer", "เลขไมล์รายสัปดาห์");
            const period = (s: SourceDistance) => s.periodStart ? (s.periodStart === s.periodEnd ? s.periodStart : `${s.periodStart} → ${s.periodEnd}`) : "—";
            const copy = (status: string, reason: string) => status === "not_comparable" ? (reason === "missing_distance" ? t("Not comparable · distance unknown", "เปรียบเทียบไม่ได้ · ไม่ทราบระยะทาง") : t("Not comparable · different observation periods", "เปรียบเทียบไม่ได้ · ช่วงเวลาสังเกตต่างกัน")) : status === "incomplete" ? t("Same period · coverage or observation time uncertain", "ช่วงเวลาเดียวกัน · ความครอบคลุมหรือเวลาสังเกตยังไม่แน่นอน") : status === "review_required" ? t("Discrepancy · office review required", "ผลต่าง · ต้องให้สำนักงานตรวจสอบ") : t("Within tolerance", "อยู่ในเกณฑ์");
            return <><h4>{t("Mileage source comparison", "เปรียบเทียบระยะทางจากแหล่งข้อมูล")} · {activeDay}</h4>
              <ul className="fleet-evidence-list">{comparisonSources.map(s => <li key={s.source}><strong>{name(s.source)}: {s.km === null ? "—" : `${value(s.km)} km`}</strong><small>{t("Observation period", "ช่วงเวลาสังเกต")}: {period(s)}</small></li>)}</ul>
              <ul className="fleet-evidence-list">{comparisonPairs.map(([a, b]) => { const result = compareSources(a, b); return <li key={`${a.source}:${b.source}`}><span>{name(a.source)} ↔ {name(b.source)}</span><small>{copy(result.status, result.reason)}{result.differenceKm !== null ? ` · ${value(result.differenceKm)} km` : ""}</small></li>; })}</ul>
              <p className="fleet-evidence-note">{t("No source is treated as correct. A multi-day odometer span is never compared with one day of GPS. Differences are shown for review and nothing is overwritten.", "ไม่ถือว่าแหล่งใดถูกต้องเสมอ ไม่เปรียบเทียบเลขไมล์หลายวันกับ GPS หนึ่งวัน แสดงผลต่างเพื่อตรวจสอบและไม่เขียนทับข้อมูล")}</p></>;
          })()}
          <h4>{t("Odometer readings in range", "เลขไมล์ในช่วงที่เลือก")}</h4>
          {!data.mileage ? <p>{t("Fuel / weekly source unavailable. No zero is inferred.", "แหล่งเชื้อเพลิง/เลขไมล์รายสัปดาห์ไม่พร้อม ไม่ถือว่าเป็นศูนย์")}</p> : data.mileage.checkpoints.length === 0 ? <p>{t("No readings returned for this scope.", "ไม่มีเลขไมล์ในช่วงที่เลือก")}</p> : <ul className="fleet-evidence-list">{data.mileage.checkpoints.map(point => <li key={`${point.source}:${point.id}`}><strong>{point.observationDate} · {value(point.odometerKm)} km</strong><span>{point.source === "fuel_logs" ? t("Fuel log", "บันทึกเชื้อเพลิง") : t("Weekly reading · date is a proxy", "เลขไมล์รายสัปดาห์ · วันที่เป็นค่าอ้างอิง")}</span>{point.source === "fuel_logs" ? <span>{point.fuelType ?? t("Fuel type unknown", "ไม่ทราบชนิดเชื้อเพลิง")} · {value(point.purchasedLitres ?? null)} L · ฿{baht(point.costThb ?? null)}</span> : null}<small>{t("Entered", "บันทึกเมื่อ")}: {enteredDate(point.enteredAt)}</small></li>)}</ul>}
          {data.intervals?.map((interval, index) => <div className="fleet-evidence-interval" key={`${interval.source}:${index}`}><strong>{interval.from} → {interval.to}: {value(interval.metric.value)} km</strong><span>{interval.source === "fuel_logs" ? t("Fuel odometer interval", "ช่วงเลขไมล์จากเชื้อเพลิง") : t("Weekly odometer interval", "ช่วงเลขไมล์รายสัปดาห์")}</span><span>{interval.reviewRequired ? t("Office review required · date / identity uncertainty", "ต้องให้สำนักงานตรวจสอบ · วันที่/ตัวตนยังไม่แน่นอน") : t("Checkpoint difference", "ผลต่างเลขไมล์")}</span>{interval.metric.value === null ? <small>{t("Distance withheld: missing, conflicting, reset or uncertain readings.", "ไม่แสดงระยะทาง: ข้อมูลขาด ขัดแย้ง รีเซ็ต หรือไม่แน่นอน")}</small> : null}</div>)}
          <p className="fleet-evidence-note">{t("Purchased fuel is not consumed fuel. Observation dates differ from entry dates, and intervals from different periods must not be forced to agree. Historical LPG accounting is unchanged.", "เชื้อเพลิงที่ซื้อไม่ใช่เชื้อเพลิงที่ใช้จริง วันที่อ่านค่าต่างจากวันที่บันทึก ห้ามบังคับกระทบยอดคนละช่วงเวลา การบัญชี LPG เดิมไม่เปลี่ยน")}</p>
          <small>{t("Source snapshot", "เวลาที่อ่านแหล่งข้อมูล")}: {new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.capturedAt))}</small>
        </>}
      </details>
    </div>

    {/* GPS HEALTH: can the position and mileage evidence be trusted? Verification rules are unchanged. */}
    <div hidden={section !== "health"} className="fleet-vehicle-view" data-view="health">
      {gpsHealth}
      <h4>{t("Historical data gaps", "ช่วงที่ประวัติขาด")} · {activeDay}</h4>
      {!dayProvider ? <p>{t("Not known: the Forth report for this day has not been read (Journeys tab).", "ยังไม่ทราบ: ยังไม่ได้อ่านรายงาน Forth ของวันนี้ (แท็บเส้นทาง)")}</p>
        : journeyRestricted ? <p>{t("Gap detail uses historical journeys and needs administrator authorisation.", "รายละเอียดช่วงที่ขาดใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p>
        : !journeyLedger ? <p>{t("Not known: the snapshot predates journey analysis. Refresh it in the Journeys tab.", "ยังไม่ทราบ: ข้อมูลนี้อ่านก่อนมีการวิเคราะห์เที่ยว โปรดรีเฟรชในแท็บเส้นทาง")}</p>
        : <p>{journeyLedger.missing.length === 0 ? t("No recording outage over 10 minutes.", "ไม่มีช่วงบันทึกขาดเกิน 10 นาที") : `${journeyLedger.missing.length} ${t("missing period(s)", "ช่วงที่ขาด")} · ${journeyLedger.totals.missingMinutes} ${t("min; distance there is unknown", "นาที ไม่ทราบระยะทางในช่วงนั้น")}`} · {journeyLedger.totals.cadenceJitterGaps} {t("normal 5-minute spacings (not missing)", "ช่วงห่างตามรอบปกติ (ไม่ใช่ที่ขาด)")}</p>}
      <h4>{t("Provider coverage and source completeness", "ความครอบคลุมของผู้ให้บริการและความครบถ้วนของข้อมูล")}</h4>
      <ul className="fleet-evidence-list">{FORTH_DISTANCE_SEMANTICS.filter(f => ["day_coverage", "open_segment_final_zero", "position_source_label", "history_coordinates"].includes(f.id)).map(f => <li key={f.id}><span>{language === "th" ? f.th : f.en}</span></li>)}</ul>
      <details><summary>{t("Unresolved questions for Forth", "คำถามที่ยังรอคำตอบจาก Forth")} · {FORTH_QUESTIONS.length}</summary><ol>{FORTH_QUESTIONS.map(q => <li key={q}>{q}</li>)}</ol></details>
    </div>
    {mapVisitId && vehicleId && journeyAccess === "granted" && visitRefs.length ? <FleetVisitMap key={`${vehicleId}:${activeDay}`} language={language} vehicleId={vehicleId} registration={registration} day={activeDay} visits={visitRefs} visitId={mapVisitId} onSelect={id => { chooseVisit(id); setMapVisitId(id); }} onClose={() => setMapVisitId(null)} onOpenEvidence={id => { chooseVisit(id); setMapVisitId(null); }} /> : null}
  </section>;
}
