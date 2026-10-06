"use client";
import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { bangkokOperationalDate, shiftBangkokDate, completedDriverEvent, driverDurationMinutes, type OperationsHistoryResult, type OperationsRow } from "@/lib/driver-operations";

type Preset = "today" | "7" | "30" | "all" | "custom";
function dateRange(preset: Preset) {
  const today = bangkokOperationalDate();
  return preset === "all" ? { from: "", to: "" } : { from: shiftBangkokDate(today, preset === "7" ? -6 : preset === "30" ? -29 : 0), to: today };
}
export function DriverOperationsHistory({ onOpen, refreshKey }: { onOpen: (row: OperationsRow) => void; refreshKey?: string }) {
  const { language } = useLanguage(); const th = language === "th";
  const [preset, setPreset] = useState<Preset>("30");
  const [filters, setFilters] = useState(() => ({ q: "", ...dateRange("30") }));
  const [applied, setApplied] = useState(filters); const [page, setPage] = useState(0); const [revision, setRevision] = useState(0);
  const [data, setData] = useState<OperationsHistoryResult | null>(null); const [error, setError] = useState(false); const [busy, setBusy] = useState(true);
  const [updated, setUpdated] = useState<string | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    try {
      const token = await getAccessToken();
      const query = new URLSearchParams({ ...applied, page: String(page), _: String(Date.now()) });
      const response = await fetch(`/api/admin/driver-operations/history?${query}`, { signal, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error(`History request failed (${response.status})`);
      const payload = await response.json() as OperationsHistoryResult;
      if (!Array.isArray(payload.rows) || !Number.isInteger(payload.total) || payload.total < 0 || !Number.isInteger(payload.pageSize)) throw new Error("Invalid history response");
      if (!signal.aborted) { setData(payload); setUpdated(new Date().toISOString()); setError(false); }
    } catch (failure) { if (!signal.aborted) { console.error("Driver Operations history refresh failed", failure); setError(true); } }
    finally { if (!signal.aborted) setBusy(false); }
  }, [applied, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, refreshKey, revision]);
  useEffect(() => {
    if (preset === "custom") return;
    const range = dateRange(preset);
    if (range.from !== applied.from || range.to !== applied.to) { const next = { ...applied, ...range }; setFilters(next); setApplied(next); setPage(0); }
  }, [refreshKey, preset, applied]);
  const choose = (value: Preset) => { const next = { ...filters, ...dateRange(value) }; setPreset(value); setFilters(next); setApplied(next); setPage(0); };
  const format = (value: string) => new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
  const filtered = !!(applied.q || applied.from || applied.to);
  return <section className="operations-history mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="p-4 sm:p-6">
      <h2 className="text-lg font-black">{th ? "ประวัติงานปฏิบัติการที่เสร็จแล้ว" : "Completed operations history"}</h2>
      <p className="mt-1 text-sm text-slate-500">{th ? "งานที่จบแล้วทั้งหมด รวมวันนี้ เรียงจากล่าสุด" : "All completed driver jobs, including today, newest first"}</p>
      <div className="mt-4 flex flex-wrap gap-2" aria-label={th ? "ช่วงวันที่" : "History date range"}>
        {([['today', th ? 'วันนี้' : 'Today'], ['7', th ? '7 วันที่ผ่านมา' : 'Last 7 days'], ['30', th ? '30 วันที่ผ่านมา' : 'Last 30 days'], ['all', th ? 'ทั้งหมด' : 'All']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={preset === value} onClick={() => choose(value)} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${preset === value ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>{label}</button>)}
      </div>
      <form className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_auto]" onSubmit={e => { e.preventDefault(); setApplied({ ...filters }); setPage(0); setRevision(value => value + 1); }}>
        <label className="col-span-2 text-xs font-bold lg:col-span-1">{th ? "ค้นหา" : "Search"}<input className="form-input mt-1" maxLength={100} value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder={th ? "คนขับ ลูกค้า รถ เส้นทาง เลขงาน" : "Driver, customer, vehicle, route or job reference"}/></label>
        {(['from','to'] as const).map(key => <label key={key} className="text-xs font-bold">{key === 'from' ? th ? 'ตั้งแต่' : 'From' : th ? 'ถึง' : 'To'}<input type="date" className="form-input mt-1" value={filters[key]} onChange={e => { setPreset('custom'); setFilters({ ...filters, [key]: e.target.value }); }}/></label>)}
        <div className="col-span-2 flex gap-2 self-end lg:col-span-1"><button disabled={busy} className="btn-primary min-h-11">{th ? 'ค้นหา / รีเฟรช' : 'Search / refresh'}</button><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => { const next={q:'',from:'',to:''};setPreset('all');setFilters(next);setApplied(next);setPage(0); }}>{th ? 'ล้าง' : 'Clear'}</button></div>
      </form>
      {updated ? <p className="mt-3 text-xs text-slate-500">{th ? 'อัปเดตสำเร็จล่าสุด' : 'Last successful refresh'} · {format(updated)}</p> : null}
      {error ? <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><span>{th ? 'โหลดประวัติไม่ได้ ข้อมูลเดิมยังคงแสดงอยู่' : 'Unable to load history. Previous successful data is retained.'}</span><button className="min-h-11 px-2 font-bold underline" onClick={() => setRevision(value => value + 1)}>{th ? 'ลองอีกครั้ง' : 'Retry'}</button></div> : null}
      {busy ? <div role="status" className="mt-4 animate-pulse space-y-2"><p className="text-sm text-slate-500">{th ? 'กำลังโหลดประวัติ…' : 'Loading history…'}</p>{!data ? [1,2,3].map(i=><div key={i} className="h-12 rounded-lg bg-slate-100"/>) : null}</div> : null}
    </div>
    {data ? <>
      <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50"><tr>{[th?'เสร็จเมื่อ':'Completed',th?'คนขับ':'Driver',th?'ลูกค้า / งาน':'Customer / Job',th?'เส้นทาง':'Route',th?'รถ':'Vehicle',th?'ระยะเวลา':'Duration',th?'สถานะ':'Status'].map(label=><th className="px-4 py-3 text-left text-xs font-bold text-slate-500" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map(row=>{const completed=completedDriverEvent(row.events),duration=driverDurationMinutes(row.events);return <tr className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" key={row.job.id} onClick={()=>onOpen(row)}><td className="px-4 py-3"><button type="button" className="min-h-11 text-left font-semibold text-brand-700 underline-offset-4 hover:underline">{completed?format(completed.eventTime):'—'}</button></td><td className="px-4 py-3"><p className="font-bold">{row.driverName}</p><p className="mt-1 text-xs text-slate-500">ID {row.driverId}</p></td><td className="px-4 py-3"><p className="font-semibold">{row.job.clientName||'—'}</p><p className="mt-1 text-xs text-slate-500">{row.job.jobOrderNumber||'—'}</p></td><td className="px-4 py-3">{row.job.pickupName} → {row.job.dropoffName}</td><td className="px-4 py-3">{row.job.vehicleRegistration||'—'}</td><td className="px-4 py-3">{duration===null?'—':`${duration} ${th?'นาที':'min'}`}</td><td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">{th?'จบงานแล้ว':'Completed'}</span></td></tr>})}</tbody></table></div>
      {!data.rows.length ? <p className="p-6 text-center text-sm text-slate-500">{filtered ? th?'ไม่มีงานที่เสร็จแล้วตรงกับตัวกรอง':'No completed jobs match these filters.' : th?'ยังไม่มีงานที่เสร็จแล้ว':'No completed jobs yet.'}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm"><button className="btn-secondary" disabled={data.page===0||busy} onClick={()=>setPage(data.page-1)}>{th?'ก่อนหน้า':'Previous'}</button><p>{data.total ? <>{th?'แสดง':'Showing'} {data.page*data.pageSize+1}–{Math.min((data.page+1)*data.pageSize,data.total)} {th?'จาก':'of'} {data.total}<span className="ml-3 text-slate-500">{th?'หน้า':'Page'} {data.page+1} {th?'จาก':'of'} {Math.ceil(data.total/data.pageSize)}</span></> : (th?'ไม่มีผลลัพธ์':'No matching records')}</p><button className="btn-secondary" disabled={!data.hasMore||busy} onClick={()=>setPage(data.page+1)}>{th?'ถัดไป':'Next'}</button></div>
    </> : null}
  </section>;
}
