import { countsAsSpend, expenseSummary, filterExpenses, paidSatang, outstandingSatang, type Expense, type ExpenseAttachment, type ExpenseFilters, type ExpenseSort } from './expenses';

export type RegisterQuery = ExpenseFilters & { centre?: string; sort: ExpenseSort; page: number; pageSize: number; th: boolean };
export type RegisterResult = { rows: Expense[]; recent: Expense[]; attachments: ExpenseAttachment[]; totalCount: number; page: number; pageSize: number; summary: ReturnType<typeof expenseSummary> & { vehicle: number; pending: number; missing: number; submitted: number; paid: number; outstanding: number }; categories: [string,number][]; vehicles: [string,number][]; months: [string,number][] };
const keys = ['date','description','category','allocation','supplier','amount','receipt','approval','payment','employee'];
export function validateRegisterQuery(raw: unknown): RegisterQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_FILTER');
  const r = raw as Record<string,unknown>, result: Record<string,unknown> = {};
  for (const key of ['from','to','q','vehicle','category','centre','status','payment','supplier','employee']) {
    const value = r[key] ?? '';
    if (typeof value !== 'string' || value.length > (['q','supplier','employee'].includes(key)?200:64)) throw new Error('INVALID_FILTER');
    result[key] = value.normalize('NFKC').trim();
  }
  for (const key of ['from','to']) { const value=result[key] as string;if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new Error('INVALID_FILTER_DATE'); }
  if(result.from&&result.to&&String(result.from)>String(result.to))throw new Error('INVALID_FILTER_DATE');
  if(result.status&&!['draft','submitted','needs_information','approved','rejected','closed','voided'].includes(String(result.status)))throw new Error('INVALID_FILTER_STATUS');
  if(result.payment&&!['unpaid','partially_paid','paid'].includes(String(result.payment)))throw new Error('INVALID_FILTER_PAYMENT');
  const sort = r.sort as ExpenseSort | undefined;
  if(!sort||!keys.includes(sort.key)||!['asc','desc'].includes(sort.direction))throw new Error('INVALID_SORT');
  const page=r.page??1,pageSize=r.pageSize??20;
  if(!Number.isInteger(page)||Number(page)<1||Number(page)>100000||![10,20,50].includes(Number(pageSize))||typeof pageSize!=='number')throw new Error('INVALID_PAGE');
  if(typeof r.th!=='boolean')throw new Error('INVALID_LANGUAGE');
  return {...result,sort:{key:sort.key,direction:sort.direction},page,pageSize,th:r.th} as RegisterQuery;
}
/** Deterministic DB-compatible sort: UTF-8 byte collation, then UUID/fixture ID ascending. */
export function querySort(rows: Expense[], q: RegisterQuery, attachments: ExpenseAttachment[]) {
  const counts=new Map<string,number>();for(const a of attachments)if(a.state==='ready')counts.set(a.expense_id,(counts.get(a.expense_id)||0)+1);
  const compare=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
  const value=(e:Expense):string|number=>({date:e.data.date,description:e.data.description,category:q.th?e.data.category_th:e.data.category_en,allocation:e.data.vehicle_reg||(q.th?e.data.centre_th:e.data.centre_en),supplier:e.data.supplier,amount:e.data.amount_satang,receipt:counts.get(e.id)||0,approval:e.status,payment:e.data.payment_status,employee:e.data.submitted_by})[q.sort.key]??'';
  return [...rows].sort((a,b)=>{const x=value(a),y=value(b);return (typeof x==='number'&&typeof y==='number'?x-y:compare(String(x),String(y)))*(q.sort.direction==='asc'?1:-1)||compare(a.id,b.id);});
}
/** Only synthetic fixture state is queried in memory. Live paging runs inside PostgreSQL. */
export function fixtureRegister(expenses:Expense[],attachments:ExpenseAttachment[],raw:RegisterQuery):RegisterResult {
  const q=validateRegisterQuery(raw),filtered=filterExpenses(expenses,q).filter(e=>!q.centre||e.data.allocation==='centre'&&e.data.cost_centre_id===q.centre),sorted=querySort(filtered,q,attachments),spend=filtered.filter(countsAsSpend);
  const group=(key:(e:Expense)=>string)=>{const map=new Map<string,number>();for(const e of spend){const k=key(e);if(k)map.set(k,(map.get(k)||0)+e.data.amount_satang);}return [...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));};
  const page=Math.min(q.page,Math.max(1,Math.ceil(sorted.length/q.pageSize))),rows=sorted.slice((page-1)*q.pageSize,page*q.pageSize),ids=new Set(rows.map(e=>e.id));
  return {rows,recent:[...filtered].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id)).slice(0,5),attachments:attachments.filter(a=>ids.has(a.expense_id)),totalCount:filtered.length,page,pageSize:q.pageSize,summary:{...expenseSummary(filtered),vehicle:spend.filter(e=>e.data.allocation==='vehicle').reduce((n,e)=>n+e.data.amount_satang,0),pending:filtered.filter(e=>e.status==='submitted').length,missing:spend.filter(e=>!attachments.some(a=>a.expense_id===e.id&&a.state==='ready')).length,submitted:spend.length,paid:spend.reduce((n,e)=>n+paidSatang(e),0),outstanding:spend.reduce((n,e)=>n+outstandingSatang(e),0)},categories:group(e=>q.th?e.data.category_th:e.data.category_en),vehicles:group(e=>e.data.allocation==='vehicle'?e.data.vehicle_reg:''),months:group(e=>e.data.date.slice(0,7))};
}
