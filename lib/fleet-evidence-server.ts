import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AdminApiError, getBearerToken } from "./admin-user-management-server";

export function createFleetSourceClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AdminApiError(503, "EES source is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: {
    headers: { Authorization: `Bearer ${getBearerToken(request)}` }, fetch: (input, init) => {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (!["GET", "HEAD"].includes(method)) throw new Error("read_only_source");
      return fetch(input, { ...init, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    }
  } });
}
