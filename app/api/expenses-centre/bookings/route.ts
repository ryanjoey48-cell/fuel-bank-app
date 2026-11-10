import { expensesContext, expensesError } from '@/lib/expenses-server';
import { expenseBookingSearch } from '@/lib/expenses-bookings-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {db}=await expensesContext(request),params=new URL(request.url).searchParams;
 return Response.json(await expenseBookingSearch(db,params.get('q')||'',params.get('id')||undefined),{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return expensesError(error);}}
export async function POST(request:Request){try{
 const {db}=await expensesContext(request,true);
 const text=await request.text();if(text.length>4000)throw new Error('REQUEST_TOO_LARGE');
 const body=JSON.parse(text);
 if(!/^[0-9a-f-]{36}$/i.test(body.expense_id)||typeof body.note!=='string'||!body.note.trim()||body.note.length>2000||!Number.isInteger(body.revision)||body.revision<0)throw new Error('INVALID_BOOKING_LINK');
 if(body.booking_id!==null&&(typeof body.booking_id!=='string'||!(await expenseBookingSearch(db,'',body.booking_id)).length))throw new Error('BOOKING_UNAVAILABLE');
 const value={expense_id:body.expense_id,booking_id:body.booking_id,note:body.note,revision:body.revision+1};
 const response=body.revision===0?await db.from('expenses_booking_links').insert(value).select().single():await db.from('expenses_booking_links').update(value).eq('expense_id',body.expense_id).eq('revision',body.revision).select().single();
 if(response.error||!response.data)throw new Error('BOOKING_LINK_CONFLICT_OR_FORBIDDEN');
 return Response.json(response.data,{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return expensesError(error);}}
