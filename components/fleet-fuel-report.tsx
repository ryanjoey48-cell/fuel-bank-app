"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { originHeaders } from "@/lib/fleet-request-origin";
import { bangkokDateInput } from "@/lib/fleet-evidence-view";
import { formatLitres, formatThb, type FuelByType, type VehicleFuelSummary } from "@/lib/fleet-fuel-view";
import { fuelTypeLabel } from "@/components/fleet-fuel-panel";
import {
  CLASS_COPY, ISSUE_CLASS, FUEL_STATE_COPY, OVERSIGHT_ISSUE_COPY, SORT_COPY, buildOversightRows, filterSortRows, groupOversightIssues, summarizeOversight, unknownAreasByVehicle,
  type CoverageVehicleInput, type OversightRow, type RecurringUnknownInput, type ShowFilter, type SortKey
} from "@/lib/fleet-fuel-oversight";
import { FleetVehicleInvestigation } from "@/components/fleet-vehicle-investigation";
import { runReadQueue } from "@/lib/fleet-day-review";
import { MAX_CHECKED_VEHICLES, PERIOD_READ_CAP, buildReadPlan, countReads, coverageNumbers, expiredSince, finalizeStates, parseKey, reviewableDays, reviewText, reviewedKeySet, type CoverageRowLite, type PeriodReadState, type PlanScope } from "@/lib/fleet-coverage-review";

type Lang = "en" | "th";
type FuelRowApi = Omit<VehicleFuelSummary, "reviewRecords" | "transactions" | "intervals"> & { reviewRecords: number | null; reviewFlags: number | null; registryStatus?: "active" | "inactive" | "duplicate" | "unknown" };
type FuelReport = { from: string; to: string; capturedAt: string; sourceStatus: "available" | "unavailable" | "truncated"; vehicles: FuelRowApi[];
  fleet: { matchedRecords: number; unmatchedRecords: number; ambiguousRegistrationRecords: number; duplicateSourceRows: number; outsideRangeRecords: number; byType: FuelByType[]; costThb: number | null; reviewRecords: number; vehiclesWithPurchases: number; daysInRange: number } | null };
type CoverageReport = { from: string; to: string; calendarDays: number; capturedAt: string; vehicles: CoverageVehicleInput[] };
export type FuelOversightTarget = "fuel" | "daily" | "journeys" | "route";
type RecurringState = "not_loaded" | "ready" | "restricted" | "too_long" | "unavailable";

/**
 * Fleet fuel and mileage oversight (Reports). It joins two read-only results for the SAME period: Fuel Logs through the caller's own
 * permissions, and Forth day coverage from this user's server memory only (no Forth request). Purchases are never consumption, an unread
 * source is never zero, and registry rows are never merged. Changing sort, search or filter only re-orders what is already loaded.
 */
export function FleetFuelReport({ language, onVehicle, initialScope, onScopeChange }: {
  language: Lang; onVehicle: (registration: string, target: FuelOversightTarget, scope: { from: string; to: string; day: string | null }) => void;
  /** V7.8.4: the period shared by all five workspaces (and the address bar). It only seeds the date inputs: nothing is read until the button is pressed. */
  initialScope?: { from: string; to: string } | null; onScopeChange?: (scope: { from: string; to: string }) => void;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const lang = language === "th" ? 1 : 0;
  const [from, setFrom] = useState(() => initialScope?.from ?? bangkokDateInput(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(() => initialScope?.to ?? bangkokDateInput());
  const [fuel, setFuel] = useState<FuelReport | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [coverageFailed, setCoverageFailed] = useState(false);
  const [recurring, setRecurring] = useState<{ state: RecurringState; unknown: RecurringUnknownInput[] }>({ state: "not_loaded", unknown: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reconRequested, setReconRequested] = useState(false);
  // V7.8.2 controlled coverage review: an explicit, bounded, one-at-a-time read of missing vehicle-days through the existing read queue.
  const [scope, setScope] = useState<PlanScope>("selected");
  const [checked, setChecked] = useState<string[]>([]);
  const [reads, setReads] = useState<Record<string, PeriodReadState>>({});
  const [runKeys, setRunKeys] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [expired, setExpired] = useState<string[]>([]);
  const [cancelledNote, setCancelledNote] = useState(false);
  const runAbort = useRef<AbortController | null>(null);
  const userCancelled = useRef(false);
  const seen = useRef<Set<string>>(new Set());
  const period = useRef("");
  const refreshing = useRef(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("spend");
  const [show, setShow] = useState<ShowFilter>("all");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); runAbort.current?.abort(); }, []);
  function reset() { request.current?.abort(); request.current = null; setFuel(null); setCoverage(null); setStatus("idle"); setCoverageFailed(false); setRecurring({ state: "not_loaded", unknown: [] }); setSelectedId(null); runAbort.current?.abort(); setReads({}); setRunKeys([]); setExpired([]); setChecked([]); setCancelledNote(false); seen.current = new Set(); period.current = ""; }
  async function read() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setStatus("loading"); setFuel(null); setCoverage(null); setCoverageFailed(false); setSelectedId(null); setRecurring({ state: "not_loaded", unknown: [] });
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const { data: session } = await supabase.auth.getSession(); if (!session.session) throw new Error("session");
      const init = { headers: { Authorization: `Bearer ${session.session.access_token}` }, signal: controller.signal, cache: "no-store" as const };
      const qs = new URLSearchParams({ from, to });
      // Three bounded requests for the whole fleet (never one per vehicle); none contacts Forth. The third (recurring unknown areas) is limited to 31 days and to journey-authorised callers; it may fail without affecting fuel or coverage.
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
      const [fuelResponse, coverageResponse, recurringResponse] = await Promise.all([fetch(`/api/admin/forth-tracking/evidence/fuel?${qs}`, init), fetch(`/api/admin/forth-tracking/evidence/fleet-period?${qs}`, init), days <= 31 ? fetch(`/api/admin/forth-tracking/evidence/recurring?${qs}`, init).catch(() => null) : Promise.resolve(null)]);
      if (!fuelResponse.ok) throw new Error("fuel");
      const fuelResult = await fuelResponse.json() as FuelReport;
      const coverageResult = coverageResponse.ok ? await coverageResponse.json() as CoverageReport : null;
      let recurringResult: { state: RecurringState; unknown: RecurringUnknownInput[] } = { state: days > 31 ? "too_long" : "unavailable", unknown: [] };
      if (recurringResponse?.ok) { const body = await recurringResponse.json() as { analysis?: { areas?: Parameters<typeof unknownAreasByVehicle>[0] } }; recurringResult = { state: "ready", unknown: unknownAreasByVehicle(body.analysis?.areas ?? []) }; }
      else if (recurringResponse?.status === 403) recurringResult = { state: "restricted", unknown: [] };
      if (request.current === controller) { setFuel(fuelResult); setCoverage(coverageResult); setRecurring(recurringResult); setCoverageFailed(!coverageResult); setStatus("idle"); period.current = `${from}|${to}`; seen.current = coverageResult ? reviewedKeySet(coverageResult.vehicles.map(v => ({ vehicleId: v.vehicleId, registration: v.registration, eligible: v.registryStatus === "active" || v.registryStatus === "unknown", reviewedDayList: v.reviewedDayList })), reviewableDays(from, to)) : new Set(); setExpired([]); }
    } catch { if (request.current === controller && !controller.signal.aborted) setStatus("failed"); else if (request.current === controller) setStatus("idle"); } finally { clearTimeout(timeout); }
  }

  /** Cache-only refresh of the coverage (and, at the end of a run, the recurring areas). It never contacts Forth and never touches the loaded fuel records. */
  async function refreshCoverage(final: boolean) {
    if (!coverage || refreshing.current) return;
    const stamp = `${from}|${to}`; refreshing.current = true;
    try {
      const { data: session } = await supabase.auth.getSession(); if (!session.session) return;
      const init = { headers: { Authorization: `Bearer ${session.session.access_token}` }, cache: "no-store" as const };
      const qs = new URLSearchParams({ from, to });
      const [cov, rec] = await Promise.all([fetch(`/api/admin/forth-tracking/evidence/fleet-period?${qs}`, init), final && recurring.state === "ready" ? fetch(`/api/admin/forth-tracking/evidence/recurring?${qs}`, init).catch(() => null) : Promise.resolve(null)]);
      if (period.current !== stamp || !cov.ok) return; // the period changed meanwhile, or the refresh failed: keep what is shown
      const next = await cov.json() as CoverageReport;
      if (period.current !== stamp) return;
      const current = reviewedKeySet(next.vehicles.map(v => ({ vehicleId: v.vehicleId, registration: v.registration, eligible: v.registryStatus === "active" || v.registryStatus === "unknown", reviewedDayList: v.reviewedDayList })), reviewableDays(from, to));
      const gone = expiredSince(seen.current, current);
      if (gone.length) setExpired(prev => [...new Set([...prev, ...gone])].filter(k => !current.has(k)));
      else setExpired(prev => prev.filter(k => !current.has(k)));
      seen.current = current; setCoverage(next);
      if (rec?.ok) { const body = await rec.json() as { analysis?: { areas?: Parameters<typeof unknownAreasByVehicle>[0] } }; if (period.current === stamp) setRecurring({ state: "ready", unknown: unknownAreasByVehicle(body.analysis?.areas ?? []) }); }
    } catch { /* a failed cache-only refresh leaves the last coverage on screen */ } finally { refreshing.current = false; }
  }
  const coverageRows = useMemo<CoverageRowLite[]>(() => (coverage?.vehicles ?? []).map(v => ({ vehicleId: v.vehicleId, registration: v.registration, eligible: v.registryStatus === "active" || v.registryStatus === "unknown", reviewedDayList: v.reviewedDayList })), [coverage]);
  const reviewDays = useMemo(() => reviewableDays(from, to), [from, to]);
  const plan = useMemo(() => buildReadPlan({ rows: coverageRows, days: reviewDays, scope, selectedId, checkedIds: checked }), [coverageRows, reviewDays, scope, selectedId, checked]);
  const numbers = useMemo(() => coverageNumbers(coverageRows, reviewDays), [coverageRows, reviewDays]);
  const counts = useMemo(() => countReads(runKeys, reads), [runKeys, reads]);
  async function startReview() {
    if (running || plan.keys.length === 0) return;
    const keys = plan.keys; const controller = new AbortController(); runAbort.current = controller; userCancelled.current = false;
    setRunning(true); setRunKeys(keys); setReads({}); setCancelledNote(false);
    try {
      const { data: session } = await supabase.auth.getSession(); if (!session.session) throw new Error("session");
      const access = session.session.access_token;
      await runReadQueue(keys, async (key, signal) => {
        const p = parseKey(key); if (!p) return { status: 400 };
        const response = await fetch(`/api/admin/forth-tracking/evidence/provider?${new URLSearchParams({ vehicleId: p.vehicleId, day: p.day })}`, { method: "POST", headers: { Authorization: `Bearer ${access}`, ...originHeaders("reports_coverage_review") }, signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]), cache: "no-store" });
        return { status: response.status };
      }, { signal: controller.signal, concurrency: 1, onState: (key, state) => { setReads(current => ({ ...current, [key]: state })); if (state === "done") void refreshCoverage(false); } });
    } catch { /* a session problem leaves every day not started */ } finally {
      setRunning(false); runAbort.current = null; setReads(current => finalizeStates(keys, current, userCancelled.current)); setCancelledNote(userCancelled.current);
      await refreshCoverage(true);
    }
  }
  function stopReview() { userCancelled.current = true; runAbort.current?.abort(); }
  // When the earliest cached day leaves server memory, re-check the cache once (no Forth) so the numerator drops honestly instead of staying stale.
  useEffect(() => {
    if (!coverage) return;
    const times = coverage.vehicles.map(v => v.earliestExpiresAt).filter((x): x is string => Boolean(x)).map(x => Date.parse(x)).filter(Number.isFinite);
    if (!times.length) return;
    const wait = Math.min(Math.max(Math.min(...times) - Date.now() + 1500, 1000), 31 * 60000);
    const timer = window.setTimeout(() => { void refreshCoverage(false); }, wait);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage]);

  const rows = useMemo<OversightRow[]>(() => coverage ? buildOversightRows({ fuel: { status: fuel ? fuel.sourceStatus : "not_loaded", vehicles: fuel?.vehicles ?? [] }, coverage: coverage.vehicles, calendarDays: coverage.calendarDays, recurringUnknown: recurring.unknown }) : [], [fuel, coverage, recurring]);
  const summary = useMemo(() => summarizeOversight(rows), [rows]);
  const visible = useMemo(() => filterSortRows(rows, { search, show, sort }), [rows, search, show, sort]);
  const groups = useMemo(() => groupOversightIssues(rows), [rows]);
  const includesToday = to >= bangkokDateInput();
  const stamp = (iso: string) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: 1 }));
  const typeName = (v: string | null) => (v ? v.replace(/_/g, " ").toLowerCase() : "—");
  const L = language === "th" ? "ลิตร" : "L";
  const typeText = (groups2: readonly { fuelType: string; litres: number | null }[] | null) => groups2 === null ? "—" : groups2.length === 0 ? "—" : groups2.map(g => `${fuelTypeLabel(g.fuelType, language)} ${formatLitres(g.litres, language)} ${L}`).join(" · ");
  const open = (r: { registration: string; day?: string | null }, target: FuelOversightTarget) => onVehicle(r.registration, target, { from, to, day: r.day ?? null });
  const selectedRow = rows.find(r => r.vehicleId === selectedId) ?? null;
  const evLabel = (k: string) => k === "records" ? t("records", "รายการ") : k === "days" ? t("days", "วัน") : k === "intervals" ? t("intervals", "ช่วง") : k === "longest_min" ? t("longest gap (min)", "ช่วงขาดนานสุด (นาที)") : k === "largest_diff_km" ? t("largest difference (km)", "ส่วนต่างสูงสุด (กม.)") : k === "areas" ? t("areas", "พื้นที่") : k;
  const sevText = (s: string) => (s === "medium" ? t("Medium", "กลาง") : s === "high" ? t("High", "สูง") : t("Info", "ข้อมูล"));
  const fuelOk = fuel?.sourceStatus === "available" && fuel.fleet;
  // V7.8.4: vehicles with at least one medium-or-higher review candidate (info-level notices are not counted). Derived from the same groups the queue shows.
  const needReview = new Set(groups.flatMap(g => g.vehicles.filter(v => v.severity !== "info").map(v => v.vehicleId))).size;

  return <section className="fleet-evidence fleet-fuel-report v771-fuel" aria-label={t("Fleet fuel and mileage", "เชื้อเพลิงและระยะทางกองรถ")} data-fleet-fuel-oversight>
    <div className="fleet-evidence-heading"><span>{t("EES FUEL LOGS · FORTH DAY CACHE · READ ONLY", "บันทึกเชื้อเพลิง EES · แคชวัน Forth · อ่านอย่างเดียว")}</span><h3>{t("Fleet fuel & mileage", "เชื้อเพลิงและระยะทางกองรถ")}</h3></div>
    <form onSubmit={event => { event.preventDefault(); void read(); }} className="v771-form">
      <div className="fleet-evidence-dates"><label>{t("From", "ตั้งแต่")}<input required type="date" value={from} max={to} onChange={event => { if (event.target.value) { setFrom(event.target.value); reset(); if (event.target.value <= to) onScopeChange?.({ from: event.target.value, to }); } }} /></label><label>{t("To", "ถึง")}<input required type="date" value={to} min={from} max={bangkokDateInput()} onChange={event => { if (event.target.value) { setTo(event.target.value); reset(); if (from <= event.target.value) onScopeChange?.({ from, to: event.target.value }); } }} /></label></div>
      <button className="btn-secondary" disabled={status === "loading"}>{status === "loading" ? t("Reading…", "กำลังอ่าน…") : t("Load fuel and coverage", "โหลดเชื้อเพลิงและความครอบคลุม")}</button>
      {status === "loading" ? <button type="button" className="btn-secondary" onClick={() => request.current?.abort()}>{t("Stop", "หยุด")}</button> : null}
    </form>
    <p className="v72-hint" data-fuel-method>{t("Up to 62 days. Reads Fuel Logs and the Forth days already held in your session (up to 30 minutes old). It never contacts Forth and never reads every vehicle.", "สูงสุด 62 วัน อ่านบันทึกเชื้อเพลิงและวัน Forth ที่มีในเซสชันของคุณแล้ว (เก่าไม่เกิน 30 นาที) ไม่ติดต่อ Forth และไม่อ่านรถทุกคัน")} <Link href="/fuel-logs">{t("Open Fuel Logs", "เปิดบันทึกเชื้อเพลิง")}</Link></p>
    <div role="status" aria-live="polite">
      {status === "loading" ? <p className="v72-hint">{t("Reading Fuel Logs and the day cache…", "กำลังอ่านบันทึกเชื้อเพลิงและแคชวัน…")}</p> : null}
      {status === "failed" ? <p role="alert">{t("Fleet fuel could not be loaded. Check the dates, access and connection, then retry.", "โหลดเชื้อเพลิงกองรถไม่ได้ โปรดตรวจสอบวันที่ สิทธิ์ และการเชื่อมต่อ แล้วลองใหม่")}</p> : null}
      {coverage && recurring.state !== "ready" ? <p className="v72-hint" data-recurring-state={recurring.state}>{recurring.state === "restricted" ? t("Recurring unknown stopping areas use historical journeys and need administrator authorisation, so they are not listed.", "พื้นที่จอดซ้ำที่ไม่ทราบใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ จึงไม่แสดง") : recurring.state === "too_long" ? t("Recurring stopping areas are checked for periods up to 31 days.", "ตรวจพื้นที่จอดซ้ำสำหรับช่วงไม่เกิน 31 วัน") : t("Recurring stopping areas could not be loaded.", "โหลดพื้นที่จอดซ้ำไม่ได้")}</p> : null}
      {coverageFailed ? <p role="alert">{t("Forth day coverage could not be loaded, so no reviewed-day or distance figures are shown. Fuel figures below are unaffected.", "โหลดความครอบคลุมวัน Forth ไม่ได้ จึงไม่แสดงวันที่ตรวจแล้วและระยะทาง ข้อมูลเชื้อเพลิงด้านล่างไม่ได้รับผลกระทบ")}</p> : null}
      {fuel && fuel.sourceStatus !== "available" ? <p role="alert">{fuel.sourceStatus === "truncated" ? t("More than 1,000 Fuel Log rows in this period. Narrow the dates; no totals are shown.", "บันทึกเกิน 1,000 รายการ โปรดลดช่วงวันที่ ไม่แสดงยอดรวม") : t("Fuel Logs are unavailable. No zero is inferred.", "บันทึกเชื้อเพลิงไม่พร้อม ไม่ถือว่าเป็นศูนย์")}</p> : null}
    </div>
    {!coverage && status === "idle" && !fuel ? <p className="v72-empty-line">{t("Choose a period and load it. Nothing is read until you press the button.", "เลือกช่วงเวลาแล้วกดโหลด จะไม่มีการอ่านจนกว่าจะกดปุ่ม")}</p> : null}

    {coverage ? <>
      <p className="fleet-evidence-period" data-period>{from} → {to} · {coverage.calendarDays} {t("calendar days (Bangkok)", "วันตามปฏิทิน (เวลาไทย)")}{includesToday ? ` · ${t("today is incomplete", "วันนี้ยังไม่สิ้นสุด")}` : ""}</p>
      <dl className="v72-strip v771-strip" data-fuel-summary>
        <div><dt>{t("Eligible vehicles", "รถที่นับ")}</dt><dd><b>{summary.eligibleVehicles}</b><small>{t(`${summary.excluded.inactive} inactive and ${summary.excluded.duplicate} shared-registration rows are listed apart, not merged`, `ไม่ใช้งาน ${summary.excluded.inactive} และทะเบียนซ้ำ ${summary.excluded.duplicate} แยกไว้ ไม่รวม`)}</small></dd></div>
        <div><dt>{t("Recorded fuel spend", "ค่าเชื้อเพลิงที่บันทึก")}</dt><dd><b>{fuelOk ? `฿${formatThb(fuel!.fleet!.costThb, language)}` : "—"}</b><small>{fuelOk ? t(`${fuel!.fleet!.matchedRecords} records, ${fuel!.fleet!.vehiclesWithPurchases} vehicles · purchases, not consumption`, `${fuel!.fleet!.matchedRecords} รายการ ${fuel!.fleet!.vehiclesWithPurchases} คัน · การซื้อ ไม่ใช่การใช้จริง`) : t("fuel not loaded", "ยังไม่ได้โหลดเชื้อเพลิง")}</small></dd></div>
        <div className="v771-wide"><dt>{t("Litres purchased by fuel type", "ลิตรที่ซื้อแยกตามชนิด")}</dt><dd><b>{fuelOk ? (fuel!.fleet!.byType.length ? "" : "—") : "—"}</b>{fuelOk ? fuel!.fleet!.byType.map(g => <span key={g.fuelType} className="v771-type"><b>{formatLitres(g.litres, language)}</b> {L} <small>{fuelTypeLabel(g.fuelType, language)} · {g.records}</small></span>) : null}<small>{t("Never added across types.", "ไม่รวมข้ามชนิด")}</small></dd></div>
        <div><dt>{t("Vehicles with fuel records", "รถที่มีบันทึกเชื้อเพลิง")}</dt><dd><b>{fuelOk ? `${summary.vehiclesWithFuel}/${summary.eligibleVehicles}` : "—"}</b><small>{fuelOk ? t(`${summary.vehiclesNoRecord} with no record found (not zero use) · ${summary.vehiclesNotAttributed} not attributed`, `ไม่พบบันทึก ${summary.vehiclesNoRecord} คัน (ไม่ใช่ไม่ได้ใช้) · ไม่ระบุให้รถ ${summary.vehiclesNotAttributed}`) : t("fuel evidence not loaded", "ยังไม่ได้โหลดข้อมูลเชื้อเพลิง")}</small></dd></div>
        <div className={summary.reviewedVehicleDays === 0 ? "" : ""}><dt>{t("Reviewed Forth days", "วัน Forth ที่ตรวจแล้ว")}</dt><dd><b>{summary.reviewedVehicleDays}/{summary.eligibleVehicleDays}</b><small>{t(`vehicle-days · ${summary.vehiclesWithReviewedForth} vehicles have at least one. The rest are not reviewed, not zero driving.`, `คัน-วัน · ${summary.vehiclesWithReviewedForth} คันมีอย่างน้อยหนึ่งวัน ที่เหลือยังไม่ได้ตรวจ ไม่ใช่ไม่ได้ขับ`)}</small></dd></div>
        <div><dt>{t("Provider km (reviewed days only)", "กม. ผู้ให้บริการ (เฉพาะวันที่ตรวจแล้ว)")}</dt><dd><b>{n(summary.providerKm)}</b><small>{summary.providerKm === null ? t("no reviewed day", "ไม่มีวันที่ตรวจแล้ว") : t(`partial: ${summary.providerKmVehicles} vehicles · not a fleet total`, `บางส่วน: ${summary.providerKmVehicles} คัน · ไม่ใช่ยอดรวมกองรถ`)}{summary.gpsKm !== null ? ` · ${t("GPS-derived", "จาก GPS")} ${n(summary.gpsKm)}` : ""}</small></dd></div>
        <div data-needs-review><dt>{t("Vehicles needing review", "รถที่ควรตรวจสอบ")}</dt><dd><b>{needReview}</b><small>{t("with at least one medium review candidate in the queue below · from recorded evidence, not a fault finding", "มีรายการที่ควรตรวจระดับกลางอย่างน้อยหนึ่งรายการในคิวด้านล่าง · จากหลักฐานที่บันทึก ไม่ใช่การชี้ว่าผิดปกติ")}</small></dd></div>
      </dl>
      {fuelOk ? <p className="v72-hint">{t(`Excluded from fuel totals: ${fuel!.fleet!.unmatchedRecords} records with no matching registry registration, ${fuel!.fleet!.ambiguousRegistrationRecords} with a shared registration. Read ${stamp(fuel!.capturedAt)}.`, `ไม่รวมในยอดเชื้อเพลิง: ทะเบียนจับคู่ไม่ได้ ${fuel!.fleet!.unmatchedRecords} รายการ ทะเบียนซ้ำ ${fuel!.fleet!.ambiguousRegistrationRecords} รายการ · อ่านเมื่อ ${stamp(fuel!.capturedAt)}`)}</p> : null}

      <h4 data-priority-queue>{t("Priority investigation queue", "คิวตรวจสอบตามลำดับความสำคัญ")}</h4>
      <p className="v72-hint">{t("Review candidates from recorded evidence only, grouped by issue. Open one to see the vehicle, the date, the evidence, what is unknown and the suggested office action. None of them is a finding of fault or misuse.", "รายการที่ควรตรวจจากหลักฐานที่บันทึกไว้เท่านั้น จัดกลุ่มตามประเด็น เปิดแต่ละรายการเพื่อดูรถ วันที่ หลักฐาน สิ่งที่ยังไม่ทราบ และสิ่งที่สำนักงานควรทำ ไม่ใช่การระบุว่ามีความผิดหรือใช้งานผิดปกติ")}</p>
      {groups.length === 0 ? <p className="v72-empty-line" data-fuel-issues>{fuelOk ? t("No issues in the evidence loaded. This does not cover vehicles or days that were not read.", "ไม่พบปัญหาในหลักฐานที่โหลด ไม่ครอบคลุมรถหรือวันที่ไม่ได้อ่าน") : t("Load fuel to list fuel issues.", "โหลดเชื้อเพลิงเพื่อดูปัญหา")}</p> : <div data-fuel-issues>{groups.map((g, i) => { const c = OVERSIGHT_ISSUE_COPY[g.key]; return <details key={g.key} className={`v77-issue is-${g.severity}`} open={i < 2 && g.severity !== "info"} data-issue={g.key}>
        <summary><span className={`fleet-review-badge is-priority-${g.severity}`}>{g.severity === "medium" ? t("Medium", "กลาง") : g.severity === "high" ? t("High", "สูง") : t("Info", "ข้อมูล")}</span> <span className={`v782-class is-${ISSUE_CLASS[g.key]}`} data-issue-class={ISSUE_CLASS[g.key]}>{CLASS_COPY[ISSUE_CLASS[g.key]][lang]}</span> <b>{c.title[lang]}</b> · {g.vehicles.length} {t(g.vehicles.length === 1 ? "vehicle" : "vehicles", "คัน")}</summary>
        <p className="v72-hint">{c.reason[lang]}</p>
        <div className="v72-table-wrap"><table className="v72-table v781-issue-table"><thead><tr><th scope="col">{t("Vehicle", "รถ")}</th><th scope="col">{t("Severity", "ระดับ")}</th><th scope="col">{t("Date(s)", "วันที่")}</th><th scope="col">{t("Evidence", "หลักฐาน")}</th><th scope="col"><span className="sr-only">{t("Open", "เปิด")}</span></th></tr></thead>
          <tbody>{g.vehicles.slice(0, 12).map(v => <tr key={v.vehicleId} data-vehicle={v.registration}><th scope="row">{v.registration}</th><td><span className={`fleet-review-badge is-priority-${v.severity}`}>{sevText(v.severity)}</span></td><td>{v.days.length ? v.days.slice(0, 4).join(", ") + (v.days.length > 4 ? ` +${v.days.length - 4}` : "") : (from === to ? from : `${from} → ${to}`)}{v.related.length ? <span className="v783-related" data-related-issues>{t("Same day also flagged", "วันเดียวกันมีรายการอื่นด้วย")}: {v.related.map(r => `${OVERSIGHT_ISSUE_COPY[r.key].title[lang]} (${r.days.join(", ")})`).join(" · ")}</span> : null}</td><td>{Object.entries(v.evidence).map(([k, x]) => `${evLabel(k)}: ${x}`).join(" · ") || "—"}</td>
            <td className="v771-actions">{g.key === "distance_sources_disagree" ? <button type="button" className="fleet-link-button" data-explain-queue onClick={() => { setSelectedId(v.vehicleId); setReconRequested(true); }}>{t("Explain the difference", "อธิบายความต่าง")}</button> : null}<button type="button" className="fleet-link-button" onClick={() => { setReconRequested(false); setSelectedId(v.vehicleId); }}>{t("Investigate vehicle", "ตรวจสอบรถ")}</button><button type="button" className="fleet-link-button" onClick={() => open({ registration: v.registration }, "fuel")}>{t("Open Fuel Intelligence", "เปิดข้อมูลเชื้อเพลิง")}</button>{v.day ? <button type="button" className="fleet-link-button" onClick={() => open({ registration: v.registration, day: v.day }, "daily")}>{t("Open Daily Activity", "เปิดกิจกรรมประจำวัน")} {v.day}</button> : null}</td></tr>)}</tbody></table></div>
        {g.vehicles.length > 12 ? <p className="v72-hint">+{g.vehicles.length - 12} {t("more in the comparison table", "คันในตารางเปรียบเทียบ")}</p> : null}
        <p className="v72-hint"><b>{t("Source", "แหล่ง")}:</b> {c.source[lang]} · <b>{t("Suggested action", "สิ่งที่ควรทำ")}:</b> {c.action[lang]}</p>
      </details>; })}</div>}
      {selectedRow ? <FleetVehicleInvestigation key={`${selectedRow.vehicleId}:${from}:${to}`} language={language} row={selectedRow} from={from} to={to} initialRecon={reconRequested} onClose={() => { setSelectedId(null); setReconRequested(false); }} onOpen={(target, day) => open({ registration: selectedRow.registration, day }, target)} /> : null}

      <h4>{t("Vehicle comparison", "เปรียบเทียบรายคัน")}</h4>
      <div className="v771-controls">
        <label>{t("Search registration", "ค้นหาทะเบียน")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="68-7154" /></label>
        <label>{t("Show", "แสดง")}<select value={show} onChange={event => setShow(event.target.value as ShowFilter)}>
          <option value="all">{t("All eligible vehicles", "รถที่นับทั้งหมด")}</option><option value="with_fuel">{t("With fuel records", "มีบันทึกเชื้อเพลิง")}</option><option value="without_fuel">{t("No fuel record found", "ไม่พบบันทึกเชื้อเพลิง")}</option><option value="issues">{t("With review issues", "มีรายการต้องตรวจ")}</option><option value="unreviewed">{t("No Forth day reviewed", "ยังไม่ได้ตรวจวัน Forth")}</option><option value="excluded">{t("Inactive / shared registration", "ไม่ใช้งาน / ทะเบียนซ้ำ")}</option></select></label>
        <label>{t("Sort", "เรียงตาม")}<select value={sort} onChange={event => setSort(event.target.value as SortKey)}>{(Object.keys(SORT_COPY) as SortKey[]).map(k => <option key={k} value={k}>{SORT_COPY[k][lang]}</option>)}</select></label>
      </div>
      <p className="fleet-evidence-note" role="status">{t(`Showing ${visible.length} of ${rows.length} registry vehicles. Highest spend is not poor efficiency: no consumption is calculated.`, `แสดง ${visible.length} จาก ${rows.length} คันในทะเบียน ค่าใช้จ่ายสูงไม่ได้หมายความว่าใช้เชื้อเพลิงไม่คุ้ม เพราะไม่คำนวณการใช้จริง`)}</p>
      {visible.length === 0 ? <p>{t("No vehicles match this filter.", "ไม่มีรถที่ตรงกับตัวกรองนี้")}</p> : <div className="v72-table-wrap v771-wrap"><table className="v72-table v771-table" data-fuel-vehicle-table>
        <thead><tr><th scope="col">{t("Vehicle", "รถ")}</th><th scope="col" className="v771-c-type">{t("Type", "ประเภท")}</th><th scope="col">{t("Fuel purchases", "การซื้อเชื้อเพลิง")}</th><th scope="col" className="v771-c-days">{t("Forth days reviewed", "วัน Forth ที่ตรวจ")}</th><th scope="col" className="num v771-c-km">{t("Provider km", "กม. ผู้ให้บริการ")}</th><th scope="col">{t("Issues", "ปัญหา")}</th><th scope="col"><span className="sr-only">{t("Open", "เปิด")}</span></th></tr></thead>
        <tbody>{visible.map(r => <tr key={r.vehicleId} data-vehicle={r.registration} data-fuel-state={r.fuelState} className={selectedId === r.vehicleId ? "is-active" : ""}>
          <th scope="row"><label className="v782-check"><input type="checkbox" checked={checked.includes(r.vehicleId)} disabled={running || !r.eligible || (!checked.includes(r.vehicleId) && checked.length >= MAX_CHECKED_VEHICLES)} onChange={event => setChecked(c => (event.target.checked ? [...c, r.vehicleId].slice(0, MAX_CHECKED_VEHICLES) : c.filter(x => x !== r.vehicleId)))} aria-label={t(`Include ${r.registration} in the review`, `รวม ${r.registration} ในการตรวจ`)} /></label><b>{r.registration}</b>{r.registryStatus === "inactive" ? <small>{t("inactive registry row", "ทะเบียนไม่ใช้งาน")}</small> : r.registryStatus === "duplicate" ? <small>{t("shared registration", "ทะเบียนซ้ำ")}</small> : null}
            <small className="v771-more">{r.vehicleType ? `${typeName(r.vehicleType)} · ` : ""}{r.reviewedDays}/{r.calendarDays} {t("days", "วัน")} · {n(r.providerKm)} {t("km", "กม.")}</small></th>
          <td className="v771-c-type">{typeName(r.vehicleType)}</td>
          <td>{r.fuelState === "recorded" ? <><b>฿{formatThb(r.costThb, language)}</b><small>{typeText(r.byType)} · {r.records} {t("refuels", "ครั้ง")}</small></> : <span className="v72-muted">{FUEL_STATE_COPY[r.fuelState][lang]}</span>}</td>
          <td className="v771-c-days">{r.reviewedDays}/{r.calendarDays}<small>{r.reviewedDays > 0 ? t(`${r.verifiedDays} verified · ${r.partlyVerifiedDays} partly · ${r.unverifiedDays} unverified`, `ยืนยัน ${r.verifiedDays} · บางส่วน ${r.partlyVerifiedDays} · ไม่ยืนยัน ${r.unverifiedDays}`) : t("not reviewed", "ยังไม่ได้ตรวจ")}</small></td>
          <td className="num v771-c-km">{n(r.providerKm)}</td>
          <td>{r.issues.length ? <span className={r.issues.some(i => i.severity === "medium" || i.severity === "high") ? "v771-badge is-medium" : "v771-badge"}>{r.issues.length}</span> : <span className="v72-muted">—</span>}</td>
          <td className="v771-actions"><button type="button" className="fleet-link-button" aria-pressed={selectedId === r.vehicleId} onClick={() => { setReconRequested(false); setSelectedId(c => (c === r.vehicleId ? null : r.vehicleId)); }} aria-label={t(`Investigate ${r.registration}`, `ตรวจสอบ ${r.registration}`)}>{t("Investigate", "ตรวจสอบ")}</button><button type="button" className="fleet-link-button" onClick={() => open(r, "fuel")} aria-label={t(`Open fuel for ${r.registration}`, `เปิดเชื้อเพลิงของ ${r.registration}`)}>{t("Fuel", "เชื้อเพลิง")}</button></td></tr>)}</tbody>
      </table></div>}

      <section className="v782-review" data-coverage-review aria-label={t("Historical coverage review", "ตรวจความครอบคลุมข้อมูลย้อนหลัง")}>
        <h4>{t("Historical coverage review", "ตรวจความครอบคลุมข้อมูลย้อนหลัง")}</h4>
        <dl className="v72-strip v782-strip">
          <div><dt>{reviewText("reviewedDay", language)}</dt><dd><b data-coverage-ratio>{numbers.reviewed}/{numbers.eligibleVehicleDays}</b><small>{numbers.percent === null ? "—" : `${numbers.percent}%`} · {t(`${numbers.eligibleVehicles} eligible vehicles × ${reviewDays.length} reviewable days. Only days actually held in your cache count.`, `รถที่นับ ${numbers.eligibleVehicles} คัน × ${reviewDays.length} วันที่ตรวจได้ นับเฉพาะวันที่มีในแคชของคุณ`)}</small></dd></div>
          <div><dt>{reviewText("missingDay", language)}</dt><dd><b>{numbers.missing}</b><small>{t("not reviewed: unknown, not zero driving", "ยังไม่ได้ตรวจ: ไม่ทราบ ไม่ใช่ไม่ได้ขับ")}</small></dd></div>
          <div><dt>{t("Evidence available", "หลักฐานที่มี")}</dt><dd><small data-evidence-states>
            {t("EES fuel records", "บันทึกเชื้อเพลิง EES")}: <b>{fuelOk ? t("loaded", "โหลดแล้ว") : t("not loaded", "ยังไม่โหลด")}</b><br />
            {t("Forth reports cached", "รายงาน Forth ในแคช")}: <b>{coverage.vehicles.reduce((n, v) => n + v.reviewedDays, 0)}</b><br />
            {t("GPS positions cached", "ตำแหน่ง GPS ในแคช")}: <b>{coverage.vehicles.reduce((n, v) => n + v.verifiedDays + v.partlyVerifiedDays + v.unverifiedDays, 0)}</b> {t("days", "วัน")}<br />
            {t("Visit analysis can be built for", "สร้างการวิเคราะห์การเข้าเยี่ยมได้")}: <b>{coverage.vehicles.reduce((n, v) => n + v.verifiedDays + v.partlyVerifiedDays + v.unverifiedDays, 0)}</b> {t("days (from cached positions)", "วัน (จากตำแหน่งในแคช)")}<br />
            {reviewText("cacheExpired", language)}: <b>{expired.length}</b> {t("days since you opened this", "วัน ตั้งแต่เปิดหน้านี้")}</small></dd></div>
        </dl>
        {expired.length ? <p role="status" className="v72-hint" data-cache-expired>{t(`${expired.length} reviewed vehicle-day(s) left your 30-minute cache and are no longer counted or shown. They are not fetched again automatically; read them again if you need them.`, `วันที่ตรวจแล้ว ${expired.length} คัน-วันหมดอายุจากแคช 30 นาที จึงไม่นับและไม่แสดง ไม่มีการดึงซ้ำอัตโนมัติ อ่านใหม่หากต้องการ`)}</p> : null}
        <fieldset className="v782-scope" disabled={running}><legend>{t("What to read", "จะอ่านอะไร")}</legend>
          <label><input type="radio" name="v782-scope" checked={scope === "selected"} onChange={() => setScope("selected")} /> {t("Selected vehicle", "รถที่เลือก")}{selectedRow ? ` · ${selectedRow.registration}` : ` · ${t("choose one with Investigate", "เลือกด้วย ตรวจสอบ")}`}</label>
          <label><input type="radio" name="v782-scope" checked={scope === "checked"} onChange={() => setScope("checked")} /> {t(`Checked vehicles (max ${MAX_CHECKED_VEHICLES})`, `รถที่ติ๊ก (สูงสุด ${MAX_CHECKED_VEHICLES})`)} · {checked.length}</label>
          <label><input type="radio" name="v782-scope" checked={scope === "batch"} onChange={() => setScope("batch")} /> {t(`Bounded batch of recent missing days (max ${PERIOD_READ_CAP})`, `ชุดวันล่าสุดที่ยังไม่มี (สูงสุด ${PERIOD_READ_CAP})`)}</label>
        </fieldset>
        <p className="v72-hint" data-read-plan>{plan.keys.length === 0 ? t("Nothing to read for this choice: every reviewable day is already reviewed, or no vehicle is chosen.", "ไม่มีอะไรต้องอ่านสำหรับตัวเลือกนี้: วันที่ตรวจได้ตรวจครบแล้ว หรือยังไม่ได้เลือกรถ") : t(`This run requests ${plan.keys.length} of ${plan.totalMissing} missing vehicle-days (${plan.vehicles} vehicle(s)), one at a time, read-only, newest first. It stops at the first rate-limit or access error. Today is excluded because its data is incomplete.`, `การอ่านครั้งนี้ขอ ${plan.keys.length} จาก ${plan.totalMissing} คัน-วันที่ยังไม่มี (${plan.vehicles} คัน) ทีละรายการ แบบอ่านอย่างเดียว เรียงจากใหม่ไปเก่า และหยุดเมื่อถึงขีดจำกัดหรือไม่มีสิทธิ์ ไม่รวมวันนี้เพราะข้อมูลยังไม่ครบ`)}{plan.capped ? ` ${t(`The remaining ${plan.totalMissing - plan.keys.length} stay missing; this is the safe limit.`, `ที่เหลือ ${plan.totalMissing - plan.keys.length} ยังไม่มี นี่คือขีดจำกัดที่ปลอดภัย`)}` : ""}</p>
        <div className="v782-actions">
          <button type="button" className="btn-primary min-h-11" disabled={running || plan.keys.length === 0} onClick={() => void startReview()} data-start-review>{running ? t("Reading…", "กำลังอ่าน…") : t(`Read ${plan.keys.length} vehicle-day(s) from Forth`, `อ่าน ${plan.keys.length} คัน-วันจาก Forth`)}</button>
          {running ? <button type="button" className="btn-secondary min-h-11" onClick={stopReview} data-stop-review>{t("Stop after the current request", "หยุดหลังคำขอปัจจุบัน")}</button> : null}
        </div>
        {runKeys.length ? <div role="status" aria-live="polite" className="v782-progress" data-review-progress>
          <progress max={counts.total} value={counts.done + counts.failed + counts.noDevice + counts.rateLimited + counts.unavailable + counts.cancelled} aria-label={t("Read progress", "ความคืบหน้าการอ่าน")} />
          <p>{reviewText("done", language)} {counts.done} · {reviewText("reading", language)} {counts.reading} · {reviewText("queued", language)} {counts.queued} · {reviewText("failed", language)} {counts.failed + counts.noDevice + counts.unavailable} · {reviewText("cancelled", language)} {counts.cancelled} · {reviewText("rateLimited", language)} {counts.rateLimited}</p>
          {counts.rateLimited ? <p role="alert">{t("Forth read limit reached. Reading stopped safely; the rest were not requested. Wait a minute before starting again.", "ถึงขีดจำกัดการอ่านของ Forth หยุดอย่างปลอดภัย ที่เหลือยังไม่ได้ขอ รอสักครู่ก่อนเริ่มใหม่")}</p> : null}
          {counts.unavailable ? <p role="alert">{t("Forth is unavailable or not authorised right now. Reading stopped safely.", "Forth ไม่พร้อมหรือไม่มีสิทธิ์ในขณะนี้ หยุดอย่างปลอดภัย")}</p> : null}
          {cancelledNote ? <p>{t("Stopped. Days already read are kept and counted. A request already sent to Forth cannot be undone.", "หยุดแล้ว วันที่อ่านเสร็จแล้วยังคงอยู่และนับรวม คำขอที่ส่งไปยัง Forth แล้วย้อนกลับไม่ได้")}</p> : null}
          {!running && counts.done > 0 ? <p>{t("Coverage, the vehicle table and the exceptions above were refreshed from your cache. Read days appear as reviewed only if they are held and validated.", "ความครอบคลุม ตารางรถ และรายการผิดปกติถูกรีเฟรชจากแคชของคุณ วันที่อ่านแล้วนับเป็นตรวจแล้วเมื่อมีในแคชและผ่านการตรวจเท่านั้น")}</p> : null}
        </div> : null}
      </section>


      <details className="v72-evidence" data-fuel-methodology><summary>{t("How to read this section", "วิธีอ่านส่วนนี้")}</summary>
        <ul className="v72-plain-list">
          <li>{t("Spend and litres are purchases recorded in Fuel Logs. They are not fuel consumed, and no km/L or cost per km is calculated.", "ค่าใช้จ่ายและลิตรเป็นการซื้อที่บันทึกในบันทึกเชื้อเพลิง ไม่ใช่เชื้อเพลิงที่ใช้จริง และไม่คำนวณ กม./ลิตร หรือต้นทุนต่อ กม.")}</li>
          <li>{t("Reviewed Forth days are only the days already read in your session in the last 30 minutes. Other days are not reviewed, which says nothing about driving.", "วัน Forth ที่ตรวจแล้วคือวันที่อ่านในเซสชันของคุณภายใน 30 นาทีเท่านั้น วันอื่นยังไม่ได้ตรวจ ซึ่งไม่ได้บอกว่ารถไม่ได้ขับ")}</li>
          <li>{t("Provider km adds reconciled reviewed days only. It is a partial sum and never a fleet total. GPS-derived km is a separate measure.", "กม. ผู้ให้บริการรวมเฉพาะวันที่ตรวจและกระทบยอดแล้ว เป็นผลรวมบางส่วนและไม่ใช่ยอดรวมกองรถ กม. จาก GPS เป็นคนละวิธีวัด")}</li>
          <li>{t("Odometer-versus-Forth comparisons need exact date spans. They are shown per vehicle in the investigation panel and in Fuel Intelligence, and are never compared across different dates.", "การเทียบเลขไมล์กับ Forth ต้องใช้ช่วงวันที่ตรงกัน แสดงรายคันในแผงตรวจสอบและในข้อมูลเชื้อเพลิง และไม่เทียบข้ามช่วงวันที่ต่างกัน")}</li>
          <li>{t("Exceptions are review items from recorded evidence only: GPS verification, tracking gaps of 60+ minutes, Forth-vs-GPS distance differences (5 km and 10%), fuel data quality and recurring unnamed stopping areas. Nothing detects speeding, driver conduct or completed jobs.", "ข้อยกเว้นเป็นรายการให้ตรวจจากหลักฐานที่บันทึกเท่านั้น: การยืนยัน GPS ช่วงขาด 60 นาทีขึ้นไป ความต่างของระยะทาง Forth กับ GPS (5 กม. และ 10%) คุณภาพข้อมูลเชื้อเพลิง และพื้นที่จอดซ้ำที่ไม่มีชื่อ ไม่ตรวจจับการขับเร็ว พฤติกรรมคนขับ หรืองานที่เสร็จ")}</li>
          <li>{t("LPG is its own fuel type. Registry rows are never merged: a shared registration is listed apart and its purchases are not attributed.", "LPG เป็นชนิดเชื้อเพลิงของตัวเอง ไม่รวมแถวในทะเบียน ทะเบียนซ้ำแยกไว้และไม่ระบุการซื้อให้รถ")}</li>
        </ul>
      </details>
    </> : null}
  </section>;
}
