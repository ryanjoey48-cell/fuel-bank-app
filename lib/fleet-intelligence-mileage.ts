import { bangkokDay } from "./fleet-intelligence";
import type { SourceMetric } from "./fleet-intelligence-sources";

export type OdometerCheckpoint={
  id:string;source:"fuel_logs"|"weekly_mileage";vehicleId:string;registrationSnapshot:string;
  observationDate:string;observedAt:string|null;enteredAt:string;odometerKm:number|null;
  meterEpoch:string;baseline:boolean|null;identity:"confirmed"|"registration_only"|"ambiguous";
  sourceHash:string;raw:Record<string,unknown>;fullTankConfirmed?:boolean|null;fuelType?:string|null;purchasedLitres?:number|null;costThb?:number|null;
};
export const MILEAGE_REVIEW_COPY={
  title:{en:"Mileage Reconciliation",th:"กระทบยอดระยะทาง"},fuel:{en:"Fuel-log readings",th:"เลขไมล์จากบันทึกเชื้อเพลิง"},weekly:{en:"Weekly readings",th:"เลขไมล์ประจำสัปดาห์"},
  provider:{en:"Forth reported distance",th:"ระยะทางที่ Forth รายงาน"},gps:{en:"GPS-derived distance",th:"ระยะทางคำนวณจาก GPS"},
  observation:{en:"Observation date / uncertainty",th:"วันที่อ่านค่า / ความไม่แน่นอน"},entry:{en:"Entry timestamp",th:"เวลาบันทึกข้อมูล"},review:{en:"Office review required",th:"ต้องให้สำนักงานตรวจสอบ"}
} as const;
export function checkpointBounds(p:OdometerCheckpoint){
 const day=bangkokDay(p.observationDate);
 if(p.observedAt!==null){const t=Date.parse(p.observedAt);if(!Number.isFinite(t)||t<day.start||t>=day.end)throw new Error("invalid_observation_time");return {earliest:t,latest:t,precision:"instant" as const};}
 return {earliest:day.start,latest:day.end-1,precision:"day" as const};
}
export function checkpointIntervals(points:readonly OdometerCheckpoint[],maxKmPerDay=2000){
 if(!Number.isFinite(maxKmPerDay)||maxKmPerDay<=0)throw new Error("invalid_odometer_policy");
 const groups=new Map<string,OdometerCheckpoint[]>();const seen=new Map<string,string>();
 for(const p of points){
  if(!p.id||!p.vehicleId||!p.sourceHash||!p.meterEpoch||!Number.isFinite(Date.parse(p.enteredAt)))throw new Error("invalid_checkpoint_provenance");
  const identity=p.source+":"+p.id;
  if(seen.has(identity)&&seen.get(identity)!==p.sourceHash)throw new Error("conflicting_checkpoint_revision");
  if(seen.has(identity))continue;seen.set(identity,p.sourceHash);
  const k=JSON.stringify([p.source,p.vehicleId,p.meterEpoch,p.observationDate,p.observedAt]);groups.set(k,[...(groups.get(k)??[]),p]);
 }
 const checkpoints=[...groups.values()].map(rows=>({p:rows[0],evidenceIds:rows.map(r=>`${r.source}:${r.id}`),conflict:rows.some(r=>r.odometerKm!==rows[0].odometerKm||r.baseline!==rows[0].baseline||r.identity!==rows[0].identity),bounds:checkpointBounds(rows[0])}));
 checkpoints.sort((a,b)=>a.p.source.localeCompare(b.p.source)||a.p.vehicleId.localeCompare(b.p.vehicleId)||a.bounds.earliest-b.bounds.earliest);
 const intervals: {source:string;vehicleId:string;from:OdometerCheckpoint;to:OdometerCheckpoint;evidenceIds:string[];metric:SourceMetric;reviewRequired:boolean}[]=[];
 const blocked=new Set<string>();
 for(let i=1;i<checkpoints.length;i++){
  const a=checkpoints[i-1],b=checkpoints[i];
  if(a.p.source!==b.p.source||a.p.vehicleId!==b.p.vehicleId)continue;
  const key=a.p.source+":"+a.p.vehicleId;
  let reason:string|null=a.p.meterEpoch!==b.p.meterEpoch||b.p.baseline===true?"reset_or_replacement_boundary":a.p.baseline===null||b.p.baseline===null?"baseline_status_unknown":a.conflict||b.conflict?"same_observation_conflict":
   a.p.identity==="ambiguous"||b.p.identity==="ambiguous"?"identity_ambiguous":
   a.p.odometerKm===null||b.p.odometerKm===null||![a.p.odometerKm,b.p.odometerKm].every(n=>Number.isFinite(n)&&n!>=0)?"missing_or_invalid_reading":
   b.bounds.earliest<=a.bounds.latest?"overlapping_observation_uncertainty":null;
  const delta=reason?null:b.p.odometerKm!-a.p.odometerKm!;
  if(delta!==null&&delta<0){reason="odometer_decrease_requires_review";blocked.add(key);}
  if(delta!==null&&delta>maxKmPerDay*(b.bounds.latest-a.bounds.earliest)/86400000){reason="implausible_checkpoint_jump";blocked.add(key);}
  if(b.p.baseline===true||a.p.meterEpoch!==b.p.meterEpoch)blocked.delete(key);
  else if(blocked.has(key)&&!reason)reason="unresolved_prior_bad_reading";
  const exact=a.bounds.precision==="instant"&&b.bounds.precision==="instant"&&a.p.identity==="confirmed"&&b.p.identity==="confirmed";
  const value=reason?null:delta;
  const metric:SourceMetric={source:a.p.source,unit:"km",value,status:value===null?"unknown":!exact?"incomplete":value===0?"verified_zero":"known",
   period:{start:new Date(a.bounds.earliest).toISOString(),end:new Date(b.bounds.latest).toISOString(),timeZone:"Asia/Bangkok"},
   completeness:exact&&value!==null?"complete":"incomplete",confidence:"checkpoint_difference",sourceTimestamp:b.p.enteredAt,evidenceIds:[...a.evidenceIds,...b.evidenceIds],
   reasons:reason?[reason]:exact?[]:["observation_time_or_identity_uncertain"]};
  intervals.push({source:a.p.source,vehicleId:a.p.vehicleId,from:a.p,to:b.p,evidenceIds:metric.evidenceIds,metric,reviewRequired:reason!==null||!exact});
 }
 return intervals;
}
/** Only compare identical time scopes; do not prorate weekly readings onto a GPS day. */
export function compareMileagePeriods(a:SourceMetric,b:SourceMetric,toleranceKm:number){
 if(!Number.isFinite(toleranceKm)||toleranceKm<0)throw new Error("invalid_discrepancy_tolerance");
 if(a.value===null||b.value===null)return {status:"not_comparable",differenceKm:null,reason:"missing_distance"};
 if(a.period.start!==b.period.start||a.period.end!==b.period.end||a.period.timeZone!==b.period.timeZone)return {status:"not_comparable",differenceKm:null,reason:"different_observation_periods"};
 if(a.completeness!=="complete"||b.completeness!=="complete")return {status:"incomplete",differenceKm:null,reason:"uncertain_time_or_coverage"};
 const differenceKm=b.value-a.value;
 return {status:Math.abs(differenceKm)>toleranceKm?"review_required":"within_tolerance",differenceKm,reason:"same_period_comparison_no_source_correction"};
}
/** Fill-to-fill is an interval estimate, not a measured daily/journey consumption. */
export function fillToFillEfficiency(points:readonly OdometerCheckpoint[],scope:{vehicleId:string;startId:string;endId:string;allFillsAccountedFor:boolean;fuelTypeVerified:boolean;mixedFuel:boolean;evidenceReference:string}){
 const unknown=(reason:string)=>({status:"unknown" as const,estimatedConsumedLitres:null,kmPerLitre:null,distanceKm:null,reason});
 if(!scope.evidenceReference.trim()||!scope.allFillsAccountedFor||!scope.fuelTypeVerified||scope.mixedFuel)return unknown("fill_completeness_or_fuel_type_unverified");
 const rows=points.filter(p=>p.source==="fuel_logs"&&p.vehicleId===scope.vehicleId);
 const a=rows.find(p=>p.id===scope.startId),b=rows.find(p=>p.id===scope.endId);
 if(!a||!b||a.id===b.id||!a.observedAt||!b.observedAt||a.baseline!==false||b.baseline!==false||!a.fullTankConfirmed||!b.fullTankConfirmed||a.identity!=="confirmed"||b.identity!=="confirmed")return unknown("full_tank_or_exact_time_unconfirmed");
 const start=checkpointBounds(a).earliest,end=checkpointBounds(b).earliest;
 if(end<=start||!a.fuelType||a.fuelType!==b.fuelType||a.meterEpoch!==b.meterEpoch||a.odometerKm===null||b.odometerKm===null||b.odometerKm<=a.odometerKm)return unknown("invalid_fill_interval");
 const fills=rows.filter(p=>{const t=checkpointBounds(p);return t.latest>start&&t.earliest<=end;});
 if(fills.some(p=>!p.observedAt||p.identity!=="confirmed"||p.fuelType!==a.fuelType||p.meterEpoch!==a.meterEpoch||p.baseline!==false||p.purchasedLitres===null||p.purchasedLitres===undefined||!Number.isFinite(p.purchasedLitres)||p.purchasedLitres<=0)||new Set(fills.map(p=>p.id)).size!==fills.length)return unknown("missing_conflicting_or_mixed_fills");
 const ordered=[a,...fills].sort((l,r)=>Date.parse(l.observedAt!)-Date.parse(r.observedAt!));
 if(ordered.some((p,i)=>p.odometerKm===null||i>0&&p.odometerKm!<ordered[i-1].odometerKm!))return unknown("reset_or_bad_checkpoint_within_fills");
 const litres=fills.reduce((n,p)=>n+p.purchasedLitres!,0),km=b.odometerKm-a.odometerKm;
 if(!litres)return unknown("no_interval_refills");
 return {status:"estimated" as const,estimatedConsumedLitres:litres,kmPerLitre:km/litres,distanceKm:km,reason:"confirmed_full_to_full_interval_excludes_opening_fill",evidenceReference:scope.evidenceReference};
}
