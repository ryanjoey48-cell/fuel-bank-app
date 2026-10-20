'use client';

import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useLanguage} from '@/lib/language-provider';
import {useAccountAccess} from '@/lib/use-account-access';
import {maintenanceDriver} from '@/lib/maintenance';
import {maintenanceVehicleType} from '@/lib/maintenance-ux';
import {SERVICE_CATALOG,type ServiceSchedule} from '@/lib/preventative-maintenance';
import {vehicleCheckCatalogue} from '@/lib/maintenance-office';
import type {MaintenanceData,MaintenanceCategory} from '@/lib/maintenance-types';

type Outcome = {registration:string;ok:boolean;message:string};
type InsuranceIdentity = {vehicle_registration:string;vehicle_make:string|null;vehicle_year:number|null;chassis_number:string|null};
const normalizeReg = (value:string) => value.normalize('NFC').trim().replace(/[\s\-‐‑‒–—−]+/gu,'').toLocaleLowerCase();


export function MaintenanceIntervalBulk({data,onComplete}:{data:MaintenanceData;onComplete:()=>void}){
 const {language,t}=useLanguage(),{can}=useAccountAccess();
 const th=language==='th';
 const active=useMemo(()=>data.vehicles.filter(v=>v.active!==false),[data.vehicles]);
 const types=useMemo(()=>Array.from(new Set(active.map(v=>v.vehicle_type).filter((v):v is string=>!!v))).sort(),[active]);
 const [type,setType]=useState('');
 const [selected,setSelected]=useState<string[]>([]);
 const [key,setKey]=useState('');
 const [kind,setKind]=useState<'replacement'|'inspection'>('replacement');
 const [months,setMonths]=useState('');
 const [km,setKm]=useState('');
 const [warningKm,setWarningKm]=useState('1000');
 const [warningDays,setWarningDays]=useState('30');
 const [notes,setNotes]=useState('');
 const [review,setReview]=useState(false);
 const [busy,setBusy]=useState(false);
 const [outcomes,setOutcomes]=useState<Outcome[]>([]);
 const [insurance,setInsurance]=useState<InsuranceIdentity[]>([]);
 const [insuranceLoading,setInsuranceLoading]=useState(true);
 const [insuranceError,setInsuranceError]=useState(false);
 const [makeFilter,setMakeFilter]=useState('');
 const [vehicleSearch,setVehicleSearch]=useState('');
 useEffect(()=>{
  let cancelled=false;
  void (async()=>{
   setInsuranceLoading(true);
   const {data:rows,error}=await supabase.from('vehicle_insurance_compliance')
    .select('vehicle_registration,vehicle_make,vehicle_year,chassis_number')
    .eq('record_status','current');
   if(cancelled)return;
   setInsuranceError(Boolean(error));
   setInsurance(error?[]:(rows??[]) as InsuranceIdentity[]);
   setInsuranceLoading(false);
  })();
  return ()=>{cancelled=true;};
 },[]);
 const identityIndex=useMemo(()=>{
  const index=new Map<string,InsuranceIdentity|null>();
  for(const row of insurance){
   const reg=normalizeReg(row.vehicle_registration);
   if(!reg)continue;
   if(index.has(reg))index.set(reg,null); // Ambiguous registration: don't use either record.
   else index.set(reg,row);
  }
  return index;
 },[insurance]);
 const identityFor=(reg:string)=>identityIndex.get(normalizeReg(reg))??null;
 const typeVehicles=useMemo(()=>active.filter(v=>v.vehicle_type===type),[active,type]);
 const makes=useMemo(()=>Array.from(new Set(typeVehicles.map(v=>identityIndex.get(normalizeReg(v.vehicle_reg))?.vehicle_make?.trim()).filter((v):v is string=>Boolean(v)))).sort((a,b)=>a.localeCompare(b)),[typeVehicles,identityIndex]);
 const candidates=useMemo(()=>typeVehicles.filter(v=>{
  const identity=identityIndex.get(normalizeReg(v.vehicle_reg));
  if(makeFilter&&(identity?.vehicle_make?.trim().toLocaleLowerCase()??'')!==makeFilter.toLocaleLowerCase())return false;
  const search=vehicleSearch.trim().toLocaleLowerCase();
  if(!search)return true;
  return [v.vehicle_reg,identity?.vehicle_make,identity?.chassis_number,identity?.vehicle_year?.toString()]
   .some(value=>value?.toLocaleLowerCase().includes(search));
 }),[typeVehicles,identityIndex,makeFilter,vehicleSearch]);
 const chosen=candidates.filter(v=>selected.includes(v.id));
 const existingFor=(vehicleId:string)=>data.requirements.find(s=>s.service_key===key&&s.schedule_kind===kind&&data.applicability.some(a=>a.vehicle_id===vehicleId&&a.requirement_id===s.id));
 const existing=chosen.filter(v=>!!existingFor(v.id));
 const newTargets=chosen.filter(v=>!existingFor(v.id));
 const baseVehicle=candidates[0];
 const choices=baseVehicle?vehicleCheckCatalogue(data,data.checks??[],baseVehicle.id):[];
 const catalog=SERVICE_CATALOG.find(s=>s[0]===key);
 const found=choices.find(s=>s.key===key);
 const serviceName=(th?found?.th:found?.en)??catalog?.[1]??key;
 const validNumber=(value:string,zero:boolean)=>value.trim()===''?null:(Number.isFinite(Number(value))&&Number(value)>=(zero?0:1)?Number(value):NaN);
 const distance=validNumber(km,false),period=validNumber(months,false),leadKm=validNumber(warningKm,true),leadDays=validNumber(warningDays,true);
 const valid=type&&chosen.length>0&&choices.some(item=>item.key===key)&&key!=='engine_oil'&&(distance!==null||period!==null)&&leadKm!==null&&leadDays!==null&&Number.isFinite(leadKm)&&Number.isFinite(leadDays)&&[distance,period].every(n=>n===null||Number.isFinite(n))&&(!period||Number.isInteger(period))&&Number.isInteger(leadDays)&&notes.length<=2000;
  const setField=(callback:()=>void)=>{if(busy)return;callback();setReview(false);setOutcomes([]);};
 async function apply(){
  if(!valid||busy||!can('business:write')||newTargets.length===0)return;
  if(!window.confirm(th?`บันทึกรอบบริการให้รถ ${newTargets.length} คัน? จะไม่เขียนทับค่าที่เคยตั้งไว้`:`Save the approved ${serviceName} interval to ${newTargets.length} vehicles? Existing settings will be skipped.`))return;
  setBusy(true);setOutcomes([]);
  const results:Outcome[]=[];
  try{
   for(const vehicle of newTargets){
    const previous=existingFor(vehicle.id);
    if(previous){results.push({registration:vehicle.vehicle_reg,ok:false,message:'Skipped — existing rule'});continue;}
    const payload:Partial<ServiceSchedule>={service_key:key,name:catalog?.[1]??found?.en??key,category:(catalog?.[3]??'other') as MaintenanceCategory,schedule_kind:kind,replacement_strategy:'interval',applicability_status:'applicable',frequency_months:period,mileage_interval:distance,warning_days:leadDays,warning_km:leadKm,specification:null,capacity:null,notes:notes.trim()||null};
    try{
     const {data:id,error}:{data:string|null;error:unknown}=await supabase.rpc('save_vehicle_maintenance_schedule',{payload,target_vehicle:vehicle.id,expected_updated_at:null});
     if(error)throw error;
     if(!id)throw new Error('No schedule ID returned');
     const {data:verified,error:verifyError}:{data:Pick<ServiceSchedule,'service_key'|'schedule_kind'|'mileage_interval'|'frequency_months'|'warning_km'|'warning_days'>|null;error:unknown}=await supabase.from('maintenance_requirements').select('service_key,schedule_kind,mileage_interval,frequency_months,warning_km,warning_days').eq('id',id).single();
     if(verifyError||!verified||verified.service_key!==key||verified.schedule_kind!==kind||Number(verified.warning_km)!==leadKm||Number(verified.warning_days)!==leadDays||(verified.mileage_interval===null?null:Number(verified.mileage_interval))!==distance||(verified.frequency_months===null?null:Number(verified.frequency_months))!==period)throw new Error('Could not verify saved interval');
     results.push({registration:vehicle.vehicle_reg,ok:true,message:'Saved'});
    }catch(error){results.push({registration:vehicle.vehicle_reg,ok:false,message:error instanceof Error?error.message:'Save failed'});}
    setOutcomes([...results]);
   }
  }finally{setBusy(false);onComplete();setReview(false);}
 }
 return <div className="maintenance-bulk-intervals space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
  <div><h3 className="text-base font-semibold text-slate-900">{th?'กำหนดรอบบริการหลายคัน':'Apply intervals by vehicle type'}</h3><p className="mt-1 text-xs text-slate-500">{th?'เลือกรถประเภทเดียวกัน ตรวจสอบทะเบียนรถ แล้วใช้รอบที่ผู้บริหารอนุมัติ — ไม่ทับค่าที่บันทึกไว้':'Select a type and vehicles, set the agreed interval, then review before saving.'}</p></div>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="text-xs font-medium text-slate-600">{th?'ประเภทรถ':'1. Vehicle type'}<select className="form-input mt-1" value={type} disabled={busy} onChange={e=>setField(()=>{setType(e.target.value);setSelected([]);setKey('');setMakeFilter('');setVehicleSearch('');})}><option value="">{th?'เลือกประเภทรถ':'Select vehicle type'}</option>{types.map(value=><option key={value} value={value}>{maintenanceVehicleType(value,t.weeklyMileage.oil.vehicleTypes)} ({active.filter(v=>v.vehicle_type===value).length})</option>)}</select></label>
   <label className="text-xs font-medium text-slate-600">{th?'รายการบำรุงรักษา':'Maintenance item'}<select className="form-input mt-1" value={key} disabled={busy} onChange={e=>setField(()=>setKey(e.target.value))}><option value="">{th?'เลือกรายการ':'Select an item'}</option>{choices.filter(item=>item.key!=='engine_oil'&&item.key!=='custom').map(item=><option key={item.key} value={item.key}>{th?item.th:item.en}</option>)}</select></label>
  </div>
  {type&&<div className="grid gap-2 rounded-xl border border-violet-100 bg-[#faf9ff] p-3 sm:grid-cols-2">
   <label className="text-xs font-medium text-slate-600">{th?'ยี่ห้อรถ (จากประกันภัย)':'Manufacturer (from Insurance)'}
    <select className="form-input mt-1" disabled={busy||insuranceLoading||insuranceError} value={makeFilter} onChange={e=>setField(()=>{setMakeFilter(e.target.value);setSelected([]);})}>
     <option value="">{th?'ทุกยี่ห้อ':'All manufacturers'}</option>
     {makes.map(make=><option key={make} value={make}>{make}</option>)}
    </select>
   </label>
   <label className="text-xs font-medium text-slate-600">{th?'ค้นหาทะเบียน / เลขตัวถัง':'Search registration / chassis'}
    <input className="form-input mt-1" value={vehicleSearch} disabled={busy} placeholder={th?'ทะเบียน, เลขตัวถัง หรือปี':'Registration, chassis or year'} onChange={e=>setField(()=>{setVehicleSearch(e.target.value);setSelected([]);})}/>
   </label>
   <p className="text-xs text-slate-500 sm:col-span-2">{insuranceLoading?(th?'กำลังโหลดข้อมูลประกันภัย…':'Loading Insurance vehicle information…'):insuranceError?(th?'โหลดข้อมูลประกันภัยไม่ได้ — ยังเลือกตามประเภทรถได้':'Insurance information unavailable — vehicle type selection still works.'):(th?'แสดงยี่ห้อ ปี และเลขตัวถังเมื่อข้อมูลทะเบียนตรงกัน รุ่นยังไม่มีข้อมูลยืนยัน':'Make, year and chassis appear when registrations match. Models are not yet verified.')} {th?'เลือกได้':'Matching vehicles'}: {candidates.length}/{typeVehicles.length}</p>
  </div>}
  {type&&<div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{th?'เลือกรถที่จะใช้':'2. Choose vehicles'} · {selected.length}/{candidates.length}</p><div className="flex gap-2"><button className="text-xs font-semibold text-violet-700" type="button" disabled={busy} onClick={()=>setField(()=>setSelected(old=>Array.from(new Set([...old,...candidates.map(v=>v.id)]))))}>{th?'เลือกทั้งหมด':'Select all'}</button><button className="text-xs text-slate-600" type="button" disabled={busy} onClick={()=>setField(()=>setSelected(old=>old.filter(id=>!candidates.some(v=>v.id===id))))}>{th?'ล้าง':'Clear'}</button></div></div>
   <div className="mt-2 grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">{candidates.map(v=>{const saved=!!existingFor(v.id);const identity=identityFor(v.vehicle_reg);return <label key={v.id} className={`grid min-w-0 cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2 rounded-lg border px-3 py-2.5 text-xs text-slate-800 transition-colors ${selected.includes(v.id)?'border-violet-300 bg-violet-50':'border-slate-200 bg-white hover:border-violet-200'}`}><input type="checkbox" className="!m-0 !inline-block !h-4 !w-4 !min-h-0 !min-w-0 !max-w-4 !shrink-0 cursor-pointer accent-violet-700" style={{width:16,height:16,minWidth:16,maxWidth:16,margin:0}} disabled={busy} checked={selected.includes(v.id)} onChange={e=>setField(()=>setSelected(old=>e.target.checked?[...old,v.id]:old.filter(id=>id!==v.id)))}/><span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5"><span className="min-w-0"><strong className="block whitespace-nowrap text-sm font-semibold tabular-nums">{v.vehicle_reg}</strong><span className="block max-w-[170px] truncate text-xs text-slate-500">{maintenanceDriver(data,v.id)}</span>{identity&&<span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{[identity.vehicle_make,identity.vehicle_year].filter(Boolean).join(' · ')|| (th?'ไม่ระบุยี่ห้อ':'Make not recorded')}{identity.chassis_number&&<span className="block break-all font-mono text-[10px] text-slate-400">{identity.chassis_number}</span>}</span>}</span>{saved&&<span className="whitespace-nowrap rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">{th?'มีค่าแล้ว':'Existing'}</span>}</span></label>})}</div>
  </div>}
  <p className="text-sm font-semibold text-slate-800">{th?'3. กำหนดรอบบริการ':'3. Set the interval'}</p>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">{th?'การดำเนินการ':'Service action'}<select className="form-input mt-1" value={kind} disabled={busy} onChange={e=>setField(()=>setKind(e.target.value as typeof kind))}><option value="replacement">{th?'เปลี่ยน':'Replacement'}</option><option value="inspection">{th?'ตรวจเช็ค':'Inspection'}</option></select></label><div className="flex items-center rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-xs leading-relaxed text-violet-900">{th?'ไม่รวมการเปลี่ยนน้ำมันเครื่องแบบกลุ่ม เพื่อรักษากฎ EES และค่าที่ตั้งเฉพาะรถ':'Engine oil is excluded from bulk changes to protect EES oil rules and individual overrides.'}</div></div>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><label className="text-xs font-medium text-slate-600">{th?'ทุกกี่กิโลเมตร':'Every (km)'}<input className="form-input mt-1" inputMode="numeric" type="number" min="1" value={km} disabled={busy} placeholder="—" onChange={e=>setField(()=>setKm(e.target.value))}/></label><label className="text-xs font-medium text-slate-600">{th?'ทุกกี่เดือน':'Every (months)'}<input className="form-input mt-1" type="number" min="1" step="1" value={months} disabled={busy} placeholder="—" onChange={e=>setField(()=>setMonths(e.target.value))}/></label><label className="text-xs font-medium text-slate-600">{th?'เตือนก่อน (กม.)':'Warn before (km)'}<input className="form-input mt-1" type="number" min="0" value={warningKm} disabled={busy} onChange={e=>setField(()=>setWarningKm(e.target.value))}/></label><label className="text-xs font-medium text-slate-600">{th?'เตือนก่อน (วัน)':'Warn before (days)'}<input className="form-input mt-1" type="number" min="0" step="1" value={warningDays} disabled={busy} onChange={e=>setField(()=>setWarningDays(e.target.value))}/></label></div>
  <details className="rounded-lg border border-slate-200 px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-violet-700">{th?'บันทึกเพิ่มเติม (ไม่บังคับ)':'Notes (optional)'}</summary><textarea className="form-input mt-2" maxLength={2000} rows={2} value={notes} disabled={busy} onChange={e=>setField(()=>setNotes(e.target.value))}/></details>
  <p className="text-xs leading-relaxed text-amber-900"><strong>{th?'สำหรับผู้บริหารอนุมัติเท่านั้น':'Boss approval required.'}</strong> {th?'ยังไม่ใช้ตัวเลขจากวิดีโอโดยอัตโนมัติ การตรวจเช็คไม่ใช่การเปลี่ยนอะไหล่':'Video reference figures are never applied automatically. A condition check does not count as a replacement.'}</p>
  {selected.length>0&&chosen.length!==selected.length&&<p className="text-xs text-amber-800">{th?'รถที่เลือกไว้บางคันถูกซ่อนด้วยตัวกรองและจะไม่ถูกบันทึก':'Some selected vehicles are hidden by the current filters and will not be saved.'}</p>}
  {chosen.length>0&&<p className="text-sm text-slate-700">{th?'เลือกไว้':'Selected'}: <strong>{chosen.length}</strong> · {th?'พร้อมบันทึกใหม่':'New rules'}: <strong>{newTargets.length}</strong> · {th?'ข้ามค่าที่มีแล้ว':'Existing rules skipped'}: <strong>{existing.length}</strong></p>}
  {!review?<button className="btn-primary" type="button" disabled={!valid||busy||!can('business:write')} onClick={()=>setReview(true)}>{th?'ตรวจสอบก่อนบันทึก':'Review proposed changes'}</button>:<div className="rounded-xl border border-violet-200 p-3"><p className="font-semibold text-slate-900">{th?'ตรวจสอบก่อนยืนยัน':'4. Review before saving'}</p><p className="mt-1 text-sm text-slate-700">{serviceName} · {distance??'—'} km · {period??'—'} {th?'เดือน':'months'}</p><p className="mt-1 text-xs text-slate-600">{newTargets.map(v=>v.vehicle_reg).join(', ')||'No new rules to save'}</p>{existing.length>0&&<p className="mt-2 text-xs text-amber-800">{th?'ข้ามค่าที่มีแล้ว':'Skipped existing'}: {existing.map(v=>v.vehicle_reg).join(', ')}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={!valid||busy||newTargets.length===0} onClick={()=>void apply()}>{busy?(th?'กำลังบันทึก':'Saving…'):(th?`ยืนยัน ${newTargets.length} คัน`:`Confirm ${newTargets.length} vehicles`)}</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setReview(false)}>{th?'ย้อนกลับ':'Back'}</button></div></div>}
  {outcomes.length>0&&<div role="status" className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-semibold text-slate-800">{outcomes.filter(o=>o.ok).length} {th?'สำเร็จ':'saved'} · {outcomes.filter(o=>!o.ok).length} {th?'ไม่สำเร็จ':'failed/skipped'}</p><div className="mt-2 max-h-36 space-y-1 overflow-auto text-xs">{outcomes.map(o=><p key={o.registration} className={o.ok?'text-emerald-700':'text-rose-700'}>{o.registration}: {o.message}</p>)}</div></div>}
 </div>;
}
