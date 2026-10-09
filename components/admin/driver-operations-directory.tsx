"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, RefreshCw, Search, Truck, UserRound, X } from "lucide-react";
import { getAccessToken, type ManagedDriverAccount, type ManagedDriverAccountResult } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { useModalScrollLock } from "@/lib/use-modal-scroll-lock";
import { statusCopy, type OperationsDriverDetail, type OperationsResult, type OperationsRow } from "@/lib/driver-operations";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "?").toUpperCase();
}

export function DriverOperationsDirectory({ operations, onOpenJob }: { operations: OperationsResult | null; onOpenJob: (row: OperationsRow) => void }) {
  const { language } = useLanguage();
  const th = language === "th";
  const [drivers, setDrivers] = useState<ManagedDriverAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<ManagedDriverAccount | null>(null);
  const [detail, setDetail] = useState<OperationsDriverDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  useModalScrollLock(selected !== null);

  const load = useCallback(async () => {
    const id = ++listRequest.current;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/driver-accounts?_=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" }
      });
      if (!response.ok) throw new Error(`Directory request failed (${response.status})`);
      const payload = (await response.json()) as ManagedDriverAccountResult;
      if (!Array.isArray(payload.drivers)) throw new Error("Invalid directory response");
      if (id === listRequest.current) {
        setDrivers(payload.drivers);
        setError(false);
      }
    } catch (failure) {
      if (id === listRequest.current) {
        console.error("Driver directory refresh failed", failure);
        setError(true);
      }
    } finally {
      if (id === listRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const counter = listRequest;
    void load();
    return () => { counter.current++; };
  }, [load, operations?.fetchedAt]);

  const open = async (driver: ManagedDriverAccount) => {
    const id = ++detailRequest.current;
    setSelected(driver);
    setDetail(null);
    setDetailError(false);
    setDetailBusy(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/driver-operations/drivers/${encodeURIComponent(driver.driverId)}?_=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" }
      });
      if (!response.ok) throw new Error(`Driver detail failed (${response.status})`);
      const payload = (await response.json()) as OperationsDriverDetail;
      if (!payload.stats || !Object.values(payload.stats).every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0)) throw new Error("Invalid driver statistics");
      if (id === detailRequest.current) setDetail(payload);
    } catch (failure) {
      if (id === detailRequest.current) {
        console.error("Driver detail refresh failed", failure);
        setDetailError(true);
      }
    } finally {
      if (id === detailRequest.current) setDetailBusy(false);
    }
  };

  const close = () => {
    detailRequest.current++;
    setSelected(null);
    setDetail(null);
  };

  const openAssigned = async (bookingId: string) => {
    const id = ++detailRequest.current;
    setDetailBusy(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/driver-operations/jobs/${encodeURIComponent(bookingId)}?_=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" }
      });
      if (!response.ok) throw new Error("Job detail unavailable");
      const row = (await response.json()) as OperationsRow;
      if (id !== detailRequest.current) return;
      close();
      onOpenJob(row);
    } catch (failure) {
      if (id === detailRequest.current) {
        console.error("Assigned job detail failed", failure);
        setDetailError(true);
      }
    } finally {
      setDetailBusy(false);
    }
  };

  const active = (driver: ManagedDriverAccount) => !!driver.accountId && driver.accountActive === true && driver.driverActive;
  const query = search.trim().toLowerCase();
  const visible = (drivers || []).filter((driver) =>
    (!query || [driver.name, driver.driverId, driver.email, driver.vehicleRegistration].some((value) => value?.toLowerCase().includes(query))) &&
    (filter === "all" || (filter === "active" ? active(driver) : filter === "none" ? !driver.accountId : !!driver.accountId && !active(driver)))
  );

  const format = (value: string | null) => value
    ? new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value))
    : "—";

  const stats = (driver: ManagedDriverAccount) => {
    if (!operations) return { jobs: "—", status: "—" };
    const activity = operations.driverActivity[driver.driverId];
    return {
      jobs: activity?.jobsToday ?? 0,
      status: activity?.status ? statusCopy[language][activity.status] : th ? "ไม่มีงานที่กำลังดำเนินการ" : "No active job"
    };
  };

  const portalCount = (drivers || []).filter(active).length;
  const noAccountCount = (drivers || []).filter((driver) => !driver.accountId).length;
  const inactiveCount = (drivers || []).filter((driver) => !!driver.accountId && !active(driver)).length;

  return (
    <section className="driver-directory overflow-hidden rounded-2xl border border-[#e6ddd0] bg-[#fffdf9] shadow-[0_14px_34px_rgba(74,43,86,0.06)]">
      <div className="border-b border-[#ece3d8] bg-[linear-gradient(180deg,#fffdf9_0%,#fbf7f1_100%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-700">{th ? "รายชื่อคนขับ" : "DRIVER DIRECTORY"}</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{drivers ? `${drivers.length} ${th ? "คนขับ" : "drivers"}` : th ? "กำลังโหลด…" : "Loading…"}</h2>
            <p className="mt-1 text-sm text-slate-500">{th ? "บัญชีพอร์ทัล รถปัจจุบัน และสถานะงานในที่เดียว" : "Portal access, current vehicles and live work status in one place."}</p>
          </div>
          <div className="flex w-full gap-2 lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-80 lg:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input aria-label={th ? "ค้นหาคนขับ" : "Search drivers"} className="form-input w-full border-[#ded4c8] bg-white pl-9 shadow-sm focus:border-brand-300" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={th ? "ชื่อ รหัส รถ อีเมล" : "Name, ID, vehicle or email"} />
            </div>
            <button disabled={loading} className="btn-secondary min-h-11 shrink-0" onClick={() => void load()} aria-label={th ? "รีเฟรชรายชื่อ" : "Refresh directory"}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{th ? "รีเฟรช" : "Refresh"}</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {[
            ["all", th ? "ทั้งหมด" : "All", drivers?.length ?? 0],
            ["active", th ? "บัญชีใช้งาน" : "Portal active", portalCount],
            ["none", th ? "ไม่มีบัญชี" : "No account", noAccountCount],
            ["inactive", th ? "ไม่ใช้งาน" : "Inactive", inactiveCount]
          ].map(([value, label, count]) => (
            <button type="button" className={`min-h-10 shrink-0 rounded-xl border px-3 text-sm font-semibold ${filter === value ? "border-brand-300 bg-[#f3ebf8] text-brand-800 shadow-sm" : "border-[#dfd6cb] bg-white text-slate-600 hover:bg-[#faf6f1]"}`} aria-pressed={filter === value} onClick={() => setFilter(String(value))} key={String(value)}>
              {String(label)} <span className="ml-1.5 text-xs opacity-70">{String(count)}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? <div role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{th ? "โหลดรายชื่อไม่ได้ ข้อมูลเดิมยังคงแสดงอยู่" : "Unable to load drivers. Previous successful data is retained."}<button className="ml-3 min-h-10 font-bold underline" onClick={() => void load()}>{th ? "ลองอีกครั้ง" : "Retry"}</button></div> : null}

      {loading && !drivers ? (
        <div role="status" className="animate-pulse space-y-2 p-5">{[1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl bg-slate-100" />)}</div>
      ) : drivers ? (
        <>
          <div className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-[#f4eee6]"><tr>{[th ? "คนขับ / รหัส" : "Driver / ID", th ? "รถปัจจุบัน" : "Current vehicle", th ? "สิทธิ์พอร์ทัล" : "Portal access", th ? "อีเมล" : "Email", th ? "เข้าสู่ระบบล่าสุด" : "Last login", th ? "งานวันนี้" : "Jobs today", th ? "สถานะปัจจุบัน" : "Current status"].map((label) => <th key={label} className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</th>)}</tr></thead>
                <tbody>{visible.map((driver) => { const activity = stats(driver); return <tr key={driver.driverId} className="cursor-pointer border-t border-[#eee6dc] transition odd:bg-white even:bg-[#fdfaf6] hover:bg-[#f4eef9]" onClick={() => void open(driver)}><td className="px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-black text-brand-700">{initials(driver.name)}</span><div><p className="font-bold text-slate-950">{driver.name}</p><p className="mt-0.5 text-xs text-slate-500">ID {driver.driverId}</p></div></div></td><td className="px-4 py-3 font-semibold">{driver.vehicleRegistration || "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${active(driver) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{!driver.accountId ? th ? "ไม่มีบัญชี" : "No account" : active(driver) ? th ? "ใช้งาน" : "Active" : th ? "ไม่ใช้งาน" : "Inactive"}</span></td><td className="px-4 py-3 text-xs">{driver.email || "—"}</td><td className="px-4 py-3 text-xs">{format(driver.lastSignInAt)}</td><td className="px-4 py-3 font-black">{activity.jobs}</td><td className="px-4 py-3 text-xs">{activity.status}</td></tr>; })}</tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-2.5 bg-[#fbf7f1] p-3 lg:hidden">
            {visible.map((driver) => {
              const activity = stats(driver);
              return (
                <button type="button" key={driver.driverId} onClick={() => void open(driver)} className="w-full rounded-2xl border border-[#e6ddd0] bg-white p-3.5 text-left shadow-[0_8px_22px_rgba(74,43,86,0.04)]">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-black text-brand-700">{initials(driver.name)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2"><div><p className="font-black text-slate-950">{driver.name}</p><p className="mt-0.5 text-xs text-slate-500">ID {driver.driverId}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-brand-600" /></div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 text-slate-600"><Truck className="h-3.5 w-3.5" />{driver.vehicleRegistration || "—"}</span>
                        <span className="text-right font-semibold text-slate-700">{th ? "งานวันนี้" : "Jobs today"}: {activity.jobs}</span>
                        <span className={`w-fit rounded-full px-2 py-1 font-semibold ${active(driver) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{!driver.accountId ? th ? "ไม่มีบัญชี" : "No account" : active(driver) ? th ? "ใช้งาน" : "Active" : th ? "ไม่ใช้งาน" : "Inactive"}</span>
                        <span className="truncate text-right text-slate-500">{activity.status}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!visible.length ? <p className="p-6 text-center text-sm text-slate-500">{search || filter !== "all" ? th ? "ไม่มีคนขับตรงกับตัวกรอง" : "No drivers match these filters." : th ? "ยังไม่มีข้อมูลคนขับ" : "No drivers yet."}</p> : null}
        </>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-end bg-slate-950/45 backdrop-blur-[3px] sm:items-stretch" onClick={close}>
          <aside role="dialog" aria-modal="true" aria-label={th ? "รายละเอียดคนขับ" : "Driver detail"} className="h-[calc(100dvh-0.35rem)] w-full overflow-y-auto rounded-t-[1.5rem] bg-[#fbf8f3] shadow-2xl sm:h-full sm:max-h-none sm:w-[500px] sm:rounded-none sm:rounded-l-[1.75rem]" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#e6ddd0] bg-[#fffdf9]/95 p-4 backdrop-blur sm:p-5">
              <div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-black text-brand-700">{initials(selected.name)}</span><div className="min-w-0"><h2 className="truncate text-xl font-black text-slate-950">{selected.name}</h2><p className="mt-0.5 text-sm text-slate-500">ID {selected.driverId}</p></div></div>
              <button aria-label={th ? "ปิด" : "Close driver detail"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white" onClick={close}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              {detailBusy ? <div role="status" className="animate-pulse space-y-2"><div className="h-20 rounded-xl bg-slate-100" /><div className="h-32 rounded-xl bg-slate-100" /></div> : null}
              {detailError ? <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{th ? "โหลดรายละเอียดไม่ได้" : "Unable to load driver detail."}<button className="ml-3 min-h-10 font-bold underline" onClick={() => void open(selected)}>{th ? "ลองอีกครั้ง" : "Retry"}</button></div> : null}
              {detail ? (
                <>
                  <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-[#e6ddd0] bg-white p-3 shadow-[0_8px_22px_rgba(74,43,86,0.04)] sm:gap-3 sm:p-4">{[[th ? "สิทธิ์พอร์ทัล" : "Portal access", detail.portalActive === null ? th ? "ไม่มีบัญชี" : "No account" : detail.portalActive ? th ? "ใช้งาน" : "Active" : th ? "ไม่ใช้งาน" : "Inactive"], [th ? "รถปัจจุบัน" : "Current vehicle", detail.currentVehicle || "—"], [th ? "เข้าสู่ระบบล่าสุด" : "Last login", format(detail.profile?.lastLogin || null)], [th ? "ชื่อที่แสดง" : "Display name", detail.profile?.displayName || detail.driverName], [th ? "อีเมล" : "Email", detail.profile?.email || "—"], [th ? "โทรศัพท์" : "Phone", detail.profile?.phone || "—"]].map(([label, value]) => <div key={String(label)}><dt className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</dd></div>)}</dl>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[[th ? "งานวันนี้" : "Jobs today", detail.stats.jobsToday], [th ? "กำลังดำเนินการ" : "Active now", detail.stats.activeNow], [th ? "เสร็จวันนี้" : "Completed today", detail.stats.completedToday], [th ? "เสร็จใน 7 วัน" : "Last 7 days", detail.stats.completedLast7Days], [th ? "เสร็จทั้งหมด" : "Total completed", detail.stats.totalCompleted]].map(([label, value]) => <div className="rounded-xl border border-[#e6ddd0] bg-white p-3 shadow-[0_6px_18px_rgba(74,43,86,0.035)]" key={String(label)}><p className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</p><p className="mt-1 text-2xl font-black text-slate-950">{value}</p></div>)}</div>

                  <section><h3 className="font-black text-slate-950">{th ? "งานที่เสร็จล่าสุด" : "Recent completed jobs"}</h3>{detail.recentCompleted.length ? detail.recentCompleted.map((row) => <button type="button" className="mt-2 block min-h-12 w-full rounded-xl border border-[#eee5da] bg-[#faf6f0] p-3 text-left text-sm hover:bg-[#f4eef9]" key={row.job.id} onClick={() => { close(); onOpenJob(row); }}><span className="font-semibold text-slate-900">{row.job.clientName || row.job.jobOrderNumber || "—"}</span><span className="mt-1 block text-xs text-slate-500">{row.job.pickupName} → {row.job.dropoffName} · {row.job.vehicleRegistration || "—"}</span></button>) : <p className="mt-2 text-sm text-slate-500">{th ? "ยังไม่มีงานที่เสร็จแล้ว" : "No completed jobs yet."}</p>}</section>

                  <section><h3 className="font-black text-slate-950">{th ? "งานที่มอบหมายถัดไป" : "Next assigned jobs"}</h3>{detail.recentAssigned.length ? detail.recentAssigned.map((job) => <button type="button" disabled={detailBusy} className="mt-2 block min-h-12 w-full rounded-xl border border-[#eee5da] bg-[#faf6f0] p-3 text-left text-sm hover:bg-[#f4eef9]" key={job.id} onClick={() => void openAssigned(job.id)}><span className="font-semibold text-slate-900">{job.clientName || job.jobOrderNumber || "—"}</span><span className="mt-1 block text-xs text-slate-500">{job.pickupName} → {job.dropoffName} · {job.bookingDate} · {job.pickupTime?.slice(0, 5) || (th ? "ยังไม่กำหนดเวลา" : "Time not set")}</span></button>) : <p className="mt-2 text-sm text-slate-500">{th ? "ไม่มีงานที่มอบหมายค้างอยู่" : "No outstanding assigned jobs."}</p>}</section>
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
