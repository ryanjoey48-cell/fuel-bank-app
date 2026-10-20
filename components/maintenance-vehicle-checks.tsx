'use client';
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {useLanguage} from '@/lib/language-provider';
import {useAccountAccess} from '@/lib/use-account-access';
import {maintenanceOfficeCopy} from '@/lib/maintenance-office-copy';
import {latestVehicleChecks,vehicleCheckCatalogue,type VehicleCheckInput,type VehicleMaintenanceCheck,type VehicleCheckResult} from '@/lib/maintenance-office';
import {saveVehicleMaintenanceChecks} from '@/lib/maintenance-checks-data';
import {buildServiceSchedule,scheduleEvents} from '@/lib/preventative-maintenance';
import {maintenanceDriver,maintenanceToday,reliableMaintenanceMileage,validMaintenanceDate} from '@/lib/maintenance';
import {formatDate,formatNumber} from '@/lib/utils';
import {vehicleBaseline,baselineLabel} from '@/lib/maintenance-baseline';
import {maintenanceComponentCategory} from '@/lib/maintenance-components';
import {maintenanceVehicleType} from '@/lib/maintenance-ux';
import type {MaintenanceData,MaintenanceRecord} from '@/lib/maintenance-types';
import type {OilChangeAlertRow} from '@/lib/operations';


type InspectionDraft=VehicleCheckInput & {check_date:string;odometer:number|null};
export function MaintenanceVehicleChecks({data,vehicleId,checks,oil,ready,scheduleReady,focusKey='',onSaved,onEdit,onChanged,onDirty,onReturn}:{data:MaintenanceData;vehicleId:string;checks:VehicleMaintenanceCheck[]|null;oil:OilChangeAlertRow|null;ready:boolean;scheduleReady:boolean;focusKey?:string;onSaved:(events:VehicleMaintenanceCheck[])=>void;onEdit:(r:MaintenanceRecord)=>void;onChanged:()=>void;onDirty:(dirty:boolean)=>void;onReturn?:()=>void}){
 const {language,t}=useLanguage(),c=maintenanceOfficeCopy[language],{can}=useAccountAccess();
 const vehicle=data.vehicles.find(v=>v.id===vehicleId),saved=useMemo(()=>latestVehicleChecks(checks??[],vehicleId),[checks,vehicleId]);
 const returnAfterSave=useRef(false);
 const [draft,setDraft]=useState<Record<string,InspectionDraft>>({}),[checkDate,setCheckDate]=useState(maintenanceToday),[custom,setCustom]=useState(''),[newItems,setNewItems]=useState<{key:string;en:string;th:string;group:string}[]>([]);
 const [viewFilter,setViewFilter]=useState<'all'|'attention'|'not_checked'>('all'),[itemSearch,setItemSearch]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),lock=useRef(false),request=useRef<{id:string;body:string}|null>(null);
 const rows=useMemo(()=>[...vehicleCheckCatalogue(data,checks??[],vehicleId),...newItems.filter(n=>!vehicleCheckCatalogue(data,checks??[],vehicleId).some(r=>r.key===n.key))],[data,checks,vehicleId,newItems]);
 const progress=vehicleBaseline(data,checks??[],vehicleId);
 const focusedName=rows.find(item=>item.key===focusKey);
 const effectiveSearch=itemSearch !== null ? itemSearch : (focusKey ? (language==='th'?focusedName?.th:focusedName?.en) ?? focusKey.replaceAll('_',' ') : '');
 const mileage=reliableMaintenanceMileage(data.mileage,vehicleId),ownRecords=data.records.filter(r=>r.vehicle_id===vehicleId&&!r.is_deleted&&r.service_date<=maintenanceToday()).sort((a,b)=>b.service_date.localeCompare(a.service_date));
 const baseline=oil?.lastOilChangeDate?{date:oil.lastOilChangeDate,odometer:oil.lastOilChangeOdometer,recordId:null,itemId:null}:null;
 const schedules=buildServiceSchedule({...data,checks:checks??[]},vehicleId,baseline);
 const dirty=Object.keys(draft).length>0;
  const matchingRows=rows.filter(item=>{
    const state=draft[item.key]?.result??saved.get(item.key)?.result??'not_checked';
    const needle=effectiveSearch.trim().toLocaleLowerCase();
    return (viewFilter==='all'||state===viewFilter)&&(!needle||[item.en,item.th,item.key].some(v=>v.toLocaleLowerCase().includes(needle)));
  });
  const attentionCount=rows.filter(item=>(draft[item.key]?.result??saved.get(item.key)?.result??'not_checked')==='attention').length;
 useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 const change=(key:string,name:string,patch:Partial<InspectionDraft>)=>{const old=saved.get(key);setDraft(d=>{const base:InspectionDraft={check_date:old?.check_date??checkDate,odometer:old?.odometer??null,service_key:key,item_name:name,result:old?.result??'not_checked',notes:old?.notes??null,maintenance_record_id:old?.maintenance_record_id??null};const next={...base,...d[key],...patch},updated={...d,[key]:next};if((old||!key.startsWith('custom:'))&&next.result===base.result&&next.notes===base.notes&&next.maintenance_record_id===base.maintenance_record_id&&next.check_date===base.check_date&&next.odometer===base.odometer)delete updated[key];return updated;});setNotice('');};
 async function submit(e:FormEvent){
  e.preventDefault();if(lock.current||!can('business:write')||!ready)return;
  const changed=Object.values(draft);
  if(!changed.length||changed.some(r=>!validMaintenanceDate(r.check_date)||r.check_date>maintenanceToday()||(r.result==='not_applicable'&&!r.notes?.trim())||(r.odometer!==null&&(!Number.isFinite(r.odometer)||r.odometer<0)))){setNotice(language==='th'?'ตรวจสอบวันที่ เลขไมล์ และระบุเหตุผลสำหรับรายการที่ไม่ใช้':'Review component dates and odometers. Not applicable requires a documented reason.');return;}
  lock.current=true;setBusy(true);setNotice('');
  // Each date/odometer group uses the existing atomic, idempotent save RPC.
  // Successful groups are retained if a later group fails; retry only the remainder.
  const groups=new Map<string,InspectionDraft[]>();
  for(const row of changed){const key=JSON.stringify([row.check_date,row.odometer]);groups.set(key,[...(groups.get(key)??[]),row]);}
  try{for(const group of groups.values()){
    const {check_date,odometer}=group[0];
    const rows=group.map(({check_date,odometer,...row})=>row);
    const body=JSON.stringify({vehicleId,check_date,odometer,rows});
    if(request.current?.body!==body)request.current={id:crypto.randomUUID(),body};
    const events=await saveVehicleMaintenanceChecks(vehicleId,check_date,odometer,rows,request.current.id);
    onSaved(events);setDraft(old=>{const next={...old};for(const row of group)delete next[row.service_key];return next;});request.current=null;
  }setNewItems([]);onDirty(false);setNotice(c.saved);if(returnAfterSave.current){onReturn?.();returnAfterSave.current=false;}
  }catch{returnAfterSave.current=false;setNotice(c.saveError);}finally{lock.current=false;setBusy(false);}
 }

 if(!vehicle)return <p>{c.noVehicle}</p>;
 return <div className="space-y-3">
 <details className="surface-card p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">{language==='th'?'ข้อมูลระยะทางและน้ำมันเครื่อง':'Mileage & oil change details'}</summary><div className="mt-3 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-900">{vehicle.vehicle_reg}</h2><p className="mt-1 text-sm text-slate-500">{vehicle.vehicle_name} · {maintenanceVehicleType(vehicle.vehicle_type,t.weeklyMileage.oil.vehicleTypes)}</p><p className="mt-1 text-sm text-slate-500">{maintenanceDriver(data,vehicleId)||t.maintenance.unassigned}</p></div><div className="text-sm"><p className="text-xs text-slate-500">{c.latestOdometer}</p><strong>{mileage.value===null?c.mileageUnavailable:`${formatNumber(mileage.value,language)} km`}</strong>{mileage.date&&<p className="text-xs text-slate-500">{formatDate(mileage.date,language)}</p>}</div></div>
 {oil&&<div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-3"><p><span className="block text-xs text-slate-500">{c.nextOil}</span>{oil.nextOilChangeDueOdometer===null?'—':`${formatNumber(oil.nextOilChangeDueOdometer,language)} km`}</p><p><span className="block text-xs text-slate-500">{c.remaining}</span>{mileage.value===null||oil.kmRemaining===null?'—':`${formatNumber(oil.kmRemaining,language)} km`}</p></div>}
 </details>
 <p className="text-xs text-violet-800">{ready?baselineLabel(progress.state,language)+' · '+progress.assessed+'/'+progress.total:'—'} · {language==='th'?'ความครบถ้วนของข้อมูล ไม่ใช่การรับรองสภาพรถ':'Coverage only; not a mechanical health certificate'}</p>
 <section className="maintenance-checklist surface-card p-3 sm:p-4"><form onSubmit={submit} className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{c.checks}</h3><p className="mt-1 max-w-2xl text-xs text-slate-500">{language==='th'?'ตรวจสภาพรถและบันทึกรายการที่ต้องดูแล':'Check the vehicle’s condition and save any items requiring attention.'}</p></div><details className="text-xs font-medium text-slate-600"><summary className="cursor-pointer py-2">{language==='th'?'วันที่เริ่มต้นสำหรับรายการใหม่':'Default date for new selections'}</summary><input className="form-input mt-1" type="date" min="1900-01-01" max={maintenanceToday()} value={checkDate} disabled={busy||!ready||!can('business:write')} onChange={e=>setCheckDate(e.target.value)}/></details></div>
 <div className="flex flex-wrap gap-2 text-xs" aria-live="polite">{(['ok','attention','not_checked'] as const).map(state=><span key={state} className={`rounded-full border px-2 py-1 ${state==='ok'?'border-emerald-200 bg-emerald-50 text-emerald-800':state==='attention'?'border-amber-200 bg-amber-50 text-amber-900':'border-slate-200 text-slate-600'}`}>{state==='attention'?c.attentionState:state==='ok'?(language==='th'?'ปกติ':'Good'):c[state]}: <strong>{ready?rows.filter(item=>(draft[item.key]?.result??saved.get(item.key)?.result??'not_checked')===state).length:'—'}</strong></span>)}</div>
 <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 sm:flex-row sm:items-center sm:justify-between">
   <div className="flex flex-wrap gap-1.5" role="group" aria-label={language==='th'?'ตัวกรองผลตรวจ':'Filter inspection items'}>
     {(['all','attention','not_checked'] as const).map(value=><button key={value} type="button" aria-pressed={viewFilter===value} onClick={()=>setViewFilter(value)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition ${viewFilter===value?'bg-white text-violet-800 shadow-sm ring-1 ring-violet-100':'text-slate-600 hover:bg-white'}`}>{value==='all'?(language==='th'?'ทั้งหมด':'All items'):value==='attention'?c.attentionState:c.not_checked}{value==='attention'?` (${attentionCount})`:''}</button>)}
   </div>
   <label className="min-w-0 text-xs text-slate-500 sm:w-56"><span className="sr-only">{language==='th'?'ค้นหารายการ':'Search checklist'}</span><input type="search" className="form-input !min-h-9" value={effectiveSearch} onChange={e=>setItemSearch(e.target.value)} placeholder={language==='th'?'ค้นหารายการตรวจ':'Search checklist items'}/></label>
 </div>
 <p className="text-xs text-slate-500">{language==='th'?`แสดง ${matchingRows.length} จาก ${rows.length} รายการ · การตรวจเช็คไม่ใช่การเปลี่ยนอะไหล่`:`Showing ${matchingRows.length} of ${rows.length} items · Inspections do not reset replacement intervals`}</p>
 {!ready&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{c.checkUnavailable}</p>}
 {notice&&<p role={notice===c.saved?'status':'alert'} className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">{notice}</p>}
 {!can('business:write')&&<p className="text-sm text-slate-500">{c.readOnly}</p>}
 {MAINTENANCE_CHECK_SECTIONS.filter(group=>matchingRows.some(r=>maintenanceCheckSection(r)===group)).map(group=><details key={group} open={true} className="maintenance-check-group rounded-xl border border-slate-200 bg-white px-3 py-2.5"><summary className="cursor-pointer text-sm font-semibold text-slate-900">{SECTION_INFO[group].emoji} {language==='th'?SECTION_INFO[group].th:SECTION_INFO[group].en} <span className="ml-2 text-xs font-normal text-slate-500">({matchingRows.filter(r=>maintenanceCheckSection(r)===group).length})</span></summary><div className="mt-2 divide-y divide-slate-100">{matchingRows.filter(r=>maintenanceCheckSection(r)===group).map(item=>{
 const name=language==='en'?item.en:item.th,last=saved.get(item.key),input=draft[item.key],result=input?.result??last?.result??'not_checked';const events=scheduleEvents(data,vehicleId,item.key),replacement=events.find(e=>e.item.service_action===(['engine_oil','coolant','brake_fluid','transmission_oil','power_steering_fluid'].includes(item.key)?'fluid_replacement':'component_replacement')),latestWork=events[0];const ownSchedules=schedules.filter(s=>s.schedule.service_key===item.key);
 return <article key={item.key} data-check-item={item.key} className="maintenance-check-row bg-white px-1.5 py-2.5 transition hover:bg-slate-50/70"><div className="space-y-2"><div><h5 className="text-sm font-medium text-slate-800"><span aria-hidden="true" className="mr-1.5">{checkEmoji[item.key]??'🔧'}</span>{name}</h5>{input&&<span className="text-[11px] font-semibold text-violet-700">{language==='th'?'ยังไม่บันทึก':'Unsaved selection'}</span>}<p className="mt-0.5 text-[11px] text-slate-500">{last?`${c.lastChecked}: ${formatDate(last.check_date,language)} · ${last.result==='attention'?c.attentionState:c[last.result]}`:language==='th'?'ยังไม่ได้ตรวจ':'Not yet inspected'}</p>{(item.key==='engine_oil'?oil?.lastOilChangeDate:replacement?.record.service_date)&&<div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/50 px-2.5 py-2 text-xs" aria-label={language==='th'?'ข้อมูลการเปลี่ยนล่าสุด':'Latest confirmed replacement'}>
   <p className="font-semibold text-violet-900">{c.lastReplacement}: {formatDate((item.key==='engine_oil'?oil?.lastOilChangeDate:replacement?.record.service_date)!,language)}</p>
   {replacement&&<p className="mt-1 text-slate-700">{language==='th'?'อู่ / ผู้ให้บริการ':'Garage / supplier'}: {replacement.record.garage?.trim()||'—'}{replacement.record.odometer!=null?` · ${formatNumber(replacement.record.odometer,language)} km`:''}</p>}
   {replacement&&<p className="mt-1 text-slate-700">{language==='th'?'งานที่บันทึก':'Recorded work'}: {replacement.item.description}</p>}
  {replacement?.record.receipt_reference&&<p className="mt-1 text-slate-600">{language==='th'?'เลขที่ใบเสร็จ':'Receipt'}: {replacement.record.receipt_reference}</p>}
  {replacement&&<p className="mt-1 text-[11px] text-slate-500">{language==='th'?'อ้างอิงจากประวัติซ่อมที่ยืนยันแล้ว — ไม่ใช่ผลตรวจสภาพ':'From confirmed replacement history — not an inspection result'}</p>}
  </div>}{latestWork&&!replacement&&<div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
  <p className="font-semibold text-slate-800">{language==='th'?'งานซ่อมล่าสุดที่ยืนยันแล้ว':'Latest confirmed linked work'}: {formatDate(latestWork.record.service_date,language)}</p>
  <p className="mt-1 text-slate-700">{latestWork.item.description} · {language==='th'?'อู่':'Garage'}: {latestWork.record.garage||'—'}</p>
  <p className="mt-1 text-slate-500">{language==='th'?'ไม่ถือเป็นการเปลี่ยนอะไหล่หรือผลการตรวจ':'Does not count as replacement or inspection'}</p>
</div>}</div><details className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
 <summary className="cursor-pointer text-xs font-semibold text-violet-700">{language==='th'?'บันทึกผลตรวจ (ไม่บังคับ)':'Optional inspection — record a check'}</summary>
 <p className="mt-2 text-xs text-slate-500">{language==='th'?'บันทึกเฉพาะเมื่อมีการตรวจจริง การซ่อมหรือเปลี่ยนอะไหล่ไม่ใช่ผลตรวจ':'Record only an actual inspection. A repair or replacement is not itself an inspection.'}</p><select className={`form-input !w-auto !max-w-[160px] !min-h-9 !py-1 !px-2 text-sm ${result==='attention'?'!border-amber-300 !bg-amber-50 !text-amber-900':result==='ok'?'!border-emerald-200 !bg-emerald-50 !text-emerald-800':'!text-slate-600'}`} aria-label={`${name} — ${c.result}`} value={result} disabled={busy||!ready||!can('business:write')} onChange={e=>change(item.key,name,{result:e.target.value as VehicleCheckResult})}>{(['not_checked','ok','attention','not_applicable'] as const).map(value=><option key={value} value={value}>{value==='attention'?c.attentionState:value==='ok'?(language==='th'?'ปกติ':'Good'):c[value]}</option>)}</select>
 <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><label>{c.checkDate}<input aria-label={name+' — '+c.checkDate} type="date" min="1900-01-01" max={maintenanceToday()} className="ml-2 rounded border border-slate-200 px-1 py-1" value={input?.check_date??last?.check_date??checkDate} disabled={busy||!ready||!can('business:write')} onChange={e=>change(item.key,name,{check_date:e.target.value})}/></label>{['spark_plugs','timing_belt','timing_chain'].includes(item.key)&&(!last||last.result==='not_checked')&&<span>{language==='th'?'ต้องยืนยันการใช้งาน':'Needs applicability review'}</span>}</div>
 <details className="mt-1 text-xs"><summary className="inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 font-semibold text-violet-700 hover:bg-violet-50">{c.details}</summary><div className="mt-2 space-y-3"><label>{language==='th'?'เลขไมล์ที่อ่านจริงขณะตรวจ (ไม่บังคับ)':'Actual inspection odometer (optional)'}<input aria-label={`${name} — inspection odometer`} type="number" min="0" max="9999999999.99" className="form-input mt-1" value={(input?input.odometer:last?.odometer)??''} disabled={busy||!ready||!can('business:write')} onChange={e=>change(item.key,name,{odometer:e.target.value===''?null:Number(e.target.value)})}/></label><p className="text-slate-500">{c.lastReplacement}: {item.key==='engine_oil'&&oil?`${oil.lastOilChangeDate?formatDate(oil.lastOilChangeDate,language):'—'} · ${oil.lastOilChangeOdometer??'—'} km`:replacement?`${formatDate(replacement.record.service_date,language)} · ${replacement.record.odometer??'—'} km`:'—'}</p><div className="grid gap-3 sm:grid-cols-2"><label>{c.notes}<textarea className="form-input mt-1" rows={2} maxLength={2000} value={(input?input.notes:last?.notes)??''} disabled={busy||!ready||!can('business:write')} onChange={e=>change(item.key,name,{notes:e.target.value||null})}/></label><label>{c.related}<select className="form-input mt-1" aria-label={`${name} — ${c.related}`} value={(input?input.maintenance_record_id:last?.maintenance_record_id)??''} disabled={busy||!ready||!can('business:write')} onChange={e=>change(item.key,name,{maintenance_record_id:e.target.value||null})}><option value="">{c.none}</option>{ownRecords.filter(r=>r.service_date<=checkDate).map(r=><option key={r.id} value={r.id}>{formatDate(r.service_date,language)} · {r.garage??c.noDescription}</option>)}</select></label></div>
 <details><summary className="cursor-pointer text-violet-700">{c.history}</summary>{(checks??[]).filter(x=>x.vehicle_id===vehicleId&&x.service_key===item.key).sort((a,b)=>b.check_date.localeCompare(a.check_date)||b.created_at.localeCompare(a.created_at)).map(x=><p key={x.id} className="mt-2 border-l-2 border-violet-100 pl-2 text-slate-600">{formatDate(x.check_date,language)} · {x.checked_by_name} · {x.result==='attention'?c.attentionState:c[x.result]}{x.notes?` · ${x.notes}`:''}</p>)}{!last&&<p>{c.noChecks}</p>}</details>
 {ownSchedules.filter(s=>s.status==='overdue'||s.status==='dueSoon').map(s=><p key={s.schedule.id} className="text-amber-800">{c.due} · {s.schedule.schedule_kind==='inspection'?c.inspection:c.replacement} · {s.dueDate?formatDate(s.dueDate,language):'—'} · {s.dueKm??'—'} km</p>)}
 </div></details>
 </details>
 </div>
 </article>;
 })}</div></details>)}
 <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-violet-700">{language==='th'?'เพิ่มรายการตรวจเช็คอื่น':'Add another check item'}</summary><fieldset disabled={busy||!ready||!can('business:write')} className="flex flex-wrap items-end gap-2"><label className="grow text-xs text-slate-600">{c.customName}<input className="form-input mt-1" maxLength={200} value={custom} onChange={e=>setCustom(e.target.value)}/></label><button className="btn-secondary" type="button" disabled={!custom.trim()} onClick={()=>{const key=`custom:${crypto.randomUUID()}`,name=custom.trim();setNewItems(n=>[...n,{key,en:name,th:name,group:'custom'}]);change(key,name,{result:'not_checked'});setCustom('');}}>{c.addCustom}</button></fieldset></details>
 {onReturn&&<button type="submit" className="btn-secondary" disabled={busy||!ready||!dirty||!can('business:write')} onClick={()=>{returnAfterSave.current=true;}}>{language==='th'?'บันทึกและกลับรายการ':'Save and return to list'}</button>}
 <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white/95 p-3 shadow-[0_-5px_22px_rgba(31,27,61,0.07)] backdrop-blur">
  <p className="text-xs font-medium text-slate-600">{dirty?`${Object.keys(draft).length} ${language==='th'?'รายการที่ยังไม่บันทึก':'unsaved item(s)'}`:(language==='th'?'บันทึกแล้ว ไม่มีการเปลี่ยนแปลง':'No unsaved changes')}</p>
  <button className="btn-primary" type="submit" disabled={busy||!ready||!can('business:write')||!Object.keys(draft).length}>{busy?t.common.saving:c.saveChecks}</button>
 </div>
 </form></section>

 </div>;
}

// UI-only categories. Do not change catalogue service keys, stored groups, or inspection history.
type MaintenanceCheckSection = 'engine' | 'cooling' | 'brakes' | 'electrical' | 'mechanical' | 'custom';
function maintenanceCheckSection(item:{key:string;group:string}): MaintenanceCheckSection {
 return maintenanceComponentCategory(item.key,item.group==='custom');
}
const MAINTENANCE_CHECK_SECTIONS:MaintenanceCheckSection[]=['engine','cooling','brakes','electrical','mechanical','custom'];
const SECTION_INFO:Record<MaintenanceCheckSection,{en:string;th:string;emoji:string}>={
 engine:{en:'Engine & filters',th:'เครื่องยนต์และไส้กรอง',emoji:'🛢️'},
 cooling:{en:'Cooling system',th:'ระบบหล่อเย็น',emoji:'💧'},
 brakes:{en:'Brakes & wheels',th:'เบรกและล้อ',emoji:'🛞'},
 electrical:{en:'Electrical',th:'ระบบไฟฟ้า',emoji:'🔋'},
 mechanical:{en:'Mechanical',th:'ระบบกลไก',emoji:'⚙️'},
 custom:{en:'Other inspection items',th:'รายการตรวจเพิ่มเติม',emoji:'➕'}
};

const checkEmoji:Record<string,string>={engine_oil:'🛢️',coolant:'💧',radiator:'🔧',brake_fluid:'🛑',transmission_oil:'⚙️',power_steering_fluid:'🔧',battery:'🔋',oil_filter:'🛢️',air_filter:'🌬️',fuel_filter:'⛽',tyres:'🛞',brake_pads:'🛑',brake_discs:'⚙️',spark_plugs:'⚡',timing_belt:'🔧',timing_chain:'⚙️',shock_absorbers:'🚚'};
