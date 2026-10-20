import {supabase} from './supabase';
import {maintenanceChanged} from './maintenance-data';
import type {VehicleCheckInput,VehicleMaintenanceCheck} from './maintenance-office';
export async function fetchVehicleMaintenanceChecks():Promise<VehicleMaintenanceCheck[]>{
 const {data:version,error}=await supabase.rpc('maintenance_vehicle_checks_version').abortSignal(AbortSignal.timeout(15000));
 if(error)throw new Error(`maintenance_vehicle_checks_version: ${error.code||'NETWORK'} — ${error.message}`);
 if(version!==1)throw new Error(`MAINTENANCE_CHECKS_VERSION: expected 1, received ${String(version)}`);
 const rows:VehicleMaintenanceCheck[]=[];
 for(let offset=0;;offset+=500){const {data,error}=await supabase.from('maintenance_vehicle_checks').select('*').order('id').range(offset,offset+499).abortSignal(AbortSignal.timeout(15000));if(error)throw error;rows.push(...data as VehicleMaintenanceCheck[]);if((data??[]).length<500)return rows;}
}
export async function maintenanceScheduleReady(){const {data,error}=await supabase.rpc('maintenance_centre_version').abortSignal(AbortSignal.timeout(15000));return !error&&data===1;}
export async function saveVehicleMaintenanceChecks(vehicleId:string,date:string,odometer:number|null,rows:VehicleCheckInput[],requestId:string){
 const {data,error}=await supabase.rpc('save_maintenance_vehicle_checks',{target_vehicle:vehicleId,check_date:date,check_odometer:odometer,check_rows:rows,request_id:requestId}).abortSignal(AbortSignal.timeout(30000));if(error)throw error;const result=data as VehicleMaintenanceCheck[];
 if(!Array.isArray(result)||result.length!==rows.length||new Set(result.map(r=>r.service_key)).size!==rows.length||result.some(r=>{
  const expected=rows.find(row=>row.service_key===r.service_key);
  return r.vehicle_id!==vehicleId||r.request_id!==requestId||r.check_date!==date||!expected||r.result!==expected.result||r.odometer!==null&&Number(r.odometer)!==odometer||r.odometer===null&&odometer!==null;
 }))throw new Error('MAINTENANCE_CHECK_VERIFY');maintenanceChanged();return result;
}
