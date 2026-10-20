const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript'),{randomUUID}=require('node:crypto');
const {fixture}=require('./fixtures/hr-v7-http.cjs');
const originalLoad=Module._load,originalResolve=Module._resolveFilename;
Module._load=function(name,parent,...rest){if(name==='server-only')return {};return originalLoad.call(this,name,parent,...rest)};
Module._resolveFilename=function(name,parent,...rest){return originalResolve.call(this,name.startsWith('@/')?path.resolve(name.slice(2))+'.ts':name,parent,...rest)};
Module._extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let f,route;
test.before(async()=>{f=await fixture();process.env.NEXT_PUBLIC_SUPABASE_URL=f.url;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-public-key';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-key';route=require('../app/api/hr/[...path]/route.ts');});
test.after(async()=>{await f?.close();});
async function request(method,path,body,token=f.token){const headers={...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})};const req=new Request('http://local.test/api/hr/'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return route[method](req,{params:Promise.resolve({path:path.split('?')[0].split('/')})});}
const {subscribeHRSession}=require('../lib/ees-hr-session.ts');
test('auth refresh is deferred beyond the SDK lock and repeated sign-in notifications are deduplicated',async()=>{
 let callback,locked=false,refreshes=0,clears=0,unsubscribed=false;
 const cleanup=subscribeHRSession({onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){unsubscribed=true}}}};}},()=>{assert.equal(locked,false);refreshes++},()=>clears++);
 callback('INITIAL_SESSION',{user:{id:'first'}});for(let n=0;n<10;n++)callback('SIGNED_IN',{user:{id:'first'}});assert.equal(refreshes,0);assert.equal(clears,0);
 locked=true;callback('SIGNED_IN',{user:{id:'second'}});assert.equal(refreshes,0);assert.equal(clears,1);locked=false;await new Promise(r=>setTimeout(r,10));assert.equal(refreshes,1);
 callback('SIGNED_OUT',null);cleanup();await new Promise(r=>setTimeout(r,10));assert.equal(refreshes,1);assert.equal(unsubscribed,true);
});
test('missing People Centre RPC is diagnosed with its exact pending migration and creation stays blocked',async()=>{
 await f.db.exec('drop function public.ees_people_ready()');
 const access=await(await request('GET','access')).json();assert.equal(access.peopleReady,false);assert.deepEqual(access.setupDependencies,[{rpc:'ees_people_ready',migration:'20261013150000_ees_hr_v7_people_centre.sql',reason:'missing_rpc'}]);
 assert.equal((await request('POST','people/absences',{input:{},requestId:randomUUID()})).status,503);
 await f.db.exec(fs.readFileSync('supabase/migrations/20261013150000_ees_hr_v7_people_centre.sql','utf8'));assert.equal((await(await request('GET','access')).json()).peopleReady,true);
});
test('missing release guard is diagnosed separately and existing private compliance reads still work',async()=>{
 await f.db.exec('drop function public.ees_hr_v7_release_ready()');const access=await(await request('GET','access')).json();assert.equal(access.releaseReady,false);assert.equal(access.setupDependencies[0].rpc,'ees_hr_v7_release_ready');assert.equal(access.setupDependencies[0].migration,'20261013140000_ees_hr_v7_workflow_guards.sql');
 assert.equal((await request('GET','compliance')).status,200);
 await f.db.exec(fs.readFileSync('supabase/migrations/20261013140000_ees_hr_v7_workflow_guards.sql','utf8'));assert.equal((await(await request('GET','access')).json()).peopleReady,true);
});
test('compliance filters cover the full directory before pagination and omit confidential file/licence fields',async()=>{
 const first=await(await request('GET','compliance?page=1')).json(),second=await(await request('GET','compliance?page=2')).json();assert.equal(first.total,32);assert.equal(first.rows.length,25);assert.equal(second.rows.length,7);
 assert.doesNotMatch(JSON.stringify(first),/object_key|original_filename|licence_number|telephone|salary/);
 const saved=await(await request('POST','action',{action:'save_employee',requestId:randomUUID(),input:{driverId:'31',preferredName:'Synthetic Driver 31',statusReason:'Synthetic compliance fixture'}})).json();assert.ok(saved.id);
 const expired=await request('POST','action',{action:'save_licence',requestId:randomUUID(),input:{employeeId:saved.id,category:'SYNTHETIC',number:'PRIVATE-SYNTHETIC-NUMBER',issueDate:'2020-01-01',expiryDate:'2020-02-01',verificationStatus:'unverified'}});assert.equal(expired.status,200,await expired.clone().text());
 const filtered=await(await request('GET','compliance?status=expired')).json();assert.equal(filtered.total,1);assert.equal(filtered.rows[0].id,'31');assert.equal(filtered.rows[0].expiry,'2020-02-01');assert.doesNotMatch(JSON.stringify(filtered),/PRIVATE-SYNTHETIC/);
 const search=await(await request('GET','compliance?search=Synthetic%20Driver%2031')).json();assert.equal(search.total,1);
 assert.equal((await request('GET','compliance?status=not-supported')).status,400);
});
test('ordinary office and driver sessions cannot read compliance metadata or case data',async()=>{
 for(const token of [f.tokenFor(f.office),f.tokenFor(f.driver,'driver_portal')])for(const url of ['compliance','people/absences','people/incidents']){const res=await request('GET',url,undefined,token);assert.equal(res.status,403);assert.doesNotMatch(await res.text(),/employee_id|expiry_date|documentCount/);}
});
test('document expiry and unrecorded filters use ready records and latest applicable licence only',()=>{
 const {complianceRows}=require('../lib/ees-hr-compliance.ts');const person={id:'1',kind:'driver',driverId:'1',employeeId:'e',name:'Synthetic',vehicle:null,documentStatus:'expired'};
 const rows=complianceRows([person],[{employee_id:'e',state:'retired',expiry_date:'2020-01-01'},{employee_id:'e',state:'ready',expiry_date:'2026-10-20'}],[{employee_id:'e',issue_date:'2020-01-01',expiry_date:'2025-01-01',recorded_at:'2020-01-01'},{employee_id:'e',issue_date:'2026-01-01',expiry_date:'2027-01-01',recorded_at:'2026-01-01'},{employee_id:'e',issue_date:'2027-01-01',expiry_date:'2028-01-01',recorded_at:'2026-10-01'}],'2026-10-14');
 assert.equal(rows[0].documentCount,1);assert.equal(rows[0].expired,false);assert.equal(rows[0].expiring,true);assert.equal(rows[0].missing,false);assert.equal(rows[0].licenceExpiry,'2027-01-01');
});
