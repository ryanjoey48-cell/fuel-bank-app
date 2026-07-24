"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCurrentAccess } from "@/lib/account-management";
import { hasPermission, type AccountAccess, type Permission } from "@/lib/authorization";

type AccessResult = Awaited<ReturnType<typeof fetchCurrentAccess>>;
type RefreshOptions = { force?: boolean };

type AccountAccessContextValue = {
  access: AccountAccess | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: RefreshOptions) => Promise<AccountAccess>;
  can: (permission: Permission) => boolean;
};

const ACCESS_TTL_MS = 15_000;
const AccountAccessContext = createContext<AccountAccessContextValue | null>(null);

let cachedAccessResult: AccessResult | null = null;
let cachedAt = 0;
let pendingAccessRequest: Promise<AccessResult> | null = null;

function loadCurrentAccess(options: RefreshOptions = {}) {
  const now = Date.now();
  if (!options.force && cachedAccessResult && now - cachedAt < ACCESS_TTL_MS) {
    return Promise.resolve(cachedAccessResult);
  }

  if (!options.force && pendingAccessRequest) {
    return pendingAccessRequest;
  }

  pendingAccessRequest = fetchCurrentAccess()
    .then((result) => {
      cachedAccessResult = result;
      cachedAt = Date.now();
      return result;
    })
    .finally(() => {
      pendingAccessRequest = null;
    });

  return pendingAccessRequest;
}

function clearAccessCache() {
  cachedAccessResult = null;
  cachedAt = 0;
  pendingAccessRequest = null;
}

export function AccountAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccountAccess | null>(cachedAccessResult?.access ?? null);
  const [loading, setLoading] = useState(!cachedAccessResult);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((options: RefreshOptions = {}) => {
    setLoading(true);
    setError(null);
    return loadCurrentAccess(options)
      .then((result) => {
        setAccess(result.access);
        return result.access;
      })
      .catch((caught: Error) => {
        if (options.force) clearAccessCache();
        setAccess(null);
        setError(caught.message);
        throw caught;
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let active = true;

    loadCurrentAccess()
      .then((result) => {
        if (active) setAccess(result.access);
      })
      .catch((caught: Error) => {
        if (active) {
          setError(caught.message);
          setAccess(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const handleUserUpdated = () => {
      void refresh({ force: true }).catch(() => undefined);
    };

    window.addEventListener("fuel-bank:user-updated", handleUserUpdated);
    return () => {
      active = false;
      window.removeEventListener("fuel-bank:user-updated", handleUserUpdated);
    };
  }, [refresh]);

  const value = useMemo<AccountAccessContextValue>(() => ({
    access,
    loading,
    error,
    refresh,
    can: (permission: Permission) => hasPermission(access, permission)
  }), [access, error, loading, refresh]);

  return createElement(AccountAccessContext.Provider, { value }, children);
}

export function useAccountAccess() {
  const context = useContext(AccountAccessContext);
  if (context) return context;
  throw new Error("useAccountAccess must be used inside AccountAccessProvider.");
}
