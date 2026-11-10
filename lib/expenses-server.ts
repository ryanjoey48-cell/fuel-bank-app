import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { receiptMime } from './expenses-receipts';
import { createHash } from 'node:crypto';
import { AdminApiError, createServerSupabaseAdmin, getBearerToken, requireVerifiedUser, resolveAccountAccess } from '@/lib/admin-user-management-server';
import { validateExpense, type ExpenseInput } from '@/lib/expenses';
import { isConfirmedEesProductionUrl } from '@/lib/ees-database-environment';
import { resolveExpensesReadiness, type ExpensesReadiness } from '@/lib/expenses-readiness-state';

export const RECEIPTS_BUCKET = 'expenses-receipts';
export type { ExpensesReadiness };
export { resolveExpensesReadiness };
export function assertExpensesWriteEnvironment(env: NodeJS.ProcessEnv = process.env) {
  // Two deliberate server-side gates. No localhost assumption and no implicit production activation.
  if (env.EES_EXPENSES_WRITES !== 'approved-safe-environment' || !env.EES_EXPENSES_APPROVED_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL !== env.EES_EXPENSES_APPROVED_SUPABASE_URL || env.VERCEL_ENV === 'production' || isConfirmedEesProductionUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new AdminApiError(503, 'EXPENSES_SAFE_ENVIRONMENT_REQUIRED');
  }
}
export function expensesWriteEnvironmentReady(env: NodeJS.ProcessEnv = process.env) {
  try { assertExpensesWriteEnvironment(env); return true; } catch { return false; }
}
export async function expensesContext(request: Request, write = false) {
  const user = await requireVerifiedUser(request);
  const admin = createServerSupabaseAdmin();
  const access = await resolveAccountAccess(admin, user);
  if (access.status !== 'active' || !['super_admin', 'admin', 'office_staff', 'read_only'].includes(access.role)) throw new AdminApiError(403, 'EXPENSES_FORBIDDEN');
  if (write) { assertExpensesWriteEnvironment(); if (access.role === 'read_only') throw new AdminApiError(403, 'EXPENSES_READ_ONLY'); }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${getBearerToken(request)}` }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) }, auth: { persistSession: false, autoRefreshToken: false } });
  if (write) {
    const [config,bucket] = await Promise.all([db.from('expenses_config').select('*').single(),admin.storage.getBucket(RECEIPTS_BUCKET)]);
    if (config.error || config.data?.schema_version !== 3) throw new AdminApiError(503,'EXPENSES_SCHEMA_UPGRADE_REQUIRED');
    if (!config.data.enabled) throw new AdminApiError(503,'EXPENSES_NOT_ACTIVATED');
    if (bucket.error || bucket.data.public !== false) throw new AdminApiError(503,'EXPENSES_PRIVATE_STORAGE_REQUIRED');
  }
  return { user, admin, access, db };
}
export async function allExpenseRows(db: SupabaseClient, table: string, order = 'id', filter?: { column: string; value: string }) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    let query = db.from(table).select('*');
    if (filter) query = query.eq(filter.column,filter.value);
    const { data, error } = await query.order(order).range(offset, offset + 999);
    if (error) throw new AdminApiError(503, 'EXPENSES_SCHEMA_UNAVAILABLE');
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  throw new AdminApiError(503, 'EXPENSES_REPORT_LIMIT');
}
export async function expenseCommand(db: SupabaseClient, command: string, body: Record<string, unknown>) {
  if (['create', 'edit'].includes(command)) validateExpense(body.input as ExpenseInput);
  // attachment_ready is never exposed: only the server verifies stored originals.
  if (!['create', 'edit', 'transition', 'payment', 'category', 'centre', 'template', 'attachment_reserve', 'attachment_remove'].includes(command)) throw new AdminApiError(400, 'UNKNOWN_COMMAND');
  const { data, error } = await db.rpc('expenses_command', { command, body });
  if (error) {
    const known = error.message.match(/EXPENSE_[A-Z_]+|[A-Z]+(?:_[A-Z]+)+/)?.[0] || 'EXPENSES_SAVE_FAILED';
    throw new AdminApiError(error.code === '42501' ? 403 : /CONFLICT/.test(known) ? 409 : 400, known);
  }
  return data;
}
export function sniffReceipt(bytes: Uint8Array) {
  try { return {mime:receiptMime(bytes),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}; } catch(error){throw new AdminApiError(400,error instanceof Error?error.message:'FILE_TYPE');}
}
export function expensesError(error: unknown) {
  const status = error instanceof AdminApiError ? error.status : 400;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : 'EXPENSES_ERROR';
  if (process.env.NODE_ENV !== 'production') {
    console.error('[expenses-api]', status, message, error instanceof Error ? error.stack : error);
  }
  return Response.json({ error: message || 'EXPENSES_ERROR' }, { status, headers: { 'Cache-Control': 'no-store' } });
}
