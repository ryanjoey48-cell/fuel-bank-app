import type { MaintenanceData, MaintenanceRequirement } from './maintenance-types';
import { addMaintenanceMonths, maintenanceToday, reliableMaintenanceMileage, validMaintenanceDate } from './maintenance';
export const SERVICE_CATALOG = [
 ['engine_oil','Engine Oil','น้ำมันเครื่อง','oil'], ['coolant','Engine Coolant','น้ำยาหล่อเย็น','engine'],
 ['radiator','Radiator','หม้อน้ำ','engine'],
 ['brake_fluid','Brake Fluid','น้ำมันเบรก','brakes'], ['transmission_oil','Transmission Oil','น้ำมันเกียร์','transmission'],
 ['power_steering_fluid','Power Steering Fluid','น้ำมันพวงมาลัยเพาเวอร์','steering'],
 ['battery','Battery','แบตเตอรี่','battery'], ['oil_filter','Engine Oil Filter','ไส้กรองน้ำมันเครื่อง','oil'],
 ['air_filter','Engine Air Filter','ไส้กรองอากาศ','engine'], ['fuel_filter','Fuel Filter','ไส้กรองน้ำมันเชื้อเพลิง','engine'],
 ['tyres','Tyres','ยางรถยนต์','tyres'], ['brake_pads','Brake Pads','ผ้าเบรก','brakes'], ['brake_discs','Brake Discs','จานเบรก','brakes'],
 ['spark_plugs','Spark Plugs','หัวเทียน','engine'], ['timing_belt','Timing Belt','สายพานไทม์มิ่ง','engine'],
 ['timing_chain','Timing Chain','โซ่ไทม์มิ่ง','engine'], ['shock_absorbers','Shock Absorbers','โช้คอัพ','suspension'],
] as const;
export const SERVICE_ACTIONS = ['inspection','fluid_replacement','fluid_top_up','component_replacement','repair','other'] as const;
export type ServiceAction = typeof SERVICE_ACTIONS[number];
export type ScheduleStatus = 'overdue'|'urgent'|'dueSoon'|'ok'|'notConfigured'|'notApplicable'|'unknown'|'condition';
export type ServiceSchedule = MaintenanceRequirement & {service_key:string; schedule_kind:'replacement'|'inspection'; applicability_status:'applicable'|'not_applicable'; specification:string|null; capacity:string|null; replacement_strategy?:'interval'|'condition'};
export type ServiceBaseline = {date:string; odometer:number|null; recordId:string|null; itemId:string|null};
export type ScheduleResult = {schedule:ServiceSchedule; status:ScheduleStatus; baseline:ServiceBaseline|null; dueDate:string|null; dueKm:number|null; days:number|null; km:number|null; condition:string|null; lastInspection:ServiceBaseline|null; lastReplacement:ServiceBaseline|null};
export function qualifies(action:string|undefined,kind:string){return kind==='inspection'?action==='inspection':action==='fluid_replacement'||action==='component_replacement';}
export function qualifiesForService(key:string,action:string|undefined,kind:string){if(kind==='inspection')return action==='inspection';const index=SERVICE_CATALOG.findIndex(s=>s[0]===key);return index<0?qualifies(action,kind):index<5?action==='fluid_replacement':action==='component_replacement';}
export function evaluateSchedule(schedule:ServiceSchedule,baseline:ServiceBaseline|null,current:number|null,today=maintenanceToday()):ScheduleResult {
 const result:ScheduleResult={schedule,status:'notConfigured',baseline,dueDate:null,dueKm:null,days:null,km:null,condition:null,lastInspection:null,lastReplacement:null};
 if(schedule.applicability_status==='not_applicable')return {...result,status:'notApplicable'};
 if(!schedule.frequency_months&&!schedule.mileage_interval)return {...result,status:schedule.replacement_strategy==='condition'&&schedule.schedule_kind==='replacement'?'condition':'notConfigured'};
 if(!baseline||!validMaintenanceDate(baseline.date)||baseline.date>today)return result;
 result.dueDate=schedule.frequency_months?addMaintenanceMonths(baseline.date,Number(schedule.frequency_months)):null;
 result.dueKm=schedule.mileage_interval&&baseline.odometer!==null?Number(baseline.odometer)+Number(schedule.mileage_interval):null;
 result.days=result.dueDate?Math.round((Date.parse(result.dueDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
 result.km=result.dueKm!==null&&current!==null&&current>=Number(baseline.odometer)?result.dueKm-current:null;
 const missing=(!!schedule.frequency_months&&result.days===null)||(!!schedule.mileage_interval&&result.km===null);
 result.status=(result.days!==null&&result.days<=0)||(result.km!==null&&result.km<=0)?'overdue':(result.days!==null&&result.days<=schedule.warning_days)||(result.km!==null&&result.km<=schedule.warning_km)?'dueSoon':missing?'unknown':'ok';
 return result;
}
export function scheduleEvents(data:MaintenanceData,vehicleId:string,key:string,today=maintenanceToday()) {
 const records=new Map(data.records.filter(r=>!r.is_deleted&&r.vehicle_id===vehicleId&&validMaintenanceDate(r.service_date)&&r.service_date<=today).map(r=>[r.id,r]));
 const readings=reliableMaintenanceMileage(data.mileage,vehicleId,today).dated;
 return data.items.filter(i=>i.service_key===key&&i.service_confirmed===true&&records.has(i.record_id)).map(item=>({item,record:records.get(item.record_id)!})).filter(({record})=>record.odometer===null||!readings.some(r=>r.valid&&r.date>=record.service_date&&r.value<Number(record.odometer))).sort((a,b)=>b.record.service_date.localeCompare(a.record.service_date)||b.record.created_at.localeCompare(a.record.created_at)||b.item.position-a.item.position);
}
export function buildServiceSchedule(data:MaintenanceData,vehicleId:string,legacyOil:ServiceBaseline|null=null,today=maintenanceToday()):ScheduleResult[] {
 const mileage=reliableMaintenanceMileage(data.mileage,vehicleId,today);
 return data.requirements.filter((s):s is ServiceSchedule=>!!s.service_key&&s.active&&data.applicability.some(a=>a.vehicle_id===vehicleId&&a.requirement_id===s.id)).map(schedule=>{
  const events=scheduleEvents(data,vehicleId,schedule.service_key,today);
  const baseline=(kind:string):ServiceBaseline|null=>{const e=events.find(e=>qualifiesForService(schedule.service_key,e.item.service_action,kind));return e?{date:e.record.service_date,odometer:e.record.odometer,recordId:e.record.id,itemId:e.item.id}:null;};
  let lastReplacement=baseline('replacement');
  if(schedule.service_key==='engine_oil'&&legacyOil&&(!lastReplacement||legacyOil.date>lastReplacement.date))lastReplacement=legacyOil;
  let lastInspection=baseline('inspection');
  const check=[...(data.checks??[])].filter(c=>c.vehicle_id===vehicleId&&c.service_key===schedule.service_key&&['ok','attention'].includes(c.result)&&validMaintenanceDate(c.check_date)&&c.check_date<=today).sort((a,b)=>b.check_date.localeCompare(a.check_date)||b.created_at.localeCompare(a.created_at))[0];
  if(check&&(!lastInspection||check.check_date>=lastInspection.date))lastInspection={date:check.check_date,odometer:check.odometer,recordId:check.maintenance_record_id,itemId:null};
  const last=schedule.schedule_kind==='inspection'?lastInspection:lastReplacement;
  const current=last&&mileage.date&&mileage.date>=last.date&&!mileage.dated.some(r=>r.baseline&&r.date>last.date)?mileage.value:null;
  return {...evaluateSchedule(schedule,last,current,today),lastInspection,lastReplacement,condition:events.find(e=>e.item.condition)?.item.condition??null};
 });
}
