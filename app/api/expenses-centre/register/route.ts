import { expensesContext, expensesError } from '@/lib/expenses-server';
import { validateRegisterQuery } from '@/lib/expenses-query';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
  const {db}=await expensesContext(request);
  const query=validateRegisterQuery(JSON.parse(new URL(request.url).searchParams.get('query')||'{}'));
  const {data,error}=await db.rpc('expenses_register',{q:query});
  if(error)throw new Error('EXPENSES_V12_QUERY_SCHEMA_UNAVAILABLE');
  return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return expensesError(error);}}
