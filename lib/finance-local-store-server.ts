import { mkdir, readFile, writeFile, unlink, access, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createFinanceLocalStoreEnvelope,
  normalizeFinanceLocalStore,
  type FinanceLocalStoreEnvelope,
  type FinanceLocalWorkspaces,
  type FinanceWorkspaceId
} from "@/lib/finance-local-persistence";
import type { Role } from "@/lib/finance-demo-centre";
import { assertFinanceBillingWrite } from "@/lib/finance-write-guard";

// EES_FINANCE_LOCAL_STORE_DIR lets isolated test servers use a throw-away copy; unset = the normal project store.
const ROOT = process.env.EES_FINANCE_LOCAL_STORE_DIR ? path.resolve(process.env.EES_FINANCE_LOCAL_STORE_DIR) : path.join(process.cwd(), ".ees-local", "finance-test");
const STATE_FILE = path.join(ROOT, "state.json");
const ATTACH_DIR = path.join(ROOT, "attachments");

export function financeLocalStoreRoot() {
  return ROOT;
}

export function isFinanceLocalStoreEnabled() {
  // Never write finance local files against live finance tables mode.
  if (process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL === "1") return false;
  // Explicit local workspace flag keeps persistence available under `next start`
  // on localhost (NODE_ENV=production). Never set that flag on Vercel Production.
  if (process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

async function ensureDirs() {
  await mkdir(ATTACH_DIR, { recursive: true });
}

export async function readFinanceLocalStore(): Promise<FinanceLocalStoreEnvelope | null> {
  if (!isFinanceLocalStoreEnabled()) return null;
  try {
    await access(STATE_FILE);
  } catch {
    return null;
  }
  const raw = await readFile(STATE_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return normalizeFinanceLocalStore(parsed);
}

/** Windows can briefly deny replacement of an open destination. Retry the atomic replace; never truncate/delete it. */
export async function replaceFinanceFileAtomically(
  temporary: string,
  destination: string,
  replace: (from: string, to: string) => Promise<void> = rename,
  pause: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
) {
  const delays = Array.from({ length: 20 }, (_, attempt) => Math.min(50 * 2 ** attempt, 500));
  for (let attempt = 0; ; attempt++) {
    try { await replace(temporary, destination); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (attempt >= delays.length || !["EPERM", "EACCES", "EBUSY"].includes(code || "")) throw error;
      await pause(delays[attempt]);
    }
  }
}

export async function writeFinanceLocalStore(
  workspaces: FinanceLocalWorkspaces,
  role: Role,
  activeWorkspace: FinanceWorkspaceId = "owner"
) {
  if (!isFinanceLocalStoreEnabled()) {
    throw new Error("FINANCE_LOCAL_STORE_DISABLED");
  }
  await ensureDirs();
  const envelope = createFinanceLocalStoreEnvelope(workspaces, role, activeWorkspace);
  // Replace only after the complete envelope is written; a failed save preserves the previous file.
  const temporary = path.join(ROOT, `state-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await replaceFinanceFileAtomically(temporary, STATE_FILE);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return envelope;
}

export class FinanceStaleWriteError extends Error {
  constructor(public currentSavedAt: string | null) { super("FINANCE_STALE"); }
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Optimistic concurrency for the local store: the write is applied only if the file on disk is still the version the
 * client loaded (`baseSavedAt`). Reads and writes are serialised, so two tabs cannot both pass the check. A stale save is
 * refused and leaves the file untouched. `baseSavedAt === undefined` skips the check (legacy callers only).
 */
export function writeFinanceLocalStoreChecked(
  workspaces: FinanceLocalWorkspaces,
  role: Role,
  activeWorkspace: FinanceWorkspaceId,
  baseSavedAt: string | null | undefined
) {
  const run = writeChain.catch(() => {}).then(async () => {
    const existing = await readFinanceLocalStore();
    if (baseSavedAt !== undefined) {
      const current = existing ? existing.savedAt : null;
      if (current !== null && current !== baseSavedAt) throw new FinanceStaleWriteError(current);
    }
    assertFinanceBillingWrite(existing?.workspaces.owner, workspaces.owner);
    assertFinanceBillingWrite(existing?.workspaces.previous_demo, workspaces.previous_demo);
    return writeFinanceLocalStore(workspaces, role, activeWorkspace);
  });
  writeChain = run;
  return run;
}

export async function clearFinanceLocalStore() {
  if (!isFinanceLocalStoreEnabled()) {
    throw new Error("FINANCE_LOCAL_STORE_DISABLED");
  }
  try {
    await unlink(STATE_FILE);
  } catch {
    // missing is fine
  }
}

const SAFE_STORED = /^[a-zA-Z0-9._-]+$/;

export function assertSafeAttachmentStoredName(storedName: string) {
  if (!SAFE_STORED.test(storedName) || storedName.length > 180) {
    throw new Error("FINANCE_LOCAL_ATTACHMENT_NAME_INVALID");
  }
}

export async function writeFinanceLocalAttachment(storedName: string, bytes: Uint8Array) {
  if (!isFinanceLocalStoreEnabled()) throw new Error("FINANCE_LOCAL_STORE_DISABLED");
  assertSafeAttachmentStoredName(storedName);
  await ensureDirs();
  const target = path.resolve(ATTACH_DIR, storedName);
  if (!target.startsWith(path.resolve(ATTACH_DIR) + path.sep)) throw new Error("FINANCE_LOCAL_ATTACHMENT_PATH");
  await writeFile(target, bytes);
  return storedName;
}

export async function readFinanceLocalAttachment(storedName: string) {
  if (!isFinanceLocalStoreEnabled()) throw new Error("FINANCE_LOCAL_STORE_DISABLED");
  assertSafeAttachmentStoredName(storedName);
  const target = path.resolve(ATTACH_DIR, storedName);
  if (!target.startsWith(path.resolve(ATTACH_DIR) + path.sep)) throw new Error("FINANCE_LOCAL_ATTACHMENT_PATH");
  return readFile(target);
}
