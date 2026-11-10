import { allocateDistance, calculateVehicleDay } from "./fleet-intelligence";
import { fuelIntelligence } from "./fleet-intelligence-operations";
import { reconcileValues, requireCompleteReconciliation } from "./fleet-intelligence-sources";
export type VehicleDayReport={vehicleId:string;daily:ReturnType<typeof calculateVehicleDay>;allocation:ReturnType<typeof allocateDistance>;fuel:ReturnType<typeof fuelIntelligence>};
const sumKnown=(rows:readonly (number|null)[])=>rows.some(n=>n!==null) ? rows.reduce<number>((n,v)=>n+(v??0),0) : null;
/** Same validated vehicle-days feed daily/weekly/monthly scopes. No rounding before reconciliation. */
export function buildFleetReport(rows:readonly VehicleDayReport[]) {
  const keys=new Set<string>();
  for(const r of rows) {
    const key=`${r.vehicleId}:${r.daily.day}`;
    if(keys.has(key)) throw new Error("duplicate_vehicle_day");keys.add(key);
    if(r.daily.observedKm===null ? r.allocation.rows.length!==0 : Math.abs(r.daily.observedKm-r.allocation.totalObservedKm)>1e-8) throw new Error("daily_allocation_mismatch");
    if(Math.abs(r.allocation.allocatedKm+r.allocation.unassignedKm-r.allocation.totalObservedKm)>1e-8) throw new Error("allocation_mismatch");
  }
  const jobKm=new Map<string,number>();
  for(const r of rows) for(const a of r.allocation.rows) if(a.kind==="job"&&a.jobId) jobKm.set(a.jobId,(jobKm.get(a.jobId)??0)+a.km);
  const reconciliation=rows.length?rows.map(r=>({vehicleId:r.vehicleId,day:r.daily.day,check:reconcileValues(r.daily.observedKm,r.daily.observedKm===null?null:r.allocation.totalObservedKm,r.daily.complete)})): [{vehicleId:null,day:null,check:reconcileValues(null,null,false)}];
  return {version:"ees-fleet-report-v2",reconciliation,vehicleDays:rows.length,coveredVehicleDays:rows.filter(r=>r.daily.complete).length,
    observedKm:sumKnown(rows.map(r=>r.daily.observedKm)),unassignedKm:sumKnown(rows.map(r=>r.daily.observedKm===null ? null : r.allocation.unassignedKm)),
    activeHours:sumKnown(rows.map(r=>r.daily.activeHours)),idleHours:sumKnown(rows.map(r=>r.daily.idleHours)),
    missingSeconds:rows.reduce((n,r)=>n+r.daily.missingSeconds,0),
    jobs:[...jobKm].map(([jobId,km])=>({jobId,observedKm:km,fuelCostThb:null,reason:"job_fuel_allocation_not_verified"})),
    fuel:(["diesel","petrol","lpg"] as const).map(fuel=>{
      const f=rows.flatMap(r=>r.fuel.filter(v=>v.fuel===fuel));
      return {fuel,purchasedLitres:sumKnown(f.map(r=>r.purchasedLitres)),purchaseCostThb:sumKnown(f.map(r=>r.purchaseCostThb)),
        measuredLitres:sumKnown(f.map(r=>r.method==="measured" ? r.consumedLitres : null)),estimatedLitres:sumKnown(f.map(r=>r.method==="estimated" ? r.consumedLitres : null)),
        consumptionCostThb:sumKnown(f.map(r=>r.consumptionCostThb)),missingConsumptionVehicleDays:f.filter(r=>r.consumedLitres===null).length};
    }),
    note:"Totals include known values only. Missing vehicle-days and consumption are not zero; estimates and measured litres remain separate."};
}

/** CSV for spreadsheets; text is formula-safe and unknown numeric values stay blank. */
export function vehicleDaysCsv(rows:readonly VehicleDayReport[]) {
  const report=buildFleetReport(rows); // Export of incomplete values must be explicitly labelled.
  const cell=(v:string|number|null)=>v===null ? "" : typeof v==="number" ? String(v) : '"'+(/^[\s]*[=+@\-]/.test(v)?"'":"")+v.replace(/"/g,'""')+'"';
  if(report.reconciliation.some(r=>r.check.status==="fail"))throw new Error("report_reconciliation_failed");
  const headers=["vehicle_id","Bangkok_day","observed_km","depot_km","job_km","repositioning_km","unassigned_km","covered_seconds","missing_seconds","sample_coverage_complete","method"];
  return '\uFEFF'+[headers,...rows.map(r=>[r.vehicleId,r.daily.day,r.daily.observedKm,r.daily.observedKm===null?null:r.allocation.depotKm,r.daily.observedKm===null?null:r.allocation.jobKm,r.daily.observedKm===null?null:r.allocation.repositioningKm,r.daily.observedKm===null?null:r.allocation.unassignedKm,r.daily.coveredSeconds,r.daily.missingSeconds,r.daily.complete?"yes":"no",r.daily.confidence])].map(row=>row.map(cell).join(',')).join('\r\n');
}

export function requireCompleteFleetReport(rows:readonly VehicleDayReport[]){
 const report=buildFleetReport(rows);for(const r of report.reconciliation)requireCompleteReconciliation(r.check);return report;
}
