const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const h=require('./helpers/expenses-db.cjs');
test('exact owner review SQL creates only a synthetic test fleet and refuses unsafe/incomplete activation',async()=>{
 const db=await h.createExpenseDb(undefined,true);
 try{
  assert.equal((await db.query('select * from public.vehicles')).rows.length,0);
  await db.exec(fs.readFileSync('docs/expenses-v11-activation-preflight-read-only.sql','utf8'));
  await db.query("update public.account_access set display_name='Expenses V11 fixture submitter' where user_id=$1",[h.ids.staff]);await db.query("update public.account_access set display_name='Expenses V11 fixture reviewer' where user_id=$1",[h.ids.manager]);
  await db.query("select set_config('ees.expenses.test_submitter_id',$1,false)",[h.ids.staff]);await db.query("select set_config('ees.expenses.test_reviewer_id',$1,false)",[h.ids.manager]);
  await db.exec(fs.readFileSync('docs/expenses-v11-synthetic-vehicles-review-only.sql','utf8'));assert.equal((await db.query('select * from public.vehicles')).rows.length,2);assert.equal((await db.query('select * from public.expenses_entries')).rows.length,0);
  await assert.rejects(()=>db.exec(fs.readFileSync('docs/expenses-v11-synthetic-vehicles-review-only.sql','utf8')),/non-empty|empty, isolated/);await db.exec('rollback');
  await db.exec("set ees.expenses.approved_test_project_ref='not-approved'");await assert.rejects(()=>db.exec(fs.readFileSync('docs/expenses-v11-activation-review-only.sql','utf8')),/Verify the approved/);await db.exec('rollback');
  assert.equal((await db.query('select enabled from public.expenses_config')).rows[0].enabled,false);
  await db.exec("set ees.expenses.approved_test_project_ref='wpmnjfncaoogssgpqxek';update storage.buckets set public=true where id='expenses-receipts'");await assert.rejects(()=>db.exec(fs.readFileSync('docs/expenses-v11-activation-review-only.sql','utf8')),/Private receipt bucket/);await db.exec('rollback');
  await db.exec("update storage.buckets set public=false where id='expenses-receipts'");await db.exec(fs.readFileSync('docs/expenses-v11-activation-review-only.sql','utf8'));assert.equal((await db.query('select enabled from public.expenses_config')).rows[0].enabled,true);assert.equal((await db.query('select * from public.expenses_entries')).rows.length,0);
 }finally{await db.close();}
});
