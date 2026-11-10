import { NextResponse } from 'next/server';
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from '@/lib/admin-user-management-server';
import { canUseVehicleFinancialDrafts } from '@/lib/vehicle-financial-draft-access';
import { isAdminRole } from '@/lib/authorization';
import { readVehicleFinancialWorkspace, saveVehicleFinancialChanges, VehicleAdjustmentError } from '@/lib/vehicle-performance-adjustments-server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  try {
    const user = await requireVerifiedUser(request);
    const access = await resolveAccountAccess(createServerSupabaseAdmin(), user);
    if (!canUseVehicleFinancialDrafts(access, 'read')) throw new AdminApiError(403, 'Financial reporting access is required.');
    const workspace = await readVehicleFinancialWorkspace();
    return NextResponse.json({ ...workspace, writesEnabled: workspace.writesEnabled && isAdminRole(access.role) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : 'Unable to load reconciled source reports.' }, { status: error instanceof AdminApiError ? error.status : 500, headers });
  }
}

export async function PUT(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  try {
    const user = await requireVerifiedUser(request);
    const access = await resolveAccountAccess(createServerSupabaseAdmin(), user);
    if (!isAdminRole(access.role) || !canUseVehicleFinancialDrafts(access, 'read')) throw new AdminApiError(403, 'Administrator financial permission is required.');
    const size = Number(request.headers.get('content-length') || 0);
    if (size > 200000) throw new VehicleAdjustmentError(413, 'Save request is too large.');
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let raw = '', bytes = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 200000) { await reader.cancel(); throw new VehicleAdjustmentError(413, 'Save request is too large.'); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    }
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new VehicleAdjustmentError(400, 'Invalid save request.'); }
    return NextResponse.json(await saveVehicleFinancialChanges(input, user.id), { headers });
  } catch (error) {
    const status = error instanceof AdminApiError || error instanceof VehicleAdjustmentError ? error.status : 500;
    return NextResponse.json({ error: status === 500 ? 'Save failed. Your edits are not confirmed saved; keep them and retry or reload saved values.' : (error as Error).message,
      cells: error instanceof VehicleAdjustmentError ? error.cells : [] }, { status, headers });
  }
}
