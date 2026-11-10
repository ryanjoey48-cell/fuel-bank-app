import { expensesContext, expensesError } from '@/lib/expenses-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {db}=await expensesContext(request),id=new URL(request.url).searchParams.get('id')||'';
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('INVALID_ID');
 const {data,error}=await db.rpc('expenses_duplicate_matches',{target:id});if(error)throw new Error('DUPLICATE_CHECK_UNAVAILABLE');
 return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return expensesError(error);}}
export async function POST(request:Request){try{
 const {db}=await expensesContext(request,true),text=await request.text();if(text.length>5000)throw new Error('REQUEST_TOO_LARGE');
 const body=JSON.parse(text);
 if(![body.expense_id,body.other_id].every(v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v))||typeof body.note!=='string'||!body.note.trim()||body.note.length>2000||![body.version,body.other_version].every(v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v)))throw new Error('INVALID_DUPLICATE_REVIEW');
 const {data,error}=await db.from('expenses_duplicate_resolutions').insert({expense_id:body.expense_id,other_id:body.other_id,version:body.version,other_version:body.other_version,note:body.note}).select().single();
 if(error)throw new Error('DUPLICATE_REVIEW_CONFLICT_OR_FORBIDDEN');
 return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return expensesError(error);}}
