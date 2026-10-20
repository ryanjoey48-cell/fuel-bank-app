import type {Vehicle} from '@/types/database';

// Existing EES vehicles store their model/name in vehicle_name. Prefer an
// explicit model when supplied by a vehicle source; never infer one from type.
export function maintenanceVehicleModel(vehicle?:Partial<Vehicle>|null){
 if(!vehicle)return '';
 const source=vehicle as Partial<Vehicle>&{vehicle_model?:string|null;model?:string|null;model_name?:string|null};
 return [source.vehicle_model,source.model,source.model_name,source.vehicle_name].find(value=>typeof value==='string'&&value.trim())?.trim()??'';
}
