// Pure office-facing projections. Financial totals count visits exactly once.
import {maintenanceVehicleModel} from './maintenance-vehicle-label';
import type {MaintenanceData,MaintenanceRecord} from './maintenance-types';
import type {OilChangeAlertRow} from './operations';
import {buildMaintenanceReminders,maintenanceDriver,maintenanceToday,validMaintenanceDate} from './maintenance';
import {buildServiceSchedule,SERVICE_CATALOG} from './preventative-maintenance';
export type VehicleCheckResult='not_checked'|'ok'|'attention'|'not_applicable';
export type VehicleMaintenanceCheck={id:string;request_id:string;vehicle_id:string;service_key:string;item_name:string;check_date:string;odometer:number|null;result:VehicleCheckResult;notes:string|null;maintenance_record_id:string|null;checked_by:string;checked_by_name:string;created_at:string};
export type VehicleCheckInput=Pick<VehicleMaintenanceCheck,'service_key'|'item_name'|'result'|'notes'|'maintenance_record_id'>;
export function latestVehicleChecks(checks:VehicleMaintenanceCheck[],vehicleId:string,today=maintenanceToday()){
 const latest=new Map<string,VehicleMaintenanceCheck>();
 for(const check of [...checks].filter(c=>c.vehicle_id===vehicleId&&validMaintenanceDate(c.check_date)&&c.check_date<=today).sort((a,b)=>b.check_date.localeCompare(a.check_date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))){
  // A later "not checked" is not an assessment and cannot close an earlier defect.
  const current=latest.get(check.service_key);
  if(!current||current.result==='not_checked'&&check.result!=='not_checked')latest.set(check.service_key,check);
 }
 return latest;
}
export function maintenanceOfficeRecords(data:MaintenanceData,{start,end,search='',vehicleId='',archive=false}:{start:string;end:string;search?:string;vehicleId?:string;archive?:boolean},today=maintenanceToday()){
 const ids=new Set<string>(),q=search.trim().toLocaleLowerCase();
 return data.records.filter(r=>{if(ids.has(r.id)||(!archive&&r.is_deleted)||!validMaintenanceDate(r.service_date)||r.service_date>today||r.service_date<start||r.service_date>end||(vehicleId&&r.vehicle_id!==vehicleId))return false;const v=data.vehicles.find(v=>v.id===r.vehicle_id);const text=[v?.vehicle_reg,maintenanceVehicleModel(v),maintenanceDriver(data,r.vehicle_id),r.garage,r.receipt_reference,r.notes,...data.items.filter(i=>i.record_id===r.id).flatMap(i=>[i.description,i.description_th])].join(' ').toLocaleLowerCase();if(!text.includes(q))return false;ids.add(r.id);return true;}).sort((a,b)=>b.service_date.localeCompare(a.service_date)||b.created_at.localeCompare(a.created_at));
}
export function maintenanceOfficeTotals(records:MaintenanceRecord[]){const rows=Array.from(new Map(records.filter(r=>!r.is_deleted).map(r=>[r.id,r])).values());const known=rows.every(r=>Number.isFinite(Number(r.calculated_total))&&r.calculated_total!==null);return {count:rows.length,total:known?rows.reduce((sum,r)=>sum+Math.round(Number(r.calculated_total)*100),0)/100:null};}
export function maintenanceAttentionVehicles(data:MaintenanceData,checks:VehicleMaintenanceCheck[],oil:OilChangeAlertRow[],today=maintenanceToday()){
 const legacy=buildMaintenanceReminders(data,today),attention=new Map<string,string[]>();
 for(const v of data.vehicles.filter(v=>v.active!==false)){
  const latest=latestVehicleChecks(checks,v.id,today),names:string[]=[];
  for(const check of latest.values())if(check.result==='attention')names.push(check.service_key);
  const row=oil.find(o=>o.vehicleId===v.id);if(row&&['overdue','urgent','due_soon'].includes(row.status))names.push('engine_oil');
  const baseline=row?.lastOilChangeDate?{date:row.lastOilChangeDate,odometer:row.lastOilChangeOdometer,recordId:null,itemId:null}:null;
  for(const s of buildServiceSchedule({...data,checks},v.id,baseline,today))if(['overdue','dueSoon'].includes(s.status)&&latest.get(s.schedule.service_key)?.result!=='not_applicable')names.push(s.schedule.service_key);
  for(const r of legacy.filter(r=>r.vehicle_id===v.id&&['overdue','mileageDue','dueSoon'].includes(r.status)))names.push(r.name);
  if(names.length)attention.set(v.id,Array.from(new Set(names)));
 }
 return attention;
}
export function vehicleCheckCatalogue(data:MaintenanceData,checks:VehicleMaintenanceCheck[],vehicleId:string){const rows=SERVICE_CATALOG.map(s=>({key:s[0] as string,en:s[1] as string,th:s[2] as string,group:SERVICE_CATALOG.indexOf(s)<5?'fluids':'components'}));for(const item of [...checks.filter(c=>c.vehicle_id===vehicleId).map(c=>({key:c.service_key,name:c.item_name})),...data.requirements.filter(s=>s.service_key&&data.applicability.some(a=>a.vehicle_id===vehicleId&&a.requirement_id===s.id)).map(s=>({key:s.service_key!,name:s.name}))])if(!rows.some(r=>r.key===item.key))rows.push({key:item.key,en:item.name,th:item.name,group:'custom'});return rows;}
