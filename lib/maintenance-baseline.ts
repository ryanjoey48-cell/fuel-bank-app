import type {MaintenanceData} from './maintenance-types';
import {latestVehicleChecks,vehicleCheckCatalogue,type VehicleMaintenanceCheck} from './maintenance-office';
import {maintenanceToday} from './maintenance';

export type BaselineState='not_started'|'in_progress'|'established';
export function vehicleBaseline(data:MaintenanceData,checks:VehicleMaintenanceCheck[],vehicleId:string,today=maintenanceToday()) {
  const latest=latestVehicleChecks(checks,vehicleId,today),catalogue=vehicleCheckCatalogue(data,checks,vehicleId);
  let assessed=0,applicabilityReview=0;
  for(const item of catalogue){
    const check=latest.get(item.key);
    const schedules=data.requirements.filter(s=>s.active&&s.service_key===item.key&&data.applicability.some(a=>a.vehicle_id===vehicleId&&a.requirement_id===s.id));
    const supportedNA=check?.result==='not_applicable'&&(!!check.notes?.trim()||schedules.some(s=>s.applicability_status==='not_applicable'));
    if(check?.result==='ok'||check?.result==='attention'||supportedNA)assessed++;
    else if(check?.result==='not_applicable'||['spark_plugs','timing_belt','timing_chain'].includes(item.key))applicabilityReview++;
  }
  const state:BaselineState=assessed===0?'not_started':assessed===catalogue.length?'established':'in_progress';
  return {state,assessed,total:catalogue.length,applicabilityReview,
    latestDate:[...latest.values()].filter(c=>c.result!=='not_checked').map(c=>c.check_date).sort().at(-1)??null,
    hasIssue:[...latest.values()].some(c=>c.result==='attention')};
}
export function baselineLabel(state:BaselineState,language:'en'|'th') {
  return (language==='th'?{not_started:'ยังไม่เริ่ม',in_progress:'กำลังดำเนินการ',established:'เก็บข้อมูลตั้งต้นครบแล้ว'}
    :{not_started:'Not started',in_progress:'In progress',established:'Baseline established'})[state];
}
