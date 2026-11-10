const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {lib,loadTs}=require('./helpers/invoice-compare.cjs');

test('V1.3 readiness helper distinguishes schema gaps from activation gates',()=>{
  const {resolveExpensesReadiness,expensesRegisterQuerySupported}=lib('expenses-readiness-state.ts');
  assert.equal(resolveExpensesReadiness({schemaPresent:false,schemaVersion:null,enabled:false,privateBucket:false,environmentReady:false}),'schema_unavailable');
  assert.equal(resolveExpensesReadiness({schemaPresent:true,schemaVersion:2,enabled:true,privateBucket:true,environmentReady:true}),'schema_upgrade_required');
  assert.equal(resolveExpensesReadiness({schemaPresent:true,schemaVersion:3,enabled:true,privateBucket:false,environmentReady:true}),'private_storage_required');
  assert.equal(resolveExpensesReadiness({schemaPresent:true,schemaVersion:3,enabled:false,privateBucket:true,environmentReady:true}),'activation_required');
  assert.equal(resolveExpensesReadiness({schemaPresent:true,schemaVersion:3,enabled:true,privateBucket:true,environmentReady:false}),'activation_required');
  assert.equal(resolveExpensesReadiness({schemaPresent:true,schemaVersion:3,enabled:true,privateBucket:true,environmentReady:true}),'ready');
  assert.equal(expensesRegisterQuerySupported('schema_unavailable'),false);
  assert.equal(expensesRegisterQuerySupported('schema_upgrade_required'),false);
  assert.equal(expensesRegisterQuerySupported('activation_required'),true);
  assert.equal(expensesRegisterQuerySupported('ready'),true);
});

test('bootstrap GET returns a degraded authenticated snapshot when Expenses schema is missing',async()=>{
  const server=lib('expenses-server.ts');
  const original=server.expensesContext;
  const route=loadTs(path.resolve('app/api/expenses-centre/route.ts'));
  const vehiclesQuery={select(){return this;},eq(){return this;},order:async()=>({data:[{id:'veh-1',vehicle_reg:'TEST-001'}],error:null})};
  server.expensesContext=async()=>({
    user:{id:'user-synthetic-v13'},
    access:{role:'admin',status:'active'},
    admin:{from:()=>vehiclesQuery,storage:{getBucket:async()=>({data:null,error:{message:'missing'}})}},
    db:{from(table){return {select(){return this;},single:async()=>({data:null,error:{code:'PGRST205',message:`${table} missing`}}),eq(){return this;},maybeSingle:async()=>({data:null,error:null})};}}
  });
  try{
    const response=await route.GET(new Request('http://localhost/api/expenses-centre'));
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.user_id,'user-synthetic-v13');
    assert.equal(body.ready,false);
    assert.equal(body.readiness,'schema_unavailable');
    assert.equal(body.capabilities.write,false);
    assert.equal(body.capabilities.admin,true);
    assert.deepEqual(body.expenses,[]);
    assert.equal(body.vehicles[0].vehicle_reg,'TEST-001');
  }finally{server.expensesContext=original;}
});

test('production write gate still refuses confirmed production even with matching flags',()=>{
  const {assertExpensesWriteEnvironment}=lib('expenses-server.ts');
  assert.throws(()=>assertExpensesWriteEnvironment({
    EES_EXPENSES_WRITES:'approved-safe-environment',
    EES_EXPENSES_APPROVED_SUPABASE_URL:'https://hafoaurzfgkkwpvzedvd.supabase.co',
    NEXT_PUBLIC_SUPABASE_URL:'https://hafoaurzfgkkwpvzedvd.supabase.co'
  }),/SAFE_ENVIRONMENT|AdminApiError|503/);
});

test('V1.3 activation SQL requires schema version 3 and register/booking objects',()=>{
  const sql=fs.readFileSync(path.resolve('docs/expenses-v13-activation-review-only.sql'),'utf8');
  assert.match(sql,/schema_version=3/);
  assert.match(sql,/expenses_register\(jsonb\)/);
  assert.match(sql,/expenses_booking_links/);
  assert.match(sql,/expenses_duplicate_resolutions/);
  assert.match(sql,/wpmnjfncaoogssgpqxek/);
  assert.match(sql,/NOT APPLIED|not applied/i);
  assert.doesNotMatch(sql,/hafoaurzfgkkwpvzedvd/);
});

test('workspace UI keeps a single configuration notice and premium empty state markers',()=>{
  const source=fs.readFileSync(path.resolve('components/expenses-centre.tsx'),'utf8');
  assert.match(source,/data-expenses-config="1"/);
  assert.match(source,/data-expenses-empty-hero="1"/);
  assert.match(source,/configurationMessage/);
  assert.match(source,/expensesRegisterQuerySupported/);
  assert.equal((source.match(/Persistent storage has not been activated/g)||[]).length,0);
});
