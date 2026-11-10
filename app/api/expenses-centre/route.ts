import { allExpenseRows, expenseCommand, expensesContext, expensesError, expensesWriteEnvironmentReady, RECEIPTS_BUCKET, resolveExpensesReadiness } from '@/lib/expenses-server';
import { AdminApiError } from '@/lib/admin-user-management-server';
import { expenseBookingSearch } from '@/lib/expenses-bookings-server';
export const dynamic = 'force-dynamic';

function schemaMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`.toUpperCase();
  return text.includes('PGRST205') || text.includes('DOES NOT EXIST') || text.includes('42P01') || text.includes('SCHEMA_UNAVAILABLE');
}

export async function GET(request: Request) {
  try {
    const { db, user, access, admin } = await expensesContext(request);
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AdminApiError(400,'INVALID_ID');
      const row = await db.from('expenses_entries').select('*').eq('id',id).single();
      if (row.error || !row.data) throw new AdminApiError(schemaMissing(row.error) ? 503 : 404, schemaMissing(row.error) ? 'EXPENSES_SCHEMA_UNAVAILABLE' : 'EXPENSE_NOT_FOUND');
      const [audit,attachments,link] = await Promise.all([allExpenseRows(db,'expenses_audit','id',{column:'expense_id',value:id}),allExpenseRows(db,'expenses_attachments','id',{column:'expense_id',value:id}),db.from('expenses_booking_links').select('*').eq('expense_id',id).maybeSingle()]);
      if(link.error && !schemaMissing(link.error))throw new Error('EXPENSES_V12_SCHEMA_UNAVAILABLE');
      // A diary outage/deletion must not prevent access to the expense itself.
      let booking=null;
      if(link.data?.booking_id){try{booking=(await expenseBookingSearch(db,'',link.data.booking_id))[0]||null;}catch{/* Keep its stable ID and display unavailable. */}}
      return Response.json({expense:row.data,audit,attachments,bookingLink:link.data?{...link.data,booking}:null},{headers:{'Cache-Control':'private, no-store'}});
    }

    const isAdmin = ['admin', 'super_admin'].includes(access.role);
    const vehiclesResult = await admin.from('vehicles').select('id,vehicle_reg,vehicle_name,vehicle_category,vehicle_type').eq('active', true).order('vehicle_reg');
    const vehicles = vehiclesResult.error ? [] : (vehiclesResult.data || []);
    const config = await db.from('expenses_config').select('*').single();

    if (config.error || !config.data) {
      // Authenticated workspace still renders; saving stays locked and fixtures are never substituted.
      const readiness = resolveExpensesReadiness({ schemaPresent: false, schemaVersion: null, enabled: false, privateBucket: false, environmentReady: false });
      return Response.json({
        expenses: [], categories: [], centres: [], attachments: [], audit: [], templates: [], vehicles,
        user_id: user.id, ready: false, readiness,
        capabilities: { write: false, review: false, approve: false, admin: isAdmin }
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [categories, centres, templates, bucket] = await Promise.all([
      allExpenseRows(db, 'expenses_categories'),
      allExpenseRows(db, 'expenses_cost_centres'),
      allExpenseRows(db, 'expenses_templates'),
      admin.storage.getBucket(RECEIPTS_BUCKET)
    ]);
    const environmentReady = expensesWriteEnvironmentReady();
    const readiness = resolveExpensesReadiness({
      schemaPresent: true,
      schemaVersion: config.data.schema_version,
      enabled: !!config.data.enabled,
      privateBucket: !bucket.error && bucket.data?.public === false,
      environmentReady
    });
    const ready = readiness === 'ready';
    return Response.json({
      expenses: [], categories, centres, attachments: [], audit: [], templates, vehicles,
      user_id: user.id, ready, readiness,
      capabilities: { write: ready && access.role !== 'read_only', review: ready && access.role !== 'read_only', approve: ready && isAdmin, admin: isAdmin }
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return expensesError(error); }
}
export async function POST(request: Request) {
  try {
    const { db } = await expensesContext(request, true);
    if (Number(request.headers.get('content-length') || 0) > 50000) throw new Error('REQUEST_TOO_LARGE');
    const text = await request.text(); if (text.length > 50000) throw new Error('REQUEST_TOO_LARGE');
    const { command, body } = JSON.parse(text);
    if (['attachment_reserve', 'attachment_remove'].includes(command)) throw new Error('USE_ATTACHMENT_ROUTE');
    return Response.json(await expenseCommand(db, command, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return expensesError(error); }
}
