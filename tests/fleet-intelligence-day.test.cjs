const test = require('node:test'), assert = require('node:assert/strict');
const {load}=require('../scripts/fleet-real-day-validation.cjs');
const {buildProviderDay,suggestDayJobs,summarizeProviderFleet}=load('lib/fleet-intelligence-day.ts');
const session=load('lib/fleet-intelligence-session.ts');
const day='2026-11-03';
const row=(km='12.30',end='09:00:00')=>({boxId:'box',plateNo:'REG',rDate:day,startTime:'08:00:00',endTime:end,sumDistance:km,routingTime:'01:00:00'});
const input=(rows=[row(),{boxId:'',plateNo:'Total',sumDistance:'12.30'}],logRows=[])=>({vehicleId:'v',registration:'REG',deviceId:'box',day,capturedAt:'2026-11-04T00:00:00Z',reportRows:rows,logRows});
test('provider distance is separately reconciled without inventing GPS or complete coverage',()=>{
 const result=buildProviderDay(input()); assert.equal(result.sources.providerReported.value,12.3); assert.equal(result.provider.arithmetic.status,'pass');
 assert.equal(result.sources.providerReported.completeness,'unknown'); assert.equal(result.sources.gpsDerived.value,null);assert.equal(result.gps.observedKm,null);assert.equal(result.gps.unknownSeconds,86400);
 assert.equal(result.provider.segments[0].raw,undefined); assert.equal(result.mapping,'current_association_historical_period_unverified');
});
test('mismatched report Total withholds accepted provider kilometres',()=>{
 const r=buildProviderDay(input([row(),{boxId:'',plateNo:'Total',sumDistance:'50'}]));assert.equal(r.sources.providerReported.value,null);assert.equal(r.provider.arithmetic.status,'fail');
});
test('No GPS and missing log remain distinct; foreign identity is rejected',()=>{
 const log=[{gpsID:'box',plateNumber:'REG',dateTime:'03-11-2026 08:00:00',GPS:'ON',positionSource:'No GPS',Latitude:13,Longitude:100,Speed:30,Engine:'ON'}];
 const r=buildProviderDay(input(undefined,log));assert.equal(r.gps.observations,1);assert.equal(r.gps.verifiedObservations,0);assert.equal(r.sources.gpsDerived.value,null);
 assert.equal(buildProviderDay(input(undefined,null)).logAvailable,false);
 assert.throws(()=>buildProviderDay(input(undefined,[{...log[0],gpsID:'other'}])),/identity_conflict/);
});
test('job suggestions preserve assignment evidence, reject conflicts and never allocate distance',()=>{
 const job={id:'j',booking_date:day,vehicle_id:'v',vehicle_registration:'REG',pickup_time:'08:30',job_order_number:'WO',pickup_lat:13,pickup_lng:100,dropoff_lat:14,dropoff_lng:101};
 const results=suggestDayJobs('v','REG',day,[job,{...job,id:'conflict',vehicle_id:'other'},{...job,id:'tomorrow',booking_date:'2026-11-04'}],null);
 assert.equal(results.length,1); assert.equal(results[0].score,40); assert.equal(results[0].status,'confirmation_required');assert.equal(results[0].allocatedKm,null);assert.equal(results[0].observedDeliveryTime,null);
 const ev=buildProviderDay(input());ev.gps.timeline=[{start:day+'T08:00:00+07:00',end:day+'T09:00:00+07:00',km:1}];ev.observedPoints=[{latitude:13,longitude:100,timestamp:day+'T08:00:00+07:00'},{latitude:14,longitude:101,timestamp:day+'T09:00:00+07:00'}];
 const matched=suggestDayJobs('v','REG',day,[job],ev)[0];assert.equal(matched.score,80);assert.ok(matched.reasons.includes('ordered_pickup_delivery_proximity'));assert.equal(matched.allocatedKm,null);
});
test('fleet totals require complete reconciled same-period provider evidence for every vehicle',()=>{
 const evidence=buildProviderDay(input());const metric={...evidence.sources.providerReported,status:'known',completeness:'complete'};const rows=[{vehicleId:'v',metric,arithmeticPassed:true}];
 assert.equal(summarizeProviderFleet(day,rows).totalKm,12.3);assert.equal(summarizeProviderFleet(day,[...rows,{vehicleId:'missing',metric:null,arithmeticPassed:false}]).totalKm,null);
 for(const changed of [{completeness:'unknown'},{value:NaN},{value:-1},{confidence:'gps_derived'},{period:{...metric.period,start:day+'T01:00:00+07:00'}}])assert.equal(summarizeProviderFleet(day,[{...rows[0],metric:{...metric,...changed}}]).totalKm,null);
 assert.equal(summarizeProviderFleet(day,[]).totalKm,null);assert.throws(()=>summarizeProviderFleet(day,[rows[0],rows[0]]),/duplicate/);
 const zero={...metric,value:0,status:'verified_zero'};assert.equal(summarizeProviderFleet(day,[{...rows[0],metric:zero}]).totalKm,0);
});
test('review cache is scoped to authenticated user, registration and day',()=>{
 const evidence=buildProviderDay(input());session.rememberProviderDay('user-a',evidence);
 assert.equal(session.recalledProviderDay('user-b','v','REG',day),null);assert.equal(session.recalledProviderDay('user-a','v','CHANGED',day),null);
 assert.equal(session.recalledProviderDay('user-a','v','REG',day).sources.providerReported.value,12.3);
});
