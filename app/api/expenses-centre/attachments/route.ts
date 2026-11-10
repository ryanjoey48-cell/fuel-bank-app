import { randomUUID } from 'node:crypto';
import { AdminApiError } from '@/lib/admin-user-management-server';
import { expenseCommand, expensesContext, expensesError, RECEIPTS_BUCKET, sniffReceipt } from '@/lib/expenses-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { db, admin, user } = await expensesContext(request, true);
    if (Number(request.headers.get('content-length') || 0) > 16 * 1024 * 1024) throw new AdminApiError(413, 'FILE_SIZE');
    // Bound the stream even when Content-Length is absent or dishonest.
    const reader = request.body?.getReader(); if (!reader) throw new Error('FILE_REQUIRED');
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > 16 * 1024 * 1024) { await reader.cancel(); throw new AdminApiError(413, 'FILE_SIZE'); } chunks.push(part.value); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const expenseId = String(form.get('expense_id')); if (!uuid.test(expenseId)) throw new Error('INVALID_ID');
    const file = form.get('file'); if (!(file instanceof File)) throw new Error('FILE_REQUIRED');
    const bytes = new Uint8Array(await file.arrayBuffer()); const metadata = sniffReceipt(bytes);
    const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180) || 'receipt';
    const entry = await db.from('expenses_entries').select('created_by,status').eq('id', expenseId).single();
    const account = await admin.from('account_access').select('role,status').eq('user_id', user.id).single();
    if (!entry.data || !account.data || account.data.status !== 'active' || !['draft','needs_information','rejected'].includes(entry.data.status) || (entry.data.created_by !== user.id && !['admin','super_admin'].includes(account.data.role))) throw new AdminApiError(403, 'ATTACHMENT_LOCKED');
    // An existing pending reservation is reused on retry. Every stored object has a durable metadata row.
    const existing = await db.from('expenses_attachments').select('*').eq('expense_id', expenseId).eq('sha256', metadata.sha256).maybeSingle();
    if (existing.error) throw new Error('ATTACHMENT_LOOKUP_FAILED');
    let attachment = existing.data;
    if (attachment?.state === 'ready') return Response.json(attachment);
    if (attachment?.state === 'removed') throw new Error('RECEIPT_ALREADY_REMOVED');
    if (!attachment) attachment = await expenseCommand(db, 'attachment_reserve', { id: expenseId, attachment_id: randomUUID(), name, ...metadata });
    // Recheck edit ownership even for a resumed pending upload.
    const objectPath = `${expenseId}/${attachment.id}`;
    const uploaded = await admin.storage.from(RECEIPTS_BUCKET).upload(objectPath, bytes, { contentType: metadata.mime, upsert: false });
    // A retry after a network interruption may find its original object already stored. Verify its hash.
    if (uploaded.error) {
      const original = await admin.storage.from(RECEIPTS_BUCKET).download(objectPath);
      if (original.error || !original.data || sniffReceipt(new Uint8Array(await original.data.arrayBuffer())).sha256 !== metadata.sha256) throw new Error('UPLOAD_FAILED_RETRY');
    }
    const finished = await admin.rpc('expenses_finish_upload', { attachment: attachment.id, actor_id: user.id });
    if (finished.error) throw new Error('UPLOAD_PENDING_RETRY');
    return Response.json({ ...attachment, state: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return expensesError(error); }
}
export async function GET(request: Request) {
  try {
    const { db, admin, access } = await expensesContext(request);
    const id = new URL(request.url).searchParams.get('id') || ''; if (!uuid.test(id)) throw new Error('INVALID_ID');
    const { data } = await db.from('expenses_attachments').select('*').eq('id', id).single();
    if (!data || data.state === 'pending' || (data.state === 'removed' && !['admin','super_admin'].includes(access.role))) throw new AdminApiError(404, 'RECEIPT_NOT_FOUND');
    const preview = new URL(request.url).searchParams.get('preview') === '1';
    const result = await admin.storage.from(RECEIPTS_BUCKET).createSignedUrl(`${data.expense_id}/${id}`, 60, preview ? undefined : { download: data.name });
    if (result.error) throw new Error('RECEIPT_UNAVAILABLE');
    return Response.json({ url: result.data.signedUrl }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return expensesError(error); }
}
export async function DELETE(request: Request) {
  try {
    const { db } = await expensesContext(request, true);
    const text = await request.text(); if (text.length > 10000) throw new AdminApiError(413,'REQUEST_TOO_LARGE');
    const body = JSON.parse(text);
    // Soft removal retains original and immutable audit evidence; no bucket deletion.
    return Response.json(await expenseCommand(db, 'attachment_remove', body));
  } catch (error) { return expensesError(error); }
}
