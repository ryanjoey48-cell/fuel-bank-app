import { supabase } from "@/lib/supabase";
import type { Driver, FuelLog, Vehicle, WeeklyMileageEntry } from "@/types/database";
import type { MaintenanceAttachment, MaintenanceData, MaintenanceItem, MaintenanceItemInput, MaintenanceRecord, MaintenanceRecordInput, MaintenanceRequirement, MaintenanceApplicability } from "./maintenance-types";

export class MaintenanceLoadError extends Error {
 constructor(public table: string, public code: string, public status: number, message: string) {
  super(`Maintenance query failed: ${table} (${status}, ${code}): ${message}`);
  this.name = "MaintenanceLoadError";
 }
}

async function all<T>(table: string): Promise<T[]> {
 const rows: T[] = [];
 for (let offset = 0; ; offset += 500) {
  let query = supabase.from(table).select("*")
   .order(table === "maintenance_requirement_vehicles" ? "requirement_id" : "id");
  // A composite key needs both columns for stable pagination.
  if (table === "maintenance_requirement_vehicles") query = query.order("vehicle_id");
  const { data, error, status } = await query.range(offset, offset + 499).abortSignal(AbortSignal.timeout(30000));
  if (error) {
   const failure = new MaintenanceLoadError(table, error.code, status, error.message);
   console.error(failure.message);
   throw failure;
  }
  rows.push(...(data ?? []) as T[]);
  if ((data ?? []).length < 500) return rows;
 }
}
export async function fetchMaintenanceData(includeFuel=false):Promise<MaintenanceData> {
 const [vehicles,drivers,mileage,records,items,requirements,applicability,attachments,fuel]=await Promise.all([all<Vehicle>("vehicles"),all<Driver>("drivers"),all<WeeklyMileageEntry>("weekly_mileage"),all<MaintenanceRecord>("maintenance_records"),all<MaintenanceItem>("maintenance_items"),all<MaintenanceRequirement>("maintenance_requirements"),all<MaintenanceApplicability>("maintenance_requirement_vehicles"),all<MaintenanceAttachment>("maintenance_attachments"),includeFuel?all<FuelLog>("fuel_logs"):Promise.resolve([])]);
 return {vehicles,drivers,mileage,records,items,requirements,applicability,attachments,fuel};
}
export function maintenanceChanged(){window.dispatchEvent(new CustomEvent("fuel-bank:data-changed",{detail:{resource:"maintenance"}}));}
export async function saveMaintenanceRecord(payload:MaintenanceRecordInput,items:MaintenanceItemInput[],updatedAt:string|null) {
 const {data,error}=await supabase.rpc("save_maintenance_record",{payload,item_rows:items,expected_updated_at:updatedAt});if(error)throw error;maintenanceChanged();
 const {data:record,error:readError}=await supabase.from("maintenance_records").select("*").eq("id",data).single();if(readError)throw readError;return record as MaintenanceRecord;
}
export async function deleteMaintenanceRecord(record:MaintenanceRecord){const {error}=await supabase.rpc("delete_maintenance_record",{target_id:record.id,expected_updated_at:record.updated_at});if(error)throw error;maintenanceChanged();}
export async function saveMaintenanceRequirement(payload:Partial<MaintenanceRequirement>,vehicleIds:string[],updatedAt:string|null){const {error}=await supabase.rpc("save_maintenance_requirement",{payload,vehicle_ids:vehicleIds,expected_updated_at:updatedAt});if(error)throw error;maintenanceChanged();}
export const MAINTENANCE_ATTACHMENT_LIMIT=10*1024*1024;
export async function validateMaintenanceFile(file:File) {
 if(file.size===0 || file.size>MAINTENANCE_ATTACHMENT_LIMIT)throw new Error("MAINTENANCE_FILE_SIZE");
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const mime=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10?"image/png":new TextDecoder().decode(bytes.slice(0,5))==="%PDF-"?"application/pdf":null;
 if(!mime || (file.type && file.type!==mime) || !/\.(jpe?g|png|pdf)$/i.test(file.name))throw new Error("MAINTENANCE_FILE_TYPE");return mime;
}
export async function uploadMaintenanceAttachment(recordId:string,file:File,onProgress:(percent:number)=>void) {
 const mime=await validateMaintenanceFile(file),id=crypto.randomUUID(),path=`${recordId}/${id}.${mime==="application/pdf"?"pdf":mime==="image/png"?"png":"jpg"}`;
 const {data:auth,error:authError}=await supabase.auth.getSession();if(authError||!auth.session)throw new Error("MAINTENANCE_FORBIDDEN");
 await new Promise<void>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open("POST",`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/maintenance-receipts/${path}`);
  xhr.setRequestHeader("Authorization",`Bearer ${auth.session!.access_token}`);xhr.setRequestHeader("apikey",process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);xhr.setRequestHeader("Content-Type",mime);xhr.setRequestHeader("x-upsert","false");xhr.timeout=120000;
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*95));};
  xhr.onerror=xhr.ontimeout=()=>reject(new Error("MAINTENANCE_UPLOAD"));xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error("MAINTENANCE_UPLOAD"));xhr.send(file);
 });
 const {data,error}=await supabase.from("maintenance_attachments").insert({id,record_id:recordId,file_path:path,original_filename:file.name,mime_type:mime,size_bytes:file.size,uploaded_by:auth.session.user.id}).select("*").single();
 if(error){await supabase.storage.from("maintenance-receipts").remove([path]);throw error;}
 onProgress(100);maintenanceChanged();return data as MaintenanceAttachment;
}
export async function viewMaintenanceAttachment(attachment:MaintenanceAttachment){const {data,error}=await supabase.storage.from("maintenance-receipts").createSignedUrl(attachment.file_path,300);if(error)throw error;return data.signedUrl;}
export async function deleteMaintenanceAttachment(attachment:MaintenanceAttachment){const {error:storageError}=await supabase.storage.from("maintenance-receipts").remove([attachment.file_path]);if(storageError)throw storageError;const {error}=await supabase.from("maintenance_attachments").delete().eq("id",attachment.id);if(error)throw error;maintenanceChanged();}
