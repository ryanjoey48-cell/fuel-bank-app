#!/usr/bin/env node
// Reuses private REAL captures; no network or existing-output overwrite.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),child=require('node:child_process');
const {load}=require('./fleet-real-day-validation.cjs');
const root=path.resolve(__dirname,'..'),capture=path.join(root,'output/fleet-real-validation/1793759758202'),checkpointCapture=path.join(root,'output/fleet-real-validation/corrective-1793760586059/evidence.json');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const input=read(path.join(capture,'actual-input.json')),provider=read(path.join(capture,'actual-parking.json')),evidence=read(checkpointCapture);
const folder=path.join(root,'output/fleet-real-validation','corrected-'+Date.now());fs.mkdirSync(folder,{recursive:true});
const enriched={...input,providerSegments:provider,providerCompleteness:'unknown',capturedAt:read(path.join(capture,'evidence.json')).capturedAt,
 purchases:evidence.fuel_logs.rows.filter(r=>r.date===input.day).map(r=>({id:String(r.id),vehicleId:input.vehicleId,day:r.date,fuel:r.fuel_type,litres:r.litres,costThb:r.total_cost}))};
const inputFile=path.join(folder,'actual-input-with-provider.json'),output=path.join(folder,'corrected-preview.json');
fs.writeFileSync(inputFile,JSON.stringify(enriched,null,2),{flag:'wx'});
const command=child.spawnSync(process.execPath,[path.join(root,'scripts/fleet-intelligence-preview.cjs'),inputFile,output],{encoding:'utf8',windowsHide:true});if(command.status!==0)throw new Error('corrective_preview_failed');
const metric=load('lib/fleet-intelligence-mileage.ts'),history=load('lib/forth-history-log.ts');
const checkpoints=[];
for(const source of ['fuel_logs','weekly_mileage'])for(const raw of evidence[source].rows){
 const value=source==='fuel_logs'?raw.odometer:raw.odometer_reading;
 checkpoints.push({id:String(raw.id),source,vehicleId:input.vehicleId,registrationSnapshot:raw.vehicle_reg,observationDate:source==='fuel_logs'?raw.date:raw.week_ending,
  observedAt:null,enteredAt:raw.created_at,odometerKm:typeof value==='number'?value:null,meterEpoch:'unconfirmed-original',baseline:raw.is_odometer_baseline===true,
  identity:raw.vehicle_id?'confirmed':'registration_only',sourceHash:crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),raw,
  fullTankConfirmed:null,fuelType:raw.fuel_type??null,purchasedLitres:raw.litres??null,costThb:raw.total_cost??null});
}
const intervals=metric.checkpointIntervals(checkpoints),report=read(output);
const comparison=history.normalizeHistoricalLog(evidence.comparator.rows,evidence.comparator.deviceId,'Asia/Bangkok');
const odometer={checkpoints,intervals,fillToFill:metric.fillToFillEfficiency(checkpoints,{vehicleId:input.vehicleId,startId:'2763',endId:'2818',allFillsAccountedFor:false,fuelTypeVerified:false,mixedFuel:true,evidenceReference:'insufficient-receipt-evidence'}),
 sourceComparisons:intervals.map(i=>({source:i.source,from:i.from.observationDate,to:i.to.observationDate,comparison:metric.compareMileagePeriods(i.metric,report.distanceSources.providerReported,10)}))};
fs.writeFileSync(path.join(folder,'odometer-review.json'),JSON.stringify(odometer,null,2),{flag:'wx'});
const summary={actualData:true,day:input.day,providerKm:report.distanceSources.providerReported.value,providerStatus:report.distanceSources.providerReported.status,gpsKm:report.distanceSources.gpsDerived.value,
 distanceCheck:report.checks.distance,providerArithmetic:report.providerEvidence.arithmetic,providerAcceptance:report.providerEvidence.acceptance,
 purchasedLitres:Math.round(report.fuel.reduce((n,r)=>n+(r.purchasedLitres??0),0)*100)/100,consumption:report.fuel.map(r=>({fuel:r.fuel,litres:r.consumedLitres,method:r.method})),
 comparator:{registration:evidence.comparator.registration,deviceId:evidence.comparator.deviceId,verifiedPoints:comparison.points.filter(p=>p.verifiedGps).length,total:comparison.points.length},
 mileageIntervals:intervals.map(i=>({source:i.source,from:i.from.observationDate,to:i.to.observationDate,km:i.metric.value,status:i.metric.status,reasons:i.metric.reasons})),
 fillToFill:odometer.fillToFill,productionWrites:0};
fs.writeFileSync(path.join(folder,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
console.log(JSON.stringify({folder:path.relative(root,folder),...summary},null,2));
