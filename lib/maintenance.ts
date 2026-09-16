import type { Vehicle, WeeklyMileageEntry } from "@/types/database";
import type { MaintenanceData, MaintenanceItem, MaintenanceItemInput, MaintenanceRecord, MaintenanceReminder, MaintenanceRequirement, MaintenanceStatus } from "./maintenance-types";
import { buildVerifiedFullTankCycles } from "./fuel-cycles";

export const maintenanceStatusOrder: MaintenanceStatus[] = ["overdue", "mileageDue", "dueSoon", "noHistory", "ok"];
export const maintenanceTones: Record<MaintenanceStatus, string> = { overdue:"bg-rose-50 text-rose-800 border-rose-200", mileageDue:"bg-orange-50 text-orange-800 border-orange-200", dueSoon:"bg-amber-50 text-amber-800 border-amber-200", noHistory:"bg-slate-100 text-slate-700 border-slate-200", ok:"bg-emerald-50 text-emerald-800 border-emerald-200" };
export function maintenanceToday(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit" }).format(now); }
export function validMaintenanceDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false; const d=new Date(`${value}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value; }
export function addMaintenanceMonths(date: string, months: number) {
 if (!validMaintenanceDate(date) || !Number.isInteger(months) || months<1 || months>1200) return null;
 const [y,m,d]=date.split("-").map(Number), target=new Date(Date.UTC(y,m-1+months,1));
 target.setUTCDate(Math.min(d,new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()));
 return target.toISOString().slice(0,10);
}
export function shiftMaintenanceDate(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10); }
export function maintenanceLineTotal(item: Pick<MaintenanceItem,"quantity"|"unit_price">) {
 const q=BigInt(Math.round(Number(item.quantity)*100)),p=BigInt(Math.round(Number(item.unit_price)*100));
 return Number((q*p+BigInt(50))/BigInt(100))/100;
}
export function maintenanceTotal(items: Pick<MaintenanceItem,"quantity"|"unit_price">[]) { return items.reduce((c,i)=>c+Math.round(maintenanceLineTotal(i)*100),0)/100; }
export function receiptDifference(total: number, receipt: number | null) { return receipt===null ? null : (Math.round(total*100)-Math.round(receipt*100))/100; }
export function maintenanceDowntime(record: Pick<MaintenanceRecord,"off_road_at"|"returned_at">, now=new Date()) { return record.off_road_at ? Math.max(0, (Date.parse(record.returned_at || now.toISOString())-Date.parse(record.off_road_at))/3600000) : 0; }
export function maintenanceDue(item: Pick<MaintenanceItem,"reminder_months"|"reminder_km"|"override_date"|"override_km">,record: Pick<MaintenanceRecord,"service_date"|"odometer">) {
 return { date:item.override_date || (item.reminder_months ? addMaintenanceMonths(record.service_date,item.reminder_months) : null), km:item.override_km ?? (item.reminder_km && record.odometer!==null ? Number(record.odometer)+Number(item.reminder_km) : null) };
}
export function requirementApplies(req: MaintenanceRequirement, vehicle: Vehicle, data: Pick<MaintenanceData,"applicability">) { return (req.vehicle_type!==null && req.vehicle_type===vehicle.vehicle_type) || data.applicability.some(a=>a.requirement_id===req.id && a.vehicle_id===vehicle.id); }
export function maintenanceDriver(data: Pick<MaintenanceData,"drivers">, vehicleId: string) { return data.drivers.filter(d=>d.active!==false && d.assigned_vehicle_id===vehicleId).map(d=>d.name).join(", "); }

// Only stable vehicle IDs are used. Conflicting dates, declining readings and stale
// readings never make a mileage reminder look healthy.
export function reliableMaintenanceMileage(entries: WeeklyMileageEntry[],vehicleId:string,today=maintenanceToday()) {
 const rows=entries.filter(e=>e.vehicle_id===vehicleId && validMaintenanceDate(e.week_ending) && e.week_ending<=today).sort((a,b)=>a.week_ending.localeCompare(b.week_ending)||a.created_at.localeCompare(b.created_at));
 const dated: {date:string;value:number;baseline:boolean;valid:boolean}[]=[];
 for (const e of rows) {
  const raw=e.odometer_reading ?? e.mileage; const value=Number(raw);
  const previous=dated[dated.length-1];
  const valid=raw!==null && raw!==undefined && Number.isFinite(value) && value>=0;
  if(previous?.date===e.week_ending) { previous.valid=previous.valid && valid && previous.value===value; previous.baseline ||=e.is_odometer_baseline===true; }
  else dated.push({date:e.week_ending,value,baseline:e.is_odometer_baseline===true,valid});
 }
 const latest=dated.at(-1); let bad=false; let previous:number|null=null;
 for(const row of dated) { if(row.baseline) {bad=false;previous=null;} if(!row.valid || (previous!==null && row.value<previous)) bad=true; previous=row.value; }
 const fresh=latest && (Date.parse(`${today}T00:00:00Z`)-Date.parse(`${latest.date}T00:00:00Z`))/86400000<=14;
 return {value:latest && !bad && fresh ? latest.value : null,date:latest?.date??null,dated};
}
function relevantKey(item: MaintenanceItem) { return item.requirement_id ? `requirement:${item.requirement_id}` : `category:${item.category}:${item.description.trim().toLocaleLowerCase().replace(/\s+/g," ")}`; }
export function buildMaintenanceReminders(data: MaintenanceData,today=maintenanceToday()): MaintenanceReminder[] {
 const records=new Map(data.records.filter(r=>!r.is_deleted && validMaintenanceDate(r.service_date) && r.service_date<=today).map(r=>[r.id,r]));
 const reminders:MaintenanceReminder[]=[];
 for(const vehicle of data.vehicles.filter(v=>v.active!==false)) {
  const latest=new Map<string,{item:MaintenanceItem;record:MaintenanceRecord}>();
  for(const item of data.items) { const record=records.get(item.record_id); if(!record || record.vehicle_id!==vehicle.id) continue; const key=relevantKey(item),prev=latest.get(key); if(!prev || `${record.service_date}|${record.created_at}|${item.position.toString().padStart(9,"0")}|${item.id}`>`${prev.record.service_date}|${prev.record.created_at}|${prev.item.position.toString().padStart(9,"0")}|${prev.item.id}`) latest.set(key,{item,record}); }
  const mileage=reliableMaintenanceMileage(data.mileage,vehicle.id,today);
  for(const req of data.requirements.filter(r=>r.active && requirementApplies(r,vehicle,data))) {
   const key=`requirement:${req.id}`;
   if(!latest.has(key)) reminders.push({key:`${vehicle.id}:${key}`,vehicle_id:vehicle.id,name:req.name,category:req.category,status:"noHistory",record_id:null,item_id:null,due_date:null,due_km:null,days:null,km:null,mileage_date:mileage.date,mileage_unavailable:false});
  }
  for(const [key,{item,record}] of latest) {
   const req=data.requirements.find(r=>r.id===item.requirement_id);
   if(item.requirement_id && (!req?.active || !requirementApplies(req,vehicle,data))) continue;
   const due=maintenanceDue(item,record); if(due.date===null && due.km===null) continue;
   // Readings prior to the garage visit or below its baseline cannot assess this item.
   const current=mileage.value!==null && mileage.date!>=record.service_date && (record.odometer===null || mileage.value>=record.odometer) && !mileage.dated.some(r=>r.baseline && r.date>record.service_date) ? mileage.value : null;
   const days=due.date ? Math.round((Date.parse(`${due.date}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000) : null;
   const km=due.km!==null && current!==null ? due.km-current : null;
   const status:MaintenanceStatus=days!==null && days<0 || km!==null && km<0 ? "overdue" : km!==null && km===0 ? "mileageDue" : (days!==null && days<=item.warning_days || km!==null && km<=item.warning_km) ? "dueSoon" : "ok";
   reminders.push({key:`${vehicle.id}:${key}`,vehicle_id:vehicle.id,name:req?.name||item.description,category:item.category,status,record_id:record.id,item_id:item.id,due_date:due.date,due_km:due.km,days,km,mileage_date:mileage.date,mileage_unavailable:due.km!==null && current===null});
  }
 }
 return reminders.sort((a,b)=>maintenanceStatusOrder.indexOf(a.status)-maintenanceStatusOrder.indexOf(b.status)||(a.days??Infinity)-(b.days??Infinity)||(a.km??Infinity)-(b.km??Infinity)||a.name.localeCompare(b.name));
}
export type MaintenanceFilters={vehicle:string;driver:string;vehicleType:string;category:string;status:string;garage:string;start:string;end:string;search:string};
export function filterMaintenanceRecords(data:MaintenanceData,filters:MaintenanceFilters,reminders=buildMaintenanceReminders(data)) {
 return data.records.filter(record=>{
  if(record.is_deleted || record.service_date<filters.start || record.service_date>filters.end) return false;
  const v=data.vehicles.find(v=>v.id===record.vehicle_id),items=data.items.filter(i=>i.record_id===record.id);
  return (!filters.vehicle || record.vehicle_id===filters.vehicle) && (!filters.driver || data.drivers.some(d=>d.id===filters.driver && d.active!==false && d.assigned_vehicle_id===record.vehicle_id)) && (!filters.vehicleType || v?.vehicle_type===filters.vehicleType) && (!filters.category || items.some(i=>i.category===filters.category)) && (!filters.status || reminders.some(r=>r.vehicle_id===record.vehicle_id && r.status===filters.status && (!filters.category || r.category===filters.category))) && (!filters.garage || record.garage===filters.garage) && `${v?.vehicle_reg} ${maintenanceDriver(data,record.vehicle_id)} ${record.garage??""} ${record.receipt_reference??""} ${items.map(i=>`${i.description} ${i.description_th??""}`).join(" ")}`.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase());
 }).sort((a,b)=>b.service_date.localeCompare(a.service_date)||b.created_at.localeCompare(a.created_at));
}
export function maintenancePeriodDistance(data:MaintenanceData,vehicleId:string,start:string,end:string) {
 const rows=reliableMaintenanceMileage(data.mileage,vehicleId,end).dated.filter(r=>r.date>=start && r.date<=end);
 if(rows.length<2 || rows[0].date!==start || rows.at(-1)!.date!==end || rows.some((r,i)=>!r.valid || i>0 && (r.baseline || r.value<rows[i-1].value || (Date.parse(r.date)-Date.parse(rows[i-1].date))/86400000>8))) return null;
 const distance=rows.at(-1)!.value-rows[0].value; return distance>0 ? distance : null;
}
export function maintenanceAnalytics(data:MaintenanceData,vehicleId:string,start:string,end:string,today=maintenanceToday(),allReminders=buildMaintenanceReminders(data,today)) {
 const records=data.records.filter(r=>!r.is_deleted && r.vehicle_id===vehicleId && r.service_date>=start && r.service_date<=end),ids=new Set(records.map(r=>r.id));
 const items=data.items.filter(i=>ids.has(i.record_id)),total=maintenanceTotal(items),distance=maintenancePeriodDistance(data,vehicleId,start,end);
 const fuel=data.fuel.filter(f=>f.vehicle_id===vehicleId && f.date>=start && f.date<=end),fuelTotal=fuel.reduce((s,f)=>s+Math.round(Number(f.total_cost)*100),0)/100;
 const byCategory:Record<string,number>={},repeats:Record<string,number>={},monthly:Record<string,number>={},yearly:Record<string,number>={};
 for(const item of items) { byCategory[item.category]=(byCategory[item.category]??0)+Math.round(maintenanceLineTotal(item)*100); const key=item.description.trim().toLocaleLowerCase().replace(/\s+/g," "); repeats[key]=(repeats[key]??0)+1; }
 for(const record of records) { const cents=Math.round(Number(record.calculated_total)*100);monthly[record.service_date.slice(0,7)]=(monthly[record.service_date.slice(0,7)]??0)+cents;yearly[record.service_date.slice(0,4)]=(yearly[record.service_date.slice(0,4)]??0)+cents; }
 const reminders=allReminders.filter(r=>r.vehicle_id===vehicleId);
 // Downtime is clipped to the reporting period and overlaps are merged.
 const lo=Date.parse(`${start}T00:00:00+07:00`),hi=Date.parse(`${shiftMaintenanceDate(end,1)}T00:00:00+07:00`),now=Date.now();
 const spans=data.records.filter(r=>!r.is_deleted && r.vehicle_id===vehicleId && r.off_road_at).map(r=>[Math.max(lo,Date.parse(r.off_road_at!)),Math.min(hi,Date.parse(r.returned_at??new Date(now).toISOString()))]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 const merged:number[][]=[];for(const span of spans) {const prev=merged.at(-1);if(prev&&span[0]<=prev[1])prev[1]=Math.max(prev[1],span[1]);else merged.push(span);}
 return {total,distance,fuelTotal,fuelCount:fuel.length,maintenancePerKm:distance?total/distance:null,fuelPerKm:distance&&fuel.length?fuelTotal/distance:null,combinedPerKm:distance&&fuel.length?(total+fuelTotal)/distance:null,visits:records.length,itemCount:items.length,byCategory,repeats,monthly,yearly,downtime:merged.reduce((s,[a,b])=>s+(b-a)/3600000,0),overdue:reminders.filter(r=>r.status==="overdue"||r.status==="mileageDue").length,upcoming:reminders.filter(r=>r.status==="dueSoon").length};
}
export function maintenanceObservation(data:MaintenanceData,record:MaintenanceRecord) {
 const cycles=buildVerifiedFullTankCycles(data.fuel.filter(f=>f.vehicle_id===record.vehicle_id).map(f=>({...f,vehicle_reg:record.vehicle_id})));
 const before={start:shiftMaintenanceDate(record.service_date,-30),end:shiftMaintenanceDate(record.service_date,-1)},after={start:shiftMaintenanceDate(record.service_date,1),end:shiftMaintenanceDate(record.service_date,30)};
 const summarize=(range:typeof before)=>{const selected=cycles.filter(c=>c.status==="verified"&&c.startDate>=range.start&&c.endDate<=range.end);return selected.length>=2?{...range,cycles:selected.length,coverageStart:selected[0].startDate,coverageEnd:selected.at(-1)!.endDate,kmPerLitre:selected.reduce((s,c)=>s+c.distanceKm,0)/selected.reduce((s,c)=>s+c.litres,0)}:null;};
 const b=summarize(before),a=summarize(after);return b&&a&&after.end<=maintenanceToday()?{before:b,after:a}:null;
}
export function newMaintenanceItem(id:string,category:MaintenanceItem["category"]="other"):MaintenanceItemInput {return {id,description:"",description_th:null,category,quantity:1,unit_price:0,notes:null,requirement_id:null,reminder_months:category==="grease"?12:null,reminder_km:null,warning_days:30,warning_km:1000,override_date:null,override_km:null};}
