const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../scripts/fleet-real-day-validation.cjs');
const {readEesMileageEvidence}=load('lib/fleet-intelligence-ees-source.ts');
test('independent fuel and weekly reads survive partial access failures without false zero readings',async()=>{
 for(const failed of ['fuel_logs','weekly_mileage']){
  const client={from(table){const q={select(){return q;},in(){return q;},gte(){return q;},lte(){return q;},order(){return q;},limit(){return Promise.resolve(table===failed?{data:null,error:{code:'42501'}}:{data:table==='fuel_logs'?[{id:1,date:'2026-11-03',vehicle_reg:'REG',odometer:100,litres:10,total_cost:300,fuel_type:'diesel',created_at:'2026-11-03T08:00:00Z'}]:[{id:'w',week_ending:'2026-11-01',vehicle_reg:'REG',odometer_reading:99,is_odometer_baseline:false,created_at:'2026-11-02T08:00:00Z'}],error:null});}};return q;}};
  const result=await readEesMileageEvidence({vehicleId:'v',registrations:['REG'],fromDay:'2026-11-01',toDay:'2026-11-03'},{client,authorize:async()=>true});
  assert.equal(result.completeSourceRead,false);assert.equal(result.sourceStatus[failed==='fuel_logs'?'fuel':'weekly'],'unavailable');assert.equal(result.checkpoints.length,1);assert.notEqual(result.checkpoints[0].source,failed);
 }
});
