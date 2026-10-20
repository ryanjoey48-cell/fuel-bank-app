"use client";
import { hrAction,hrRequest } from "@/lib/ees-hr-v7-client";
import type { HRProfile } from "@/lib/ees-hr-v7-types";
import { fetchVehicles } from "@/lib/data";
export type VehicleAssignment={id:string;driver_id:string;vehicle_id:string;effective_from:string;effective_to:string|null;assignment_kind:"permanent"|"temporary";reason:string;notes:string|null;previous_vehicle_reg:string|null;recorded_at:string;recorded_by:string|null;};
export async function fetchVehicleAssignmentHistory(driverId:string){const profile=await hrRequest<HRProfile>(`profile/driver/${encodeURIComponent(driverId)}?section=assignments`);return (profile.data.history??[]) as VehicleAssignment[];}
export async function fetchAssignableVehicles(){return fetchVehicles();}
export async function changeDriverVehicle(input:{driverId:string;vehicleId:string;date:string;kind:"permanent"|"temporary";endDate?:string;reason:string;notes:string}){return hrAction("change_vehicle",input);}
