export function verifyDeletedServiceRow(data: unknown, id: string) {
  if (!Array.isArray(data) || data.length !== 1 || String(data[0]?.id) !== id) {
    throw new Error("No selected service record was deleted. It may already be removed, or your account's Supabase SELECT/DELETE policies may prevent access. Reload history and check permissions.");
  }
}

/** Share concurrent refreshes; a mutation during a read schedules one fresh trailing read. */
export function createServiceRefreshCoordinator() {
  let pending: Promise<void> | null = null;
  let revision = 0;
  return {
    invalidate() { revision += 1; },
    run(load: () => Promise<void>): Promise<void> {
      if (pending) return pending;
      pending = (async () => {
        let started: number;
        do {
          started = revision;
          await load();
        } while (started !== revision);
      })().finally(() => { pending = null; });
      return pending;
    }
  };
}
