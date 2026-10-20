const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript'),{randomUUID}=require('node:crypto');
const {fixture}=require('./fixtures/hr-v7-http.cjs');const load=Module._load,resolve=Module._resolveFilename;
Module._load=function(name,parent,...rest){if(name==='server-only')return {};return load.call(this,name,parent,...rest)};
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.resolve(name.slice(2))+'.ts':name,parent,...rest)};
Module._extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let f,route,employee,absence,incident,day;
test.before(async()=>{f=await fixture();process.env.NEXT_PUBLIC_SUPABASE_URL=f.url;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-public-key';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-key';route=require('../app/api/hr/[...path]/route.ts');employee=(await f.db.query('select id from ees_employee_profiles where driver_id=11')).rows[0].id;day=(await f.db.query("select (now() at time zone 'Asia/Bangkok')::date::text as today_key")).rows[0].today_key;});
test.after(async()=>{await f?.close();});
async function req(method,url,body,token=f.token){return route[method](new Request('http://local.test/api/hr/'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:url.split('?')[0].split('/')})});}
async function save(kind,input,nonce=randomUUID()){const response=await req('POST','people/'+kind,{input,requestId:nonce});assert.equal(response.status,200,await response.clone().text());return response.json();}
async function rpc(name,args=[]){return f.run({sub:f.hr,role:'authenticated'},async()=> (await f.db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result);}
test('absence create/edit/retry/return persists with original snapshots and verified dashboard counts',async()=>{
const input={employeeId:employee,category:'sick',status:'requested',startDate:day,endDate:day,returnStatus:'expected',notes:'Synthetic restricted medical note',documentIds:[]};const nonce=randomUUID();absence=await save('absences',input,nonce);assert.deepEqual(await save('absences',input,nonce),absence);
assert.equal((await req('POST','people/absences',{input:{...input,notes:'Changed nonce content'},requestId:nonce})).status,409);
absence=await save('absences',{...input,id:absence.id,version:absence.version,status:'approved'});
const list=await (await req('GET','people/absences?view=away')).json();assert.equal(list.total,1);assert.equal(list.rows[0].duration,1);assert.equal(list.rows[0].approved_name,'Synthetic HR');assert.equal(list.rows[0].events.length,2);
const directory=await(await req('POST','directory',{})).json();assert.equal(directory.summary.awayToday,1);assert.equal(directory.rows.find(row=>row.driverId==='11').awayToday,true);
const profile=await(await req('GET','profile/driver/11?section=absences')).json();assert.equal(profile.data.rows[0].id,absence.id);
assert.equal((await req('POST','people/absences',{requestId:randomUUID(),input:{...input,id:absence.id,version:1,status:'cancelled'}})).status,409);
absence=await save('absences',{...input,id:absence.id,version:absence.version,status:'completed',returnStatus:'returned',returnDate:day});
assert.equal((await(await req('POST','directory',{})).json()).summary.awayToday,0);
const reopened=await(await req('GET','people/absences?employeeId='+employee)).json();assert.equal(reopened.rows[0].return_status,'returned');assert.equal(reopened.rows[0].events.length,3);assert.equal(reopened.rows[0].events[0].snapshot.status,'requested');
assert.equal((await f.db.query('select active from drivers where id=11')).rows[0].active,true);
});
test('incident create/resolve preserves originals, owner and deadline and produces timeline events',async()=>{
const input={employeeId:employee,category:'conduct',status:'action_required',occurredAt:day+'T08:00:00+07:00',description:'Synthetic original report',severity:'high',actionTaken:'Synthetic investigation',responsibleId:f.hr,followupDate:day,documentIds:[]};incident=await save('incidents',input);
const dir=await(await req('POST','directory',{})).json();assert.equal(dir.summary.actionsDue,1);
const initial=await(await req('GET','people/incidents')).json();assert.equal(initial.rows[0].responsible_name,'Synthetic HR');
incident=await save('incidents',{...input,id:incident.id,version:incident.version,status:'resolved',description:'Synthetic corrected report',actionTaken:'Synthetic resolution'});
const final=await(await req('GET','people/incidents?status=resolved')).json();assert.equal(final.rows[0].description,'Synthetic corrected report');assert.ok(final.rows[0].resolved_at);assert.equal(final.rows[0].events[0].snapshot.description,'Synthetic original report');assert.equal(final.rows[0].events.length,2);
const overview=await(await req('GET','profile/driver/11')).json();assert.ok(overview.data.timeline.some(ev=>ev.type==='incident'));assert.ok(overview.data.timeline.some(ev=>ev.type==='absence'));
assert.equal((await(await req('POST','directory',{})).json()).summary.actionsDue,0);
});
test('ordinary office/driver cannot read medical notes, disciplinary history, choices or mutate cases',async()=>{
for(const token of [f.tokenFor(f.office),f.tokenFor(f.driver,'driver_portal')]){for(const url of ['people/absences','people/incidents','people/choices','profile/driver/11?section=incidents'])assert.equal((await req('GET',url,undefined,token)).status,403);assert.equal((await req('POST','people/incidents',{requestId:randomUUID(),input:{employeeId:employee}},token)).status,403);}
const publicDir=await(await req('POST','directory',{},f.tokenFor(f.office))).json();assert.equal(publicDir.summary.awayToday,null);assert.equal(publicDir.summary.actionsDue,null);assert.doesNotMatch(JSON.stringify(publicDir),/Synthetic restricted medical|Synthetic original report/);
await f.run({sub:f.office,role:'authenticated'},async()=>{for(const table of ['ees_hr_absences','ees_hr_incidents','ees_hr_case_events'])assert.equal((await f.db.query('select * from '+table)).rows.length,0)});
await assert.rejects(f.run({sub:f.hr,role:'authenticated'},()=>f.db.query("update ees_hr_incidents set description='Silent overwrite' where id=$1",[incident.id])),/permission denied/);await assert.rejects(f.run({sub:f.hr,role:'authenticated'},()=>f.db.query('delete from ees_hr_case_events')),/permission denied/);
});
test('validation rejects cross-employee evidence, reversed dates, missing return and silent employee reassignment',async()=>{
const base={employeeId:employee,category:'annual',status:'requested',startDate:day,endDate:day,returnStatus:'expected',documentIds:[]};
for(const input of [{...base,endDate:'2020-01-01'},{...base,documentIds:[randomUUID()]},{...base,status:'completed'},{...base,returnStatus:'returned'}])assert.notEqual((await req('POST','people/absences',{requestId:randomUUID(),input})).status,200);
assert.notEqual((await req('POST','people/incidents',{requestId:randomUUID(),input:{employeeId:employee,category:'safety',status:'resolved',description:'Synthetic',occurredAt:day+'T09:00:00+07:00',severity:'low'}})).status,200);
});
test('ready document evidence reuses existing private document IDs and forward migration is idempotent',async()=>{
const policy=await rpc('ees_hr_v7_action',['save_document_policy',JSON.stringify({category:'other',purpose:'Synthetic evidence only',lawfulBasis:'Synthetic test configuration',reference:'SYNTHETIC-ONLY',retentionDays:365,approved:true}),randomUUID()]);
const doc=await rpc('ees_hr_v7_action',['prepare_document',JSON.stringify({employeeId:employee,category:'other',policyId:policy.id,filename:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:100}),randomUUID()]);
await f.db.query("insert into storage.objects(bucket_id,name) values('ees-employee-documents',$1)",[doc.objectKey]);await f.run({sub:f.hr,role:'service_role'},()=>f.db.query("select ees_hr_v7_finalize_document($1,$2,'ready')",[doc.id,f.hr]));
const item=await save('incidents',{employeeId:employee,category:'other',status:'open',occurredAt:day+'T09:00:00+07:00',description:'Synthetic evidence record',severity:'low',documentIds:[doc.id]});
const list=await(await req('GET','people/incidents')).json();assert.deepEqual(list.rows.find(r=>r.id===item.id).document_ids,[doc.id]);assert.doesNotMatch(JSON.stringify(list),/object_key|storage\/v1/);
await f.db.exec(fs.readFileSync('supabase/migrations/20261013150000_ees_hr_v7_people_centre.sql','utf8'));assert.equal(await rpc('ees_people_ready'),true);assert.equal((await f.db.query('select count(*)::int n from ees_hr_incidents')).rows[0].n,2);
});
