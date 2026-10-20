import {newMaintenanceItem} from './maintenance';
import type {MaintenanceItemInput} from './maintenance-types';
import {OIL_CHANGE_INTERVAL_BY_VEHICLE_TYPE} from './oil-change-service';

// Package composition is operational policy, not historical replacement evidence.
export const ENGINE_OIL_PACKAGE = {
  key:'ees_engine_oil_v1',
  vehicleTypes:Object.keys(OIL_CHANGE_INTERVAL_BY_VEHICLE_TYPE),
  intervalServiceKey:'engine_oil',
  components:[
    {key:'engine_oil',en:'Engine Oil',th:'น้ำมันเครื่อง',action:'fluid_replacement',category:'oil'},
    {key:'oil_filter',en:'Engine Oil Filter',th:'ไส้กรองน้ำมันเครื่อง',action:'component_replacement',category:'oil'},
    {key:'fuel_filter',en:'Fuel Filter',th:'ไส้กรองน้ำมันเชื้อเพลิง',action:'component_replacement',category:'engine'},
  ],
} as const;

export function proposedOilPackage(makeId:()=>string):MaintenanceItemInput[] {
  return ENGINE_OIL_PACKAGE.components.map(component=>({...newMaintenanceItem(makeId()),
    service_key:component.key,description:component.en,description_th:component.th,
    category:component.category,service_action:component.action,service_confirmed:false}));
}

export function validateOilPackage(items:MaintenanceItemInput[]) {
  return ENGINE_OIL_PACKAGE.components.every(component=>{
    const matching=items.filter(item=>item.service_key===component.key);
    return matching.length===1 && matching[0].service_action===component.action
      && (matching[0].service_confirmed===true || !!matching[0].notes?.trim());
  });
}
