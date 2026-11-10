const {test}=require('node:test');const assert=require('node:assert/strict'),path=require('node:path');
const {lib,loadTs}=require('./helpers/invoice-compare.cjs');
test('Booking Diary search uses only the supplied authenticated client, bounded queries and genuine identifiers',async()=>{
 const {expenseBookingSearch}=lib('expenses-bookings-server.ts'),calls=[];
 const booking={id:'33000000-0000-4000-8000-000000000001',booking_id:'SYNTHETIC-JOB',job_order_number:'WO-SYNTHETIC-001',booking_date:'2026-11-10',client_id:'55000000-0000-4000-8000-000000000001',vehicle_registration:'TEST-001',vehicle:null,driver:'Synthetic driver'};
 const db={from(table){const call={table,steps:[]};calls.push(call);const query={then(resolve){return Promise.resolve({data:table==='clients'?[{id:booking.client_id,name:'Synthetic customer'}]:[booking],error:null}).then(resolve);}};for(const method of ['select','ilike','eq','in','or','order','limit'])query[method]=(...args)=>{call.steps.push([method,...args]);return query;};return query;}};
 const result=await expenseBookingSearch(db,'Synthetic customer');assert.equal(result[0].id,booking.id);assert.equal(result[0].client_name,'Synthetic customer');assert.equal(result[0].job_order_number,'WO-SYNTHETIC-001');assert.ok(calls.find(c=>c.table==='booking_diary').steps.find(s=>s[0]==='or')[1].includes('job_order_number.ilike.'));
 assert.ok(calls.some(c=>c.table==='booking_diary'&&c.steps.some(s=>s[0]==='limit'&&s[1]===30)));assert.ok(calls.some(c=>c.steps.some(s=>s[0]==='or'&&s[1].includes('client_id.in.'))));
 calls.length=0;await expenseBookingSearch(db,'',booking.id);assert.ok(calls.some(c=>c.table==='booking_diary'&&c.steps.some(s=>s[0]==='eq'&&s[1]==='id'&&s[2]===booking.id)));
 await assert.rejects(()=>expenseBookingSearch(db,'','invented-id'),/INVALID_BOOKING/);await assert.rejects(()=>expenseBookingSearch(db,'x'.repeat(101)),/INVALID_BOOKING/);
 calls.length=0;await expenseBookingSearch(db,'name),id.not.is.null');assert.ok(calls.find(c=>c.table==='booking_diary').steps.find(s=>s[0]==='or')[1].includes('name  id not is null'),'filter punctuation cannot inject a PostgREST clause');
});
test('register API validates before querying and delegates to the caller-scoped PostgreSQL page RPC',async()=>{
 const server=lib('expenses-server.ts'),original=server.expensesContext,route=loadTs(path.resolve('app/api/expenses-centre/register/route.ts'));let calls=0;
 server.expensesContext=async()=>({db:{rpc:async(name,{q})=>{calls++;assert.equal(name,'expenses_register');assert.equal(q.pageSize,10);return{data:{rows:[],totalCount:0,page:1,pageSize:10,summary:{recorded:0}},error:null};}}});
 const query={from:'',to:'',q:'',vehicle:'',category:'',supplier:'',employee:'',status:'',payment:'',sort:{key:'date',direction:'desc'},page:1,pageSize:10,th:false};
 try{
  let response=await route.GET(new Request('http://localhost/api/expenses-centre/register?query='+encodeURIComponent(JSON.stringify({...query,pageSize:5000}))));assert.equal(response.status,400);assert.equal(calls,0);
  response=await route.GET(new Request('http://localhost/api/expenses-centre/register?query='+encodeURIComponent(JSON.stringify(query))));assert.equal(response.status,200);assert.equal(calls,1);assert.match(response.headers.get('cache-control'),/private, no-store/);
  server.expensesContext=async()=>{throw new Error('EXPENSES_FORBIDDEN');};response=await route.GET(new Request('http://localhost/api/expenses-centre/register'));assert.notEqual(response.status,200);assert.equal(calls,1,'failed auth never calls the query RPC');
 }finally{server.expensesContext=original;}
});
