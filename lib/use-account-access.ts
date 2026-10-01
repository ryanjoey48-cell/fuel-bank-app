"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCurrentAccess } from "@/lib/account-management";
import { hasPermission, type AccountAccess, type Permission } from "@/lib/authorization";

type RefreshOptions = { force?: boolean };

type AccountAccessContextValue = {
  access: AccountAccess | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: RefreshOptions) => Promise<AccountAccess>;
  can: (permission: Permission) => boolean;
};

const AccountAccessContext = createContext<AccountAccessContextValue | null>(null);

export function AccountAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccountAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((_options: RefreshOptions = {}) => {
    setLoading(true);
    setError(null);
    return fetchCurrentAccess()
      .then((result) => {
        setAccess(result.access);
        return result.access;
      })
      .catch((caught: Error) => {
        setAccess(null);
        setError(caught.message);
        throw caught;
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleUserUpdated = () => {
      void refresh({ force: true }).catch(() => undefined);
    };

    window.addEventListener("fuel-bank:user-updated", handleUserUpdated);
    return () => {
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
