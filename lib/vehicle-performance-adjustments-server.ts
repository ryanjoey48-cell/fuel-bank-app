import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadVehicleSourceReports } from './vehicle-performance-source-reports';
import { applyFinancialCorrections, financialCellKey, financialCellVersion, normalizeFinancialInput, SOURCE_FIELDS,
  COST_FIELDS, type FinancialChange, type FinancialCorrection } from './vehicle-performance-financial';

type Store = { version: 1; revision: number; entries: FinancialCorrection[] };
export class VehicleAdjustmentError extends Error {
  constructor(public status: number, message: string, public cells: string[] = []) { super(message); }
}
export function vehicleAdjustmentWritesEnabled() {
  return !process.env.VERCEL && (process.env.NODE_ENV !== 'production' || process.env.EES_VEHICLE_FINANCIAL_LOCAL_WORKSPACE === '1');
}
function root() {
  return process.env.EES_VEHICLE_FINANCIAL_STORE_DIR ? path.resolve(process.env.EES_VEHICLE_FINANCIAL_STORE_DIR) : path.join(process.cwd(), '.ees-local', 'vehicle-performance-financial');
}
async function readStore(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(path.join(root(), 'adjustments.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, revision: 0, entries: [] }; throw error; }
  const store = JSON.parse(raw) as Store;
  if (store.version !== 1 || !Number.isSafeInteger(store.revision) || store.revision < 0 || !Array.isArray(store.entries)) throw new Error('Invalid adjustment history. No data was overwritten.');
  // Fail closed on damaged audit data rather than silently reverting to source figures.
  for (const entry of store.entries) {
    if (!entry.id || !entry.userId || !Number.isFinite(Date.parse(entry.createdAt)) ||
      !['amount', 'unknown', 'not_applicable'].includes(entry.kind) ||
      (entry.kind === 'amount' && (entry.value == null || normalizeFinancialInput(entry.field, entry.value) !== entry.value)) ||
      (entry.kind !== 'amount' && entry.value !== null)) throw new Error('Invalid adjustment history. No data was overwritten.');
  }
  return store;
}
export async function readVehicleFinancialWorkspace() {
  const sources = loadVehicleSourceReports();
  const store = await readStore();
  return { reports: applyFinancialCorrections(sources, store.entries), sources, history: store.entries,
    revision: store.revision, writesEnabled: vehicleAdjustmentWritesEnabled() };
}

/** Only supported source rows and fields can be changed. Caller identity is supplied by authenticated server code. */
export async function saveVehicleFinancialChanges(input: unknown, userId: string) {
  if (!vehicleAdjustmentWritesEnabled()) throw new VehicleAdjustmentError(403, 'Local financial editing is unavailable on this deployment.');
  if (!userId) throw new VehicleAdjustmentError(403, 'An authenticated administrator is required.');
  if (!input || typeof input !== 'object' || !Array.isArray((input as { changes?: unknown }).changes)) throw new VehicleAdjustmentError(400, 'A changed-cell list is required.');
  const changes = (input as { changes: FinancialChange[] }).changes;
  if (!changes.length || changes.length > 378) throw new VehicleAdjustmentError(400, 'Save between 1 and 378 changed cells.');
  const sources = loadVehicleSourceReports();
  const keys = new Set<string>();
  for (const change of changes) {
    if (!change || change.year !== 2026 || ![8, 9].includes(change.month) || !SOURCE_FIELDS.includes(change.field) || typeof change.registration !== 'string' || typeof change.expected !== 'string') throw new VehicleAdjustmentError(400, 'Invalid financial row or field.');
    const key = financialCellKey(change.month, change.registration, change.field);
    const row = sources.find(r => r.month === change.month)?.rows.find(r => r.registration === change.registration);
    if (!row || keys.has(key)) throw new VehicleAdjustmentError(400, 'Unknown or duplicate financial cell.', [key]);
    keys.add(key);
    if (change.field === 'lpg' && row.registration !== 'ฒอ-8453') throw new VehicleAdjustmentError(400, 'LPG is not applicable to this vehicle.', [key]);
    let validAmount = false;
    try { validAmount = typeof change.value === 'string' && normalizeFinancialInput(change.field, change.value) === change.value; }
    catch { /* Validation errors identify the cell and leave the whole batch unsaved. */ }
    if (!['amount', 'unknown', 'not_applicable'].includes(change.kind) ||
      (change.kind === 'amount' && !validAmount) ||
      (change.kind !== 'amount' && change.value !== null) ||
      (change.kind === 'not_applicable' && !COST_FIELDS.includes(change.field as typeof COST_FIELDS[number]))) throw new VehicleAdjustmentError(400, 'Invalid amount, blank or not-applicable value.', [key]);
  }
  await mkdir(root(), { recursive: true });
  const lockPath = path.join(root(), 'adjustments.lock');
  // An exclusive file lock protects multiple workers/processes, as well as office users.
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { lock = await open(lockPath, 'wx'); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  if (!lock) throw new VehicleAdjustmentError(409, 'Another save is in progress. Your edits are still unsaved; retry.');
  const temporary = path.join(root(), `adjustments-${randomUUID()}.tmp`);
  try {
    const store = await readStore();
    const effective = applyFinancialCorrections(sources, store.entries);
    const conflicts = changes.filter(change => {
      const report = effective.find(r => r.month === change.month)!;
      const row = report.rows.find(r => r.registration === change.registration)!;
      return financialCellVersion(report, row, change.field) !== change.expected;
    }).map(change => financialCellKey(change.month, change.registration, change.field));
    if (conflicts.length) throw new VehicleAdjustmentError(409, 'These cells changed since you loaded them. No changes were saved. Reload saved values to compare; your edits are retained.', conflicts);
    const timestamp = new Date().toISOString();
    const entries: FinancialCorrection[] = changes.map(change => {
      const report = effective.find(r => r.month === change.month)!;
      const row = report.rows.find(r => r.registration === change.registration)!;
      return { year: change.year, month: change.month, registration: change.registration, field: change.field,
        kind: change.kind, value: change.value, expected: change.expected, id: randomUUID(), userId,
        createdAt: timestamp, sourceSha256: report.sourceSha256, previousValue: row.cells[change.field].value, previousStatus: row.cells[change.field].status };
    });
    const next: Store = { version: 1, revision: store.revision + 1, entries: [...store.entries, ...entries] };
    const file = await open(temporary, 'wx');
    try { await file.writeFile(JSON.stringify(next, null, 2) + '\n', 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path.join(root(), 'adjustments.json'));
    // Confirm persistence by reading the committed file before acknowledging success.
    const confirmed = await readStore();
    if (confirmed.revision !== next.revision || confirmed.entries.at(-1)?.id !== entries.at(-1)?.id) throw new Error('Persistence verification failed. Reload saved values before retrying.');
    return { reports: applyFinancialCorrections(sources, confirmed.entries), sources, history: confirmed.entries,
      revision: confirmed.revision, savedCount: entries.length, writesEnabled: true };
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
