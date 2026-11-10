const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const ts = require('typescript'); const path = require('node:path'); const { createRequire } = require('node:module');
const file = path.resolve('lib/finance-demo-centre.ts'); const mod = {exports:{}};
new Function('module','exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(mod,mod.exports,createRequire(file));
const f = mod.exports; const run = (s,a,role='finance')=>f.applyAction(s,a,role);
function readyState(parking=null) {
  const amounts=Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(k=>[k,null])); amounts.parking=parking;
  let s=f.linkDiaryWorkOrder(f.createEmptyOwnerState(),{id:'isolated-priced-job',client_id:'isolated-customer',client_name:'Isolated customer',booking_id:'BK-INTERNAL',booking_date:'2026-01-19',pickup_time:'08:30:00',pickup:'GOODYEAR',dropoff:'Suvarnabhumi Airport',vehicle_registration:'FIXTURE',vehicle:'4W',driver:'Isolated driver'},'ISOLATED-WO','admin',{amounts,notes:''});
  const j=s.bookings[0];
  s=run(s,{type:'set_returned_details',jobId:j.id,fields:{client:j.client,date:j.date,pickupTime:'08:30',pickup:j.pickup,delivery:j.delivery,driver:j.driver,vehicle:j.vehicle}},'admin');
  for(const kind of f.requiredDocKinds(s,j.id)) {
    s=run(s,{type:'add_document',jobId:j.id,kind},'admin'); const d=s.documents.find(d=>d.kind===kind);
    s=run(s,{type:'confirm_document',documentId:d.id,jobId:j.id,physicalRef:'Isolated physical paper fixture'},'admin');
  }
  s=run(s,{type:'verify_job',jobId:j.id},'admin');
  s=run(s,{type:'ready_handover',jobId:j.id},'admin');
  return run(s,{type:'receive_paper',jobId:j.id});
}
const mappingAction={type:'confirm_rate_mapping',scheduleId:'goodyear',rowId:'goodyear-route-1',clientId:'isolated-customer',contractReference:'Isolated approved contract',effectiveFrom:'2026-01-01',effectiveTo:null,reviewReason:''};
test('all three PDF schedules retain all 515 source amounts and anomaly',()=>{
  assert.deepEqual(f.CUSTOMER_RATE_SCHEDULES.map(s=>[s.id,s.rows.length,s.rows.reduce((n,r)=>n+r.bands.length,0)]),[['goodyear',8,176],['sirtech',1,31],['apl',14,308]]);
  const dong=f.CUSTOMER_RATE_SCHEDULES.find(s=>s.id==='apl').rows.find(r=>r.pickup.startsWith('DONG TAI')&&r.vehicle==='6W');
  assert.equal(dong.bands[2].amountThb,15303); assert.equal(dong.bands.at(-1).amountThb,18694); assert.equal(dong.reviewFlags.length,1);
});
test('Goodyear uses exact 4W and 6W charges, with inclusive band boundaries',()=>{
  assert.equal(f.exactCustomerRate('goodyear','goodyear-route-1',37).band.amountThb,1500);
  assert.equal(f.exactCustomerRate('goodyear','goodyear-route-1',37.01).band.amountThb,1515);
  assert.equal(f.exactCustomerRate('goodyear','goodyear-route-1',42.54).band.amountThb,1590);
  assert.equal(f.exactCustomerRate('goodyear','goodyear-route-2',43).band.amountThb,3300);
  assert.equal(f.exactCustomerRate('goodyear','goodyear-route-2',58).band.amountThb,4050);
  assert.throws(()=>f.exactCustomerRate('goodyear','goodyear-route-1',58.01));
});
test('Sirtech and APL retain their distinct bands; no interpolation outside source',()=>{
  assert.equal(f.exactCustomerRate('sirtech','sirtech-calcomp-trailer-empty40',29.01).band.amountThb,11500);
  assert.equal(f.exactCustomerRate('sirtech','sirtech-calcomp-trailer-empty40',42.54).band.amountThb,12995);
  assert.equal(f.exactCustomerRate('sirtech','sirtech-calcomp-trailer-empty40',60).band.amountThb,14950);
  for(const value of [29,60.01,42.541,NaN,Infinity]) assert.throws(()=>f.exactCustomerRate('sirtech','sirtech-calcomp-trailer-empty40',value));
  assert.equal(f.exactCustomerRate('apl','apl-route-4',51).band.amountThb,18694);
  assert.throws(()=>f.exactCustomerRate('apl','apl-route-4',51.01));
});
test('mapping confirmation requires approver, valid dates, contract and anomaly review',()=>{
  let s=readyState(); assert.throws(()=>run(s,mappingAction));
  assert.throws(()=>run(s,{...mappingAction,effectiveFrom:'2026-02-30'},'approver'));
  assert.throws(()=>run(s,{...mappingAction,scheduleId:'apl',rowId:'apl-route-4'},'approver'));
  s=run(s,mappingAction,'approver'); assert.equal(s.rateMappings.length,1);
  assert.throws(()=>run(s,mappingAction,'approver'));
});
test('pricing requires exact transport-date B7 evidence and explicit route/vehicle confirmation',()=>{
  let s=run(readyState(),mappingAction,'approver'); const id=s.bookings[0].id; const mappingId=s.rateMappings[0].id;
  assert.throws(()=>f.suggestCustomerRate(s.bookings[0],s.rateMappings[0]));
  const fuel={type:'confirm_fuel_reference',jobId:id,referenceDate:'2026-01-19',priceThb:42.54,sourceUrl:f.DIESEL_B7_SOURCE_URL,evidence:'Isolated dated source screenshot reference'};
  assert.throws(()=>run(s,{...fuel,referenceDate:'2026-11-03'})); assert.throws(()=>run(s,{...fuel,sourceUrl:'https://example.com'}));
  s=run(s,fuel); assert.equal(f.suggestCustomerRate(s.bookings[0],s.rateMappings[0]).band.amountThb,1590);
  const confirm={type:'confirm_scheduled_price',jobId:id,mappingId,amountThb:1590,overrideReason:'',routeVehicleConfirmed:true};
  assert.throws(()=>run(s,{...confirm,routeVehicleConfirmed:false}));
  assert.throws(()=>run(s,{...confirm,amountThb:1700}));
  s=run(s,confirm); assert.equal(s.bookings[0].price.amount,1590);
  const snapshot=s.bookings[0].pricingSnapshot;
  assert.equal(snapshot.fuel.jobDate,'2026-01-19'); assert.equal(snapshot.mapping.sourceSha256.length,64);
  assert.equal(snapshot.sourcePage,1); assert.equal(snapshot.suggestedThb,1590); assert.equal(snapshot.confirmedThb,1590);
  const reopened=JSON.parse(JSON.stringify(s)); assert.deepEqual(reopened.bookings[0].pricingSnapshot,snapshot);
});
test('Admin receipt requires Finance confirmation before becoming billable and cannot be copied twice',()=>{
  let s=readyState(100.20); const jobId=s.bookings[0].id;
  s=run(s,{type:'set_price',jobId,source:'manual',amount:1000,reason:'Isolated quotation evidence'});
  assert.equal(f.customerTotal(s.bookings[0]),1000);
  const action={type:'add_customer_charge',jobId,charge:{category:'parking',amount:100.20,evidence:'Admin-recorded parking receipt',adminReceiptKind:'parking'}};
  s=run(s,action); assert.equal(f.customerTotal(s.bookings[0]),1100.20);
  assert.equal(s.bookings[0].adminReceipts.amounts.parking,100.20);
  assert.throws(()=>run(s,{...action,charge:{...action.charge,category:'other',evidence:'Alternate reference'}}));
});
