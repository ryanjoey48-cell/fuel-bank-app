const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {lib}=require('./helpers/invoice-compare.cjs');const h=require('./helpers/expenses-db.cjs');
const m=lib('expenses.ts'),q=lib('expenses-query.ts'),intel=lib('expenses-intelligence.ts');
const baseQuery={from:'',to:'',q:'',vehicle:'',category:'',centre:'',supplier:'',employee:'',status:'',payment:'',sort:{key:'date',direction:'desc'},page:1,pageSize:10,th:false};
test('V1.2 validates query bounds, classifies evidence and preserves integration source identifiers',()=>{
 for(const patch of [{pageSize:1000},{page:0},{page:1.5},{from:'2026-02-30'},{from:'2026-11-11',to:'2026-11-01'},{status:'paid'},{payment:'approved'},{q:''.padEnd(201,'x')},{sort:{key:'id);drop table',direction:'desc'}},{th:'false'}])assert.throws(()=>q.validateRegisterQuery({...baseQuery,...patch}));
 const fixture=lib('expenses-fixtures.ts').expensesFixture(45),a=fixture.expenses[0];
 const clone=(patch)=>({...a,id:'other',data:{...a.data,...patch}});
 assert.equal(intel.duplicateMatches(a,[clone({date:'2020-01-01',supplier:'different',document_number:'',vehicle_id:''})],[]).length,0,'amount alone never sufficient');
 assert.equal(intel.duplicateMatches(a,[clone({date:a.data.date,supplier:a.data.supplier})],[])[0].strength,'possible');
 const receipt={...a,data:{...a.data,document_number:'SYNTH-123'}};
 assert.equal(intel.duplicateMatches(receipt,[clone({document_number:'SYNTH-123'})],[])[0].strength,'strong');
 const attachments=[{id:'a',expense_id:a.id,state:'ready',sha256:'same'},{id:'b',expense_id:'other',state:'ready',sha256:'same'}];
 assert.equal(intel.duplicateMatches(a,[clone({amount_satang:1,date:'2020-01-01',supplier:'different'})],attachments)[0].strength,'strong');
 assert.equal(intel.bookingVehicleMismatch('TEST-001',intel.FIXTURE_BOOKINGS[0]),false);assert.equal(intel.bookingVehicleMismatch('TEST-001',intel.FIXTURE_BOOKINGS[1]),true);
 const page1=q.fixtureRegister(fixture.expenses,[],baseQuery),page2=q.fixtureRegister(fixture.expenses,[],{...baseQuery,page:2});
 assert.equal(page1.rows.length,10);assert.equal(new Set([...page1.rows,...page2.rows].map(e=>e.id)).size,20);assert.deepEqual(page1.summary,page2.summary);
 const handoff=lib('expenses-integrations.ts').prepareExpenseCostHandoff({...a,data:{...a.data,source:'fuel',source_id:'synthetic-source'}});
 assert.equal(handoff.deduplicationKey,'fuel:synthetic-source');assert.equal(handoff.eligibleForStandaloneReport,false);
});
test('V1.2 real PostgreSQL query applies RLS before pagination and matches fixture filters/sorts/totals',async()=>{
 const db=await h.createExpenseDb();
 try{
 await db.exec(`create table public.booking_diary(id uuid primary key,booking_id text,booking_date date,client_id uuid,vehicle_registration text,vehicle text,driver text);
 alter table public.booking_diary enable row level security;grant select on public.booking_diary to authenticated;
 create policy fixture_booking_select on public.booking_diary for select to authenticated using(public.is_office_account() and booking_id<>'SYNTHETIC-HIDDEN');
 insert into public.booking_diary values('33000000-0000-4000-8000-000000000001','SYNTHETIC-001','2026-11-10',null,'ทดสอบ-001',null,'Synthetic driver'),('33000000-0000-4000-8000-000000000002','SYNTHETIC-HIDDEN','2026-11-10',null,'TEST-999',null,'Synthetic hidden');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261110120000_expenses_centre_v12_review_only.sql','utf8'));
 assert.equal((await db.query('select enabled from public.expenses_config')).rows[0].enabled,false,'migration never activates saving');
 await db.exec('update public.expenses_config set enabled=true');
 const input={...m.emptyExpense(),date:'2026-11-10',amount:'100.29',description:'Synthetic V12 cost',category_id:'office',supplier:'SYNTH supplier',missing_receipt_reason:'Synthetic receipt exception'};
 const rows=[];
 for(let i=0;i<27;i++){
  await h.asUser(db,'staff');
  let e=await h.command(db,'create',{request_key:`44000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,input:{...input,description:`Synthetic cost ${String(i).padStart(2,'0')}`,date:i%2?'2026-11-09':'2026-11-10',amount:i<5?'100.29':`${i+100}.29`,supplier:i%3?'SYNTH supplier':'Other synthetic',allocation:i%4?'centre':'vehicle',vehicle_id:'22000000-0000-4000-8000-000000000001'}});
  e=await h.command(db,'transition',{id:e.id,revision:e.revision,status:'submitted'});rows.push(e);
 }
 await db.exec('reset role');await db.query("update public.expenses_entries set created_by=$1,data=jsonb_set(data,'{submitted_by}','\"Synthetic reader\"') where id=$2",[h.ids.reader,rows[26].id]);rows[26]={...rows[26],created_by:h.ids.reader,data:{...rows[26].data,submitted_by:'Synthetic reader'}};
 await h.asUser(db,'manager');
 rows[0]=await h.command(db,'transition',{id:rows[0].id,revision:rows[0].revision,status:'approved'});
 rows[0]=await h.command(db,'payment',{id:rows[0].id,revision:rows[0].revision,payment_status:'partially_paid',paid_amount:'30.29',note:'Synthetic payment evidence'});
 const run=async(query)=>(await db.query('select public.expenses_register($1::jsonb) value',[JSON.stringify(query)])).rows[0].value;
 for(const key of ['date','description','category','allocation','supplier','amount','receipt','approval','payment','employee'])for(const direction of ['asc','desc'])for(const th of [false,true]){
  const query={...baseQuery,sort:{key,direction},th,page:2};const actual=await run(query),expected=q.fixtureRegister(rows,[],query);assert.deepEqual(actual.rows.map(e=>e.id),expected.rows.map(e=>e.id),`${key}/${direction}/${th}`);assert.deepEqual(actual.summary,expected.summary);
 }
 for(const patch of [{from:'2026-11-10',to:'2026-11-10'},{vehicle:'22000000-0000-4000-8000-000000000001'},{centre:'general'},{category:'office'},{supplier:'SYNTH supplier'},{q:'cost 01'},{q:'%()'},{status:'approved'},{payment:'partially_paid'},{employee:'Synthetic reader'},{page:99999},{pageSize:50}]){
  const query={...baseQuery,...patch};const actual=await run(query),expected=q.fixtureRegister(rows,[],query);assert.deepEqual(actual.rows.map(e=>e.id),expected.rows.map(e=>e.id));assert.deepEqual(actual.summary,expected.summary);assert.equal(actual.totalCount,expected.totalCount);
 }
 const first=await run(baseQuery),second=await run({...baseQuery,page:2});assert.equal(new Set([...first.rows,...second.rows].map(e=>e.id)).size,20);assert.equal(first.totalCount,27);assert.equal(first.summary.paidApproved,3029);assert.equal(first.summary.unpaidApproved,7000);assert.equal(first.recent.length,5);
 assert.equal(m.exportRows(rows).reduce((n,e)=>n+Math.round(e.SpendingTHB*100),0),first.summary.recorded);
 await assert.rejects(()=>run({...baseQuery,pageSize:500}),/INVALID_PAGE/);await assert.rejects(()=>run({...baseQuery,sort:{key:'hacked',direction:'desc'}}),/INVALID_SORT/);
 await h.asUser(db,'reader');const own=await run(baseQuery);assert.equal(own.totalCount,1);assert.equal(own.rows[0].created_by,h.ids.reader);assert.equal(own.summary.recorded,rows[26].data.amount_satang,'totals cannot reveal other accounts');
 for(const actor of ['driver','suspended']){await h.asUser(db,actor);await assert.rejects(()=>run(baseQuery),/FORBIDDEN/);}

 // Booking link policy reads the caller's real diary RLS, including hidden rows.
 await h.asUser(db,'staff');let draft=await h.command(db,'create',{request_key:'44000000-0000-4000-8000-000000000099',input});
 const link=(booking,revision=1)=>db.query('insert into public.expenses_booking_links(expense_id,booking_id,revision,note) values($1,$2,$3,$4) returning *',[draft.id,booking,revision,'Synthetic verified selection']);
 await assert.rejects(()=>link('33000000-0000-4000-8000-000000000002'),/row-level security/);
 await assert.rejects(()=>link('33000000-0000-4000-8000-000000000099'),/row-level security/);
 await link('33000000-0000-4000-8000-000000000001');
 await assert.rejects(()=>db.query('update public.expenses_booking_links set revision=9 where expense_id=$1',[draft.id]),/CONFLICT/);
 await db.exec('reset role');await db.query("update public.booking_diary set booking_id='SYNTHETIC-RENAMED' where id=$1",['33000000-0000-4000-8000-000000000001']);
 await h.asUser(db,'staff');assert.equal((await db.query('select booking_id from public.expenses_booking_links where expense_id=$1',[draft.id])).rows[0].booking_id,'33000000-0000-4000-8000-000000000001');
 draft=await h.command(db,'transition',{id:draft.id,revision:draft.revision,status:'submitted'});
 assert.equal((await db.query('update public.expenses_booking_links set booking_id=null,revision=revision+1 where expense_id=$1 returning *',[draft.id])).rows.length,0,'submitted link is locked by RLS');
 // An UPDATE hidden by USING may legally return zero rows rather than an error.
 await db.exec('reset role');await db.query('delete from public.booking_diary where id=$1',['33000000-0000-4000-8000-000000000001']);await h.asUser(db,'staff');assert.equal((await db.query('select * from public.expenses_booking_links where expense_id=$1',[draft.id])).rows.length,1,'deleted booking preserves stable identifier');

 // Duplicate evidence review is append-only and expires with either record/attachment change.
 const duplicate=await h.command(db,'create',{request_key:'44000000-0000-4000-8000-000000000098',input});
 const matches=async(id)=>(await db.query('select public.expenses_duplicate_matches($1) value',[id])).rows[0].value;
 let match=(await matches(draft.id)).find(v=>v.expense.id===duplicate.id);assert.equal(match.strength,'possible');
 const resolve=()=>db.query('insert into public.expenses_duplicate_resolutions(expense_id,other_id,version,other_version,note) values($1,$2,$3,$4,$5)',[draft.id,duplicate.id,match.version,match.other_version,'Synthetic legitimate separate expense']);
 await assert.rejects(resolve,/row-level security/);await h.asUser(db,'manager');await resolve();assert.ok((await matches(draft.id)).find(v=>v.expense.id===duplicate.id).resolution);
 assert.equal((await db.query("select * from public.expenses_audit where expense_id=$1 and action='duplicate_review'",[draft.id])).rows.length,1);
 await h.asUser(db,'staff');await h.command(db,'edit',{id:duplicate.id,revision:duplicate.revision,input:{...input,description:'Changed synthetic evidence'}});
 await h.asUser(db,'manager');assert.equal((await matches(draft.id)).find(v=>v.expense.id===duplicate.id).resolution,null);await assert.rejects(resolve,/row-level security/);
 await h.asUser(db,'staff');const altered=(await db.query('select * from public.expenses_entries where id=$1',[duplicate.id])).rows[0];await h.command(db,'edit',{id:altered.id,revision:altered.revision,input:{...input,amount:'999.19',date:'2020-01-01',supplier:'Another synthetic supplier'}});assert.equal((await matches(draft.id)).some(v=>v.expense.id===duplicate.id),false);
 await db.exec('reset role');for(const id of [draft.id,duplicate.id])await db.query("insert into public.expenses_attachments(id,expense_id,name,mime,size,sha256,state) values(gen_random_uuid(),$1,'synthetic-original.pdf','application/pdf',100,$2,'ready')",[id,'1'.repeat(64)]);
 await h.asUser(db,'manager');match=(await matches(draft.id)).find(v=>v.expense.id===duplicate.id);assert.equal(match.strength,'strong');assert.ok(match.reasons.includes('file'),'fingerprint matches despite different amounts, suppliers and dates');await resolve();assert.ok((await matches(draft.id)).find(v=>v.expense.id===duplicate.id).resolution);
 await db.exec('reset role');await db.query("insert into public.expenses_attachments(id,expense_id,name,mime,size,sha256,state) values(gen_random_uuid(),$1,'synthetic-pending.pdf','application/pdf',100,$2,'pending')",[draft.id,'2'.repeat(64)]);await h.asUser(db,'manager');assert.equal((await matches(draft.id)).find(v=>v.expense.id===duplicate.id).resolution,null,'attachment evidence changes expire the resolution');
 await assert.rejects(()=>db.query('delete from public.expenses_duplicate_resolutions'),/permission denied/);
 await h.asUser(db,'reader');assert.equal((await matches(draft.id)).length,0,'duplicate checker does not reveal inaccessible candidates');
 }finally{await db.close();}
});
