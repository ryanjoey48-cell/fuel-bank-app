import {
  createFinanceLocalStoreEnvelope,
  normalizeFinanceLocalStore,
  type FinanceLocalWorkspaces,
  type FinanceWorkspaceId
} from "./finance-local-persistence";
import type { Role } from "./finance-demo-centre";

export class FinanceStaleSaveError extends Error { constructor() { super("FINANCE_STALE"); } }

/**
 * Persist Finance workspace. Prefer the authenticated local disk API when enabled (localhost).
 * On Vercel Production the API is disabled (404) — return a browser-mirror envelope only so the
 * four-section UI can save per browser without claiming shared company storage.
 */
export async function saveFinanceLocalWorkspace(spaces: FinanceLocalWorkspaces, role: Role, activeWorkspace: FinanceWorkspaceId,
  headers: HeadersInit, fetcher: typeof fetch = fetch, baseSavedAt?: string | null) {
  const response = await fetcher("/api/finance-local-store", {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ workspaces: spaces, role, activeWorkspace, ...(baseSavedAt !== undefined ? { baseSavedAt } : {}) })
  });
  if (response.status === 404) {
    return createFinanceLocalStoreEnvelope(spaces, role, activeWorkspace);
  }
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
