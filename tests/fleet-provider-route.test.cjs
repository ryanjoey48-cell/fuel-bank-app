const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {load}=require('../scripts/fleet-real-day-validation.cjs');
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
function make({role='admin',denied=0,production=false,rateLimited=false,duplicate=false,parkingFails=false,logFails=false,cachedEntry=null}={}){
 const calls=[];const raw=[{boxId:'box',plateNo:'REG',rDate:'2026-11-03',startTime:'08:00:00',endTime:'09:00:00',sumDistance:'12.30'},{boxId:'',plateNo:'Total',sumDistance:'12.30'}];
 const mocks={
  'next/server':{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}},
  '@/lib/admin-user-management-server':{AdminApiError:ApiError},
  '@/lib/fleet-operations-auth':{requireFleetOfficeAccess:async()=>{if(denied)throw new ApiError(denied,'Denied');return {user:{id:'office'},access:{userId:'office',role,status:'active'}};}},
  '@/lib/authorization':load('lib/authorization.ts'),'@/lib/forth-playback-access':load('lib/forth-playback-access.ts'),
  '@/lib/fleet-evidence-server':{createFleetSourceClient:()=>{calls.push('db');return {from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'v',vehicle_reg:'REG'},error:null})})})})};}},
  '@/lib/forth-tracking-server':{
   getForthTrackingFleetData:async()=>{calls.push('fleet');const record={gpsDeviceId:'box',vehicleRegistration:'REG'};return {connectionStatus:'connected',records:duplicate?[record,record]:[record]};},
   getForthParkingReport:async scope=>{calls.push({parking:scope});return parkingFails?{ok:false,status:502,error:{code:'failed'}}:{ok:true,payload:raw};},
   getForthLogReport:async scope=>{calls.push({log:scope});return logFails?{ok:false,error:{code:'failed'}}:{ok:true,payload:[]};}
  },
  '@/lib/forth-tracking':load('lib/forth-tracking.ts'),
  '@/lib/forth-history-live-gate':{isForthHistoryLiveRequestsEnabled:()=>false},
  '@/lib/forth-history-rate-limit':{beginForthHistoryRateLimit:()=>({allowed:!rateLimited,retryAfterSeconds:2}),releaseForthHistoryRateLimit:()=>calls.push('release')},
  '@/lib/fleet-intelligence':load('lib/fleet-intelligence.ts'),
  '@/lib/fleet-intelligence-day':load('lib/fleet-intelligence-day.ts'),
  '@/lib/fleet-provider-metrics':load('lib/fleet-provider-metrics.ts'),
  '@/lib/fleet-provider-request-log':load('lib/fleet-provider-request-log.ts'),
  '@/lib/fleet-intelligence-session':{rememberProviderDay:(user,evidence)=>calls.push({user,cached:evidence}),recalledProviderDayEntry:()=>cachedEntry}
 };
 const module={exports:{}};const compiled=ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/provider/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports','process',compiled)(name=>{if(!(name in mocks))throw Error(name);return mocks[name];},module,module.exports,{env:{NODE_ENV:production?'production':'development'}});
 return {POST:module.exports.POST,calls};
}
const request=(query='vehicleId=v&day=2026-11-03')=>new Request('http://localhost/api/admin/forth-tracking/evidence/provider?'+query,{method:'POST'});
test('provider route rejects unauthorized office access and production gate before any source request',async()=>{
 for(const option of [{denied:401},{denied:403},{production:true}]){const r=make(option);assert.equal((await r.POST(request())).status,option.denied||503);assert.equal(r.calls.length,0);}
});
test('provider route reads one server-resolved device/day and separately caches source-aware results',async()=>{
 const r=make();const response=await r.POST(request('vehicleId=v&day=2026-11-03&deviceId=ATTACKER'));assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.sources.providerReported.value,12.3);assert.equal(body.sources.gpsDerived.value,null);assert.equal(body.sources.providerReported.completeness,'unknown');
 assert.equal(r.calls.find(c=>c.parking).parking.deviceId,'box');assert.equal(r.calls.find(c=>c.log).log.endTime,'20261103235959');assert.equal(r.calls.find(c=>c.cached).user,'office');assert.equal(r.calls.at(-1),'release');
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal('observedPoints' in body,false);
});
const entry={evidence:{vehicleId:'v',registration:'REG',day:'2026-11-03',marker:'earlier-evidence',observedPoints:[{timestamp:'2026-11-03T01:00:00Z',latitude:13.7,longitude:100.7}]},storedAt:'2026-11-05T10:00:00.000Z',expiresAt:'2026-11-05T10:30:00.000Z'};
test('repeat reads inside the cache window are idempotent: no Forth request, cache provenance returned',async()=>{
 const r=make({cachedEntry:entry});const response=await r.POST(request());const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.marker,'earlier-evidence');assert.equal('observedPoints' in body,false);assert.deepEqual(body.cache,{hit:true,storedAt:entry.storedAt,expiresAt:entry.expiresAt});
 assert.equal(r.calls.some(c=>c.parking||c.log||c==='fleet'),false);assert.equal(r.calls.some(c=>c.cached),false);
});
test('explicit refresh bypasses the cache, and a failed refresh never overwrites earlier evidence',async()=>{
 const ok=make({cachedEntry:entry});const fresh=await(await ok.POST(request('vehicleId=v&day=2026-11-03&refresh=1'))).json();
 assert.equal(fresh.cache.hit,false);assert.equal(ok.calls.some(c=>c.parking),true);assert.equal(ok.calls.some(c=>c.cached),true);
 const failed=make({cachedEntry:entry,parkingFails:true});const response=await failed.POST(request('vehicleId=v&day=2026-11-03&refresh=1'));
 assert.equal(response.status,502);assert.equal(failed.calls.some(c=>c.cached),false);          // nothing was written, so the earlier cached day remains
 assert.equal((await make({cachedEntry:entry}).POST(request('vehicleId=v&day=2026-11-03&refresh=0'))).status,200);   // only refresh=1 forces a provider request
});
test('ambiguous device identity and rate limits prevent historical reads',async()=>{
 for(const option of [{duplicate:true},{rateLimited:true}]){const r=make(option);assert.equal((await r.POST(request())).status,option.duplicate?409:429);assert.equal(r.calls.some(c=>c.parking||c.log),false);}
});
test('failed parking reports do not request GPS, while failed GPS preserves provider evidence',async()=>{
 const failed=make({parkingFails:true});assert.equal((await failed.POST(request())).status,502);assert.equal(failed.calls.some(c=>c.log),false);
 const partial=make({logFails:true});const response=await partial.POST(request());const body=await response.json();assert.equal(response.status,200);assert.equal(body.sources.providerReported.value,12.3);assert.equal(body.logAvailable,false);assert.equal(body.sources.gpsDerived.value,null);
});
test('malformed and future date scopes fail before source reads',async()=>{
 for(const day of ['2026-02-30','2099-01-01']){const r=make();assert.equal((await r.POST(request('vehicleId=v&day='+day))).status,400);assert.equal(r.calls.length,0);}
});
test('Forth parking report transport is fixed, bounded and shares existing OAuth authentication',async()=>{
 const calls=[];const service=load('lib/forth-tracking-server.ts').createForthTrackingService({environment:{FORTH_CLIENT_ID:'test',FORTH_CLIENT_SECRET:'test',FORTH_USERNAME:'test',FORTH_PASSWORD:'test',FORTH_TOKEN_REQUEST_PROFILE:'oauth-password-basic-v1'},fetcher:async(url,init)=>{
  calls.push({url,init});return Response.json(url.includes('authorizationserver')?{access_token:'test-token',token_type:'Bearer',expires_in:3600}:[]);
 }});
 assert.equal((await service.getParkingReport({deviceId:'box',forthDate:'20261103',language:'en'})).ok,true);
 const call=calls.find(c=>c.url.endsWith('/parkingTrip'));assert.ok(call);assert.equal(call.init.method,'POST');assert.deepEqual(JSON.parse(call.init.body),{boxIds:'box',startDate:'20261103',endDate:'20261103',language:'en'});assert.equal(call.init.redirect,'error');
 assert.equal((await service.getParkingReport({deviceId:'box',forthDate:'bad',language:'en'})).ok,false);assert.equal(calls.length,2);
});

test('journey detail is released only to authorised historical-journey callers; everyone else keeps the day total',async()=>{
 for(const role of ['office_staff','read_only']){
  const withLedger={...entry,evidence:{...entry.evidence,journeyLedger:{journeys:[{id:'J01',providerKm:9}],totals:{reportedTrailKm:9}}}};
  const body=await(await make({role,cachedEntry:withLedger}).POST(request())).json();
  assert.equal(body.journeyLedger,null,role);assert.equal(body.journeyAccess,'requires_authorisation',role);assert.equal(body.marker,'earlier-evidence',role+' still gets the evidence without journeys');
  assert.doesNotMatch(JSON.stringify(body),/reportedTrailKm|"J01"/,role);
 }
 const withLedger={...entry,evidence:{...entry.evidence,journeyLedger:{journeys:[{id:'J01'}]}}};
 const admin=await(await make({role:'admin',cachedEntry:withLedger}).POST(request())).json();
 assert.equal(admin.journeyAccess,'granted');assert.equal(admin.journeyLedger.journeys[0].id,'J01');
});
