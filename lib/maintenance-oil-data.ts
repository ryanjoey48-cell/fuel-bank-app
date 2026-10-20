import { supabase } from './supabase';
import type { Vehicle, VehicleServiceLog } from '@/types/database';
import type { MaintenanceItem, MaintenanceRecord } from './maintenance-types';
import type { ServiceSchedule } from './preventative-maintenance';
async function pages<T>(table:string,select:string,filter?:[string,string]) {
 const result:T[]=[];
 for(let offset=0;;offset+=500){let q=supabase.from(table).select(select).order('id').range(offset,offset+499);if(filter)q=q.eq(...filter);
  const {data,error}=await q.abortSignal(AbortSignal.timeout(30000));
  if(error){if(['42703','42P01','PGRST204','PGRST205'].includes(error.code))return [];throw error;}
  result.push(...(data??[]) as unknown as T[]);if((data??[]).length<500)return result;
 }
}
export async function oilSchedulesForVehicles(vehicles:Vehicle[]) {
 const schedules=await pages<ServiceSchedule & {maintenance_requirement_vehicles:{vehicle_id:string}[]}>('maintenance_requirements','*,maintenance_requirement_vehicles(vehicle_id)',['service_key','engine_oil']);
 return vehicles.map(v=>{const s=schedules.find(s=>s.active&&s.schedule_kind==='replacement'&&s.maintenance_requirement_vehicles.some(a=>a.vehicle_id===v.id));return s?{...v,maintenance_oil_schedule:s}:v;});
}
export async function maintenanceOilEvents():Promise<VehicleServiceLog[]> {
 const items=await pages<MaintenanceItem & {maintenance_records:MaintenanceRecord & {vehicles:{vehicle_reg:string}}}>('maintenance_items','id,record_id,service_key,service_action,service_confirmed,maintenance_records!inner(id,vehicle_id,service_date,odometer,is_deleted,created_at,updated_at,vehicles!inner(vehicle_reg))',['service_key','engine_oil']);
 const visits=new Set<string>();
 return items.filter(i=>i.service_confirmed&&i.service_action==='fluid_replacement'&&!i.maintenance_records.is_deleted).filter(i=>{if(visits.has(i.record_id))return false;visits.add(i.record_id);return true;}).map(i=>{
  const r=i.maintenance_records;return {id:`maintenance-${r.id}`,maintenance_record_id:r.id,vehicle_id:r.vehicle_id,vehicle_reg:r.vehicles.vehicle_reg,service_type:'oil_change',service_date:r.service_date,odometer:r.odometer as number,oil_change_odometer:r.odometer,interval_km:null,notes:null,created_at:r.created_at,updated_at:r.updated_at};
 });
}
