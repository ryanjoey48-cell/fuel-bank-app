"use client";

import { useEffect, useState } from "react";
import { fetchCurrentAccess } from "@/lib/account-management";
import { hasPermission, type AccountAccess, type Permission } from "@/lib/authorization";

export function useAccountAccess() {
  const [access, setAccess] = useState<AccountAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
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
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchCurrentAccess()
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
      void refresh().catch(() => undefined);
    };

    window.addEventListener("fuel-bank:user-updated", handleUserUpdated);
    return () => {
      active = false;
      window.removeEventListener("fuel-bank:user-updated", handleUserUpdated);
    };
  }, []);

  return {
    access,
    loading,
    error,
    refresh,
    can: (permission: Permission) => hasPermission(access, permission)
  };
}
