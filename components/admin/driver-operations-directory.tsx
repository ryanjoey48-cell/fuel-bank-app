"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken, type ManagedDriverAccount, type ManagedDriverAccountResult } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { useModalScrollLock } from "@/lib/use-modal-scroll-lock";
import { statusCopy, type OperationsDriverDetail, type OperationsResult, type OperationsRow } from "@/lib/driver-operations";

export function DriverOperationsDirectory({ operations, onOpenJob }: { operations: OperationsResult | null; onOpenJob: (row: OperationsRow) => void }) {
  const { language } = useLanguage(); const th = language === "th";
  const [drivers, setDrivers] = useState<ManagedDriverAccount[] | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<ManagedDriverAccount | null>(null); const [detail, setDetail] = useState<OperationsDriverDetail | null>(null); const [detailError, setDetailError] = useState(false); const [detailBusy, setDetailBusy] = useState(false);
  const listRequest = useRef(0), detailRequest = useRef(0);
  useModalScrollLock(selected !== null);
  const load = useCallback(async () => {
    const id = ++listRequest.current; setLoading(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/driver-accounts?_=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error(`Directory request failed (${response.status})`);
      const payload = await response.json() as ManagedDriverAccountResult;
      if (!Array.isArray(payload.drivers)) throw new Error("Invalid directory response");
      if (id === listRequest.current) { setDrivers(payload.drivers); setError(false); }
    } catch (failure) { if (id === listRequest.current) { console.error("Driver directory refresh failed", failure); setError(true); } }
    finally { if (id === listRequest.current) setLoading(false); }
  }, []);
  useEffect(() => { const counter = listRequest; void load(); return () => { counter.current++; }; }, [load, operations?.fetchedAt]);
  const open = async (driver: ManagedDriverAccount) => {
    const id = ++detailRequest.current; setSelected(driver); setDetail(null); setDetailError(false); setDetailBusy(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/driver-operations/drivers/${encodeURIComponent(driver.driverId)}?_=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error(`Driver detail failed (${response.status})`);
      const payload = await response.json() as OperationsDriverDetail;
      if (!payload.stats || !Object.values(payload.stats).every(value => Number.isInteger(value) && value >= 0)) throw new Error("Invalid driver statistics");
      if (id === detailRequest.current) setDetail(payload);
    } catch (failure) { if (id === detailRequest.current) { console.error("Driver detail refresh failed", failure); setDetailError(true); } }
    finally { if (id === detailRequest.current) setDetailBusy(false); }
  };
  const close = () => { detailRequest.current++; setSelected(null); setDetail(null); };
  const openAssigned = async (bookingId: string) => {
    const id = ++detailRequest.current;
    setDetailBusy(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/driver-operations/jobs/${encodeURIComponent(bookingId)}?_=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error("Job detail unavailable");
      const row = await response.json() as OperationsRow; if (id !== detailRequest.current) return; close(); onOpenJob(row);
    } catch (failure) { if (id === detailRequest.current) { console.error("Assigned job detail failed", failure); setDetailError(true); } }
    finally { setDetailBusy(false); }
  };
  const active = (driver: ManagedDriverAccount) => !!driver.accountId && driver.accountActive === true && driver.driverActive;
  const query = search.trim().toLowerCase();
  const visible = (drivers || []).filter(driver => (!query || [driver.name, driver.driverId, driver.email, driver.vehicleRegistration].some(value => value?.toLowerCase().includes(query))) && (filter === "all" || (filter === "active" ? active(driver) : filter === "none" ? !driver.accountId : !!driver.accountId && !active(driver))));
  const format = (value: string | null) => value ? new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
  const stats = (driver: ManagedDriverAccount) => {
    if (!operations) return { jobs: "—", status: "—" };
    const activity = operations.driverActivity[driver.driverId];
    return { jobs: activity?.jobsToday ?? 0, status: activity?.status ? statusCopy[language][activity.status] : th ? "ไม่มีงานที่กำลังดำเนินการ" : "No active job" };
  };
  return <section className="driver-directory overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 p-4 sm:p-6">
      <div><h2 className="text-xl font-black">{th ? "รายชื่อคนขับ" : "Driver Directory"}</h2><p className="mt-1 text-sm text-slate-500">{drivers ? `${drivers.length} ${th ? 'คนขับ' : 'drivers'}` : th ? 'กำลังโหลดคนขับ…' : 'Loading drivers…'}</p></div>
      <div className="flex flex-wrap gap-2"><input aria-label={th ? 'ค้นหาคนขับ' : 'Search drivers'} className="form-input w-64" value={search} onChange={e=>setSearch(e.target.value)} placeholder={th ? 'ชื่อ รหัส รถ อีเมล' : 'Name, ID, vehicle or email'}/><button disabled={loading} className="btn-secondary" onClick={()=>void load()}>{th ? 'รีเฟรชรายชื่อ' : 'Refresh directory'}</button></div>
      <div className="flex w-full flex-wrap gap-2">{[['all',th?'ทั้งหมด':'All'],['active',th?'บัญชีใช้งาน':'Portal active'],['none',th?'ไม่มีบัญชี':'No account'],['inactive',th?'ไม่ใช้งาน':'Inactive']].map(([value,label])=><button type="button" className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${filter===value?'border-brand-300 bg-brand-50 text-brand-800':'border-slate-200 text-slate-600'}`} aria-pressed={filter===value} onClick={()=>setFilter(value)} key={value}>{label}</button>)}</div>
    </div>
    {error ? <div role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{th?'โหลดรายชื่อไม่ได้ ข้อมูลเดิมยังคงแสดงอยู่':'Unable to load drivers. Previous successful data is retained.'}<button className="ml-3 min-h-11 font-bold underline" onClick={()=>void load()}>{th?'ลองอีกครั้ง':'Retry'}</button></div> : null}
    {loading && !drivers ? <div role="status" className="animate-pulse space-y-2 p-5">{[1,2,3].map(i=><div key={i} className="h-12 rounded-lg bg-slate-100"/>)}</div> : drivers ? <>
      <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-sm"><thead className="bg-slate-50"><tr>{[th?'คนขับ / รหัส':'Driver / ID',th?'รถปัจจุบัน':'Current vehicle',th?'สิทธิ์พอร์ทัล':'Portal access',th?'อีเมล':'Email',th?'เข้าสู่ระบบล่าสุด':'Last login',th?'งานวันนี้':'Jobs today',th?'สถานะปัจจุบัน':'Current status'].map(label=><th key={label} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{label}</th>)}</tr></thead><tbody>{visible.map(driver=>{const activity=stats(driver);return <tr key={driver.driverId} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={()=>void open(driver)}><td className="px-4 py-3"><button type="button" className="min-h-11 text-left font-bold text-slate-950">{driver.name}<span className="mt-1 block text-xs font-normal text-slate-500">ID {driver.driverId}</span></button></td><td className="px-4 py-3">{driver.vehicleRegistration||'—'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${active(driver)?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{!driver.accountId?th?'ไม่มีบัญชี':'No account':active(driver)?th?'ใช้งาน':'Active':th?'ไม่ใช้งาน':'Inactive'}</span></td><td className="px-4 py-3 text-xs">{driver.email||'—'}</td><td className="px-4 py-3 text-xs">{format(driver.lastSignInAt)}</td><td className="px-4 py-3 font-semibold">{activity.jobs}</td><td className="px-4 py-3 text-xs">{activity.status}</td></tr>})}</tbody></table></div>
      {!visible.length ? <p className="p-6 text-center text-sm text-slate-500">{search||filter!=='all'?th?'ไม่มีคนขับตรงกับตัวกรอง':'No drivers match these filters.':th?'ยังไม่มีข้อมูลคนขับ':'No drivers yet.'}</p> : null}
    </> : null}
    {selected ? <div className="fixed inset-0 z-[90] flex justify-end bg-slate-950/40" onClick={close}><aside role="dialog" aria-modal="true" aria-label={th?'รายละเอียดคนขับ':'Driver detail'} className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="text-xl font-black">{selected.name}</h2><p className="mt-1 text-sm text-slate-500">ID {selected.driverId}</p></div><button aria-label={th?'ปิด':'Close driver detail'} className="btn-secondary" onClick={close}>×</button></div><div className="space-y-5 p-5">
      {detailBusy ? <p role="status" className="animate-pulse text-sm text-slate-500">{th?'กำลังโหลด…':'Loading driver details…'}</p> : null}
      {detailError ? <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{th?'โหลดรายละเอียดไม่ได้':'Unable to load driver detail.'}<button className="ml-3 min-h-11 font-bold underline" onClick={()=>void open(selected)}>{th?'ลองอีกครั้ง':'Retry'}</button></div> : null}
      {detail ? <><dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4">{[[th?'สิทธิ์พอร์ทัล':'Portal access',detail.portalActive===null?th?'ไม่มีบัญชี':'No account':detail.portalActive?th?'ใช้งาน':'Active':th?'ไม่ใช้งาน':'Inactive'],[th?'รถปัจจุบัน':'Current vehicle',detail.currentVehicle||'—'],[th?'เข้าสู่ระบบล่าสุด':'Last login',format(detail.profile?.lastLogin||null)],[th?'ชื่อที่แสดง':'Display name',detail.profile?.displayName||detail.driverName],[th?'อีเมล':'Email',detail.profile?.email||'—'],[th?'โทรศัพท์':'Phone',detail.profile?.phone||'—']].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold">{value}</dd></div>)}</dl><div className="grid grid-cols-2 gap-3">{[[th?'งานวันนี้':'Jobs today',detail.stats.jobsToday],[th?'กำลังดำเนินการ':'Active now',detail.stats.activeNow],[th?'เสร็จวันนี้':'Completed today',detail.stats.completedToday],[th?'เสร็จใน 7 วันที่ผ่านมา':'Completed last 7 days',detail.stats.completedLast7Days],[th?'เสร็จทั้งหมด':'Total completed',detail.stats.totalCompleted]].map(([label,value])=><div className="rounded-xl border border-slate-200 p-3" key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>)}</div>
        <section><h3 className="font-bold">{th?'งานที่เสร็จล่าสุด':'Recent completed jobs'}</h3>{detail.recentCompleted.length?detail.recentCompleted.map(row=><button type="button" className="mt-2 block min-h-12 w-full rounded-xl bg-slate-50 p-3 text-left text-sm hover:bg-brand-50" key={row.job.id} onClick={()=>{close();onOpenJob(row)}}><span className="font-semibold">{row.job.clientName||row.job.jobOrderNumber||'—'}</span><span className="mt-1 block text-xs text-slate-500">{row.job.pickupName} → {row.job.dropoffName} · {row.job.vehicleRegistration||'—'}</span></button>):<p className="mt-2 text-sm text-slate-500">{th?'ยังไม่มีงานที่เสร็จแล้ว':'No completed jobs yet.'}</p>}</section>
        <section><h3 className="font-bold">{th?'งานที่มอบหมายถัดไป':'Next assigned jobs'}</h3>{detail.recentAssigned.length?detail.recentAssigned.map(job=><button type="button" disabled={detailBusy} className="mt-2 block min-h-12 w-full rounded-xl bg-slate-50 p-3 text-left text-sm hover:bg-brand-50" key={job.id} onClick={()=>void openAssigned(job.id)}><span className="font-semibold">{job.clientName||job.jobOrderNumber||'—'}</span><span className="mt-1 block text-xs text-slate-500">{job.pickupName} → {job.dropoffName} · {job.bookingDate} · {job.pickupTime?.slice(0,5)|| (th?'ยังไม่กำหนดเวลา':'Time not set')}</span></button>):<p className="mt-2 text-sm text-slate-500">{th?'ไม่มีงานที่มอบหมายค้างอยู่':'No outstanding assigned jobs.'}</p>}</section>
      </> : null}
    </div></aside></div> : null}
  </section>;
}
