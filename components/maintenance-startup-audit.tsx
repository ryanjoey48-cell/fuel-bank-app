'use client';

import {useMemo, useState} from 'react';
import type {MaintenanceData} from '@/lib/maintenance-types';
import type {VehicleMaintenanceCheck} from '@/lib/maintenance-office';
import {vehicleBaseline,baselineLabel} from '@/lib/maintenance-baseline';
import {latestVehicleChecks} from '@/lib/maintenance-office';
import {maintenanceDriver, maintenanceToday} from '@/lib/maintenance';
import {maintenanceVehicleType} from '@/lib/maintenance-ux';

/** Read-only onboarding snapshot: never assumes unrecorded work was not performed. */
export function MaintenanceStartupAudit({data, checks, language, vehicleTypeLabels, onVehicle, onInspect}: {
  data: MaintenanceData;
  checks: VehicleMaintenanceCheck[] | null;
  language: 'en' | 'th';
  vehicleTypeLabels: Record<string, string>;
  onVehicle: (id: string) => void;
  onInspect: (id: string, group: string[]) => void;
}) {
  const th = language === 'th';
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [vehicleType,setVehicleType]=useState('');
  const [hideEstablished,setHideEstablished]=useState(false);
  const [filter, setFilter] = useState<'all' | 'noCheck' | 'noRecords' | 'attention' | 'in_progress' | 'established'>('noCheck');
  const entries = useMemo(() => data.vehicles.filter(v => v.active !== false).map(vehicle => {
    const recentChecks = checks === null ? null : latestVehicleChecks(checks, vehicle.id, maintenanceToday());
    const hasCheck = recentChecks === null ? null : [...recentChecks.values()].some(c => c.result !== 'not_checked');
    const hasAttention = recentChecks === null ? null : [...recentChecks.values()].some(c => c.result === 'attention');
    const recordCount = data.records.filter(r => r.vehicle_id === vehicle.id && !r.is_deleted).length;
    return {progress:checks===null?null:vehicleBaseline(data,checks,vehicle.id),vehicle, driver: maintenanceDriver(data, vehicle.id), hasCheck, hasAttention, recordCount};
  }), [data, checks]);
  const filtered = entries.filter(x => {
    const match = `${x.vehicle.vehicle_reg} ${x.driver} ${x.vehicle.vehicle_name ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    return match && (!vehicleType||x.vehicle.vehicle_type===vehicleType)&&(!hideEstablished||x.progress?.state!=='established') && (filter === 'all' || (filter === 'noCheck' && x.progress?.state === 'not_started') || (filter === 'in_progress' && x.progress?.state==='in_progress') || (filter === 'established' && x.progress?.state==='established') || (filter === 'noRecords' && x.recordCount === 0) || (filter === 'attention' && x.hasAttention === true));
  });
  const inspected = entries.filter(x => x.hasCheck === true).length;
  const noHistory = entries.filter(x => x.recordCount === 0).length;
  const withIssue = entries.filter(x => x.hasAttention === true).length;
  return <section className="rounded-2xl border border-violet-100 bg-white p-3 sm:p-4" aria-label={th ? 'ความพร้อมข้อมูลการบำรุงรักษา' : 'Fleet maintenance onboarding'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">{th ? 'เริ่มต้นเก็บข้อมูลจริง' : 'BUILDING THE EES MAINTENANCE BASELINE'}</p>
        <h2 className="mt-1 text-base font-semibold text-slate-950">{th ? 'เริ่มตรวจสภาพรถทั้งฝูง' : 'First inspections & record coverage'}</h2>
        <p className="mt-1 text-xs text-slate-600">{th ? 'ข้อมูลไม่ครบไม่ได้แปลว่ารถเสีย ประวัติที่ไม่เคยบันทึกจะถือว่าไม่ทราบ' : 'This is a new system. Missing records mean history is unknown — not that a vehicle is faulty or overdue.'}</p>
      </div>
      <button type="button" className="btn-secondary" aria-expanded={expanded} onClick={() => setExpanded(s => !s)}>{expanded ? (th ? 'ซ่อนรายชื่อ' : 'Hide onboarding list') : (th ? 'ดูข้อมูลตั้งต้น' : 'Review fleet baseline')} →</button>
    </div>
     {!expanded&&<p className="mt-2 text-xs text-slate-600">{checks===null?(th?'ผลตรวจยังไม่พร้อม':'Inspection coverage unavailable'):(th?`เริ่มตรวจแล้ว ${inspected}/${entries.length} คัน · ยังไม่มีประวัติซ่อม ${noHistory} คัน`:`${inspected}/${entries.length} vehicles have a saved inspection · ${noHistory} have no EES maintenance entries`)}. {th?'ข้อมูลที่ไม่บันทึกถือว่าไม่ทราบ':'Missing history remains unknown.'}</p>}
     {expanded&&<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><p className="text-xs text-slate-600">{th ? 'รถที่ใช้งาน' : 'Active vehicles'}</p><p className="mt-1 text-xl font-semibold tabular-nums">{entries.length}</p></div>
      <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3"><p className="text-xs text-slate-600">{th ? 'ตรวจสภาพแล้ว' : 'Inspection started'}</p><p className="mt-1 text-xl font-semibold tabular-nums">{checks === null ? '—' : `${inspected}/${entries.length}`}</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><p className="text-xs text-slate-600">{th ? 'ยังไม่มีประวัติซ่อมใน EES' : 'No EES maintenance entries'}</p><p className="mt-1 text-xl font-semibold tabular-nums">{noHistory}</p></div>
      <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3"><p className="text-xs text-slate-600">{th ? 'พบปัญหาจากการตรวจ' : 'Saved inspection issues'}</p><p className="mt-1 text-xl font-semibold tabular-nums">{checks === null ? '—' : withIssue}</p></div>
    </div>}
     {expanded&&<p className="mt-2 text-xs text-violet-800">{checks===null?'—':entries.filter(x=>x.progress?.state==='established').length}/{entries.length} {th?'เก็บข้อมูลตั้งต้นครบแล้ว':'baseline established'} · {th?'ไม่ได้รับรองว่าสภาพรถปกติ':'Coverage does not certify mechanical health'}</p>}
    {checks === null && <p className="mt-2 text-xs text-amber-800" role="status">{th ? 'ข้อมูลผลตรวจยังไม่พร้อม ห้ามสรุปว่าไม่เคยตรวจ' : 'Inspection history is not available yet; do not treat unavailable data as no inspections.'}</p>}
    {expanded && <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap gap-2"><label className="text-xs text-slate-600">{th?'ประเภทรถ':'Vehicle type'}<select className="form-input mt-1" value={vehicleType} onChange={e=>setVehicleType(e.target.value)}><option value="">{th?'ทุกประเภท':'All types'}</option>{['FOUR_WHEEL_TRUCK','SIX_WHEEL_TRUCK','SIX_PLUS_SIX_WHEELER','EIGHTEEN_WHEELER'].map(type=><option key={type} value={type}>{maintenanceVehicleType(type,vehicleTypeLabels)}</option>)}</select></label><label className="flex items-center gap-2 text-xs"><input className="!h-4 !w-4" type="checkbox" checked={hideEstablished} onChange={e=>setHideEstablished(e.target.checked)}/>{th?'ซ่อนรถที่เก็บข้อมูลครบแล้ว':'Hide established baselines'}</label>
        <label className="min-w-[180px] flex-1 text-xs text-slate-600">{th ? 'ค้นหาทะเบียนหรือคนขับ' : 'Find vehicle or driver'}<input className="form-input mt-1" value={search} onChange={e => setSearch(e.target.value)} placeholder={th ? 'ทะเบียน / ชื่อคนขับ' : 'Registration / driver'}/></label>
        <label className="text-xs text-slate-600">{th ? 'แสดงรายการ' : 'Show'}<select className="form-input mt-1" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="noCheck">{th ? 'ยังไม่เริ่มตรวจ' : 'No saved inspection'}</option><option value="in_progress">{th?'กำลังดำเนินการ':'In progress'}</option><option value="established">{th?'เก็บข้อมูลตั้งต้นครบแล้ว':'Baseline established'}</option><option value="noRecords">{th ? 'ไม่มีประวัติใน EES' : 'No maintenance entries'}</option><option value="attention">{th ? 'พบปัญหา' : 'Inspection issues'}</option><option value="all">{th ? 'ทุกคัน' : 'All vehicles'}</option></select></label>
      </div>
      <p className="text-xs text-slate-500">{filtered.length} {th ? 'คันที่ตรงกับตัวกรอง' : 'matching vehicles'}</p>
      <div className="max-h-[430px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
        {filtered.map(x => <div key={x.vehicle.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0"><strong className="block text-sm text-slate-900">{x.vehicle.vehicle_reg}</strong><p className="text-xs text-slate-500">{x.driver || (th ? 'ยังไม่ระบุคนขับ' : 'Unassigned')} · {maintenanceVehicleType(x.vehicle.vehicle_type, vehicleTypeLabels)}</p><p className="mt-1 text-xs text-slate-500">{x.recordCount} {th ? 'บันทึกการซ่อมใน EES' : 'EES maintenance entries'} · {x.progress ? baselineLabel(x.progress.state,language)+' · '+x.progress.assessed+'/'+x.progress.total+(x.progress.latestDate?' · '+x.progress.latestDate:'') : x.hasCheck === null ? (th ? 'โหลดผลตรวจไม่สำเร็จ' : 'Checks unavailable') : x.hasCheck ? (th ? 'เริ่มตรวจแล้ว' : 'Inspection started') : (th ? 'ยังไม่มีผลตรวจที่บันทึก' : 'No saved inspection')}</p></div>
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => onVehicle(x.vehicle.id)}>{th ? 'ดูประวัติ' : 'Profile'}</button><button type="button" className="btn-primary" onClick={() => onInspect(x.vehicle.id,filtered.map(entry=>entry.vehicle.id))}>{th ? 'ตรวจสภาพ' : 'Start check'}</button></div>
        </div>)}
        {filtered.length === 0 && <p className="p-4 text-sm text-slate-500">{th ? 'ไม่พบรถที่ตรงกัน' : 'No vehicles match these filters.'}</p>}
      </div>
      <p className="text-xs text-slate-500">{th ? 'เริ่มจากตรวจสภาพจริง ห้ามบันทึกวันที่เปลี่ยนอะไหล่หากไม่มีหลักฐาน' : 'Record actual inspection findings first. Do not invent past replacement dates or reset intervals from an inspection.'}</p>
    </div>}
  </section>;
}
