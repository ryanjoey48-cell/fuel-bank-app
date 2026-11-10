import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpenseBooking } from './expenses-intelligence';
const fields='id,booking_id,job_order_number,booking_date,client_id,vehicle_registration,vehicle,driver';
export async function expenseBookingSearch(db:SupabaseClient,q:string,id?:string):Promise<ExpenseBooking[]> {
  if(q.length>100||id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('INVALID_BOOKING_SEARCH');
  // Only caller-scoped queries: existing Booking Diary/client RLS remains authoritative.
  const search=q.normalize('NFKC').replace(/[^\p{L}\p{N}\s-]/gu,' ').trim();
  let query=db.from('booking_diary').select(fields);
  if(id)query=query.eq('id',id);
  else if(search){
    const clients=await db.from('clients').select('id').ilike('name',`%${search}%`).limit(100);
    if(clients.error)throw new Error('BOOKING_SEARCH_UNAVAILABLE');
    const clientIds=(clients.data||[]).map(c=>String(c.id)).filter(v=>/^[0-9a-f-]{36}$/i.test(v));
    const terms=['booking_id','job_order_number','vehicle_registration','vehicle','driver'].map(field=>`${field}.ilike.%${search}%`);
    if(/^\d{4}-\d{2}-\d{2}$/.test(search)&&Number.isFinite(Date.parse(search)))terms.push(`booking_date.eq.${search}`);
    if(clientIds.length)terms.push(`client_id.in.(${clientIds.join(',')})`);
    query=query.or(terms.join(','));
  }
  const response=await query.order('booking_date',{ascending:false}).order('id').limit(id?1:30);
  if(response.error)throw new Error('BOOKING_SEARCH_UNAVAILABLE');
  const rows=response.data||[],ids=[...new Set(rows.map(b=>b.client_id).filter(Boolean))];
  const clients=ids.length?await db.from('clients').select('id,name').in('id',ids):{data:[],error:null};
  if(clients.error)throw new Error('BOOKING_SEARCH_UNAVAILABLE');
  const names=new Map((clients.data||[]).map(c=>[c.id,c.name]));
  return rows.map(({client_id,...b})=>({...b,client_name:names.get(client_id)||null}));
}
