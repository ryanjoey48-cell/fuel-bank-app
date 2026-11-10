import { bangkokDay } from "./fleet-intelligence";

export type MetricStatus="known"|"verified_zero"|"incomplete"|"unknown"|"not_applicable";
export type Completeness="complete"|"incomplete"|"unknown";
export type SourceMetric={status:MetricStatus;value:number|null;unit:"km"|"L"|"THB";source:string;
  period:{start:string;end:string;timeZone:"Asia/Bangkok"};completeness:Completeness;
  confidence:"provider_reported"|"gps_derived"|"checkpoint_difference"|"human_reported"|"unknown";
  evidenceIds:string[];reasons:string[];sourceTimestamp:string|null};
export const METRIC_STATUS_COPY={
 known:{en:"Reported value",th:"ค่าที่รายงาน"},verified_zero:{en:"Verified zero",th:"ยืนยันว่าเป็นศูนย์"},
 incomplete:{en:"Incomplete evidence",th:"หลักฐานไม่ครบ"},unknown:{en:"Unknown",th:"ไม่ทราบ"},not_applicable:{en:"Not applicable",th:"ไม่เกี่ยวข้อง"}
} as const;
export type Check={status:"pass"|"fail"|"incomplete"|"not_comparable";reason:string;difference:number|null};
export function reconcileValues(expected:number|null,actual:number|null,complete:boolean):Check {
  if(expected===null||actual===null||!Number.isFinite(expected)||!Number.isFinite(actual))return {status:"not_comparable",reason:"missing_numeric_evidence",difference:null};
  const difference=actual-expected;
  if(Math.abs(difference)>1e-8)return {status:"fail",reason:"totals_differ",difference};
  if(!complete)return {status:"incomplete",reason:"source_completeness_not_established",difference};
  return {status:"pass",reason:"complete_totals_match",difference};
}
export function requireCompleteReconciliation(check:Check) {if(check.status!=="pass")throw new Error(`reconciliation_${check.status}:${check.reason}`);}

type ReportRow=Record<string,unknown>;
const cents=(value:unknown)=>typeof value==="string"&&/^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value)*100) : null;
/** Report row totals are not GPS distances. Overlapping/contradictory intervals withhold the additive sum. */
export function reconcileProviderSegments(input:{rows:readonly ReportRow[];deviceId:string;day:string;completeness:Completeness;capturedAt:string}) {
  const bounds=bangkokDay(input.day),period={start:new Date(bounds.start).toISOString(),end:new Date(bounds.end).toISOString(),timeZone:"Asia/Bangkok" as const};
  const seen=new Set<string>();let duplicates=0,headers=0,foreignRows=0;
  const totals:ReportRow[]=[],segments:{id:string;start:string;end:string|null;km:number;raw:ReportRow}[]=[];
  const issues:string[]=[];
  for(const raw of input.rows){
    if(raw.boxId==="Box ID"&&raw.plateNo==="Plate No"){headers++;continue;}
    if(raw.plateNo==="Total"&&String(raw.boxId??"").trim()===""){totals.push(raw);continue;}
    if(String(raw.boxId)!==input.deviceId||String(raw.rDate).trim()!==input.day){foreignRows++;issues.push("foreign_or_wrong_day_row");continue;}
    // Exclude unrelated optional fields from the semantic duplicate identity.
    const id=JSON.stringify([raw.boxId,String(raw.rDate).trim(),raw.startTime,raw.endTime,raw.sumDistance,raw.routingTime,raw.parkingEngineOn,raw.parkingTime]);
    if(seen.has(id)){duplicates++;continue;}seen.add(id);
    const n=cents(raw.sumDistance);
    const stamp=(v:unknown)=>typeof v==="string"&&/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v)?`${input.day}T${v}+07:00`:null;
    const start=stamp(raw.startTime),end=stamp(raw.endTime);
    if(n===null||!start||(!end&&raw.endTime!=="-")||(end&&Date.parse(end)<Date.parse(start))){issues.push("invalid_segment");continue;}
    if(!end&&n>0)issues.push("open_segment_with_distance");
    segments.push({id,start,end,km:n/100,raw});
  }
  const ordered=[...segments].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  let previousEnd=-Infinity;
  for(const s of ordered){
    if(s.end&&Date.parse(s.end)>Date.parse(s.start)){
      if(Date.parse(s.start)<previousEnd)issues.push("overlapping_segments");
      previousEnd=Math.max(previousEnd,Date.parse(s.end));
    }else if(s.km>0)issues.push("distance_without_positive_interval");
  }
  const reported=totals.length===1?cents(totals[0].sumDistance):null;
  if(totals.length!==1||reported===null)issues.push("missing_or_multiple_total_rows");
  const sum=segments.length&&issues.length===0?segments.reduce((n,s)=>n+Math.round(s.km*100),0)/100:null;
  const total=reported===null?null:reported/100;
  const arithmetic=reconcileValues(total,sum,true);
  const complete=input.completeness==="complete"&&issues.length===0&&segments.length>0&&segments.every(s=>s.end!==null);
  const acceptance=reconcileValues(total,sum,complete);
  const metric:SourceMetric={status:sum===null?"unknown":!complete?"incomplete":sum===0?"verified_zero":"known",value:sum,unit:"km",source:"forth_parking_report",
    period,completeness:complete?"complete":input.completeness==="complete"?"incomplete":input.completeness,confidence:"provider_reported",
    evidenceIds:segments.map(s=>s.id),reasons:[...new Set(issues),...(!complete?["provider_coverage_not_verified"]:[])],sourceTimestamp:input.capturedAt};
  return {metric,providerAssertedTotalKm:total,segments,duplicates,headers,foreignRows,arithmetic,acceptance,issues:[...new Set(issues)]};
}

export function sourceAwareDay(input:{day:string;gpsKm:number|null;gpsComplete:boolean;gpsEvidenceIds:string[];gpsSourceTimestamp?:string|null;provider:ReturnType<typeof reconcileProviderSegments>;odometer?:SourceMetric;humanMileage?:SourceMetric}) {
  const {start,end}=bangkokDay(input.day),period={start:new Date(start).toISOString(),end:new Date(end).toISOString(),timeZone:"Asia/Bangkok" as const};
  const empty=(source:string):SourceMetric=>({status:"unknown",value:null,unit:"km",source,period,completeness:"unknown",confidence:"unknown",evidenceIds:[],reasons:["no_matching_period_evidence"],sourceTimestamp:null});
  if(input.gpsKm!==null&&(!Number.isFinite(input.gpsKm)||input.gpsKm<0))throw new Error("invalid_gps_distance");
  const gpsEvidenceIds=[...new Set(input.gpsEvidenceIds.filter(id=>typeof id==="string"&&id.trim()))];
  const hasGpsEvidence=gpsEvidenceIds.length>0;
  const acceptedGpsKm=hasGpsEvidence?input.gpsKm:null;
  const gps:SourceMetric={...empty("gps_chord"),status:acceptedGpsKm===null?"unknown":!input.gpsComplete?"incomplete":acceptedGpsKm===0?"verified_zero":"known",value:acceptedGpsKm,
    completeness:acceptedGpsKm===null?"unknown":input.gpsComplete?"complete":"incomplete",confidence:"gps_derived",evidenceIds:gpsEvidenceIds,sourceTimestamp:input.gpsSourceTimestamp??null,
    reasons:acceptedGpsKm===null?["no_eligible_gps_intervals"]:input.gpsComplete?[]:["gps_coverage_incomplete"]};
  return {day:input.day,providerReported:input.provider.metric,gpsDerived:gps,odometer:input.odometer??empty("odometer_checkpoint_difference"),humanEntered:input.humanMileage??empty("human_entered_mileage"),
    bookingInterpretation:{en:"No matched jobs does not establish no work.",th:"ไม่พบงานที่จับคู่ ไม่ได้หมายความว่าไม่มีการทำงาน"}};
}
