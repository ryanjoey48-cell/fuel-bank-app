const {test}=require('node:test');const assert=require('node:assert/strict');const {lib}=require('./helpers/invoice-compare.cjs');
const {collectExpenseReport}=lib('expenses-reports.ts'),{fixtureRegister}=lib('expenses-query.ts'),m=lib('expenses.ts');
const query={from:'',to:'',q:'',vehicle:'',category:'',centre:'',supplier:'',employee:'',status:'',payment:'',sort:{key:'amount',direction:'asc'},page:2,pageSize:10,th:false};
test('report retrieval includes every permitted filtered page, preserves sort and computes totals from exactly those rows',async()=>{
 const fixture=lib('expenses-fixtures.ts').expensesFixture(100),calls=[];
 const report=await collectExpenseReport(query,async q=>{calls.push(q);return fixtureRegister(fixture.expenses,fixture.attachments,q);});
 assert.deepEqual(calls.map(q=>[q.page,q.pageSize]),[[1,50],[2,50]]);assert.equal(report.rows.length,100);assert.equal(report.summary.recorded,m.exportRows(report.rows).reduce((n,e)=>n+Math.round(e.SpendingTHB*100),0));assert.deepEqual(report.rows.map(e=>e.data.amount_satang),report.rows.map(e=>e.data.amount_satang).sort((a,b)=>a-b));
 const original=fixture.expenses[0];const excluded=[{...original,id:'void',status:'voided'},{...original,id:'draft',status:'draft'},{...original,id:'linked',data:{...original.data,source:'fuel',source_id:'synthetic-source'}},{...original,id:'customer',data:{...original.data,cost_treatment:'customer_charge'}}];const cashRows=m.exportRows([original,...excluded]);assert.equal(cashRows.reduce((n,e)=>n+Math.round(e.SpendingPaidTHB*100),0),m.paidSatang(original));assert.equal(cashRows.reduce((n,e)=>n+Math.round(e.SpendingOutstandingTHB*100),0),m.outstandingSatang(original));assert.ok(cashRows[1].PaidTHB>0,'raw balances remain visible for audit while basis-aware cash totals exclude the void');
 const empty=await collectExpenseReport(query,async q=>fixtureRegister([],[],q));assert.equal(empty.rows.length,0);assert.equal(empty.summary.recorded,0);
});
test('changing filters during asynchronous report preparation cancels the old report',async()=>{
 const fixture=lib('expenses-fixtures.ts').expensesFixture(100);let current=true,calls=0;
 await assert.rejects(()=>collectExpenseReport(query,async q=>{calls++;const result=fixtureRegister(fixture.expenses,[],q);if(q.page===2)current=false;await Promise.resolve();return result;},()=>current),/REGISTER_CHANGED_RETRY/);assert.equal(calls,2);
});
test('reports reject changed totals, repeated rows, incorrect summaries and excessive results',async()=>{
 const fixture=lib('expenses-fixtures.ts').expensesFixture(100),read=q=>fixtureRegister(fixture.expenses,[],q);
 await assert.rejects(()=>collectExpenseReport(query,async q=>{const page=read(q);if(q.page===2)page.summary.recorded++;return page;}),/REGISTER_CHANGED_RETRY/);
 await assert.rejects(()=>collectExpenseReport(query,async q=>{const page=read(q);if(q.page===2)page.rows[0]=read({...q,page:1}).rows[0];return page;}),/REGISTER_CHANGED_RETRY/);
 await assert.rejects(()=>collectExpenseReport(query,async q=>{const page=read(q);page.summary.recorded++;return page;}),/REGISTER_CHANGED_RETRY/);
 await assert.rejects(()=>collectExpenseReport(query,async q=>({...read(q),totalCount:10001})),/EXPORT_LIMIT/);
});
