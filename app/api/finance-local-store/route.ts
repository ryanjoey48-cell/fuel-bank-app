import { NextResponse } from "next/server";
import { FinanceWriteGuardError } from "@/lib/finance-write-guard";
import { AdminApiError, requireAdminAccess, requireVerifiedUser } from "@/lib/admin-user-management-server";
import {
  FinanceStaleWriteError,
  writeFinanceLocalStoreChecked,
  clearFinanceLocalStore,
  isFinanceLocalStoreEnabled,
  readFinanceLocalStore
} from "@/lib/finance-local-store-server";
import { createEmptyOwnerState, type Role, type State } from "@/lib/finance-demo-centre";
import {
  createEmptyFinanceWorkspaces,
  isFinanceWorkspaceId,
  type FinanceLocalWorkspaces,
  type FinanceWorkspaceId
} from "@/lib/finance-local-persistence";

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Reads: any verified user (Admin Intake / Records need visibility). Writes/clears: active Admin / Super Admin only. */
async function gate(request: Request, mode: "read" | "write") {
  if (!isFinanceLocalStoreEnabled()) {
    return NextResponse.json({ error: "Finance local store disabled." }, { status: 404 });
  }
  // Fixture-cleared mode has no Supabase credentials — allow local-only file access without a production auth bypass.
  if (!hasSupabaseEnv()) return null;
  if (mode === "write") await requireAdminAccess(request);
  else await requireVerifiedUser(request);
  return null;
}

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

export async function GET(request: Request) {
  try {
    const blocked = await gate(request, "read");
    if (blocked) return blocked;
    const envelope = await readFinanceLocalStore();
    return NextResponse.json({
      enabled: true,
      kind: "ees_finance_local_test",
      envelope,
      pathHint: ".ees-local/finance-test/state.json"
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to read local Finance store." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const blocked = await gate(request, "write");
    if (blocked) return blocked;
    const body = (await request.json()) as {
      role?: Role;
      activeWorkspace?: FinanceWorkspaceId;
      workspaces?: FinanceLocalWorkspaces;
      state?: State;
      /** savedAt of the version this client loaded; a different file version means another tab/window saved since. */
      baseSavedAt?: string | null;
    };
    if (!body?.role) {
      return NextResponse.json({ error: "role is required." }, { status: 400 });
    }
    if (body.baseSavedAt === undefined) return NextResponse.json({ error: "baseSavedAt is required; reload before saving." }, { status: 400 });

    let workspaces: FinanceLocalWorkspaces;
    let activeWorkspace: FinanceWorkspaceId = isFinanceWorkspaceId(body.activeWorkspace)
      ? body.activeWorkspace
      : "owner";

    if (
      body.workspaces &&
      isStateShape(body.workspaces.owner) &&
      isStateShape(body.workspaces.previous_demo)
    ) {
      workspaces = {
        owner: body.workspaces.owner,
        previous_demo: body.workspaces.previous_demo
      };
    } else if (isStateShape(body.state)) {
      const existing = await readFinanceLocalStore();
      workspaces = existing?.workspaces || createEmptyFinanceWorkspaces();
      activeWorkspace = existing?.activeWorkspace || activeWorkspace;
      workspaces = {
        ...workspaces,
        [activeWorkspace]: body.state
      };
    } else {
      return NextResponse.json({ error: "workspaces or state is required." }, { status: 400 });
    }

    if (!workspaces.owner) workspaces.owner = createEmptyOwnerState();
    if (!workspaces.previous_demo) workspaces.previous_demo = createEmptyOwnerState();

    const envelope = await writeFinanceLocalStoreChecked(workspaces, body.role, activeWorkspace, body.baseSavedAt);
    return NextResponse.json({ ok: true, envelope });
  } catch (error) {
    if (error instanceof FinanceStaleWriteError) {
      return NextResponse.json({ error: "FINANCE_STALE", currentSavedAt: error.currentSavedAt }, { status: 409 });
    }
    if (error instanceof FinanceWriteGuardError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Finance local store save failed", error);
    return NextResponse.json({ error: "Unable to save local Finance store." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const blocked = await gate(request, "write");
    if (blocked) return blocked;
    await clearFinanceLocalStore();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to clear local Finance store." }, { status: 500 });
  }
}
