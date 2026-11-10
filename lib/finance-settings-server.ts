import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { financeLocalStoreRoot, isFinanceLocalStoreEnabled } from "@/lib/finance-local-store-server";
import { FINANCE_SETTINGS_DEFAULTS, normalizeFinanceSettings, type FinanceSettings } from "@/lib/finance-settings";

/** The one stored copy of the Finance settings (next to the local Finance store; never committed). */
export function financeSettingsFile() {
  return path.join(financeLocalStoreRoot(), "settings.json");
}

export type StoredFinanceSettings = FinanceSettings & { updatedAt: string | null; updatedBy: string | null };

export async function readFinanceSettings(): Promise<StoredFinanceSettings> {
  if (!isFinanceLocalStoreEnabled()) return { ...FINANCE_SETTINGS_DEFAULTS, updatedAt: null, updatedBy: null };
  try {
    const parsed = JSON.parse(await readFile(financeSettingsFile(), "utf8")) as Partial<StoredFinanceSettings>;
    return {
      ...normalizeFinanceSettings(parsed),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null
    };
  } catch {
    return { ...FINANCE_SETTINGS_DEFAULTS, updatedAt: null, updatedBy: null };
  }
}

export async function writeFinanceSettings(settings: FinanceSettings, updatedBy: string): Promise<StoredFinanceSettings> {
  if (!isFinanceLocalStoreEnabled()) throw new Error("FINANCE_LOCAL_STORE_DISABLED");
  const next: StoredFinanceSettings = { ...normalizeFinanceSettings(settings), updatedAt: new Date().toISOString(), updatedBy };
  const file = financeSettingsFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return next;
}
