import "server-only";
import { buildAttentionQueue, type AttentionQueue } from "./ees-hr-attention";
import { hrDatabaseError, type hrServerContext } from "./ees-hr-v7-server";
import { HRV7Error, type DirectoryEmployee, type HRDirectory } from "./ees-hr-v7-types";

type Context = Awaited<ReturnType<typeof hrServerContext>>;

/** Page through the authorised directory RPC so attention covers the full permitted workforce. */
async function readAllDirectoryEmployees(ctx: Context): Promise<DirectoryEmployee[]> {
  const all: DirectoryEmployee[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const result = await ctx.client.rpc(ctx.access.peopleReady ? "ees_people_directory" : "ees_hr_v7_directory", {
      p_query: { page, size: 50, search: "", status: "all", kind: "all" },
    });
    hrDatabaseError(result.error);
    const data = result.data as HRDirectory | null;
    if (!data || !Array.isArray(data.rows)) throw new HRV7Error("HR_OPERATION_FAILED", 500);
    all.push(...data.rows);
    if (page * 50 >= data.total || data.rows.length === 0) break;
  }
  // Deduplicate by kind+id in case an RPC page overlaps.
  const seen = new Set<string>();
  return all.filter((row) => {
    const key = `${row.kind}:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function readAttentionQueue(ctx: Context, query: URLSearchParams): Promise<AttentionQueue> {
  ctx.requireHR();
  const limit = Number(query.get("limit") ?? 12);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new HRV7Error("HR_INVALID_INPUT");
  const people = await readAllDirectoryEmployees(ctx);
  return buildAttentionQueue(people, limit);
}
