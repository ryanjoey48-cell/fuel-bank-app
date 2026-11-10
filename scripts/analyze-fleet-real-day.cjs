#!/usr/bin/env node
// Offline analysis of captured real evidence. No network or business-record writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [captureFolder,eesFolder,outputName='real-day-analysis.json']=process.argv.slice(2);
if(!captureFolder||!eesFolder)throw new Error('Provide captured log/report and EES evidence folders.');
if(path.basename(outputName)!==outputName||!outputName.endsWith('.json'))throw new Error('Use a new JSON filename in the capture folder.');
const read=(folder,name)=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
const input=read(captureFolder,'actual-input.json'),preview=read(captureFolder,'preview.json'),parking=read(captureFolder,'actual-parking.json'),ees=read(eesFolder,'evidence.json');
const rows=input.forthLog;
// This case-specific review must stop rather than reuse a zero-verified conclusion
// on a different dataset. Other provenance mixes require normalizer-based review.
if(!rows.length||rows.some(r=>r.positionSource!=='No GPS'||r.gpsID!==input.deviceId||r.plateNumber!=='ฒอ-8453'))throw new Error('Not the reviewed all-No-GPS vehicle-day.');
const time=s=>{const m=/^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2}:\d{2})$/.exec(s);return m?Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}+07:00`):NaN;};
const bangkok=ms=>new Date(ms+7*3600000).toISOString().replace('Z','+07:00');
const sorted=rows.map(r=>({...r,ms:time(r.dateTime)})).filter(r=>Number.isFinite(r.ms)).sort((a,b)=>a.ms-b.ms);
const start=Date.parse(input.day+'T00:00:00+07:00'),end=start+86400000;
const gaps=sorted.slice(1).map((r,i)=>({start:bangkok(sorted[i].ms),end:bangkok(r.ms),seconds:(r.ms-sorted[i].ms)/1000}));
const providerSegments=parking.filter(r=>r.boxId===input.deviceId&&String(r.rDate).trim()===input.day).map((r,i)=>({ordinal:i+1,...r,source:'forth_parkingTrip',gpsVerified:false}));
const total=parking.find(r=>r.plateNo==='Total');
const decimalKm=v=>{if(!/^\d+(\.\d{1,2})?$/.test(String(v)))throw new Error('invalid_distance');return Math.round(Number(v)*100);};
const cents=providerSegments.reduce((n,r)=>n+decimalKm(r.sumDistance),0),totalCents=decimalKm(total.sumDistance);
const durations=s=>/^\d+:\d{2}:\d{2}$/.test(s)?s.split(':').reduce((n,v)=>n*60+Number(v),0):null;
const manifest=['actual-input.json','actual-trips.json','actual-parking.json','preview.json','evidence.json'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(captureFolder,file))).digest('hex')}));
const fuel=ees.ees.fuel.rows;
const report={kind:'actual_forth_vehicle_day_validation',vehicleId:input.vehicleId,deviceId:input.deviceId,registration:'ฒอ-8453',day:input.day,timeZone:'Asia/Bangkok',
 sourceAuthenticity:'Captured from authenticated Forth and EES reads; see request evidence. Source GPS accuracy is not verified.',manifest,
 gps:{sampleCount:rows.length,parsedTimestampCount:sorted.length,uniqueTimestampCount:new Set(sorted.map(r=>r.ms)).size,allDeviceAndRegistrationMatch:rows.every(r=>r.gpsID===input.deviceId&&r.plateNumber==='ฒอ-8453'),
   sourceCounts:Object.fromEntries([...new Set(rows.map(r=>r.positionSource))].map(v=>[v,rows.filter(r=>r.positionSource===v).length])),
   verifiedSampleCount:0,firstVerifiedPosition:null,lastVerifiedPosition:null,
   firstReportedPosition:sorted[0],lastReportedPosition:sorted.at(-1),reportedPositiveSpeedSampleCount:rows.filter(r=>r.Speed>0).length,
   rawSpanSeconds:(sorted.at(-1).ms-sorted[0].ms)/1000,leadingUnobservedSeconds:(sorted[0].ms-start)/1000,trailingUnobservedSeconds:(end-sorted.at(-1).ms)/1000,
   maxSampleGapSeconds:Math.max(...gaps.map(g=>g.seconds)),gapsAbovePolicy:gaps.filter(g=>g.seconds>300),
   rawDistanceMinimum:Math.min(...rows.map(r=>r.Distance)),rawDistanceMaximum:Math.max(...rows.map(r=>r.Distance)),rawDistanceSum:rows.reduce((n,r)=>n+r.Distance,0),
   rawDistanceDecreases:sorted.slice(1).filter((r,i)=>r.Distance<sorted[i].Distance).length,
   rawFuelValues:[...new Set(rows.map(r=>r.Fuel))]},
 strictDaily:preview.daily,
 reconciliation:{strictGpsDailyKm:preview.daily.observedKm,strictGpsJourneyKm:null,strictGpsJourneyCount:null,strictAssignedKm:null,strictUnassignedKm:null,
   providerSegmentCount:providerSegments.length,providerClosedSegmentCount:providerSegments.filter(r=>/^\d{2}:\d{2}:\d{2}$/.test(r.endTime)).length,
   providerSegmentKm:cents/100,providerTotalKm:totalCents/100,providerDifferenceKm:(cents-totalCents)/100,
   providerReconciles:cents===totalCents,providerAttributedKm:0,providerUnattributedKm:cents/100,
   routingSecondsSum:providerSegments.reduce((n,r)=>n+(durations(r.routingTime)??0),0),routingSecondsTotal:durations(total.routingTime),
   note:'Provider report distance reconciles independently; it is not verified GPS distance. Unknown strict totals must not be converted to zero.'},
 providerSegments,providerTotal:total,booking:{dayCount:ees.ees.bookingInspection.selectedDayCount,latestBookingDate:ees.ees.bookingInspection.latestBookingDate,suggestions:[],reason:'No rows for selected day in confirmed production Booking Diary; no confirmed GPS journeys.'},
 fuel:{purchases:fuel,purchasedLitres:Math.round(fuel.reduce((n,r)=>n+Number(r.litres),0)*100)/100,purchaseCostThb:Math.round(fuel.reduce((n,r)=>n+Number(r.total_cost),0)*100)/100,
 measuredConsumptionLitres:null,estimatedConsumptionLitres:null,consumptionCostThb:null,kmPerLitre:null,costPerKm:null,quality:ees.ees.fuelQuality,
 note:'Stored fuel_type is diesel for both purchases. Do not infer LPG or consumed litres from price, odometer or raw Fuel=0.'},
 recommendation:'NO-GO for production schema approval/activation until amendments and GPS provenance, report semantics and real job evidence are resolved.'};
if(cents!==totalCents)throw new Error('Provider rows do not reconcile.');
fs.writeFileSync(path.join(captureFolder,outputName),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({day:report.day,sampleCount:rows.length,strictGpsKm:report.strictDaily.observedKm,providerKm:cents/100,segments:providerSegments.length,providerDifferenceKm:0,purchasedLitres:report.fuel.purchasedLitres,purchaseCostThb:report.fuel.purchaseCostThb,recommendation:'NO-GO'},null,2));
