"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Search,
  Truck,
  UsersRound,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import { getAccessToken } from "@/lib/account-management";
import { useAccountAccess } from "@/lib/use-account-access";
import { useLanguage } from "@/lib/language-provider";
import {
  jobStatus,
  statusCopy,
  driverCompletedOn,
  driverDurationMinutes,
  hasOperationalAttention,
  type OperationStatus,
  type OperationsResult,
  type OperationsRow
} from "@/lib/driver-operations";
import { DriverOperationsDirectory } from "@/components/admin/driver-operations-directory";
import { getPortalVehicleTypeLabel } from "@/lib/driver-vehicle-types";
import { DriverOperationsHistory } from "@/components/admin/driver-operations-history";
import { useModalScrollLock } from "@/lib/use-modal-scroll-lock";

type MainView = "operations" | "history" | "drivers";
type JobView = "all" | "active" | "attention" | "completed";

const copy = {
  en: {
    eyebrow: "LIVE OPERATIONS",
    title: "Driver Operations",
    intro: "Today's fleet activity and driver progress",
    operations: "Operations",
    drivers: "Drivers",
    driverAccounts: "Driver Accounts",
    refresh: "Refresh",
    refreshing: "Refreshing",
    auto: "Auto-refresh every 60 seconds",
    updated: "Updated",
    loading: "Loading driver operations…",
    error: "Unable to load Driver Operations. Previous successful data is retained; please retry.",
    denied: "Administrator access required",

    driversToday: "Drivers today",
    jobsToday: "Jobs today",
    activeJobs: "Active now",
    allJobs: "All activity",
    attention: "Attention",
    completed: "Completed today",

    active: "Active",
    completedTab: "Completed today",
    attentionTab: "Attention",

    search: "Search today's operations",
    searchPlaceholder: "Driver, customer, vehicle, location or job reference",

    assignedWork: "Current operations",
    activeHelp: "Started jobs that have not completed",
    allHelp: "Today's assignments, current work and completions",
    noMatch: "No jobs match this search.",
    attentionHelp: "Jobs that may need office attention",
    completedHelp: "Jobs completed today",

    emptyActive: "No active jobs right now.",
    emptyAttention: "Nothing needs attention.",
    emptyCompleted: "No jobs completed today.",

    driver: "Driver",
    job: "Job",
    route: "Route",
    pickup: "Pickup",
    status: "Status",
    lastUpdate: "Last update",
    vehicle: "Vehicle",
    details: "View details",

    overdue: "Pickup time passed with no arrival recorded",
    inactive: "Driver or portal account inactive",
    unlinked: "No linked driver portal account",

    noEvents: "No progress events yet",
    noLocation: "No location captured",
    locationCaptured: "Location captured",
    viewLocation: "View location",

    timeline: "Progress timeline",
    driverDetails: "Driver details",
    currentStatus: "Current status",
    close: "Close",

    email: "Email",
    phone: "Phone",
    lastLogin: "Last login",
    driverId: "Driver ID",

    live: "LIVE",

    steps: {
      pickup_arrived: "Arrived at pickup",
      pickup_departed: "Left pickup",
      delivery_arrived: "Arrived at delivery",
      job_completed: "Completed"
    }
  },

  th: {
    eyebrow: "การปฏิบัติงานสด",
    title: "ปฏิบัติการคนขับ",
    intro: "กิจกรรมรถและความคืบหน้าของคนขับวันนี้",
    operations: "ปฏิบัติการ",
    drivers: "คนขับ",
    driverAccounts: "บัญชีคนขับ",
    refresh: "รีเฟรช",
    refreshing: "กำลังรีเฟรช",
    auto: "รีเฟรชอัตโนมัติทุก 60 วินาที",
    updated: "อัปเดต",
    loading: "กำลังโหลดข้อมูลปฏิบัติการ…",
    error: "ไม่สามารถรีเฟรชได้ ข้อมูลที่แสดงอาจไม่ล่าสุด",
    denied: "เฉพาะผู้ดูแลระบบ",

    driversToday: "คนขับวันนี้",
    jobsToday: "งานวันนี้",
    activeJobs: "กำลังดำเนินการขณะนี้",
    allJobs: "กิจกรรมทั้งหมด",
    attention: "ต้องตรวจสอบ",
    completed: "เสร็จวันนี้",

    active: "กำลังดำเนินการ",
    completedTab: "เสร็จวันนี้",
    attentionTab: "ต้องตรวจสอบ",

    search: "ค้นหางานวันนี้",
    searchPlaceholder: "คนขับ ลูกค้า รถ หรือสถานที่",

    assignedWork: "ปฏิบัติการวันนี้",
    activeHelp: "งานที่เริ่มแล้วและยังไม่เสร็จ",
    allHelp: "งานที่มอบหมายวันนี้ งานปัจจุบัน และงานที่เสร็จ",
    noMatch: "ไม่พบงานที่ตรงกับคำค้นหา",
    attentionHelp: "งานที่สำนักงานอาจต้องตรวจสอบ",
    completedHelp: "งานที่เสร็จสิ้นวันนี้",

    emptyActive: "ตอนนี้ไม่มีงานที่กำลังดำเนินการ",
    emptyAttention: "ไม่มีงานที่ต้องตรวจสอบ",
    emptyCompleted: "ยังไม่มีงานที่เสร็จสิ้น",

    driver: "คนขับ",
    job: "งาน",
    route: "เส้นทาง",
    pickup: "รับสินค้า",
    status: "สถานะ",
    lastUpdate: "อัปเดตล่าสุด",
    vehicle: "รถ",
    details: "ดูรายละเอียด",

    overdue: "เลยเวลารับสินค้าแต่ยังไม่บันทึกการมาถึง",
    inactive: "คนขับหรือบัญชีพอร์ทัลไม่ใช้งาน",
    unlinked: "ยังไม่มีบัญชีพอร์ทัลที่เชื่อมไว้",

    noEvents: "ยังไม่มีการบันทึกความคืบหน้า",
    noLocation: "ไม่มีข้อมูลตำแหน่ง",
    locationCaptured: "บันทึกตำแหน่งแล้ว",
    viewLocation: "ดูตำแหน่ง",

    timeline: "ลำดับความคืบหน้า",
    driverDetails: "ข้อมูลคนขับ",
    currentStatus: "สถานะปัจจุบัน",
    close: "ปิด",

    email: "อีเมล",
    phone: "โทรศัพท์",
    lastLogin: "เข้าสู่ระบบล่าสุด",
    driverId: "รหัสคนขับ",

    live: "สด",

    steps: {
      pickup_arrived: "ถึงจุดรับ",
      pickup_departed: "ออกจากจุดรับ",
      delivery_arrived: "ถึงจุดส่ง",
      job_completed: "จบงาน"
    }
  }
} as const;

function statusStyle(status: OperationStatus) {
  switch (status) {
    case "pickup":
      return {
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        dot: "bg-amber-500"
      };

    case "en_route":
      return {
        badge: "border-blue-200 bg-blue-50 text-blue-700",
        dot: "bg-blue-500"
      };

    case "delivery":
      return {
        badge: "border-violet-200 bg-violet-50 text-violet-700",
        dot: "bg-violet-500"
      };

    case "completed":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        dot: "bg-emerald-500"
      };

    default:
      return {
        badge: "border-slate-200 bg-slate-50 text-slate-700",
        dot: "bg-slate-400"
      };
  }
}

function driverInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "?").toUpperCase();
}

export function DriverOperationsPage() {
  const { can } = useAccountAccess();
  const allowed = can("admin:user_management");

  const { language } = useLanguage();
  const l = copy[language];

  const [data, setData] = useState<OperationsResult | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [mainView, setMainView] = useState<MainView>("operations");
  const [jobView, setJobView] = useState<JobView>("all");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [historySelection, setHistorySelection] = useState<OperationsRow | null>(null);

  const inFlight = useRef(false);
  const openedLink = useRef(false);

  const load = useCallback(async () => {
    if (!allowed || inFlight.current) return;

    inFlight.current = true;
    setBusy(true);

    try {
      const token = await getAccessToken();

      const response = await fetch(`/api/admin/driver-operations?_=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token}`, "Cache-Control": "no-cache"
        },
        cache: "no-store"
      });

      if (!response.ok) throw new Error();

      const payload = await response.json() as OperationsResult;
      if (!Array.isArray(payload.rows) || !payload.summary || ![payload.summary.driversToday, payload.summary.jobsToday, payload.summary.activeNow, payload.summary.attention, payload.summary.completedToday].every(value => Number.isInteger(value) && value >= 0) || !payload.driverActivity) throw new Error("Invalid operations response");
      setData(payload);
      if (!openedLink.current) {
        openedLink.current = true;
        const jobId = new URLSearchParams(window.location.search).get("job");
        if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) {
          const detail = await fetch(`/api/admin/driver-operations/jobs/${jobId}?_=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          if (!detail.ok) throw new Error();
          setHistorySelection(await detail.json());
        }
      }
      setError(false);
    } catch (failure) {
      console.error("Driver Operations refresh failed", failure);
      setError(true);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [allowed]);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 60000);

    return () => window.clearInterval(timer);
  }, [load]);

  const formatDateTime = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok"
      }).format(new Date(value)),
    [language]
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const hasAttention = useCallback((row: OperationsRow) => data ? hasOperationalAttention(row, data.fetchedAt) : false, [data]);

  const activeRows = useMemo(
    () => rows.filter((row) => !["ready", "completed"].includes(jobStatus(row.events))),
    [rows]
  );

  const completedRows = useMemo(
    () => rows.filter((row) => data ? driverCompletedOn(row.events, data.date) : false),
    [rows, data]
  );

  const attentionRows = useMemo(
    () => rows.filter((row) => hasAttention(row)),
    [rows, hasAttention]
  );

  const selectedRow =
    historySelection ?? rows.find((row) => row.job.id === selectedJobId) ?? null;

  const baseRows =
    jobView === "all" ? rows : jobView === "completed"
      ? completedRows
      : jobView === "attention"
        ? attentionRows
        : activeRows;

  const searchTerm = search.trim().toLowerCase();

  const visibleRows = baseRows.filter((row) => {
    if (!searchTerm) return true;

    return [
      row.driverName,
      row.driverId,
      row.job.clientName,
      row.job.vehicleRegistration,
      row.job.pickupName,
      row.job.dropoffName,
      row.job.jobOrderNumber
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(searchTerm));
  });

  if (!allowed) {
    return (
      <div className="p-6 text-sm font-semibold text-rose-700">
        {l.denied}
      </div>
    );
  }

  return (
    <main className="driver-operations mx-auto w-full max-w-[1580px] px-3 pb-6 pt-3 sm:px-5 sm:py-5 lg:px-6">
      {/* PAGE HEADER */}
      <section className="operations-header overflow-hidden rounded-2xl border border-[#e6ddd0] bg-[linear-gradient(135deg,#fffdf9_0%,#fbf7f1_62%,#f4eef9_100%)] shadow-[0_14px_34px_rgba(74,43,86,0.07)] sm:rounded-[1.35rem]">
        <div className="px-4 py-3.5 sm:px-5 sm:py-4 lg:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {l.live}
                </span>

                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-700">
                  {l.eyebrow}
                </span>
              </div>

              <h1 className="mt-1.5 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-[1.9rem]">
                {l.title}
              </h1>

              <p className="mt-1 hidden text-sm text-slate-500 sm:block">
                {l.intro}
                {data?.date ? ` · ${data.date}` : ""}
              </p>

              <p className="mt-1 text-xs text-slate-500 sm:hidden">{data?.date || "—"}{data ? ` · ${l.updated} ${new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(data.fetchedAt))}` : ""}</p>
              <div className="mt-3 hidden flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 sm:flex">
                <span>{l.auto}</span>

                {data ? (
                  <span>
                    {l.updated}: {formatDateTime(data.fetchedAt)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/admin/users" className="btn-secondary">
                <UsersRound className="h-4 w-4" />
                {l.driverAccounts}
              </Link>

              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void load()}
              >
                <RefreshCw
                  className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
                />

                {busy ? l.refreshing : l.refresh}
              </button>
            </div>
          </div>

          {/* PRIMARY VIEW TABS */}
          <div className="mt-3 grid w-full grid-cols-3 rounded-xl border border-[#e8dfd4] bg-[#f5efe7] p-1 sm:inline-grid sm:w-auto">
            <button
              type="button"
              onClick={() => setMainView("operations")}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                mainView === "operations"
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <Activity className="mr-2 inline h-4 w-4" />
              {l.operations}
            </button>

            <button type="button" onClick={() => setMainView("history")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${mainView === "history" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}><Clock3 className="mr-2 inline h-4 w-4" />{language === "th" ? "ประวัติ" : "History"}</button>

            <button
              type="button"
              onClick={() => setMainView("drivers")}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                mainView === "drivers"
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <UsersRound className="mr-2 inline h-4 w-4" />
              {l.drivers}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          {l.error}
          <button type="button" className="ml-auto font-bold underline" onClick={() => void load()}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</button>
        </div>
      ) : null}

      {!data && !error ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {l.loading}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5" aria-busy="true">{[1,2,3,4,5].map(value => <div key={value} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>
        </div>
      ) : null}

      {data && mainView === "operations" ? (
        <>
          {/* KPIs */}
          <section className="operations-metrics mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
            <Metric
              label={l.driversToday}
              value={data.summary.driversToday}
              icon={<UsersRound className="h-4 w-4" />}
            />

            <Metric
              label={l.jobsToday}
              value={data.summary.jobsToday}
              icon={<Route className="h-4 w-4" />}
            />

            <Metric
              label={l.activeJobs}
              value={data.summary.activeNow}
              icon={<Navigation className="h-4 w-4" />}
              tone="blue"
            />

            <Metric
              label={l.attention}
              value={data.summary.attention}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone="amber"
            />

            <Metric
              label={l.completed}
              value={data.summary.completedToday}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="green"
            />
          </section>

          {/* OPERATIONS BOARD */}
          <section className="operations-board mt-3 overflow-hidden rounded-2xl border border-[#e6ddd0] bg-[#fffdf9] shadow-[0_14px_34px_rgba(74,43,86,0.06)] sm:rounded-[1.35rem]">
            <div className="border-b border-[#ece3d8] bg-[linear-gradient(180deg,#fffdf9_0%,#fbf7f1_100%)] px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-700">
                    {l.assignedWork}
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    {jobView === "all" ? l.allHelp : jobView === "active"
                      ? l.activeHelp
                      : jobView === "attention"
                        ? l.attentionHelp
                        : l.completedHelp}
                  </p>
                </div>

                <div className="relative w-full xl:w-[380px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="form-input border-[#ded4c8] bg-white pl-9 shadow-sm focus:border-brand-300"
                    placeholder={l.searchPlaceholder}
                    aria-label={l.search}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <FilterButton active={jobView === "all"} onClick={() => setJobView("all")} label={l.allJobs} count={rows.length} />
                <FilterButton
                  active={jobView === "active"}
                  onClick={() => setJobView("active")}
                  label={l.active}
                  count={activeRows.length}
                />

                <FilterButton
                  active={jobView === "attention"}
                  onClick={() => setJobView("attention")}
                  label={l.attentionTab}
                  count={attentionRows.length}
                  attention
                />

                <FilterButton
                  active={jobView === "completed"}
                  onClick={() => setJobView("completed")}
                  label={l.completedTab}
                  count={completedRows.length}
                  completed
                />
              </div>
            </div>

            {/* DESKTOP TABLE */}
            <div className="hidden min-[1050px]:block">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-[#f4eee6]">
                  <tr>
                    <TableHead className="w-[12%]">{l.status}</TableHead>
                    <TableHead className="w-[15%]">{l.driver}</TableHead>
                    <TableHead className="w-[20%]">{l.job}</TableHead>
                    <TableHead className="w-[20%]">{l.route}</TableHead>
                    <TableHead className="w-[8%]">{l.vehicle}</TableHead>
                    <TableHead className="w-[9%]">{language === "th" ? "เวลารับสินค้า" : "Pickup time"}</TableHead>
                    <TableHead className="w-[16%]">{l.lastUpdate}</TableHead>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row) => (
                    <OperationsTableRow
                      key={row.job.id}
                      row={row}
                      language={language}
                      formatDateTime={formatDateTime}
                      onOpen={() => setSelectedJobId(row.job.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* MOBILE / TABLET */}
            <div className="grid gap-2.5 bg-[#fbf7f1] p-3 sm:gap-3 sm:p-4 min-[1050px]:hidden">
              {visibleRows.map((row) => (
                <MobileJobCard
                  key={row.job.id}
                  row={row}
                  language={language}
                  formatDateTime={formatDateTime}
                  onOpen={() => setSelectedJobId(row.job.id)}
                />
              ))}
            </div>

            {visibleRows.length === 0 ? (
              <div className="px-4 py-5 text-center text-sm font-semibold text-slate-500 sm:px-5 sm:py-10">
                {searchTerm ? l.noMatch : jobView === "all" ? (language === "th" ? "ยังไม่มีงานที่มอบหมาย" : "No assigned activity yet.") : jobView === "active"
                  ? l.emptyActive
                  : jobView === "attention"
                    ? l.emptyAttention
                    : l.emptyCompleted}
              </div>
            ) : null}

            <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              {visibleRows.length} / {baseRows.length}{" "}
              {language === "th" ? "งาน" : "jobs"}
            </div>
          </section>
        </>
      ) : null}

      {mainView === "history" ? <DriverOperationsHistory refreshKey={data?.fetchedAt} onOpen={(row) => setHistorySelection(row)} /> : null}
      {mainView === "drivers" ? (
        <div className="mt-4">
          <DriverOperationsDirectory operations={data} onOpenJob={row => setHistorySelection(row)} />
        </div>
      ) : null}

      {selectedRow ? (
        <JobDrawer
          row={selectedRow}
          language={language}
          formatDateTime={formatDateTime}
          onClose={() => { setSelectedJobId(null); setHistorySelection(null); }}
        />
      ) : null}
    </main>
  );
}

function OperationsTableRow({
  row,
  language,
  formatDateTime,
  onOpen
}: {
  row: OperationsRow;
  language: "en" | "th";
  formatDateTime: (value: string) => string;
  onOpen: () => void;
}) {
  const l = copy[language];
  const status = jobStatus(row.events);
  const theme = statusStyle(status);
  const last = row.events.at(-1);

  return (
    <tr
      className="cursor-pointer border-t border-[#eee6dc] transition odd:bg-white even:bg-[#fdfaf6] hover:bg-[#f4eef9]"
      onClick={onOpen}
    >
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${theme.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
          {statusCopy[language][status]}
        </span>
        {(row.waitingMinutes ?? -1) >= 30 ? <p className="mt-2 text-[10px] font-black text-amber-800">{language === "th" ? `รอ ${row.waitingMinutes} นาที` : `WAITING ${row.waitingMinutes} MIN`}</p> : null}
      </td>

      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-black text-brand-700">
            {driverInitials(row.driverName)}
          </span>

          <div className="min-w-0">
            <p className="truncate font-bold text-slate-950">
              {row.driverName}
            </p>

            <p className="mt-0.5 text-[11px] text-slate-500">
              ID {row.driverId}
            </p>
          </div>
        </div>
      </td>

      <td className="px-5 py-3">
        <p className="truncate font-semibold text-slate-900">
          {row.job.clientName || row.job.jobOrderNumber || "—"}
        </p>
        {row.job.jobOrderNumber ? <p className="mt-1 text-xs text-slate-500">{row.job.jobOrderNumber}</p> : null}
      </td>

      <td className="px-5 py-3">
        <p className="truncate text-xs font-semibold text-slate-700">
          {row.job.pickupName}
        </p>

        <p className="mt-1 truncate text-xs text-slate-500">
          → {row.job.dropoffName}
        </p>
      </td>

      <td className="px-5 py-3 font-semibold text-slate-700">{row.job.vehicleRegistration || "—"}</td>
      <td className="px-5 py-3 font-bold text-slate-700">
        {row.job.pickupTime?.slice(0, 5) || (language === "th" ? "ยังไม่กำหนดเวลา" : "Time not set")}
      </td>

      <td className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-700">
              {last ? l.steps[last.eventType] : l.noEvents}
            </p>

            <p className="mt-0.5 text-[11px] text-slate-400">
              {last ? formatDateTime(last.eventTime) : "—"}
            </p>
          </div>

          <ChevronRight className="h-4 w-4 shrink-0 text-brand-600" />
        </div>
      </td>
    </tr>
  );
}

function MobileJobCard({
  row, language, formatDateTime, onOpen
}: {
  row: OperationsRow;
  language: "en" | "th";
  formatDateTime: (value: string) => string;
  onOpen: () => void;
}) {
  const l = copy[language];
  const status = jobStatus(row.events);
  const theme = statusStyle(status);
  const last = row.events.at(-1);
  const waiting = (row.waitingMinutes ?? -1) >= 30;
  const arrived = row.events.find((event) => event.eventType === "pickup_arrived");

  return (
    <button type="button" onClick={onOpen}
      className={`w-full rounded-2xl border p-3 text-left shadow-sm transition hover:border-brand-300 sm:p-4 ${waiting ? "border-amber-200 bg-amber-50/40" : status === "completed" ? "border-emerald-100 bg-emerald-50/20" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-black text-brand-700">{driverInitials(row.driverName)}</span>
          <div className="min-w-0"><p className="break-words text-sm font-black text-slate-950">{row.driverName}</p><p className="mt-0.5 text-xs text-slate-500">{row.job.vehicleRegistration || "—"} · {row.job.pickupTime?.slice(0, 5) || "—"}</p></div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-xs font-bold ${theme.badge}`}>{statusCopy[language][status]}</span>
      </div>
      {waiting ? <p className="mt-2 text-xs font-black text-amber-800">{language === "th" ? `รอ ${row.waitingMinutes} นาที` : `WAITING ${row.waitingMinutes} MIN`}{arrived ? <span className="ml-2 font-medium">{l.steps.pickup_arrived} {formatDateTime(arrived.eventTime)}</span> : null}</p> : null}
      <p className="mt-2 break-words text-sm font-bold text-slate-900">{row.job.clientName || "—"}</p>
      <p className="mt-1 break-words text-sm leading-5 text-slate-600">{row.job.pickupName} <span className="text-brand-500">→</span> {row.job.dropoffName}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <p className="min-w-0">{last ? <>{l.steps[last.eventType]} · {formatDateTime(last.eventTime)}</> : l.noEvents}</p>
        <ChevronRight className="h-4 w-4 shrink-0 text-brand-600" />
      </div>
    </button>
  );
}

export function JobDrawer({
  row,
  language,
  formatDateTime,
  onClose
}: {
  row: OperationsRow;
  language: "en" | "th";
  formatDateTime: (value: string) => string;
  onClose: () => void;
}) {
  const l = copy[language];
  const status = jobStatus(row.events);
  const theme = statusStyle(status);
  useModalScrollLock(true);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-end bg-slate-950/45 backdrop-blur-[3px] sm:items-stretch"
      onClick={onClose}
    >
      <aside
        role="dialog" aria-modal="true" aria-labelledby="operations-job-title"
        className="operations-job-drawer h-[calc(100dvh-0.35rem)] w-full overflow-y-auto overscroll-contain rounded-t-[1.5rem] bg-[#fbf8f3] shadow-2xl sm:h-full sm:max-h-none sm:w-[500px] sm:rounded-none sm:rounded-l-[1.75rem]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-[#e6ddd0] bg-[#fffdf9]/95 px-4 py-3.5 backdrop-blur sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${theme.badge}`}
              >
                {statusCopy[language][status]}
              </span>

              <h2 id="operations-job-title" className="mt-2 break-words text-xl font-black text-slate-950">
                {row.job.clientName || "—"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {row.driverName} · {row.job.vehicleRegistration || "—"}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white"
              aria-label={l.close}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-3 p-3.5 sm:p-5">
          <section className="rounded-2xl border border-[#e6ddd0] bg-white p-4 shadow-[0_8px_22px_rgba(74,43,86,0.04)]">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-700">
              {l.route}
            </p>

            <div className="mt-4 flex gap-3">
              <div className="flex flex-col items-center">
                <span className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="my-1 min-h-10 border-l-2 border-dashed border-slate-200" />
                <span className="h-3 w-3 rounded-full bg-brand-600" />
              </div>

              <div className="flex-1 space-y-5">
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">
                    {l.pickup}
                  </p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {row.job.pickupName}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">
                    Drop-off
                  </p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {row.job.dropoffName}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#e6ddd0] bg-white p-4 shadow-[0_8px_22px_rgba(74,43,86,0.04)]">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-700">
              {l.timeline}
            </p>

            {row.events.length ? (
              <ol className="mt-4 space-y-5">
                {row.events.map((event) => {
                  const locationValid =
                    event.latitude !== null &&
                    event.longitude !== null &&
                    Number.isFinite(event.latitude) &&
                    Number.isFinite(event.longitude) &&
                    Math.abs(event.latitude) <= 90 &&
                    Math.abs(event.longitude) <= 180;

                  return (
                    <li key={event.id} className="relative pl-9">
                      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                      </span>

                      <p className="font-bold text-slate-900">
                        {l.steps[event.eventType]}
                      </p>

                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDateTime(event.eventTime)}
                      </p>

                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`text-[11px] font-semibold ${
                            locationValid ? "text-emerald-600" : "text-slate-400"
                          }`}
                        >
                          {locationValid
                            ? l.locationCaptured
                            : l.noLocation}
                        </span>

                        {locationValid ? (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-bold text-brand-700"
                          >
                            {l.viewLocation}
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-slate-500">{l.noEvents}</p>
            )}
          </section>

          <section className="rounded-2xl border border-[#e6ddd0] bg-white p-4 shadow-[0_8px_22px_rgba(74,43,86,0.04)]">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-700">
              {l.driverDetails}
            </p>

            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-sm font-black text-brand-700">
                {driverInitials(row.driverName)}
              </span>

              <div>
                <p className="font-black text-slate-950">
                  {row.profile?.displayName || row.driverName}
                </p>

                <p className="mt-0.5 text-xs text-slate-500">
                  {l.driverId} {row.driverId}
                </p>
              </div>
            </div>

            <dl className="mt-4 grid gap-2">
              <Info label={language === "th" ? "วันที่จอง" : "Booking date"} value={row.job.bookingDate} />
              <Info label={language === "th" ? "เวลารับตามกำหนด" : "Scheduled pickup"} value={row.job.pickupTime?.slice(0, 5) || (language === "th" ? "ยังไม่กำหนดเวลา" : "Time not set")} />
              <Info label={language === "th" ? "เลขงาน" : "Job/order reference"} value={row.job.jobOrderNumber || "—"} />
              <Info label={language === "th" ? "ประเภทรถ" : "Vehicle type"} value={getPortalVehicleTypeLabel(row.job.vehicleType, language)} />
              <Info label={language === "th" ? "ระยะเวลาปฏิบัติงาน" : "Duration"} value={driverDurationMinutes(row.events) === null ? "—" : `${driverDurationMinutes(row.events)} ${language === "th" ? "นาที" : "min"}`} />
              {row.job.notes ? <Info label={language === "th" ? "หมายเหตุ / คำแนะนำ" : "Notes / instructions"} value={row.job.notes} /> : null}
              <Info
                icon={<Truck className="h-4 w-4" />}
                label={l.vehicle}
                value={row.job.vehicleRegistration || "—"}
              />

              {row.profile ? <>
              <Info
                label={l.email}
                value={row.profile?.email || "—"}
              />

              <Info
                label={l.phone}
                value={row.profile?.phone || "—"}
              />

              <Info
                label={l.lastLogin}
                value={
                  row.profile?.lastLogin
                    ? formatDateTime(row.profile.lastLogin)
                    : "—"
                }
              />
              </> : null}
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone = "default"
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: "default" | "blue" | "amber" | "green";
}) {
  const toneClass = {
    default: "bg-brand-50 text-brand-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700"
  }[tone];

  return (
    <div className="operations-metric rounded-2xl border border-[#e6ddd0] bg-[linear-gradient(180deg,#fffdf9_0%,#fbf7f1_100%)] p-3.5 shadow-[0_8px_22px_rgba(74,43,86,0.05)] sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
          {label}
        </p>

        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}
        >
          {icon}
        </span>
      </div>

      <p className="mt-1.5 text-2xl font-black tracking-[-0.03em] text-slate-950 sm:text-[1.7rem]">{value}</p>
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
  attention = false,
  completed = false
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  attention?: boolean;
  completed?: boolean;
}) {
  const activeClass = attention
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : completed
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : "border-brand-300 bg-brand-50 text-brand-800";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold transition ${
        active
          ? activeClass
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className="ml-2 rounded-full bg-white/70 px-1.5 py-0.5">
        {count}
      </span>
    </button>
  );
}

function TableHead({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

function Info({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="operations-driver-info flex items-center gap-3 rounded-xl border border-[#eee5da] bg-[#faf6f0] px-3 py-2.5">
      {icon ? <span className="text-brand-600">{icon}</span> : null}

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
          {label}
        </p>

        <p className="mt-0.5 break-all text-sm font-semibold text-slate-800">
          {value}
        </p>
      </div>
    </div>
  );
}
