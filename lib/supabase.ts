"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const missingSupabaseEnv = !supabaseUrl || !supabaseAnonKey;

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

if (missingSupabaseEnv) {
  console.warn(
    [
      "Supabase environment variables are missing.",
      "Live data will not sync with production until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.",
      "For Vercel, set these in Project Settings > Environment Variables, then redeploy.",
      "If the project currently uses VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, next.config.ts maps them as compatibility aliases at build time."
    ].join(" ")
  );
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
