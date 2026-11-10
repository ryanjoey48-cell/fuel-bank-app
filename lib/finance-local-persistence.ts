import type { Role, State } from "@/lib/finance-demo-centre";

/** Durable local Finance testing envelope. Never a production finance table row. */
export const FINANCE_LOCAL_STORE_KIND = "ees_finance_local_test" as const;
export const FINANCE_LOCAL_STORE_VERSION = 2 as const;
export const FINANCE_LOCAL_BROWSER_KEY = "ees.finance.local.test.v2";
export const FINANCE_LOCAL_BROWSER_KEY_LEGACY = "ees.finance.local.test.v1";

export type FinanceWorkspaceId = "owner" | "previous_demo";

export type FinanceLocalWorkspaces = {
  owner: State;
  previous_demo: State;
};

function emptyOwnerState(): State {
  return { mode: "owner_walkthrough", bookings: [], documents: [], batches: [], audit: [] };
}

export type FinanceLocalStoreEnvelope = {
  kind: typeof FINANCE_LOCAL_STORE_KIND;
  version: typeof FINANCE_LOCAL_STORE_VERSION;
  savedAt: string;
  role: Role;
  activeWorkspace: FinanceWorkspaceId;
  workspaces: FinanceLocalWorkspaces;
  /** Active workspace mirror — kept for tooling that reads `state` only. */
  state: State;
  note: string;
};

type LegacyV1Envelope = {
  kind: typeof FINANCE_LOCAL_STORE_KIND;
  version: 1;
  savedAt: string;
  role: Role;
  state: State;
  note?: string;
};

function isStateShape(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<State>;
  return (
    Array.isArray(row.bookings) &&
    Array.isArray(row.documents) &&
    Array.isArray(row.batches) &&
    Array.isArray(row.audit)
  );
}

function tagPreviousDemoOrigins(state: State): State {
  return {
    ...state,
    bookings: state.bookings.map((job) => {
      if (job.origin) return job;
      if (job.id.startsWith("source-") || job.id === "manual-mass-1") {
        return { ...job, origin: "demo_workbook" as const };
      }
      if (/^b\d+$/.test(job.id)) {
        return { ...job, origin: "fictional" as const };
      }
      return job;
    })
  };
}

function separateLegacyWorkbookCollections(state: State): State {
  const legacyJobIds = new Set<string>();
  const bookings = state.bookings.map((job) => {
    if (job.price?.source !== "workbook" || !job.source) return job;
    legacyJobIds.add(job.id);
    return {
      ...job,
      collection: job.collection || {
        amount: job.source.totalCollected,
        source: "workbook" as const,
        confirmed: job.price.confirmed
      },
      price: null
    };
  });
  if (!legacyJobIds.size) return state;
  return {
    ...state,
    bookings,
    batches: state.batches.map((batch) =>
      batch.jobIds.some((jobId) => legacyJobIds.has(jobId))
        ? {
            ...batch,
            draft: false,
            approvedBy: null,
            packReady: false,
            rejectedReason: "Source collected amounts are not customer prices; re-enter an approved customer price before billing."
          }
        : batch
    )
  };
}

export function createEmptyFinanceWorkspaces(): FinanceLocalWorkspaces {
  return {
    owner: emptyOwnerState(),
    previous_demo: emptyOwnerState()
  };
}

/** Promote a pre-separation (v1) store into isolated owner + previous-demo workspaces. */
export function migrateLegacyFinanceStore(legacyState: State, role: Role, savedAt = new Date().toISOString()): FinanceLocalStoreEnvelope {
  const previous = tagPreviousDemoOrigins(legacyState);
  return createFinanceLocalStoreEnvelope(
    {
      owner: emptyOwnerState(),
      previous_demo: previous
    },
    role,
    "owner",
    savedAt
  );
}

export function isFinanceWorkspaceId(value: unknown): value is FinanceWorkspaceId {
  return value === "owner" || value === "previous_demo";
}

export function isFinanceLocalStoreEnvelope(value: unknown): value is FinanceLocalStoreEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<FinanceLocalStoreEnvelope> & { version?: number };
  if (row.kind !== FINANCE_LOCAL_STORE_KIND) return false;
  if (typeof row.savedAt !== "string" || typeof row.role !== "string") return false;

  if (row.version === 2) {
    const spaces = row.workspaces as Partial<FinanceLocalWorkspaces> | undefined;
    return (
      isFinanceWorkspaceId(row.activeWorkspace) &&
      !!spaces &&
      isStateShape(spaces.owner) &&
      isStateShape(spaces.previous_demo) &&
      isStateShape(row.state)
    );
  }

  if (row.version === 1) {
    return isStateShape((value as LegacyV1Envelope).state);
  }

  return false;
}

export function normalizeFinanceLocalStore(value: unknown): FinanceLocalStoreEnvelope | null {
  if (!isFinanceLocalStoreEnvelope(value)) return null;
  if (value.version === 2) {
    const workspaces = {
      owner: separateLegacyWorkbookCollections(value.workspaces.owner),
      previous_demo: separateLegacyWorkbookCollections(value.workspaces.previous_demo)
    };
    return {
      ...value,
      workspaces,
      state: workspaces[value.activeWorkspace] || separateLegacyWorkbookCollections(value.state)
    };
  }
  const legacy = value as unknown as LegacyV1Envelope;
  return migrateLegacyFinanceStore(legacy.state, legacy.role, legacy.savedAt);
}

export function createFinanceLocalStoreEnvelope(
  workspaces: FinanceLocalWorkspaces,
  role: Role,
  activeWorkspace: FinanceWorkspaceId = "owner",
  savedAt = new Date().toISOString()
): FinanceLocalStoreEnvelope {
  const normalizedWorkspaces = {
    owner: separateLegacyWorkbookCollections(workspaces.owner),
    previous_demo: separateLegacyWorkbookCollections(workspaces.previous_demo)
  };
  const active = normalizedWorkspaces[activeWorkspace] || normalizedWorkspaces.owner;
  return {
    kind: FINANCE_LOCAL_STORE_KIND,
    version: FINANCE_LOCAL_STORE_VERSION,
    savedAt,
    role,
    activeWorkspace,
    workspaces: {
      owner: normalizedWorkspaces.owner,
      previous_demo: normalizedWorkspaces.previous_demo
    },
    state: active,
    note: "LOCAL DEVELOPMENT ONLY · owner walkthrough is isolated from previous demonstration data · no production finance writes"
  };
}

/** @deprecated Prefer createFinanceLocalStoreEnvelope(workspaces, …). Kept for older call sites. */
export function createFinanceLocalStoreEnvelopeFromState(state: State, role: Role, savedAt = new Date().toISOString()): FinanceLocalStoreEnvelope {
  return migrateLegacyFinanceStore(state, role, savedAt);
}

export function parseFinanceLocalStoreJson(raw: string): FinanceLocalStoreEnvelope | null {
  try {
    return normalizeFinanceLocalStore(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Count diary-linked local test jobs (UUID-linked overlays). */
export function countDiaryLinkedFinanceJobs(state: State) {
  return state.bookings.filter((job) => job.origin === "booking_diary_local_test").length;
}
