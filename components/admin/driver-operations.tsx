"use client";

import Image from "next/image";
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
  type OperationStatus,
  type OperationsResult,
  type OperationsRow
} from "@/lib/driver-operations";
import { DriverProfileBrowser } from "@/components/admin/driver-profile-browser";
import { DriverOperationsHistory } from "@/components/admin/driver-operations-history";

type MainView = "operations" | "history" | "drivers";
type JobView = "active" | "attention" | "completed";

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
    error: "Unable to refresh. Displayed information may be out of date.",
    denied: "Administrator access required",

    driversToday: "Drivers today",
    jobsToday: "Jobs today",
    activeJobs: "Active jobs",
    attention: "Attention",
    completed: "Completed",

    active: "Active",
    completedTab: "Completed",
    attentionTab: "Attention",

    search: "Search today's operations",
    searchPlaceholder: "Driver, customer, vehicle or location",

    assignedWork: "Today's operations",
    activeHelp: "Jobs still in progress or waiting to start",
    attentionHelp: "Jobs that may need office attention",
    completedHelp: "Jobs completed today",

    emptyActive: "No active jobs right now.",
    emptyAttention: "Nothing needs attention.",
    emptyCompleted: "No completed jobs yet.",

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
    activeJobs: "งานที่กำลังดำเนินการ",
    attention: "ต้องตรวจสอบ",
    completed: "เสร็จแล้ว",

    active: "กำลังดำเนินการ",
    completedTab: "เสร็จแล้ว",
    attentionTab: "ต้องตรวจสอบ",

    search: "ค้นหางานวันนี้",
    searchPlaceholder: "คนขับ ลูกค้า รถ หรือสถานที่",

    assignedWork: "ปฏิบัติการวันนี้",
    activeHelp: "งานที่ยังไม่เสร็จหรือรอเริ่ม",
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

export function DriverOperationsPage() {
  const { can } = useAccountAccess();
  const allowed = can("admin:user_management");

  const { language } = useLanguage();
  const l = copy[language];

  const [data, setData] = useState<OperationsResult | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [mainView, setMainView] = useState<MainView>("operations");
  const [jobView, setJobView] = useState<JobView>("active");
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

      const response = await fetch("/api/admin/driver-operations", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!response.ok) throw new Error();

      const payload = await response.json() as OperationsResult;
      setData(payload);
      if (!openedLink.current) {
        openedLink.current = true;
        const jobId = new URLSearchParams(window.location.search).get("job");
        if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) {
          const detail = await fetch(`/api/admin/driver-operations/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          if (!detail.ok) throw new Error();
          setHistorySelection(await detail.json());
        }
      }
      setError(false);
    } catch {
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

  const hasAttention = useCallback(
    (row: OperationsRow) => {
      const status = jobStatus(row.events);

      if (row.accountActive !== true) return true;
      if ((row.waitingMinutes ?? -1) >= 30) return true;

      if (
        status === "ready" &&
        row.job.pickupTime &&
        /^\d{2}:\d{2}/.test(row.job.pickupTime) &&
        data
      ) {
        const pickup = new Date(
          `${row.job.bookingDate}T${row.job.pickupTime.slice(0, 5)}:00+07:00`
        );

        return pickup.getTime() < new Date(data.fetchedAt).getTime();
      }

      return false;
    },
    [data]
  );

  const activeRows = useMemo(
    () => rows.filter((row) => jobStatus(row.events) !== "completed"),
    [rows]
  );

  const completedRows = useMemo(
    () => rows.filter((row) => jobStatus(row.events) === "completed"),
    [rows]
  );

  const attentionRows = useMemo(
    () => rows.filter((row) => hasAttention(row)),
    [rows, hasAttention]
  );

  const driversToday = useMemo(
    () => new Set(rows.map((row) => row.driverId)).size,
    [rows]
  );

  const selectedRow =
    historySelection ?? rows.find((row) => row.job.id === selectedJobId) ?? null;

  const baseRows =
    jobView === "completed"
      ? completedRows
      : jobView === "attention"
        ? attentionRows
        : activeRows;

  const searchTerm = search.trim().toLowerCase();

  const visibleRows = baseRows.filter((row) => {
    if (!searchTerm) return true;

    return [
      row.driverName,
      row.job.clientName,
      row.job.vehicleRegistration,
      row.job.pickupName,
      row.job.dropoffName
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
    <main className="mx-auto w-full max-w-[1700px] p-4 sm:p-6 lg:p-8">
      {/* PAGE HEADER */}
      <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-5 sm:px-6">
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

              <h1 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-[2rem]">
                {l.title}
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                {l.intro}
                {data?.date ? ` · ${data.date}` : ""}
              </p>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
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
          <div className="mt-5 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
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
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          {l.error}
        </div>
      ) : null}

      {!data && !error ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {l.loading}
        </div>
      ) : null}

      {data && mainView === "operations" ? (
        <>
          {/* KPIs */}
          <section className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric
              label={l.driversToday}
              value={driversToday}
              icon={<UsersRound className="h-4 w-4" />}
            />

            <Metric
              label={l.jobsToday}
              value={rows.length}
              icon={<Route className="h-4 w-4" />}
            />

            <Metric
              label={l.activeJobs}
              value={activeRows.length}
              icon={<Navigation className="h-4 w-4" />}
              tone="blue"
            />

            <Metric
              label={l.attention}
              value={attentionRows.length}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone="amber"
            />

            <Metric
              label={l.completed}
              value={completedRows.length}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="green"
            />
          </section>

          {/* OPERATIONS BOARD */}
          <section className="mt-4 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-700">
                    {l.assignedWork}
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    {jobView === "active"
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
                    className="form-input bg-white pl-9"
                    placeholder={l.searchPlaceholder}
                    aria-label={l.search}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
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
                <thead className="bg-slate-50/80">
                  <tr>
                    <TableHead className="w-[12%]">{l.status}</TableHead>
                    <TableHead className="w-[15%]">{l.driver}</TableHead>
                    <TableHead className="w-[20%]">{l.job}</TableHead>
                    <TableHead className="w-[27%]">{l.route}</TableHead>
                    <TableHead className="w-[10%]">{l.pickup}</TableHead>
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
            <div className="grid gap-3 p-4 min-[1050px]:hidden">
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
              <div className="px-5 py-10 text-center text-sm font-semibold text-slate-500">
                {jobView === "active"
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

      {mainView === "history" ? <DriverOperationsHistory onOpen={(row) => setHistorySelection(row)} /> : null}
      {data && mainView === "drivers" ? (
        <div className="mt-4">
          <DriverProfileBrowser />
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
      className="cursor-pointer border-t border-slate-100 transition hover:bg-violet-50/30"
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
          {row.profile?.avatarUrl ? (
            <Image
              unoptimized
              src={row.profile.avatarUrl}
              width={36}
              height={36}
              alt={row.driverName}
              className="h-9 w-9 rounded-xl object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-xs font-black text-brand-700">
              {row.driverName.slice(0, 1).toUpperCase()}
            </span>
          )}

          <div className="min-w-0">
            <p className="truncate font-bold text-slate-950">
              {row.driverName}
            </p>

            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.job.vehicleRegistration || "—"}
            </p>
          </div>
        </div>
      </td>

      <td className="px-5 py-3">
        <p className="truncate font-semibold text-slate-900">
          {row.job.clientName || "—"}
        </p>
      </td>

      <td className="px-5 py-3">
        <p className="truncate text-xs font-semibold text-slate-700">
          {row.job.pickupName}
        </p>

        <p className="mt-1 truncate text-xs text-slate-500">
          → {row.job.dropoffName}
        </p>
      </td>

      <td className="px-5 py-3 font-bold text-slate-700">
        {row.job.pickupTime?.slice(0, 5) || "—"}
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
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-black text-brand-700">
            {row.driverName.slice(0, 1).toUpperCase()}
          </span>

          <div className="min-w-0">
            <p className="truncate font-black text-slate-950">
              {row.driverName}
            </p>

            <p className="mt-0.5 text-xs text-slate-500">
              {row.job.vehicleRegistration || "—"} ·{" "}
              {row.job.pickupTime?.slice(0, 5) || "—"}
            </p>
          </div>
        </div>

        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${theme.badge}`}
        >
          {statusCopy[language][status]}
        </span>
      </div>

      <p className="mt-4 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
        {row.job.clientName || "—"}
      </p>
      {(row.waitingMinutes ?? -1) >= 30 ? <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-black text-amber-800">{language === "th" ? `รอ ${row.waitingMinutes} นาที` : `WAITING ${row.waitingMinutes} MIN`}</p> : null}

      <p className="mt-2 text-sm font-semibold text-slate-800">
        {row.job.pickupName}
      </p>

      <p className="my-1 text-xs text-brand-400">↓</p>

      <p className="text-sm font-semibold text-slate-800">
        {row.job.dropoffName}
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
            {l.lastUpdate}
          </p>

          <p className="mt-1 text-xs font-semibold text-slate-600">
            {last ? l.steps[last.eventType] : l.noEvents}
          </p>

          {last ? (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {formatDateTime(last.eventTime)}
            </p>
          ) : null}
        </div>

        <ChevronRight className="h-5 w-5 text-brand-600" />
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-end bg-slate-950/35 backdrop-blur-[2px] sm:items-stretch"
      onClick={onClose}
    >
      <aside
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-[2rem] bg-[#fffdf9] shadow-2xl sm:max-h-none sm:w-[520px] sm:rounded-none sm:rounded-l-[2rem]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-[#fffdf9]/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${theme.badge}`}
              >
                {statusCopy[language][status]}
              </span>

              <h2 className="mt-2 text-xl font-black text-slate-950">
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

        <div className="space-y-4 p-5 sm:p-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
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

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
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

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-700">
              {l.driverDetails}
            </p>

            <div className="mt-4 flex items-center gap-3">
              {row.profile?.avatarUrl ? (
                <Image
                  unoptimized
                  src={row.profile.avatarUrl}
                  width={52}
                  height={52}
                  alt={row.driverName}
                  className="h-13 w-13 rounded-2xl object-cover"
                />
              ) : (
                <span className="flex h-13 w-13 items-center justify-center rounded-2xl bg-brand-50 font-black text-brand-700">
                  {row.driverName.slice(0, 1).toUpperCase()}
                </span>
              )}

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
              <Info
                icon={<Truck className="h-4 w-4" />}
                label={l.vehicle}
                value={row.job.vehicleRegistration || "—"}
              />

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
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
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

      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
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
      className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
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
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
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
