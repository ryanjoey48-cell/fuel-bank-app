const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {lib}=require('./helpers/invoice-compare.cjs');const m=lib('expenses.ts');const h=require('./helpers/expenses-db.cjs');
test('partial payments remain decimal-safe and dashboard bases do not mix approval with payment',()=>{
 const input={...m.emptyExpense(),amount:'100.29',description:'Synthetic cost',category_id:'office',payment_status:'partially_paid',paid_amount:'30.29'};
 assert.deepEqual(m.validatePayment(input),{paid_satang:3029,paid_amount:'30.29'});
 for(const paid_amount of ['0','100.29','100.30','1.001','-1','1e2'])assert.throws(()=>m.validatePayment({...input,paid_amount}));
 assert.throws(()=>m.validatePayment({...input,payment_status:'paid'}));assert.throws(()=>m.validatePayment({...input,payment_status:'unpaid'}));
 const base=lib('expenses-fixtures.ts').expensesFixture().expenses[0];const e={...base,status:'approved',data:{...base.data,...input,amount_satang:10029,paid_satang:3029}};
 const pending={...e,id:'pending',status:'submitted'};const linked={...e,id:'linked',data:{...e.data,source:'fuel',source_id:'synthetic'}};
 assert.deepEqual(m.expenseSummary([e,pending,linked,{...e,id:'void',status:'voided'}]),{recorded:20058,approved:10029,provisional:10029,paidApproved:3029,unpaidApproved:7000,unpaidApprovedCount:1});
 assert.equal(m.filterExpenses([e,pending],{from:'',to:'',q:'',category:'',vehicle:'',status:'approved',payment:'partially_paid',supplier:'',employee:''}).length,1);
 const out=m.exportRows([e])[0];assert.equal(out.PaidTHB,30.29);assert.equal(out.OutstandingTHB,70);assert.equal(out.SpendingTHB,100.29);
 assert.equal(m.nextRecurringDate('2026-01-31','monthly'),'2026-02-28');assert.equal(m.nextRecurringDate('2024-02-29','yearly'),'2025-02-28');
 const sorted=m.sortExpenses([{...e,id:'large',data:{...e.data,amount_satang:99999}},{...e,id:'small',data:{...e.data,amount_satang:10}}],{key:'amount',direction:'asc'});assert.equal(sorted[0].id,'small');
});
test('V1.1 PostgreSQL migration enforces payment math, roles, audit, recurring boundaries and survives an actual database reopen',async()=>{
 const directory=fs.mkdtempSync(path.resolve('tmp','expenses-v11-db-'));let db=await h.createExpenseDb(directory);let id;
 try{
  const input={...m.emptyExpense(),amount:'100.29',description:'Synthetic permanent test',category_id:'office',payment_status:'partially_paid',paid_amount:'30.29',missing_receipt_reason:'Isolated synthetic receipt exception'};
  await h.asUser(db,'staff');await assert.rejects(()=>h.command(db,'create',{request_key:'33000000-0000-4000-8000-000000000001',input}),/NOT_ACTIVATED/);
  await db.exec('reset role;update public.expenses_config set enabled=true;');
  await h.asUser(db,'staff');let e=await h.command(db,'create',{request_key:'33000000-0000-4000-8000-000000000001',input});id=e.id;assert.equal(e.data.paid_satang,3029);
  assert.equal((await h.command(db,'create',{request_key:'33000000-0000-4000-8000-000000000001',input})).id,id);
  await assert.rejects(()=>h.command(db,'edit',{id,revision:e.revision,input:{...input,amount:'20.00'}}),/PAYMENT_AMOUNT/);
  e=await h.command(db,'transition',{id,revision:e.revision,status:'submitted'});
  await assert.rejects(()=>h.command(db,'payment',{id,revision:e.revision,payment_status:'paid',note:'Synthetic evidence'}),/PAYMENT_NOT_ALLOWED/);
  for(const user of ['reader','driver','suspended']){await h.asUser(db,user);await assert.rejects(()=>h.command(db,'payment',{id,revision:e.revision,payment_status:'paid',note:'Synthetic'}));}
  await h.asUser(db,'manager');e=await h.command(db,'transition',{id,revision:e.revision,status:'approved'});assert.equal(e.data.paid_satang,3029,'approval never records an additional payment');
  await assert.rejects(()=>h.command(db,'transition',{id,revision:e.revision,status:'closed'}),/PAYMENT_CONFIRMATION/);
  for(const paid_amount of ['0','100.29','100.30','40.001','-1'])await assert.rejects(()=>h.command(db,'payment',{id,revision:e.revision,payment_status:'partially_paid',paid_amount,note:'Synthetic'}),/PAYMENT_AMOUNT/);
  await h.asUser(db,'superAdmin');e=await h.command(db,'payment',{id,revision:e.revision,payment_status:'partially_paid',paid_amount:'60.19',note:'Synthetic second payment; cumulative total'});assert.equal(e.data.paid_satang,6019);
  const history=(await db.query('select * from public.expenses_audit where expense_id=$1',[id])).rows;const payment=history.find(row=>row.action==='payment');assert.equal(payment.actor,h.ids.superAdmin);assert.equal(payment.old_value.data.paid_satang,3029);assert.equal(payment.new_value.data.paid_satang,6019);
  await assert.rejects(()=>db.query('update public.expenses_entries set status=$1 where id=$2',['closed',id]),/permission denied/);await assert.rejects(()=>db.query('delete from public.expenses_audit'),/permission denied/);
  await h.command(db,'template',{name:'Synthetic depot electricity',next_date:'2026-12-01',frequency:'monthly',active:true,input:{...input,amount:'0.00',payment_status:'unpaid',paid_amount:'0.00'}});assert.equal((await db.query('select * from public.expenses_entries')).rows.length,1,'reminder never creates incurred or paid entries');
  await db.close();db=new PGlite(directory);await h.asUser(db,'manager');e=(await db.query('select * from public.expenses_entries where id=$1',[id])).rows[0];assert.equal(e.data.paid_satang,6019);assert.equal(e.data.description,'Synthetic permanent test');
  e=await h.command(db,'payment',{id,revision:e.revision,payment_status:'paid',note:'Synthetic final payment'});assert.equal(e.data.paid_satang,10029);
  e=await h.command(db,'transition',{id,revision:e.revision,status:'closed'});assert.equal(e.status,'closed');
  e=await h.command(db,'transition',{id,revision:e.revision,status:'voided',note:'Synthetic audited void'});assert.equal(m.expenseSummary([e]).recorded,0);
 }finally{await db.close();assert.ok(directory.startsWith(path.resolve('tmp','expenses-v11-db-')));fs.rmSync(directory,{recursive:true,force:true});}
});
test('production remains rejected even with matching expense environment gates',()=>{
 const server=lib('expenses-server.ts');const env={EES_EXPENSES_WRITES:'approved-safe-environment',NEXT_PUBLIC_SUPABASE_URL:'https://hafoaurzfgkkwpvzedvd.supabase.co',EES_EXPENSES_APPROVED_SUPABASE_URL:'https://hafoaurzfgkkwpvzedvd.supabase.co'};assert.throws(()=>server.assertExpensesWriteEnvironment(env),/SAFE_ENVIRONMENT/);
});
test('private receipt restriction blocks legacy broad storage policies without changing other buckets',async()=>{
 const db=await h.createExpenseDb();
 try{
  await db.exec("grant select,insert,update,delete on storage.objects to authenticated,anon;grant usage on schema storage to authenticated,anon;create policy legacy_all_files on storage.objects for all to authenticated,anon using(true) with check(true);insert into storage.objects values('expenses-receipts','synthetic-private'),('other-existing-bucket','synthetic-existing');");
  await h.asUser(db,'staff');const rows=(await db.query('select * from storage.objects')).rows;assert.equal(rows.length,1);assert.equal(rows[0].bucket_id,'other-existing-bucket');
  await assert.rejects(()=>db.query("insert into storage.objects values('expenses-receipts','forbidden')"),/row-level security/);
  await db.query("delete from storage.objects where bucket_id='expenses-receipts'");
  await db.exec('reset role');assert.equal((await db.query("select * from storage.objects where bucket_id='expenses-receipts'")).rows.length,1);
  await h.asUser(db,'staff','anon');assert.equal((await db.query("select * from storage.objects where bucket_id='expenses-receipts'")).rows.length,0);
 }finally{await db.close();}
});
