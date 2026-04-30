"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const memoryStorage = new Map<string, string>();

const fallbackStorage = {
  getItem(key: string) {
    return memoryStorage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memoryStorage.set(key, value);
  },
  removeItem(key: string) {
    memoryStorage.delete(key);
  }
};

const resolveStorage = () => {
  if (typeof window === "undefined") {
    return fallbackStorage;
  }

  try {
    const storage = window.sessionStorage;
    const probeKey = "__supabase_session_probe__";

    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);

    return storage;
  } catch {
    return fallbackStorage;
  }
};

if (!supabaseUrl || !supabaseAnonKey) {
  // The app still renders a setup state, but we fail loudly in development actions.
  // eslint-disable-next-line no-console
  console.warn("Supabase environment variables are missing.");
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      storage: resolveStorage()
    }
  }
);
