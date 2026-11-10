"use client";

import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "@/lib/account-management";
import { FINANCE_SETTINGS_DEFAULTS, normalizeFinanceSettings, type FinanceSettings } from "@/lib/finance-settings";

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const listeners = new Set<(settings: FinanceSettings) => void>();
let cached: FinanceSettings | null = null;

/** Reads the server-stored Finance settings; saving is re-checked server-side (Admin / Super Admin only). */
export function useFinanceSettings() {
  const [settings, setSettings] = useState<FinanceSettings>(cached ?? FINANCE_SETTINGS_DEFAULTS);
  const [loaded, setLoaded] = useState(cached !== null);

  useEffect(() => {
    const listener = (next: FinanceSettings) => { setSettings(next); setLoaded(true); };
    listeners.add(listener);
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/finance-settings", { cache: "no-store", headers: await authHeaders() });
        if (!response.ok) return;
        const payload = (await response.json()) as { settings?: unknown };
        const next = normalizeFinanceSettings(payload.settings);
        cached = next;
        if (active) listeners.forEach((notify) => notify(next));
      } catch {
        // Keep defaults when offline.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; listeners.delete(listener); };
  }, []);

  const saveStartDate = useCallback(async (startDate: string) => {
    const response = await fetch("/api/finance-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ startDate })
    });
    const payload = (await response.json().catch(() => ({}))) as { settings?: unknown; error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to save Finance settings.");
    const next = normalizeFinanceSettings(payload.settings);
    cached = next;
    listeners.forEach((notify) => notify(next));
    return next;
  }, []);

  return { settings, loaded, saveStartDate };
}
