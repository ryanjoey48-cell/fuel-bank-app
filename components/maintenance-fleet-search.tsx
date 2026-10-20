'use client';

import {useMemo,useState} from 'react';
import {oilStatusLabel} from '@/lib/oil-service-labels';
import {maintenanceVehicleType} from '@/lib/maintenance-ux';
import {Search,Truck,Wrench,ArrowRight,Droplets,X} from 'lucide-react';
import {useLanguage} from '@/lib/language-provider';
import {maintenanceDriver} from '@/lib/maintenance';
import type {MaintenanceData,MaintenanceRecord} from '@/lib/maintenance-types';
import type {OilChangeAlertRow} from '@/lib/operations';
import {formatDate} from '@/lib/utils';

type Props = {
  data: MaintenanceData;
  oilRows: OilChangeAlertRow[];
  oilLoading: boolean;
  oilError: boolean;
  onVehicle: (id:string)=>void;
  onRecord: (record:MaintenanceRecord)=>void;
  onOil: (status?:string)=>void;
};

const normalize = (value:unknown) => String(value??'').normalize('NFC').toLocaleLowerCase();

export function MaintenanceFleetSearch({data,oilRows,oilLoading,oilError,onVehicle,onRecord,onOil}:Props){
  const {language,t}=useLanguage();
  const th=language==='th';
  const [query,setQuery]=useState('');
  const term=normalize(query).trim();
  const relevantRecords=useMemo(()=>data.records.filter(record=>!record.is_deleted),[data.records]);
  const matchingVehicles=useMemo(()=>term?data.vehicles.filter(vehicle=>{
    const driver=maintenanceDriver(data,vehicle.id);
    const oil=oilRows.find(row=>row.vehicleId===vehicle.id);
    return [vehicle.vehicle_reg,vehicle.vehicle_name,vehicle.vehicle_type,driver,oil?.status,oil?.reviewReasons.join(' ')].some(value=>normalize(value).includes(term));
  }).slice(0,12):[],[data,oilRows,term]);
  const matchingRecords=useMemo(()=>term?relevantRecords.filter(record=>{
    const vehicle=data.vehicles.find(v=>v.id===record.vehicle_id);
    const itemNames=data.items.filter(item=>item.record_id===record.id).flatMap(item=>[item.description,item.description_th,item.category,item.service_action]);
    return [vehicle?.vehicle_reg,vehicle?.vehicle_name,vehicle?maintenanceDriver(data,vehicle.id):'',record.garage,record.service_date,record.notes,...itemNames].some(value=>normalize(value).includes(term));
  }).sort((a,b)=>b.service_date.localeCompare(a.service_date)).slice(0,20):[],[data,relevantRecords,term]);
  const matchingOil=useMemo(()=>term?oilRows.filter(row=>[row.registration,row.driverName,row.status,'engine oil','oil change',...row.reviewReasons].some(value=>normalize(value).includes(term))).slice(0,12):[],[oilRows,term]);
  const oilNeedsAction=oilRows.filter(row=>['overdue','urgent','due_soon','review_required'].includes(row.status));
  const showResults=term.length>0;
  return <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" aria-label="Fleet maintenance search">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600">{th?'ค้นหาข้อมูลซ่อมบำรุง':'FLEET MAINTENANCE SEARCH'}</p><h2 className="mt-0.5 text-base font-semibold text-slate-950">{th?'ค้นหารถ งานซ่อม และประวัติ':'Find any vehicle, repair or service'}</h2></div>
      <button type="button" onClick={()=>onOil()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50"><Droplets size={15}/>{th?'สถานะน้ำมันเครื่องทั้งหมด':'All oil service statuses'} <ArrowRight size={14}/></button>
    </div>
    <div className="relative mt-3"><Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input type="search" aria-label={th?'ค้นหาข้อมูลซ่อมบำรุง':'Search all maintenance information'} className="form-input !min-h-11 !pl-10 !pr-10" value={query} onChange={e=>setQuery(e.target.value)} placeholder={th?'ทะเบียนรถ คนขับ ชิ้นส่วน อู่ซ่อม หรือเลขที่บันทึก':'Registration, driver, oil, brakes, filter, garage, repair…'}/>{query&&<button type="button" aria-label={th?'ล้างการค้นหา':'Clear search'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={()=>setQuery('')}><X size={16}/></button>}</div>
    {!showResults&&<div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-500">{th?'ลัดไปยัง':'Quick views:'}</span><button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:border-violet-300" onClick={()=>setQuery('oil')}>🛢️ {th?'น้ำมันเครื่อง':'Engine oil'}</button><button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:border-violet-300" onClick={()=>setQuery('brake')}>🛑 {th?'เบรก':'Brakes'}</button><button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:border-violet-300" onClick={()=>setQuery('filter')}>🌬️ {th?'ไส้กรอง':'Filters'}</button><button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:border-violet-300" onClick={()=>onOil('review_required')}>⚠️ {th?'ตรวจสอบประวัติน้ำมัน':'Oil records to review'}{!oilLoading&&!oilError?` (${oilNeedsAction.filter(r=>r.status==='review_required').length})`:''}</button></div>}
    {showResults&&<div className="mt-3 space-y-3" role="region" aria-label="Search results">
      <p className="text-xs text-slate-500">{th?'ผลการค้นหา':'Matches'}: {matchingVehicles.length} {th?'รถ':'vehicles'} · {matchingRecords.length} {th?'งานซ่อม':'maintenance visits'} · {matchingOil.length} {th?'สถานะน้ำมัน':'oil service statuses'} <span className="text-slate-400">({th?'แสดงผลสูงสุดต่อหมวด':'results limited per category'})</span></p>
      {matchingVehicles.length>0&&<div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{th?'รถ':'Vehicles'}</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{matchingVehicles.map(vehicle=><button type="button" key={vehicle.id} onClick={()=>onVehicle(vehicle.id)} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50"><Truck size={17} className="shrink-0 text-violet-600"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{vehicle.vehicle_reg}</strong><span className="block truncate text-xs text-slate-500">{maintenanceDriver(data,vehicle.id)||'—'} · {maintenanceVehicleType(vehicle.vehicle_type,t.weeklyMileage.oil.vehicleTypes)}</span></span><ArrowRight size={15} className="shrink-0 text-slate-400"/></button>)}</div></div>}
      {matchingRecords.length>0&&<div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{th?'ประวัติงานซ่อม':'Maintenance records'}</p><div className="grid gap-2 sm:grid-cols-2">{matchingRecords.map(record=>{const vehicle=data.vehicles.find(v=>v.id===record.vehicle_id);const itemLabels=data.items.filter(item=>item.record_id===record.id).map(item=>language==='th'?item.description_th||item.description:item.description).filter(Boolean);return <button type="button" key={record.id} onClick={()=>onRecord(record)} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50"><Wrench size={17} className="shrink-0 text-violet-600"/><span className="min-w-0 flex-1"><strong className="block text-sm">{vehicle?.vehicle_reg??'—'} · {formatDate(record.service_date,language)}</strong><span className="block truncate text-xs text-slate-500">{itemLabels.join(', ')||record.garage||'—'}</span></span><ArrowRight size={15} className="shrink-0 text-slate-400"/></button>;})}</div></div>}
      {matchingOil.length>0&&!oilLoading&&!oilError&&<div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{th?'สถานะบริการน้ำมันเครื่อง':'Oil service status'}</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{matchingOil.map(row=><button type="button" key={row.registration} onClick={()=>row.vehicleId?onVehicle(row.vehicleId):onOil()} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50"><Droplets size={17} className="shrink-0 text-violet-600"/><span className="min-w-0 flex-1"><strong className="block text-sm">{row.registration}</strong><span className="block truncate text-xs text-slate-500">{oilStatusLabel(row.status,language)} · {row.kmRemaining==null?'—':`${row.kmRemaining.toLocaleString()} km`}</span></span><ArrowRight size={15} className="shrink-0 text-slate-400"/></button>)}</div></div>}
      {!matchingVehicles.length&&!matchingRecords.length&&!matchingOil.length&&<p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{th?'ไม่พบข้อมูลในประวัติที่บันทึกไว้ ไม่ได้แปลว่ายังไม่เคยซ่อม':'No matching recorded history. That does not mean the work was never performed.'}</p>}
    </div>}
    <p className="mt-3 text-[11px] text-slate-400">{th?'แสดงเฉพาะข้อมูลที่บันทึกในระบบ EES เท่านั้น ประวัติที่ไม่มีจะไม่ถือว่าเกินกำหนด':'Search covers records currently saved in EES. Missing service history is not treated as overdue.'}</p>
  </section>;
}
