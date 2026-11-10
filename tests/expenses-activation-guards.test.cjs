const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {approvedProfile}=require('../scripts/start-expenses-approved-test.cjs');const {readiness}=require('../scripts/expenses-readiness.cjs');
const candidate='https://wpmnjfncaoogssgpqxek.supabase.co',production='https://hafoaurzfgkkwpvzedvd.supabase.co';
function fileIn(directory,env){const file=path.join(directory,'synthetic.env');fs.writeFileSync(file,Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n'));return file;}
test('approved test launcher refuses production, implicit approval and inherited credentials',()=>{
 const directory=fs.mkdtempSync(path.resolve('tmp','expenses-v11-profile-'));try{
  let file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:production,EES_EXPENSES_WRITES:'approved-safe-environment',EES_EXPENSES_APPROVED_SUPABASE_URL:production});assert.throws(()=>approvedProfile(file),/Production/);
  file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:candidate});assert.throws(()=>approvedProfile(file),/explicit/);
  file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:candidate,EES_EXPENSES_WRITES:'approved-safe-environment',EES_EXPENSES_APPROVED_SUPABASE_URL:candidate});assert.throws(()=>approvedProfile(file),/credentials/);
  const jwt=ref=>'synthetic.'+Buffer.from(JSON.stringify({ref})).toString('base64url')+'.synthetic';
  file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:candidate,EES_EXPENSES_WRITES:'approved-safe-environment',EES_EXPENSES_APPROVED_SUPABASE_URL:candidate,NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt('hafoaurzfgkkwpvzedvd'),SUPABASE_SERVICE_ROLE_KEY:jwt('wpmnjfncaoogssgpqxek')});assert.throws(()=>approvedProfile(file),/do not match/);
  file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:candidate,EES_EXPENSES_WRITES:'approved-safe-environment',EES_EXPENSES_APPROVED_SUPABASE_URL:candidate,NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt('wpmnjfncaoogssgpqxek'),SUPABASE_SERVICE_ROLE_KEY:jwt('wpmnjfncaoogssgpqxek')});assert.equal(approvedProfile(file).NEXT_PUBLIC_SUPABASE_URL,candidate);
 }finally{assert.ok(directory.startsWith(path.resolve('tmp','expenses-v11-profile-')));fs.rmSync(directory,{recursive:true,force:true});}
});
test('readiness probe uses only metadata GETs and refuses production before making a request',async()=>{
 const directory=fs.mkdtempSync(path.resolve('tmp','expenses-v11-probe-')),prior=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,method:options.method});assert.equal(options.method,'GET');const parsed=new URL(url);let body=[];if(parsed.pathname==='/rest/v1/')body={paths:{}};else if(parsed.pathname.startsWith('/storage/'))body={public:false,file_size_limit:15728640};else{assert.equal(parsed.searchParams.get('limit'),'0');assert.equal(parsed.searchParams.get('select'),'*');}return new Response(JSON.stringify(body),{status:200});};
  try{let file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:production,SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret-not-logged'});await assert.rejects(()=>readiness(file),/never probed/);assert.equal(calls.length,0);file=fileIn(directory,{NEXT_PUBLIC_SUPABASE_URL:candidate,SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret-not-logged'});const report=await readiness(file);assert.equal(report.approvedForExpenses,false);assert.equal(report.storage.private,true);assert.equal(calls.length,15);assert.ok(calls.every(c=>!c.url.includes('/rpc/')));assert.ok(!JSON.stringify(report).includes('synthetic-secret-not-logged'));assert.equal(report.tables.expenses_booking_links.present,true);assert.equal(report.functions.expenses_register,false);
 }finally{global.fetch=prior;assert.ok(directory.startsWith(path.resolve('tmp','expenses-v11-probe-')));fs.rmSync(directory,{recursive:true,force:true});}
});
