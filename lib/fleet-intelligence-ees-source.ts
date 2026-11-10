import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { bangkokDay } from "./fleet-intelligence";
import type { OdometerCheckpoint } from "./fleet-intelligence-mileage";

const registrationKey=(s:string)=>s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g,"").toUpperCase();
export type BookingSnapshot={
  id:string;booking_date:string;pickup_time:string|null;vehicle_id:string|null;
  vehicle:string|null;vehicle_registration:string|null;driver_id:string|null;job_order_number:string|null;
  pickup_lat:number|null;pickup_lng:number|null;dropoff_lat:number|null;dropoff_lng:number|null;
  booking_id?:string|null;pickup?:string|null;dropoff?:string|null;driver?:string|null;
  pickup_location_id?:string|null;dropoff_location_id?:string|null;
  route_confirmation_status?:string|null;updated_at:string;
};
export type FuelSnapshot={id:string;date:string;vehicle_reg:string;litres:number;total_cost:number;fuel_type:string|null;odometer:number|null;created_at:string};
type ColumnError={code?:string;message?:string;details?:string;hint?:string};
type SnapshotVariant={select:string;columns:string[]};
type SnapshotRead={rows:Record<string,unknown>[];columns:string[]};
const missingColumn=(error:ColumnError)=>error.code==="42703"||error.code==="PGRST204"||
  [error.message,error.details,error.hint].some(value=>typeof value==="string"&&
    (value.toLowerCase().includes("does not exist")||value.toLowerCase().includes("could not find the")&&value.toLowerCase().includes("column")));
async function readCompatibleSnapshot(variants:readonly SnapshotVariant[],query:(select:string)=>Promise<{data:unknown[]|null;error:ColumnError|null}>):Promise<SnapshotRead>{
 for(const variant of variants){
  const result=await query(variant.select);
  if(!result.error)return {rows:(result.data??[]) as Record<string,unknown>[],columns:variant.columns};
  if(!missingColumn(result.error))throw new Error("mileage_snapshot_unavailable");
 }
 throw new Error("mileage_snapshot_unavailable");
}
const snapshotVariants=(selections:readonly string[]):SnapshotVariant[]=>selections.map(select=>({select,columns:select.split(",")}));
const nonnegativeNumber=(value:unknown):number|null=>{
 const number=typeof value==="number"?value:typeof value==="string"&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN;
 return Number.isFinite(number)&&number>=0?number:null;
};
/** Bounded, read-only snapshots. Caller supplies a trusted user-scoped client and
 * an authorization check using existing EES verified-user/business:read helpers.
 * Nothing in this module imports the browser data module or its mutation helpers.
 */
export async function readEesFleetDay(input:{vehicleId:string;registrations:readonly string[];day:string},deps:{client:SupabaseClient;authorize:()=>Promise<boolean>}) {
  bangkokDay(input.day);
  if(!input.vehicleId||input.registrations.length<1||input.registrations.length>10||input.registrations.some(r=>!r||r.length>80)) throw new Error("invalid_ees_scope");
  if(!await deps.authorize()) throw new Error("ees_access_denied");
  const keys=new Set(input.registrations.map(registrationKey));
  const [bookings,fuel]=await Promise.all([
    deps.client.from("booking_diary").select("id,booking_date,pickup_time,vehicle_id,vehicle,vehicle_registration,driver_id,job_order_number,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,updated_at").eq("booking_date",input.day).order("id").limit(501),
    deps.client.from("fuel_logs").select("id,date,vehicle_reg,litres,total_cost,fuel_type,odometer,created_at").eq("date",input.day).order("id").limit(501)
  ]);
  if(bookings.error||fuel.error) throw new Error("ees_snapshot_unavailable");
  if((bookings.data?.length??0)>500||(fuel.data?.length??0)>500) throw new Error("ees_day_limit_exceeded");
  const scopedBookings=((bookings.data??[]) as BookingSnapshot[]).filter(row=>row.vehicle_id ? row.vehicle_id===input.vehicleId : keys.has(registrationKey(row.vehicle_registration??row.vehicle??"")));
  const scopedFuel=((fuel.data??[]) as FuelSnapshot[]).filter(row=>keys.has(registrationKey(row.vehicle_reg)));
  return {vehicleId:input.vehicleId,day:input.day,bookings:scopedBookings,fuelPurchases:scopedFuel,
    capabilities:{bookingRouteConfirmation:"unsupported_by_deployed_source",fullTankConfirmation:"unsupported_by_deployed_source"},
    limitations:["Booking pickup_time is not a verified completion window.","driver_id is assignment evidence, not confirmation of who drove.","Fuel rows are purchases; units and fuel type require review.","Cross-day and multi-stop jobs need additional reviewed evidence."]};
}

/** Existing checkpoint snapshots only: no new entry workflow and no source correction. */
export async function readEesMileageEvidence(input:{vehicleId:string;registrations:readonly string[];fromDay:string;toDay:string},deps:{client:SupabaseClient;authorize:()=>Promise<boolean>}){
 const lo=bangkokDay(input.fromDay),hi=bangkokDay(input.toDay);
 if(!input.vehicleId||input.registrations.length<1||input.registrations.length>10||hi.start<lo.start||hi.end-lo.start>62*86400000)throw new Error("invalid_mileage_scope");
 if(!await deps.authorize())throw new Error("ees_access_denied");
 const fuelVariants=snapshotVariants([
  "id,date,vehicle_id,vehicle_reg,odometer,mileage,litres,total_cost,fuel_type,receipt_checked,created_at",
  "id,date,vehicle_reg,odometer,mileage,litres,total_cost,fuel_type,receipt_checked,created_at",
  "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,receipt_checked,created_at",
  "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,created_at",
  "id,date,vehicle_reg,mileage,litres,total_cost,fuel_type,created_at"
 ]);
 const weeklyVariants=snapshotVariants([
  "id,week_ending,vehicle_id,vehicle_reg,odometer_reading,is_odometer_baseline,created_at",
  "id,week_ending,driver_id,vehicle_reg,odometer_reading,is_odometer_baseline,created_at",
  "id,week_ending,vehicle_reg,odometer_reading,is_odometer_baseline,created_at",
  "id,week_ending,vehicle_reg,odometer_reading,created_at",
  "id,week_ending,driver,vehicle_reg,mileage,created_at"
 ]);
 const [fuelResult,weeklyResult]=await Promise.allSettled([
  readCompatibleSnapshot(fuelVariants,async select=>{
   const result=await deps.client.from("fuel_logs").select(select).in("vehicle_reg",[...input.registrations]).gte("date",input.fromDay).lte("date",input.toDay).order("date").limit(501);
   return {data:result.data as unknown[]|null,error:result.error};
  }),
  readCompatibleSnapshot(weeklyVariants,async select=>{
   const result=await deps.client.from("weekly_mileage").select(select).in("vehicle_reg",[...input.registrations]).gte("week_ending",input.fromDay).lte("week_ending",input.toDay).order("week_ending").limit(501);
   return {data:result.data as unknown[]|null,error:result.error};
  })
 ]);
 if(fuelResult.status === "rejected" && weeklyResult.status === "rejected") throw new Error("mileage_snapshot_unavailable");
 const fuel = fuelResult.status === "fulfilled" ? fuelResult.value : { rows: [], columns: [] };
 const weekly = weeklyResult.status === "fulfilled" ? weeklyResult.value : { rows: [], columns: [] };
 if(fuel.rows.length>500||weekly.rows.length>500)throw new Error("mileage_scope_truncated");
 const checkpoints:OdometerCheckpoint[]=[];
 const registrations=new Set(input.registrations.map(registrationKey));
 for(const [source,snapshot] of [["fuel_logs",fuel],["weekly_mileage",weekly]] as const){
  const columns=new Set(snapshot.columns);
  for(const row of snapshot.rows){
   const id=row.id,registration=row.vehicle_reg,createdAt=row.created_at;
   if((typeof id!=="string"&&typeof id!=="number")||typeof registration!=="string"||!registration||typeof createdAt!=="string")throw new Error("mileage_snapshot_invalid_row");
   if(!registrations.has(registrationKey(registration)))continue;
   const stableVehicleId=typeof row.vehicle_id==="string"&&row.vehicle_id?row.vehicle_id:null;
   if(stableVehicleId&&stableVehicleId!==input.vehicleId)continue;
   const observationDate=source==="fuel_logs"?row.date:row.week_ending;
   if(typeof observationDate!=="string")throw new Error("mileage_snapshot_invalid_row");
   bangkokDay(observationDate);
   const primaryColumn=source==="fuel_logs"?(columns.has("odometer")?"odometer":"mileage"):
    (columns.has("odometer_reading")?"odometer_reading":"mileage");
   const primary=nonnegativeNumber(row[primaryColumn]);
   const aliasColumn=source==="fuel_logs"?(primaryColumn==="odometer"?"mileage":null):
    (primaryColumn==="odometer_reading"&&columns.has("mileage")?"mileage":null);
   const alias=aliasColumn?nonnegativeNumber(row[aliasColumn]):null;
   const conflictingAlias=alias!==null&&primary!==null&&alias!==primary;
   const raw={...row};
   const baseline=source==="fuel_logs"?false:
    columns.has("is_odometer_baseline")?(typeof row.is_odometer_baseline==="boolean"?row.is_odometer_baseline:null):null;
   checkpoints.push({id:String(id),source,vehicleId:input.vehicleId,registrationSnapshot:registration,
    observationDate,observedAt:null,enteredAt:createdAt,odometerKm:conflictingAlias?null:primary,
    meterEpoch:"unconfirmed-original",baseline,identity:stableVehicleId?"confirmed":"registration_only",
    sourceHash:createHash("sha256").update(JSON.stringify(raw)).digest("hex"),raw,
    fullTankConfirmed:null,fuelType:typeof row.fuel_type==="string"?row.fuel_type:null,
    purchasedLitres:nonnegativeNumber(row.litres),costThb:nonnegativeNumber(row.total_cost)});
  }
 }
 return {checkpoints,completeSourceRead:fuelResult.status === "fulfilled" && weeklyResult.status === "fulfilled",
  sourceStatus:{fuel:fuelResult.status === "fulfilled" ? "available" as const : "unavailable" as const,weekly:weeklyResult.status === "fulfilled" ? "available" as const : "unavailable" as const},capabilities:{fuelColumns:fuel.columns,weeklyMileageColumns:weekly.columns,
   observationTime:"date_only",weeklyDateBasis:"week_ending_proxy_not_confirmed_observation_time",fullTankConfirmed:"unsupported"},
  note:"Registration-only identities and date-only readings require office review. created_at is never the observation timestamp."};
}

/** Bounded range snapshot for day-by-day review; no invented job end/delivery times. */
export async function readEesBookingRange(input:{vehicleId:string;registrations:readonly string[];fromDay:string;toDay:string},deps:{client:SupabaseClient;authorize:()=>Promise<boolean>}) {
 const lo=bangkokDay(input.fromDay),hi=bangkokDay(input.toDay);
 if(!input.vehicleId || hi.start < lo.start || hi.end-lo.start > 62*86400000 || !await deps.authorize()) throw new Error("invalid_booking_scope");
 const result=await deps.client.from("booking_diary").select("id,booking_id,booking_date,pickup_time,pickup,dropoff,driver,vehicle_id,vehicle,vehicle_registration,driver_id,job_order_number,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_location_id,dropoff_location_id,updated_at").gte("booking_date",input.fromDay).lte("booking_date",input.toDay).order("booking_date").limit(501);
 if(result.error || (result.data?.length??0)>500) throw new Error("booking_range_unavailable");
 const keys=new Set(input.registrations.map(registrationKey));
 return ((result.data??[]) as BookingSnapshot[]).filter(row=>row.vehicle_id ? row.vehicle_id===input.vehicleId : keys.has(registrationKey(row.vehicle_registration??row.vehicle??"")));
}
