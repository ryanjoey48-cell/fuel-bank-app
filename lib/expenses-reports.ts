import { expenseSummary, type Expense, type ExpenseAttachment } from './expenses';
import { validateRegisterQuery, type RegisterQuery, type RegisterResult } from './expenses-query';

/** Bounded, caller-scoped page retrieval. It never silently truncates a report. */
export async function collectExpenseReport(query:RegisterQuery,readPage:(query:RegisterQuery)=>Promise<RegisterResult>,isCurrent:()=>boolean=()=>true){
 const fixed=validateRegisterQuery({...query,page:1,pageSize:50});
 const rows:Expense[]=[],attachments:ExpenseAttachment[]=[],ids=new Set<string>();let baseline='';
 for(let page=1;page<=200;page++){
  if(!isCurrent())throw new Error('REGISTER_CHANGED_RETRY');
  const data=await readPage({...fixed,page});
  if(!isCurrent())throw new Error('REGISTER_CHANGED_RETRY');
  if(!Number.isInteger(data.totalCount)||data.totalCount<0||!Array.isArray(data.rows)||data.rows.length>50||data.page!==page||data.pageSize!==50)throw new Error('REGISTER_CHANGED_RETRY');
  if(data.totalCount>10000)throw new Error('EXPORT_LIMIT');
  const signature=JSON.stringify([data.totalCount,data.summary]);
  if(page===1)baseline=signature;else if(signature!==baseline)throw new Error('REGISTER_CHANGED_RETRY');
  for(const row of data.rows){if(ids.has(row.id))throw new Error('REGISTER_CHANGED_RETRY');ids.add(row.id);rows.push(row);}
  attachments.push(...data.attachments);
  if(rows.length===data.totalCount){
   const summary=expenseSummary(rows);
   if(Object.entries(summary).some(([key,value])=>data.summary[key as keyof typeof summary]!==value))throw new Error('REGISTER_CHANGED_RETRY');
   return {rows,attachments,summary};
  }
  if(!data.rows.length||rows.length>data.totalCount)throw new Error('REGISTER_CHANGED_RETRY');
 }
 throw new Error('EXPORT_LIMIT');
}
