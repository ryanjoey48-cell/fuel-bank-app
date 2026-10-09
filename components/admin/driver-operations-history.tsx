"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Clock3, Route, Search, Truck, UserRound } from "lucide-react";
import { getAccessToken } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import {
  bangkokOperationalDate,
  shiftBangkokDate,
  completedDriverEvent,
  driverDurationMinutes,
  type OperationsHistoryResult,
  type OperationsRow
} from "@/lib/driver-operations";

type Preset = "today" | "7" | "30" | "all" | "custom";

function dateRange(preset: Preset) {
  const today = bangkokOperationalDate();
  return preset === "all"
    ? { from: "", to: "" }
    : {
        from: shiftBangkokDate(today, preset === "7" ? -6 : preset === "30" ? -29 : 0),
        to: today
      };
}

export function DriverOperationsHistory({
  onOpen,
  refreshKey
}: {
  onOpen: (row: OperationsRow) => void;
  refreshKey?: string;
}) {
  const { language } = useLanguage();
  const th = language === "th";
  const [preset, setPreset] = useState<Preset>("30");
  const [filters, setFilters] = useState(() => ({ q: "", ...dateRange("30") }));
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<OperationsHistoryResult | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    try {
      const token = await getAccessToken();
      const query = new URLSearchParams({ ...applied, page: String(page), _: String(Date.now()) });
      const response = await fetch(`/api/admin/driver-operations/history?${query}`, {
        signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" }
      });
      if (!response.ok) throw new Error(`History request failed (${response.status})`);
      const payload = (await response.json()) as OperationsHistoryResult;
      if (!Array.isArray(payload.rows) || !Number.isInteger(payload.total) || payload.total < 0 || !Number.isInteger(payload.pageSize)) {
        throw new Error("Invalid history response");
      }
      if (!signal.aborted) {
        setData(payload);
        setUpdated(new Date().toISOString());
        setError(false);
      }
    } catch (failure) {
      if (!signal.aborted) {
        console.error("Driver Operations history refresh failed", failure);
        setError(true);
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, [applied, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey, revision]);

  useEffect(() => {
    if (preset === "custom") return;
    const range = dateRange(preset);
    if (range.from !== applied.from || range.to !== applied.to) {
      const next = { ...applied, ...range };
      setFilters(next);
      setApplied(next);
      setPage(0);
    }
  }, [refreshKey, preset, applied]);

  const choose = (value: Preset) => {
    const next = { ...filters, ...dateRange(value) };
    setPreset(value);
    setFilters(next);
    setApplied(next);
    setPage(0);
  };

  const format = (value: string) =>
    new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date(value));

  const filtered = !!(applied.q || applied.from || applied.to);

  return (
    <section className="operations-history mt-3 overflow-hidden rounded-2xl border border-[#e6ddd0] bg-[#fffdf9] shadow-[0_14px_34px_rgba(74,43,86,0.06)]">
      <div className="p-4 sm:p-5 lg:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-700">
              {th ? "ประวัติการทำงาน" : "OPERATIONS HISTORY"}
            </p>
            <h2 className="mt-1 text-lg font-black text-slate-950 sm:text-xl">
              {th ? "งานที่เสร็จแล้ว" : "Completed jobs"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {th ? "งานที่จบแล้วทั้งหมด รวมวันนี้ เรียงจากล่าสุด" : "All completed driver jobs, including today, newest first"}
            </p>
          </div>
          {data ? (
            <p className="mt-2 text-xs font-semibold text-slate-400 sm:mt-0">
              {data.total} {th ? "รายการ" : data.total === 1 ? "job" : "jobs"}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={th ? "ช่วงวันที่" : "History date range"}>
          {([
            ["today", th ? "วันนี้" : "Today"],
            ["7", th ? "7 วันที่ผ่านมา" : "Last 7 days"],
            ["30", th ? "30 วันที่ผ่านมา" : "Last 30 days"],
            ["all", th ? "ทั้งหมด" : "All"]
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={preset === value}
              onClick={() => choose(value)}
              className={`min-h-10 shrink-0 rounded-xl border px-3 text-sm font-semibold transition ${
                preset === value
                  ? "border-brand-300 bg-[#f3ebf8] text-brand-800 shadow-sm"
                  : "border-[#dfd6cb] bg-white text-slate-600 hover:bg-[#faf6f1]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form
          className="mt-3 grid gap-2.5 rounded-xl border border-[#ece3d8] bg-[#faf6f0] p-3 md:grid-cols-2 lg:grid-cols-[minmax(260px,2fr)_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ ...filters });
            setPage(0);
            setRevision((value) => value + 1);
          }}
        >
          <label className="text-xs font-bold text-slate-600 lg:col-span-1">
            {th ? "ค้นหา" : "Search"}
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="form-input w-full border-[#ded4c8] bg-white pl-9 shadow-sm focus:border-brand-300"
                maxLength={100}
                value={filters.q}
                onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                placeholder={th ? "คนขับ ลูกค้า รถ เส้นทาง เลขงาน" : "Driver, customer, vehicle, route or job reference"}
              />
            </div>
          </label>

          {(["from", "to"] as const).map((key) => (
            <label key={key} className="text-xs font-bold text-slate-600">
              {key === "from" ? (th ? "ตั้งแต่" : "From") : th ? "ถึง" : "To"}
              <input
                type="date"
                className="form-input mt-1 w-full border-[#ded4c8] bg-white shadow-sm focus:border-brand-300"
                value={filters[key]}
                onChange={(event) => {
                  setPreset("custom");
                  setFilters({ ...filters, [key]: event.target.value });
                }}
              />
            </label>
          ))}

          <div className="flex gap-2 self-end md:col-span-2 lg:col-span-1">
            <button disabled={busy} className="btn-primary min-h-11 flex-1 lg:flex-none">
              {th ? "ค้นหา / รีเฟรช" : "Search / refresh"}
            </button>
            <button
              type="button"
              className="btn-secondary min-h-11"
              disabled={busy}
              onClick={() => {
                const next = { q: "", from: "", to: "" };
                setPreset("all");
                setFilters(next);
                setApplied(next);
                setPage(0);
              }}
            >
              {th ? "ล้าง" : "Clear"}
            </button>
          </div>
        </form>

        {updated ? (
          <p className="mt-3 text-xs text-slate-400">
            {th ? "อัปเดตสำเร็จล่าสุด" : "Last successful refresh"} · {format(updated)}
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
            <span>{th ? "โหลดประวัติไม่ได้ ข้อมูลเดิมยังคงแสดงอยู่" : "Unable to load history. Previous successful data is retained."}</span>
            <button className="min-h-10 px-2 font-bold underline" onClick={() => setRevision((value) => value + 1)}>
              {th ? "ลองอีกครั้ง" : "Retry"}
            </button>
          </div>
        ) : null}

        {busy && !data ? (
          <div role="status" className="mt-4 animate-pulse space-y-2">
            <p className="text-sm text-slate-500">{th ? "กำลังโหลดประวัติ…" : "Loading history…"}</p>
            {[1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl bg-slate-100" />)}
          </div>
        ) : null}
      </div>

      {data ? (
        <>
          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-[#f4eee6]">
                  <tr>
                    {[th ? "เสร็จเมื่อ" : "Completed", th ? "คนขับ" : "Driver", th ? "ลูกค้า / งาน" : "Customer / Job", th ? "เส้นทาง" : "Route", th ? "รถ" : "Vehicle", th ? "ระยะเวลา" : "Duration", th ? "สถานะ" : "Status"].map((label) => (
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.08em] text-slate-500" key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const completed = completedDriverEvent(row.events);
                    const duration = driverDurationMinutes(row.events);
                    return (
                      <tr className="cursor-pointer border-t border-[#eee6dc] transition odd:bg-white even:bg-[#fdfaf6] hover:bg-[#f4eef9]" key={row.job.id} onClick={() => onOpen(row)}>
                        <td className="px-4 py-3 font-semibold text-slate-800">{completed ? format(completed.eventTime) : "—"}</td>
                        <td className="px-4 py-3"><p className="font-bold text-slate-950">{row.driverName}</p><p className="mt-0.5 text-xs text-slate-500">ID {row.driverId}</p></td>
                        <td className="px-4 py-3"><p className="font-semibold text-slate-900">{row.job.clientName || "—"}</p>{row.job.jobOrderNumber ? <p className="mt-0.5 text-xs text-slate-500">{row.job.jobOrderNumber}</p> : null}</td>
                        <td className="px-4 py-3 text-slate-700">{row.job.pickupName} → {row.job.dropoffName}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{row.job.vehicleRegistration || "—"}</td>
                        <td className="px-4 py-3 text-slate-700">{duration === null ? "—" : `${duration} ${th ? "นาที" : "min"}`}</td>
                        <td className="px-4 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{th ? "จบงานแล้ว" : "Completed"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-2.5 bg-[#fbf7f1] px-3 pb-3 md:hidden">
            {data.rows.map((row) => {
              const completed = completedDriverEvent(row.events);
              const duration = driverDurationMinutes(row.events);
              return (
                <button
                  type="button"
                  key={row.job.id}
                  onClick={() => onOpen(row)}
                  className="w-full rounded-2xl border border-[#e6ddd0] bg-white p-3.5 text-left shadow-[0_8px_22px_rgba(74,43,86,0.04)] transition active:scale-[0.995]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-500">{completed ? format(completed.eventTime) : "—"}</p>
                      <h3 className="mt-1 truncate text-base font-black text-slate-950">{row.job.clientName || row.job.jobOrderNumber || "—"}</h3>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" />{th ? "เสร็จ" : "Done"}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-700"><Route className="h-4 w-4 shrink-0 text-brand-600" /><span className="min-w-0 break-words">{row.job.pickupName} → {row.job.dropoffName}</span></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{row.driverName}</span>
                    <span className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" />{row.job.vehicleRegistration || "—"}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{duration === null ? "—" : `${duration} ${th ? "นาที" : "min"}`}</span>
                    <span className="inline-flex items-center justify-end gap-1 font-bold text-brand-700">{th ? "รายละเอียด" : "Details"}<ChevronRight className="h-4 w-4" /></span>
                  </div>
                </button>
              );
            })}
          </div>

          {!data.rows.length ? (
            <p className="p-6 text-center text-sm text-slate-500">
              {filtered
                ? th ? "ไม่มีงานที่เสร็จแล้วตรงกับตัวกรอง" : "No completed jobs match these filters."
                : th ? "ยังไม่มีงานที่เสร็จแล้ว" : "No completed jobs yet."}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-[#ece3d8] bg-[#faf6f0] p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="order-1 text-center text-xs text-slate-500 sm:order-2 sm:text-sm">
              {data.total ? <>{th ? "แสดง" : "Showing"} {data.page * data.pageSize + 1}–{Math.min((data.page + 1) * data.pageSize, data.total)} {th ? "จาก" : "of"} {data.total}<span className="ml-2">· {th ? "หน้า" : "Page"} {data.page + 1}/{Math.max(1, Math.ceil(data.total / data.pageSize))}</span></> : th ? "ไม่มีผลลัพธ์" : "No matching records"}
            </p>
            <div className="order-2 grid grid-cols-2 gap-2 sm:contents">
              <button className="btn-secondary min-h-11 sm:order-1" disabled={data.page === 0 || busy} onClick={() => setPage(data.page - 1)}>{th ? "ก่อนหน้า" : "Previous"}</button>
              <button className="btn-secondary min-h-11 sm:order-3" disabled={!data.hasMore || busy} onClick={() => setPage(data.page + 1)}>{th ? "ถัดไป" : "Next"}</button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
