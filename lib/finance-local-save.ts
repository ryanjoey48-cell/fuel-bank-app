import { normalizeFinanceLocalStore, type FinanceLocalWorkspaces, type FinanceWorkspaceId } from "./finance-local-persistence";
import type { Role } from "./finance-demo-centre";

export class FinanceStaleSaveError extends Error { constructor() { super("FINANCE_STALE"); } }

/** A save is successful only after the server returns the persisted complete workspace. `baseSavedAt` = the version this tab loaded/saved last; a newer file on disk (another tab) refuses the save. */
export async function saveFinanceLocalWorkspace(spaces: FinanceLocalWorkspaces, role: Role, activeWorkspace: FinanceWorkspaceId,
  headers: HeadersInit, fetcher: typeof fetch = fetch, baseSavedAt?: string | null) {
  const response = await fetcher("/api/finance-local-store", {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ workspaces: spaces, role, activeWorkspace, ...(baseSavedAt !== undefined ? { baseSavedAt } : {}) })
  });
  if (response.status === 409) throw new FinanceStaleSaveError();
  if (response.status === 422) {
    const payload = await response.json() as { error?: string };
    if (payload.error?.startsWith("FINANCE_")) throw new Error(payload.error);
  }
  if (!response.ok) throw new Error("FINANCE_SAVE_FAILED");
  const payload = await response.json() as { envelope?: unknown };
  const envelope = normalizeFinanceLocalStore(payload.envelope);
  if (!envelope || JSON.stringify(envelope.workspaces) !== JSON.stringify(spaces)) throw new Error("FINANCE_SAVE_NOT_CONFIRMED");
  return envelope;
}
