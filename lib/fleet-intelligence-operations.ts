import { distanceKm } from "./fleet-intelligence";

type Place={latitude:number;longitude:number};
export type JobEvidence={id:string;vehicleId:string|null;registration:string|null;confirmedDriverId:string|null;start:string;end:string;stops:Place[];workOrder:string|null};
export type JourneyEvidence={vehicleId:string;registration:string;confirmedDriverId:string|null;start:string;end:string;stops:Place[];workOrder:string|null};
const registrationKey=(s:string)=>s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g,"").toUpperCase();
const validPlace=(p:Place)=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
/** Suggestions only; even the highest rank requires office confirmation. */
export function rankJobCandidates(journey:JourneyEvidence,jobs:readonly JobEvidence[]) {
  const start=Date.parse(journey.start),end=Date.parse(journey.end);
  if(!journey.vehicleId || !Number.isFinite(start)||!Number.isFinite(end)||end<=start) throw new Error("invalid_journey");
  return jobs.flatMap(job=>{
    if(job.vehicleId && job.vehicleId!==journey.vehicleId) return [];
    const stable=job.vehicleId===journey.vehicleId;
    const reg=!!job.registration && registrationKey(job.registration)===registrationKey(journey.registration);
    if(!stable && !reg) return [];
    const a=Date.parse(job.start),b=Date.parse(job.end);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||Math.max(start,a)>=Math.min(end,b)) return [];
    let score=stable ? 40 : 20;
    const reasons=[stable ? "stable_vehicle_id" : "registration_only","overlapping_time_window"];
    score+=20;
    if(job.confirmedDriverId && job.confirmedDriverId===journey.confirmedDriverId) {score+=10;reasons.push("confirmed_driver");}
    if(job.workOrder && job.workOrder===journey.workOrder) {score+=10;reasons.push("work_order");}
    // Match all required stops in chronological order, not just a shared depot.
    let cursor=0,matched=0;
    for(const stop of job.stops) {
      if(!validPlace(stop)) break;
      const index=journey.stops.findIndex((p,i)=>i>=cursor&&validPlace(p)&&distanceKm(p,stop)<=0.15);
      if(index<0) break; matched++;cursor=index+1;
    }
    if(job.stops.length>=2 && matched===job.stops.length) {score+=20;reasons.push("ordered_stops");}
    return [{jobId:job.id,score,reasons,status:"confirmation_required" as const}];
  }).sort((a,b)=>b.score-a.score||a.jobId.localeCompare(b.jobId));
}

export type FuelKind="diesel"|"petrol"|"lpg";
export type FuelPurchase={id:string;vehicleId:string;day:string;fuel:FuelKind;litres:number;costThb:number};
export type ConsumptionEvidence={vehicleId:string;day:string;fuel:FuelKind;litres:number;sourceReference:string;method:"measured"|"estimated";kmPerLitre?:number;distanceKm?:number};
/** Fuel purchases and consumption are separate ledgers. No implicit purchase-price valuation. */
export function fuelIntelligence(vehicleId:string,day:string,purchases:readonly FuelPurchase[],consumption:readonly ConsumptionEvidence[],valuation?:{fuel:FuelKind;thbPerLitre:number;reference:string}[]) {
  if(!vehicleId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("invalid_fuel_scope");
  const relevantPurchases=purchases.filter(p=>p.vehicleId===vehicleId&&p.day===day);
  const relevantConsumption=consumption.filter(p=>p.vehicleId===vehicleId&&p.day===day);
  if(relevantPurchases.some(p=>!p.id || !["diesel","petrol","lpg"].includes(p.fuel)) || relevantConsumption.some(p=>!["diesel","petrol","lpg"].includes(p.fuel)||!["measured","estimated"].includes(p.method))) throw new Error("unknown_fuel_or_method");
  return (["diesel","petrol","lpg"] as const).map(fuel=>{
    const bought=purchases.filter(p=>p.vehicleId===vehicleId&&p.day===day&&p.fuel===fuel);
    if(new Set(bought.map(p=>p.id)).size!==bought.length) throw new Error("duplicate_fuel_purchase");
    if(bought.some(p=>![p.litres,p.costThb].every(n=>Number.isFinite(n)&&n>=0))) throw new Error("invalid_purchase");
    const used=consumption.filter(p=>p.vehicleId===vehicleId&&p.day===day&&p.fuel===fuel);
    // A day/fuel may have one reviewed measurement or estimate; competing evidence remains unresolved.
    const evidence=used.length===1 ? used[0] : null;
    if(evidence && (!Number.isFinite(evidence.litres)||evidence.litres<0||!evidence.sourceReference.trim())) throw new Error("invalid_consumption");
    if(evidence?.method==="estimated" && (!Number.isFinite(evidence.kmPerLitre)||evidence.kmPerLitre!<=0||!Number.isFinite(evidence.distanceKm)||evidence.distanceKm!<0||Math.abs(evidence.litres-evidence.distanceKm!/evidence.kmPerLitre!)>1e-8)) throw new Error("unvalidated_estimate");
    const prices=valuation?.filter(v=>v.fuel===fuel) ?? [];
    const price=prices.length===1&&prices[0].reference.trim()&&Number.isFinite(prices[0].thbPerLitre)&&prices[0].thbPerLitre>=0 ? prices[0] : null;
    return {fuel,purchasedLitres:bought.length ? bought.reduce((n,p)=>n+p.litres,0) : null,purchaseCostThb:bought.length ? bought.reduce((n,p)=>n+p.costThb,0) : null,
      consumedLitres:evidence?.litres ?? null,method:evidence?.method ?? "unavailable",sourceReference:evidence?.sourceReference ?? null,
      consumptionCostThb:evidence&&price ? evidence.litres*price.thbPerLitre : null,valuationReference:price?.reference ?? null,
      discrepancy:used.length>1 ? "competing_consumption_evidence" : !evidence ? "consumption_unknown" : null};
  });
}
