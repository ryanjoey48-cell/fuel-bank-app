const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('../scripts/fleet-real-day-validation.cjs');
const sources=load('lib/fleet-intelligence-sources.ts'),mileage=load('lib/fleet-intelligence-mileage.ts'),core=load('lib/fleet-intelligence.ts'),reports=load('lib/fleet-intelligence-report.ts'),sync=load('lib/fleet-intelligence-sync.ts'),ees=load('lib/fleet-intelligence-ees-source.ts');
const day='2026-11-03';
const segment=(start,end,km)=>({boxId:'box',plateNo:'REG',rDate:day+' ',startTime:start,endTime:end,sumDistance:km,routingTime:'00:10:00'});
const total=km=>({boxId:'',plateNo:'Total',sumDistance:km});
const provider=(rows,completeness='complete')=>sources.reconcileProviderSegments({rows,deviceId:'box',day,completeness,capturedAt:'2026-11-04T00:00:00Z'});
const cp=(id,date,odo,extra={})=>({id,source:'fuel_logs',vehicleId:'v',registrationSnapshot:'REG',observationDate:date,observedAt:date+'T12:00:00+07:00',enteredAt:'2026-11-04T09:00:00+07:00',odometerKm:odo,meterEpoch:'a',baseline:false,identity:'confirmed',sourceHash:id,raw:{},...extra});

test('empty and incomplete checks cannot pass strict acceptance; verified zero can',()=>{
 for(const c of [sources.reconcileValues(null,null,true),sources.reconcileValues(1,1,false),sources.reconcileValues(1,2,true)])assert.throws(()=>sources.requireCompleteReconciliation(c));
 assert.equal(sources.reconcileValues(0,0,true).status,'pass');assert.throws(()=>reports.requireCompleteFleetReport([]));
});
test('odometer source reads fall back across deployed column variants and retain uncertainty',async()=>{
 const selected=[];
 const rows={
  fuel_logs:[{id:2817,date:'2026-11-03',vehicle_reg:'REG',odometer:615524,litres:54.1,total_cost:2260,fuel_type:'diesel',receipt_checked:false,created_at:'2026-11-03T08:00:00+07:00'}],
  weekly_mileage:[{id:'week-1',week_ending:'2026-11-01',driver_id:'driver-1',vehicle_reg:'REG',odometer_reading:615518,is_odometer_baseline:false,created_at:'2026-11-02T09:00:00+07:00'}]
 };
 const client={from(table){
  let columns='';
  const query={select(value){columns=value;selected.push({table,columns});return query;},in(){return query;},gte(){return query;},lte(){return query;},order(){return query;},
   limit(){const missing=table==='fuel_logs'?(columns.includes('vehicle_id')||columns.includes('mileage')):columns.includes('vehicle_id');
    return Promise.resolve(missing?{data:null,error:{code:'42703',message:'column does not exist'}}:{data:rows[table],error:null});}};
  return query;
 }};
 const result=await ees.readEesMileageEvidence({vehicleId:'v',registrations:['REG'],fromDay:'2026-11-01',toDay:'2026-11-03'},{client,authorize:async()=>true});
 assert.equal(selected.filter(row=>row.table==='fuel_logs').length,3);
 assert.equal(selected.filter(row=>row.table==='weekly_mileage').length,2);
 assert.ok(result.capabilities.fuelColumns.includes('receipt_checked'));
 assert.ok(!result.capabilities.fuelColumns.includes('vehicle_id'));
 const fuel=result.checkpoints.find(row=>row.source==='fuel_logs');
 const weekly=result.checkpoints.find(row=>row.source==='weekly_mileage');
 assert.equal(fuel.odometerKm,615524);assert.equal(fuel.identity,'registration_only');assert.equal(fuel.observedAt,null);
 assert.equal(weekly.odometerKm,615518);assert.equal(weekly.baseline,false);assert.equal(weekly.identity,'registration_only');
 assert.equal(weekly.observationDate,'2026-11-01');assert.notEqual(weekly.observationDate,weekly.enteredAt);
});
test('provider excludes header/total and deduplicates exact segment events',()=>{
 const a=segment('08:00:00','09:00:00','100.00');const r=provider([{boxId:'Box ID',plateNo:'Plate No'},a,a,total('100')]);
 assert.equal(r.metric.value,100);assert.equal(r.duplicates,1);assert.equal(r.headers,1);assert.equal(r.arithmetic.status,'pass');assert.equal(r.acceptance.status,'pass');
});
test('overlaps and conflicting rows withhold additive provider totals',()=>{
 const r=provider([segment('08:00:00','10:00:00','100'),segment('09:00:00','11:00:00','80'),total('180')]);
 assert.equal(r.metric.value,null);assert.ok(r.issues.includes('overlapping_segments'));assert.throws(()=>sources.requireCompleteReconciliation(r.acceptance));
});
test('open end and unknown source coverage never pass completeness',()=>{
 const r=provider([segment('08:00:00','09:00:00','100'),segment('23:00:00','-','0'),total('100')],'unknown');
 assert.equal(r.metric.value,100);assert.equal(r.metric.status,'incomplete');assert.equal(r.arithmetic.status,'pass');assert.equal(r.acceptance.status,'incomplete');assert.throws(()=>sources.requireCompleteReconciliation(r.acceptance));
});
test('zero report has a distinct verified-zero status; absent report remains unknown',()=>{
 assert.equal(provider([segment('08:00:00','09:00:00','0'),total('0')]).metric.status,'verified_zero');assert.equal(provider([]).metric.status,'unknown');
});
test('source-aware day displays provider km while GPS stays unknown and missing jobs imply no conclusion',()=>{
 const r=sources.sourceAwareDay({day,gpsKm:null,gpsComplete:false,gpsEvidenceIds:[],provider:provider([segment('08:00:00','09:00:00','289.20'),total('289.20')],'unknown')});
 assert.equal(r.providerReported.value,289.2);assert.equal(r.gpsDerived.value,null);assert.equal(r.odometer.value,null);assert.ok(r.bookingInterpretation.th);assert.equal(sources.METRIC_STATUS_COPY.not_applicable.en,'Not applicable');
});
test('empty GPS evidence cannot turn caller-supplied zero into verified mileage',()=>{
 const input={day,gpsKm:0,gpsComplete:true,gpsEvidenceIds:[],provider:provider([])};
 const empty=sources.sourceAwareDay(input).gpsDerived;
 assert.equal(empty.status,'unknown');assert.equal(empty.value,null);assert.equal(empty.completeness,'unknown');
 const evidenced=sources.sourceAwareDay({...input,gpsEvidenceIds:['interval-evidence']}).gpsDerived;
 assert.equal(evidenced.status,'verified_zero');assert.equal(evidenced.value,0);
 assert.throws(()=>sources.sourceAwareDay({...input,gpsKm:Infinity}));
});
test('date-only checkpoints retain entry time separately and never invent an exact observation',()=>{
 const a=cp('a','2026-10-25',614615,{source:'weekly_mileage',observedAt:null,identity:'registration_only'}),b=cp('b','2026-11-01',615518,{source:'weekly_mileage',observedAt:null,identity:'registration_only'});
 const r=mileage.checkpointIntervals([a,b])[0];assert.equal(r.metric.value,903);assert.equal(r.metric.status,'incomplete');assert.equal(r.from.enteredAt,a.enteredAt);assert.notEqual(r.metric.period.start,a.enteredAt);
});
test('same-source consecutive checkpoints: duplicates coalesce and conflicting readings block',()=>{
 const a=cp('a','2026-11-01',100),b=cp('b','2026-11-02',200),duplicate={...b,id:'c',sourceHash:'c'};
 const r=mileage.checkpointIntervals([a,b,duplicate]);assert.equal(r.length,1);assert.equal(r[0].metric.value,100);assert.equal(r[0].evidenceIds.length,3);
 assert.equal(mileage.checkpointIntervals([a,b,{...duplicate,odometerKm:201}])[0].metric.value,null);
});
test('never cross source, identity or meter reset; bad decreases do not become corrected mileage',()=>{
 assert.equal(mileage.checkpointIntervals([cp('a','2026-11-01',100),cp('b','2026-11-02',200,{source:'weekly_mileage'})]).length,0);
 assert.equal(mileage.checkpointIntervals([cp('a','2026-11-01',100),cp('b','2026-11-02',200,{vehicleId:'other'})]).length,0);
 const rows=mileage.checkpointIntervals([cp('a','2026-11-01',100),cp('b','2026-11-02',10),cp('c','2026-11-03',200)]);assert.ok(rows.every(r=>r.metric.value===null));
 const reset=mileage.checkpointIntervals([cp('a','2026-11-01',100),cp('b','2026-11-02',0,{meterEpoch:'replacement',baseline:true}),cp('c','2026-11-03',100,{meterEpoch:'replacement'})]);assert.equal(reset[0].metric.value,null);assert.equal(reset[1].metric.value,100);
});
test('missing readings, observation ambiguity and unrealistic jumps require office review',()=>{
 for(const b of [cp('b','2026-11-02',null),cp('b','2026-11-01',200,{observedAt:null}),cp('b','2026-11-02',999999)])assert.equal(mileage.checkpointIntervals([cp('a','2026-11-01',100),b])[0].metric.value,null);
 assert.equal(mileage.checkpointIntervals([cp('a','2026-11-01',100,{baseline:null}),cp('b','2026-11-02',200,{baseline:null})])[0].metric.reasons[0],'baseline_status_unknown');
});
test('different periods and incomplete GPS are not comparable mileage',()=>{
 const a=mileage.checkpointIntervals([cp('a','2026-11-01',100),cp('b','2026-11-02',200)])[0].metric;
 assert.equal(mileage.compareMileagePeriods(a,{...a,period:{...a.period,end:'2026-11-03T00:00:00Z'}},10).status,'not_comparable');
 assert.equal(mileage.compareMileagePeriods(a,{...a,completeness:'incomplete'},10).status,'incomplete');
 assert.equal(mileage.compareMileagePeriods(a,{...a,value:150},10).status,'review_required');
});
test('fill-to-fill excludes opening purchase, requires all fills and never produces daily measured fuel',()=>{
 const a=cp('a','2026-11-01',100,{fullTankConfirmed:true,fuelType:'diesel',purchasedLitres:90}),b=cp('b','2026-11-02',200,{fuelType:'diesel',purchasedLitres:10}),c=cp('c','2026-11-03',300,{fullTankConfirmed:true,fuelType:'diesel',purchasedLitres:30});
 const scope={vehicleId:'v',startId:'a',endId:'c',allFillsAccountedFor:true,fuelTypeVerified:true,mixedFuel:false,evidenceReference:'reviewed-receipts'};
 const r=mileage.fillToFillEfficiency([a,b,c],scope);assert.equal(r.status,'estimated');assert.equal(r.estimatedConsumedLitres,40);assert.equal(r.kmPerLitre,5);
 for(const s of [{...scope,mixedFuel:true},{...scope,allFillsAccountedFor:false}])assert.equal(mileage.fillToFillEfficiency([a,b,c],s).status,'unknown');
 assert.equal(mileage.fillToFillEfficiency([{...a,fullTankConfirmed:null},b,c],scope).status,'unknown');
 assert.equal(mileage.fillToFillEfficiency([a,{...b,fuelType:'lpg'},c],scope).status,'unknown');
});
test('No GPS coordinates are retained but cannot become a verified route; Distance is not assumed cumulative',()=>{
 const history=load('lib/forth-history-log.ts');const raw=[0,1].map(i=>({gpsID:'box',dateTime:`2026-11-03T08:0${i}:00+07:00`,GPS:'ON',Latitude:13,Longitude:100+i*.001,positionSource:'No GPS',Distance:i?10:50,Speed:20,Engine:'ON'}));
 const replay=history.normalizeHistoricalLog(raw,'box','Asia/Bangkok');assert.equal(replay.points[0].latitude,13);assert.ok(replay.points.every(p=>!p.verifiedGps));
 assert.equal(core.calculateVehicleDay(day,replay.points.map((p,i)=>({...p,evidenceId:String(i)}))).observedKm,null);
});
test('expired sync lease cannot commit or advance checkpoint and fencing token reaches store',async()=>{
 const now=Date.parse('2026-11-04T00:00:00Z');let committed=false,released;
 const r=await sync.syncHistoryWindow({vehicleId:'v',deviceId:'box',start:'2026-11-03T08:00:00Z',end:'2026-11-03T08:01:00Z',mappingEvidence:'map'},
  {entitlementEvidence:'ent',limitsEvidence:'limits',sourceTimezone:'Asia/Bangkok',retentionStart:'2026-01-01',maxWindowSeconds:300,minIntervalMs:1000,maxPages:1,maxRows:5,maxBytes:1000},
  {enabled:true,now:()=>now,authorizeMapping:async()=>true,fetchPage:async()=>({payload:[],nextCursor:null,completeness:'unknown'}),store:{acquire:async()=>({token:'stale',generation:3,expiresAt:now-1}),commit:async()=>{committed=true;},fail:async()=>{},release:async(k,lease)=>{released=lease;}}});
 assert.equal(r.status,'failed');assert.equal(committed,false);assert.equal(released.generation,3);
});
test('optional local REAL fixture: 17 provider rows reconcile, GPS acceptance fails explicitly',t=>{
 const root=path.resolve(__dirname,'../output/fleet-real-validation/1793759758202');if(!fs.existsSync(path.join(root,'actual-input.json'))){t.skip('Private real fixture is intentionally not committed');return;}
 const input=JSON.parse(fs.readFileSync(path.join(root,'actual-input.json'))),rows=JSON.parse(fs.readFileSync(path.join(root,'actual-parking.json')));
 const r=sources.reconcileProviderSegments({rows,deviceId:input.deviceId,day:input.day,completeness:'unknown',capturedAt:'2026-11-04T02:35:58Z'});
 assert.equal(r.segments.length,17);assert.equal(r.metric.value,289.2);assert.equal(r.arithmetic.status,'pass');assert.throws(()=>sources.requireCompleteReconciliation(r.acceptance));
 assert.equal(input.forthLog.filter(p=>p.Latitude!=null&&p.Longitude!=null).length,751);assert.ok(input.forthLog.every(p=>p.positionSource==='No GPS'));
});
