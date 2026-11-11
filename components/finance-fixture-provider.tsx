"use client";

import { isFinanceWorkspaceRoute } from "@/lib/finance-workspace-routes";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyAction,
  createCompletedScenario,
  createEmptyOwnerState,
  createFixtureInitialState,
  upsertDiaryBooking,
  linkDiaryWorkOrder,
  type Action,
  type DiaryBookingSeed,
  type AdminReceipts,
  type IntakeCheck,
  type Role,
  type State
} from "@/lib/finance-demo-centre";
import {
  FINANCE_LOCAL_BROWSER_KEY,
  FINANCE_LOCAL_BROWSER_KEY_LEGACY,
  createEmptyFinanceWorkspaces,
  normalizeFinanceLocalStore,
  parseFinanceLocalStoreJson,
  type FinanceLocalStoreEnvelope,
  type FinanceLocalWorkspaces,
  type FinanceWorkspaceId
} from "@/lib/finance-local-persistence";
import { getAccessToken } from "@/lib/account-management";
import { isFinanceFixtureMode, usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";
import { safeLocalStorage } from "@/lib/safe-browser-storage";
import { FinanceStaleSaveError, saveFinanceLocalWorkspace } from "@/lib/finance-local-save";
import { useAccountAccess } from "@/lib/use-account-access";
import { canUseFinanceAdminIntake, financeActionActor } from "@/lib/finance-intake-access";

type IntakeCheckInput = { result: IntakeCheck["result"]; note: string } | null;
type PersistStatus = "idle" | "loading" | "saving" | "saved" | "error" | "conflict";

type FinanceFixtureContextValue = {
  state: State;
  workspaces: FinanceLocalWorkspaces;
  activeWorkspace: FinanceWorkspaceId;
  setActiveWorkspace: (id: FinanceWorkspaceId) => void;
  role: Role;
  canAddDiaryWorkOrder: boolean;
  accessLoading: boolean;
  setRole: (role: Role) => void;
  dispatch: (action: Action) => boolean;
  ensureDiaryBooking: (seed: DiaryBookingSeed) => void;
  addDiaryWorkOrder: (seed: DiaryBookingSeed, workOrder: string, receipts?: AdminReceipts, check?: IntakeCheckInput) => Promise<void>;
  /** Admin edits an already-linked job; resolves only after the local store confirms the save. */
  saveAdminIntake: (action: Extract<Action, { type: "admin_save_intake" }>) => Promise<void>;
  saveCurrentWorkspace: (action?: Action) => Promise<void>;
  resetActiveWorkspace: () => void;
  loadCompletedIntoPreviousDemo: () => void;
  clearPersistedStore: () => Promise<void>;
  persistStatus: PersistStatus;
  lastSavedAt: string | null;
  hydrateReady: boolean;
  error: string;
  clearError: () => void;
  /** @deprecated use resetActiveWorkspace */
  reset: () => void;
  /** @deprecated use loadCompletedIntoPreviousDemo */
  loadCompleted: () => void;
};

const FinanceFixtureContext = createContext<FinanceFixtureContextValue | null>(null);

/** The other local workspace — read-only context so simulated TRN numbers are unique across both. */
function siblingStatesFor(spaces: FinanceLocalWorkspaces, active: FinanceWorkspaceId): State[] {
  const other = spaces[active === "owner" ? "previous_demo" : "owner"];
  return other ? [other] : [];
}

async function authHeaders(): Promise<HeadersInit> {
  try {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function readBrowserMirror(): FinanceLocalStoreEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const current = parseFinanceLocalStoreJson(safeLocalStorage.getItem(FINANCE_LOCAL_BROWSER_KEY) || "");
    if (current) return current;
    return parseFinanceLocalStoreJson(safeLocalStorage.getItem(FINANCE_LOCAL_BROWSER_KEY_LEGACY) || "");
  } catch {
    return null;
  }
}

function writeBrowserMirror(envelope: FinanceLocalStoreEnvelope) {
  if (typeof window === "undefined") return;
  try {
    safeLocalStorage.setItem(FINANCE_LOCAL_BROWSER_KEY, JSON.stringify(envelope));
    safeLocalStorage.removeItem(FINANCE_LOCAL_BROWSER_KEY_LEGACY);
  } catch {
    // quota / private mode — disk API remains source of truth across restarts
  }
}

function clearBrowserMirror() {
  if (typeof window === "undefined") return;
  try {
    safeLocalStorage.removeItem(FINANCE_LOCAL_BROWSER_KEY);
    safeLocalStorage.removeItem(FINANCE_LOCAL_BROWSER_KEY_LEGACY);
  } catch {
    // ignore
  }
}

function applyEnvelope(
  envelope: FinanceLocalStoreEnvelope,
  canUseAdminIntake: boolean,
  canUseSuperAdmin: boolean,
  isolatedFixtureMode: boolean
) {
  return {
    workspaces: envelope.workspaces,
    activeWorkspace: envelope.activeWorkspace,
    role: canUseSuperAdmin ? "super_admin" : canUseAdminIntake && (envelope.role === "office" || envelope.role === "super_admin")
      ? "admin"
      : (envelope.role === "super_admin" || (envelope.role === "admin" && !canUseAdminIntake && !isolatedFixtureMode))
        ? "office"
        : envelope.role as Role,
    lastSavedAt: envelope.savedAt
  };
}

export function FinanceFixtureProvider({ children }: { children: ReactNode }) {
  const { access, loading: accountLoading } = useAccountAccess();
  const canUseSuperAdmin = access?.role === "super_admin" && access.status === "active";
  const canUseAdminIntake = (access?.role === "admin" || canUseSuperAdmin) && access?.status === "active";
  const isolatedFixtureMode = isFinanceFixtureMode();
  // The isolated fixture (development, no Supabase credentials) has no account to wait for; the layout never resolves
  // the access check there, so waiting would leave Save disabled forever. Never true in production or with Supabase set.
  const accessLoading = accountLoading && !isolatedFixtureMode;
  const [workspaces, setWorkspaces] = useState<FinanceLocalWorkspaces>(createEmptyFinanceWorkspaces);
  const [activeWorkspace, setActiveWorkspaceState] = useState<FinanceWorkspaceId>("owner");
  const [role, setRoleState] = useState<Role>("office");
  const [error, setError] = useState("");
  const [persistStatus, setPersistStatus] = useState<PersistStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hydrateReady, setHydrateReady] = useState(false);
  const skipNextSave = useRef(true);
  /** savedAt of the server copy this tab last loaded or saved (null = nothing server-confirmed yet). */
  const baseSavedAt = useRef<string | null>(null);
  const conflict = useRef(false);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const intakeLock = useRef(false);
  const [intakeSaving, setIntakeSaving] = useState(false);

  const latestWorkspace = useRef({ workspaces, role, activeWorkspace });
  latestWorkspace.current = { workspaces, role, activeWorkspace };
  const saveSequence = useRef(0);

  const persistWorkspace = useCallback((spaces: FinanceLocalWorkspaces, savedRole: Role, workspace: FinanceWorkspaceId) => {
    const sequence = ++saveSequence.current;
    const save = saveQueue.current.catch(() => {}).then(async () => {
      if (conflict.current) throw new FinanceStaleSaveError();
      setPersistStatus("saving");
      let envelope;
      try {
        envelope = await saveFinanceLocalWorkspace(spaces, savedRole, workspace, await authHeaders(), fetch, baseSavedAt.current);
      } catch (caught) {
        if (caught instanceof FinanceStaleSaveError) { conflict.current = true; setPersistStatus("conflict"); }
        throw caught;
      }
      baseSavedAt.current = envelope.savedAt;
      writeBrowserMirror(envelope);
      setLastSavedAt(envelope.savedAt);
      const latest = latestWorkspace.current;
      const current = intakeLock.current || (spaces === latest.workspaces && savedRole === latest.role && workspace === latest.activeWorkspace);
      setPersistStatus(sequence === saveSequence.current && current ? "saved" : "saving");
      return envelope;
    });
    saveQueue.current = save;
    return save;
  }, []);

  const state = workspaces[activeWorkspace] || createEmptyOwnerState();
  const canAddDiaryWorkOrder = canUseFinanceAdminIntake(access, role, isolatedFixtureMode);

  useEffect(() => {
    if (!hydrateReady || !["saving", "error", "conflict"].includes(persistStatus)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!isFinanceWorkspaceRoute(window.location.pathname)) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hydrateReady, persistStatus]);

  useEffect(() => {
    if (!usesFinanceLocalDemoScreens()) {
      setHydrateReady(true);
      setPersistStatus("idle");
      return;
    }
    let active = true;
    void (async () => {
      setPersistStatus("loading");
      const mirror = readBrowserMirror();
      try {
        const headers = await authHeaders();
        const response = await fetch("/api/finance-local-store", { cache: "no-store", headers });
        if (response.ok) {
          const payload = (await response.json()) as { envelope?: unknown };
          const envelope = normalizeFinanceLocalStore(payload.envelope);
          if (!active) return;
          if (envelope) {
            const next = applyEnvelope(envelope, canUseAdminIntake, canUseSuperAdmin, isolatedFixtureMode);
            setWorkspaces(next.workspaces);
            setActiveWorkspaceState(next.activeWorkspace);
            setRoleState(next.role);
            setLastSavedAt(next.lastSavedAt);
            baseSavedAt.current = envelope.savedAt;
            writeBrowserMirror(envelope);
            setPersistStatus("saved");
          } else if (mirror) {
            const next = applyEnvelope(mirror, canUseAdminIntake, canUseSuperAdmin, isolatedFixtureMode);
            setWorkspaces(next.workspaces);
            setActiveWorkspaceState(next.activeWorkspace);
            setRoleState(next.role);
            setLastSavedAt(next.lastSavedAt);
            setPersistStatus("error");
          } else {
            setPersistStatus("idle");
          }
        } else if (response.status === 404 && mirror) {
          // Disk store disabled (Vercel Production) — authenticated browser mirror is the store.
          if (!active) return;
          const next = applyEnvelope(mirror, canUseAdminIntake, canUseSuperAdmin, isolatedFixtureMode);
          setWorkspaces(next.workspaces);
          setActiveWorkspaceState(next.activeWorkspace);
          setRoleState(next.role);
          setLastSavedAt(next.lastSavedAt);
          baseSavedAt.current = mirror.savedAt;
          setPersistStatus("saved");
        } else if (response.status === 404) {
          if (!active) return;
          setPersistStatus("idle");
        } else if (mirror) {
          if (!active) return;
          const next = applyEnvelope(mirror, canUseAdminIntake, canUseSuperAdmin, isolatedFixtureMode);
          setWorkspaces(next.workspaces);
          setActiveWorkspaceState(next.activeWorkspace);
          setRoleState(next.role);
          setLastSavedAt(next.lastSavedAt);
          setPersistStatus("error");
        } else {
          if (!active) return;
          setPersistStatus("idle");
        }
      } catch {
        if (!active) return;
        if (mirror) {
          const next = applyEnvelope(mirror, canUseAdminIntake, canUseSuperAdmin, isolatedFixtureMode);
          setWorkspaces(next.workspaces);
          setActiveWorkspaceState(next.activeWorkspace);
          setRoleState(next.role);
          setLastSavedAt(next.lastSavedAt);
          setPersistStatus("error");
        } else {
          setPersistStatus("error");
        }
      } finally {
        if (active) {
          skipNextSave.current = true;
          setHydrateReady(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [canUseAdminIntake, canUseSuperAdmin, isolatedFixtureMode]);

  useEffect(() => {
    setRoleState((current) => canUseSuperAdmin ? "super_admin" : canUseAdminIntake && (current === "office" || current === "super_admin")
      ? "admin"
      : current === "super_admin" ? "office" : current);
  }, [canUseAdminIntake, canUseSuperAdmin]);

  const setRole = useCallback((nextRole: Role) => {
    if (intakeLock.current) return;
    if (nextRole === "super_admin" && !canUseSuperAdmin) return;
    if (nextRole === "admin" && !canUseFinanceAdminIntake(access, nextRole, isolatedFixtureMode)) return;
    setRoleState(nextRole);
  }, [canUseSuperAdmin, access, isolatedFixtureMode]);

  useEffect(() => {
    if (!hydrateReady || intakeSaving || !usesFinanceLocalDemoScreens()) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setPersistStatus("saving");
    const timer = window.setTimeout(() => {
      void persistWorkspace(workspaces, role, activeWorkspace).catch((caught) => { if (!(caught instanceof FinanceStaleSaveError)) setPersistStatus("error"); });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [workspaces, role, activeWorkspace, hydrateReady, intakeSaving, persistWorkspace]);

  const patchActive = useCallback((updater: (current: State) => State) => {
    setWorkspaces((current) => {
      const active = current[activeWorkspace] || createEmptyOwnerState();
      return {
        ...current,
        [activeWorkspace]: updater(active)
      };
    });
  }, [activeWorkspace]);

  const dispatch = useCallback((action: Action) => {
    if (intakeLock.current) { setError("FINANCE_SAVE_IN_PROGRESS"); return false; }
    try {
      const actor = financeActionActor(access, role, isolatedFixtureMode, action.type);
      const context = { siblingStates: siblingStatesFor(workspaces, activeWorkspace) };
      applyAction(workspaces[activeWorkspace], action, actor, context);
      patchActive((current) => {
        try { return applyAction(current, action, actor, context); } catch { return current; }
      });
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DEMO_ACTION_FAILED");
      return false;
    }
  }, [patchActive, role, workspaces, activeWorkspace, access, isolatedFixtureMode]);

  const ensureDiaryBooking = useCallback((seed: DiaryBookingSeed) => {
    // Diary reconciliation always belongs to the owner walkthrough.
    setActiveWorkspaceState("owner");
    setWorkspaces((current) => ({
      ...current,
      owner: upsertDiaryBooking(current.owner || createEmptyOwnerState(), seed)
    }));
    setError("");
  }, []);

  const addDiaryWorkOrder = useCallback(async (seed: DiaryBookingSeed, workOrder: string, receipts?: AdminReceipts, check?: IntakeCheckInput) => {
    if (!hydrateReady || intakeLock.current) throw new Error("FINANCE_SAVE_IN_PROGRESS");
    if (!canUseFinanceAdminIntake(access, role, isolatedFixtureMode)) throw new Error("FINANCE_ADMIN_INTAKE_REQUIRED");
    const owner = linkDiaryWorkOrder(workspaces.owner || createEmptyOwnerState(), seed, workOrder, "admin", receipts, check);
    const next = { ...workspaces, owner };
    intakeLock.current = true;
    setIntakeSaving(true);
    try {
      await persistWorkspace(next, role, "owner");
      skipNextSave.current = true;
      setWorkspaces(next);
      setActiveWorkspaceState("owner");
      setError("");
    } catch (caught) {
      if (!(caught instanceof FinanceStaleSaveError)) setPersistStatus("error");
      throw caught;
    } finally {
      intakeLock.current = false;
      setIntakeSaving(false);
    }
  }, [workspaces, role, hydrateReady, persistWorkspace, access, isolatedFixtureMode]);

  const saveAdminIntake = useCallback(async (action: Extract<Action, { type: "admin_save_intake" }>) => {
    if (!hydrateReady || intakeLock.current) throw new Error("FINANCE_SAVE_IN_PROGRESS");
    if (!canUseFinanceAdminIntake(access, role, isolatedFixtureMode)) throw new Error("FINANCE_ADMIN_INTAKE_REQUIRED");
    const owner = applyAction(workspaces.owner || createEmptyOwnerState(), action, "admin");
    const next = { ...workspaces, owner };
    intakeLock.current = true;
    setIntakeSaving(true);
    try {
      await persistWorkspace(next, role, "owner");
      skipNextSave.current = true;
      setWorkspaces(next);
      setActiveWorkspaceState("owner");
      setError("");
    } catch (caught) {
      if (!(caught instanceof FinanceStaleSaveError)) setPersistStatus("error");
      throw caught;
    } finally {
      intakeLock.current = false;
      setIntakeSaving(false);
    }
  }, [workspaces, role, hydrateReady, persistWorkspace, access, isolatedFixtureMode]);

  const setActiveWorkspace = useCallback((id: FinanceWorkspaceId) => {
    if (intakeLock.current) return;
    setActiveWorkspaceState(id);
    setError("");
  }, []);

  const saveCurrentWorkspace = useCallback(async (action?: Action) => {
    if (!hydrateReady || intakeLock.current) throw new Error("FINANCE_SAVE_IN_PROGRESS");
    const next = { ...workspaces, [activeWorkspace]: action ? applyAction(workspaces[activeWorkspace], action, role, { siblingStates: siblingStatesFor(workspaces, activeWorkspace) }) : workspaces[activeWorkspace] };
    intakeLock.current = true; setIntakeSaving(true);
    try {
      await persistWorkspace(next, role, activeWorkspace);
      skipNextSave.current = true;
      setWorkspaces(next); setError("");
    } catch (caught) { if (!(caught instanceof FinanceStaleSaveError)) setPersistStatus("error"); throw caught; }
    finally { intakeLock.current = false; setIntakeSaving(false); }
  }, [workspaces, activeWorkspace, role, hydrateReady, persistWorkspace]);

  const resetActiveWorkspace = useCallback(() => {
    skipNextSave.current = false;
    setWorkspaces((current) => ({
      ...current,
      [activeWorkspace]:
        activeWorkspace === "owner" ? createEmptyOwnerState() : createFixtureInitialState()
    }));
    setError("");
  }, [activeWorkspace]);

  const loadCompletedIntoPreviousDemo = useCallback(() => {
    skipNextSave.current = false;
    setWorkspaces((current) => ({
      ...current,
      previous_demo: createCompletedScenario()
    }));
    setActiveWorkspaceState("previous_demo");
    setError("");
  }, []);

  const clearPersistedStore = useCallback(async () => {
    clearBrowserMirror();
    try {
      const headers = await authHeaders();
      await fetch("/api/finance-local-store", { method: "DELETE", headers });
    } catch {
      // ignore network — local mirror already cleared
    }
    skipNextSave.current = true;
    setWorkspaces(createEmptyFinanceWorkspaces());
    setActiveWorkspaceState("owner");
    setRoleState(canUseSuperAdmin ? "super_admin" : canUseAdminIntake ? "admin" : "office");
    setLastSavedAt(null);
    setPersistStatus("idle");
    setError("");
  }, [canUseAdminIntake, canUseSuperAdmin]);

  const clearError = useCallback(() => setError(""), []);

  const value = useMemo(
    () => ({
      state,
      workspaces,
      activeWorkspace,
      setActiveWorkspace,
      role,
      canAddDiaryWorkOrder,
      accessLoading,
      setRole,
      dispatch,
      ensureDiaryBooking,
      addDiaryWorkOrder,
      saveAdminIntake,
      saveCurrentWorkspace,
      resetActiveWorkspace,
      loadCompletedIntoPreviousDemo,
      clearPersistedStore,
      persistStatus,
      lastSavedAt,
      hydrateReady,
      error,
      clearError,
      reset: resetActiveWorkspace,
      loadCompleted: loadCompletedIntoPreviousDemo
    }),
    [
      state,
      workspaces,
      activeWorkspace,
      setActiveWorkspace,
      role,
      canAddDiaryWorkOrder,
      accessLoading,
      setRole,
      dispatch,
      ensureDiaryBooking,
      addDiaryWorkOrder,
      saveAdminIntake,
      saveCurrentWorkspace,
      resetActiveWorkspace,
      loadCompletedIntoPreviousDemo,
      clearPersistedStore,
      persistStatus,
      lastSavedAt,
      hydrateReady,
      error,
      clearError
    ]
  );

  return <FinanceFixtureContext.Provider value={value}>{children}</FinanceFixtureContext.Provider>;
}

export function useFinanceFixture() {
  const context = useContext(FinanceFixtureContext);
  if (!context) throw new Error("FINANCE_FIXTURE_CONTEXT_REQUIRED");
  return context;
}
