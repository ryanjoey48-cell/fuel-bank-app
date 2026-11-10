const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(name,cache=new Map()) {
 const file=path.resolve(root,name);if(cache.has(file))return cache.get(file).exports;
 const m=new Module(file,module);cache.set(file,m);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=r=>r==='server-only'?{}:r.startsWith('.')||r.startsWith('@/')?load((r.startsWith('@/')?r.slice(2):path.relative(root,path.resolve(path.dirname(file),r)))+'.ts',cache):require(r);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;
}
const core=load('lib/fleet-intelligence.ts');
const ops=load('lib/fleet-intelligence-operations.ts');
const sync=load('lib/fleet-intelligence-sync.ts');
const reports=load('lib/fleet-intelligence-report.ts');
const ees=load('lib/fleet-intelligence-ees-source.ts');
const day='2026-10-24';
const point=(minute,longitude=100,extra={})=>({evidenceId:'p'+minute,sourceTimestamp:null,timestampIso:new Date(Date.parse(day+'T00:00:00+07:00')+minute*60000).toISOString(),latitude:13,longitude,coordinateStatus:'valid',gpsStatus:'connected',positionQuality:'gps',verifiedGps:true,trailEligible:true,speedKph:30,engineOn:true,sourceDistanceRaw:null,...extra});
test('Bangkok date validation rejects rolled dates and returns UTC bounds',()=>{
 assert.equal(new Date(core.bangkokDay(day).start).toISOString(),'2026-10-23T17:00:00.000Z');
 assert.throws(()=>core.bangkokDay('2026-02-30'));assert.throws(()=>core.bangkokDay('bad'));
});
test('no samples are unavailable, not zero km',()=>{const r=core.calculateVehicleDay(day,[]);assert.equal(r.observedKm,null);assert.equal(r.missingSeconds,86400);assert.equal(r.complete,false);});
test('sorts samples, deduplicates evidence and reconciles observed intervals',()=>{
 const a=point(0),b=point(1,100.001),r=core.calculateVehicleDay(day,[b,a,a]);
 assert.ok(r.observedKm>0);assert.equal(r.coveredSeconds,60);assert.equal(r.missingSeconds,86340);
 assert.equal(r.intervals.reduce((n,i)=>n+Date.parse(i.end)-Date.parse(i.start),0),86400000);
});
test('gaps, unverified fixes and jumps never create distance',()=>{
 for(const samples of [[point(0),point(8,100.01)],[point(0),point(1,100.01,{verifiedGps:false})],[point(0),point(1,110)]]) assert.equal(core.calculateVehicleDay(day,samples).observedKm,null);
});
test('same-time revisions remain conflicting; no averaging',()=>{
 const r=core.calculateVehicleDay(day,[point(0),point(1),point(1,100.001,{evidenceId:'revision'})]);assert.equal(r.observedKm,null);assert.equal(r.intervals[0].reason,'conflicting_timestamp');
});
test('counter requires validation, detects resets and respects physical bounds',()=>{
 const samples=[point(0,100,{sourceDistanceRaw:1000}),point(1,100.001,{sourceDistanceRaw:1200})];
 assert.equal(core.calculateVehicleDay(day,samples).intervals[0].method,'gps_chord');
 const policy={...core.DEFAULT_DISTANCE_POLICY,counter:{evidenceReference:'provider-unit-validation',unitsPerKm:1000}};
 assert.equal(core.calculateVehicleDay(day,samples,policy).observedKm,0.2);
 assert.equal(core.calculateVehicleDay(day,[samples[1],point(2,100.002,{sourceDistanceRaw:10})],policy).observedKm,null);
});
test('cross-day segments are not prorated',()=>{const r=core.calculateVehicleDay(day,[point(-1),point(1,100.001)]);assert.equal(r.observedKm,null);assert.equal(r.intervals[0].reason,'day_boundary_without_sample');});
test('engine-on stationary periods are conditional idle; missing engine is unknown',()=>{
 assert.equal(core.calculateVehicleDay(day,[point(0,100,{speedKph:0}),point(1,100,{speedKph:0})]).idleHours,1/60);
 assert.equal(core.calculateVehicleDay(day,[point(0,100,{speedKph:0,engineOn:null}),point(1,100,{speedKph:0,engineOn:null})]).intervals[0].state,'unknown');
});
test('allocation conflicts stay unassigned and totals reconcile exactly',()=>{
 const r=core.calculateVehicleDay(day,[point(0),point(1,100.001),point(2,100.002)]);
 const choice={intervalId:r.intervals[0].id,kind:'job',jobId:'j',confirmedBy:'office',evidenceReference:'review'};
 const a=core.allocateDistance(r.intervals,[choice]);assert.equal(a.allocatedKm+a.unassignedKm,a.totalObservedKm);
 assert.equal(core.allocateDistance(r.intervals,[choice,choice]).jobKm,0);
 assert.equal(core.segmentTimeline(r.intervals)[0].intervalIds.length,2);
});
test('job matching rejects wrong stable ID and ranks ordered multi-stop evidence; no auto confirmation',()=>{
 const j={vehicleId:'v',registration:'AB-1',confirmedDriverId:'d',start:day+'T08:00:00+07:00',end:day+'T10:00:00+07:00',stops:[{latitude:13,longitude:100},{latitude:13,longitude:100.1}],workOrder:'WO'};
 const rows=ops.rankJobCandidates(j,[{...j,id:'wrong',vehicleId:'other'},{...j,id:'good'}]);assert.equal(rows.length,1);assert.equal(rows[0].score,100);assert.equal(rows[0].status,'confirmation_required');
});
test('purchased fuel is not consumption; LPG separated; estimates require efficiency evidence',()=>{
 const p=[{id:'receipt',vehicleId:'v',day,fuel:'lpg',litres:20,costThb:300}];
 const r=ops.fuelIntelligence('v',day,p,[]);assert.equal(r[2].purchasedLitres,20);assert.equal(r[2].consumedLitres,null);assert.equal(r[0].purchasedLitres,null);
 assert.throws(()=>ops.fuelIntelligence('v',day,p,[{vehicleId:'v',day,fuel:'lpg',litres:20,method:'estimated',sourceReference:'x'}]));
 assert.throws(()=>ops.fuelIntelligence('v',day,[...p,...p],[]));
});
test('backfill is bounded, overlapping and rejects invalid windows',()=>{
 const r=sync.planBackfill(day+'T00:00:00Z',day+'T00:03:00Z',120);assert.equal(r.length,2);assert.equal(Date.parse(r[0].end)-Date.parse(r[1].start),1000);assert.throws(()=>sync.planBackfill('bad','bad',120));
});
test('backfill splits Bangkok midnight without looping at boundary',()=>{
 const r=sync.planBackfill('2026-10-24T23:58:00+07:00','2026-10-25T00:02:00+07:00',300);
 assert.equal(r.length,2);assert.equal(r[0].end,'2026-10-24T17:00:00.000Z');assert.equal(r[1].start,r[0].end);
});
test('fleet reporting rejects double-counted days, reconciles and keeps unknown fuel blank',()=>{
 const daily=core.calculateVehicleDay(day,[point(0),point(1,100.001)]);
 const row={vehicleId:'=BAD()',daily,allocation:core.allocateDistance(daily.intervals,[]),fuel:ops.fuelIntelligence('v',day,[],[])};
 const r=reports.buildFleetReport([row]);assert.equal(r.observedKm,daily.observedKm);assert.equal(r.coveredVehicleDays,0);assert.equal(r.fuel[0].measuredLitres,null);
 assert.throws(()=>reports.buildFleetReport([row,row]));assert.ok(reports.vehicleDaysCsv([row]).includes("'=BAD()"));
 assert.throws(()=>reports.vehicleDaysCsv([{...row,allocation:{...row.allocation,totalObservedKm:100}}]));
});
test('synthetic full-day timeline reconciles without claiming real evidence',()=>{
 const points=Array.from({length:1441},(_,i)=>point(i,100+i*0.00001));
 const r=core.calculateVehicleDay(day,points);assert.equal(r.coveredSeconds,86400);assert.equal(r.missingSeconds,0);
 const allocation=core.allocateDistance(r.intervals,[]);assert.equal(allocation.unassignedKm,r.observedKm);assert.equal(allocation.allocatedKm,0);
 const timeline=core.segmentTimeline(r.intervals);assert.ok(Math.abs(timeline.reduce((n,s)=>n+(s.km??0),0)-r.observedKm)<1e-8);
 assert.equal(r.confidence,'derived_with_conditions');
});
test('EES snapshot uses select only, rejects mismatched stable identities and keeps purchases separate',async()=>{
 const calls=[];const rows={booking_diary:[{id:'wrong',vehicle_id:'other',vehicle_registration:'AB-1'},{id:'right',vehicle_id:'v'},{id:'legacy',vehicle_id:null,vehicle:'AB1'}],fuel_logs:[{id:'receipt',vehicle_reg:'AB-1',litres:20,total_cost:500}]};
 const client={from(table){calls.push(table);const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return Promise.resolve({data:rows[table],error:null});}};return q;}};
 const r=await ees.readEesFleetDay({vehicleId:'v',registrations:['AB-1'],day},{client,authorize:async()=>true});assert.deepEqual(r.bookings.map(b=>b.id),['right','legacy']);assert.equal(r.fuelPurchases[0].litres,20);assert.equal(calls.length,2);
 await assert.rejects(()=>ees.readEesFleetDay({vehicleId:'v',registrations:['AB-1'],day},{client,authorize:async()=>false}));
});
const window={vehicleId:'v',deviceId:'box',start:day+'T00:00:00+07:00',end:day+'T00:05:00+07:00',mappingEvidence:'mapping'};
const policy={entitlementEvidence:'entitlement',limitsEvidence:'limits',sourceTimezone:'Asia/Bangkok',maxWindowSeconds:300,minIntervalMs:1000,retentionStart:'2026-10-01T00:00:00Z',maxPages:2,maxRows:10,maxBytes:10000};
function deps(page) {const calls=[];return {calls,enabled:true,now:()=>Date.parse('2026-11-04T00:00:00Z'),authorizeMapping:async()=>true,fetchPage:async()=>page,store:{acquire:async()=>({token:'test-lease',generation:1,expiresAt:Date.parse('2026-11-04T00:01:00Z')}),commit:async(...a)=>calls.push(['commit',...a]),fail:async(...a)=>calls.push(['fail',...a]),release:async()=>calls.push(['release'])}};}
test('sync disabled or mapping rejected sends no request',async()=>{
 const d=deps(null);d.fetchPage=()=>{throw new Error('must not call');};d.enabled=false;assert.equal((await sync.syncHistoryWindow(window,policy,d)).status,'disabled');d.enabled=true;d.authorizeMapping=async()=>false;assert.equal((await sync.syncHistoryWindow(window,policy,d)).status,'mapping_rejected');
});
test('sync strips sensitive fields, deduplicates revisions and does not claim provider completeness',async()=>{
 const row={gpsID:'box',dateTime:day+'T00:01:00+07:00',GPS:true,Latitude:13,Longitude:100,positionSource:'GPS',IDCard:'private',password:'secret'};
 const d=deps({payload:[row,row],nextCursor:null,completeness:'unknown'});
 const r=await sync.syncHistoryWindow(window,policy,d);assert.equal(r.status,'incomplete');assert.equal(r.rawCount,1);assert.equal(JSON.stringify(d.calls).includes('private'),false);assert.equal(JSON.stringify(d.calls).includes('secret'),false);
});
test('failed pages do not checkpoint, release lease, and do not leak errors',async()=>{
 const d=deps(null);d.fetchPage=async()=>{throw new Error('bearer secret');};const r=await sync.syncHistoryWindow(window,policy,d);assert.equal(r.status,'failed');assert.equal(d.calls.some(c=>c[0]==='commit'),false);assert.equal(d.calls.at(-1)[0],'release');assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('repeated sync preserves evidence identities and retrospective revisions remain distinct',async()=>{
 const row={gpsID:'box',dateTime:day+'T00:01:00+07:00',GPS:true,Latitude:13,Longitude:100,positionSource:'GPS'};
 const d=deps({payload:[row],nextCursor:null,completeness:'unknown'});
 await sync.syncHistoryWindow(window,policy,d);await sync.syncHistoryWindow(window,policy,d);
 const commits=d.calls.filter(c=>c[0]==='commit');assert.equal(commits[0][2][0].id,commits[1][2][0].id);
 d.fetchPage=async()=>({payload:[row,{...row,Longitude:100.001}],nextCursor:null,completeness:'unknown'});
 await sync.syncHistoryWindow(window,policy,d);const raw=d.calls.filter(c=>c[0]==='commit').at(-1)[2];assert.equal(raw.length,2);assert.notEqual(raw[0].id,raw[1].id);
});
test('offline command reconciles a labelled synthetic input and refuses overwrites',()=>{
 const child=require('node:child_process');const os=require('node:os');
 const destination=path.join(os.tmpdir(),'ees-fleet-preview-'+require('node:crypto').randomUUID()+'.json');
 const args=[path.join(root,'scripts/fleet-intelligence-preview.cjs'),path.join(root,'docs/fleet-intelligence-preview.synthetic.json'),destination];
 try {
   assert.equal(child.spawnSync(process.execPath,args,{encoding:'utf8'}).status,0);
   const report=JSON.parse(fs.readFileSync(destination,'utf8'));assert.equal(report.realDataVerified,false);assert.equal(report.checks.providerRequests,0);assert.ok(report.daily.observedKm>0);assert.equal(report.allocation.unassignedKm,report.daily.observedKm);assert.equal(report.daily.missingSeconds,86340);
   assert.equal(child.spawnSync(process.execPath,args,{encoding:'utf8'}).status,1);
 } finally {if(fs.existsSync(destination))fs.unlinkSync(destination);}
});
test('pagination requires shared budget and bounded page count',async()=>{
 const d=deps({payload:[],nextCursor:'next',completeness:'verified'});assert.equal((await sync.syncHistoryWindow(window,policy,d)).status,'failed');assert.equal(d.calls.some(c=>c[0]==='commit'),false);
 const e=deps(null);let n=0;e.reserveNextRequest=async()=>true;e.fetchPage=async()=>({payload:[],nextCursor:n++===0?'next':null,completeness:'verified'});assert.equal((await sync.syncHistoryWindow(window,policy,e)).status,'complete');
});
test('calculations preserve original samples, fuel and job evidence',()=>{
 const points=[point(0),point(1,100.001)];const before=JSON.stringify(points);
 points.forEach(Object.freeze);Object.freeze(points);core.calculateVehicleDay(day,points);assert.equal(JSON.stringify(points),before);
 const purchases=[Object.freeze({id:'p',vehicleId:'v',day,fuel:'diesel',litres:20,costThb:600})];const snapshot=JSON.stringify(purchases);
 ops.fuelIntelligence('v',day,Object.freeze(purchases),[]);assert.equal(JSON.stringify(purchases),snapshot);
});
