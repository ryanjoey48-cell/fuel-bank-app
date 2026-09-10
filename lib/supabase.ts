"use client";

import { AuthClient } from "@supabase/auth-js";
import { PostgrestClient } from "@supabase/postgrest-js";
import { StorageClient } from "@supabase/storage-js";
import { safeLocalStorage } from "@/lib/safe-browser-storage";

type AuthClientInstance = InstanceType<typeof AuthClient>;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const parsedSupabaseUrl = (() => {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl);
  } catch {
    return null;
  }
})();

export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? "Supabase client configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before running the Fuel Bank app."
  : !parsedSupabaseUrl
    ? "Supabase client configuration is invalid. Check NEXT_PUBLIC_SUPABASE_URL before running the Fuel Bank app."
    : null;

const storageKey = parsedSupabaseUrl
  ? `sb-${parsedSupabaseUrl.hostname.split(".")[0]}-auth-token`
  : "fuel-bank-supabase-auth-token";

type RecoverySupabaseClient = {
  auth: AuthClientInstance;
  channel: (topic: string) => RecoveryRealtimeChannel;
  from: PostgrestClient["from"];
  removeChannel: (_channel: RecoveryRealtimeChannel) => Promise<"ok">;
  rpc: PostgrestClient["rpc"];
  storage: StorageClient;
};

type RecoveryRealtimeChannel = {
  on: (..._args: unknown[]) => RecoveryRealtimeChannel;
  subscribe: (..._args: unknown[]) => RecoveryRealtimeChannel;
  unsubscribe: () => Promise<"ok">;
};

type AuthRequestDebug = {
  at: string;
  method: string;
  ok: boolean | null;
  status: number | null;
  url: string;
  error: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __fuelBankSupabaseBrowserClient: RecoverySupabaseClient | undefined;
  // eslint-disable-next-line no-var
  var __fuelBankLastAuthRequest: AuthRequestDebug | undefined;
}

function unavailableError() {
  return new Error(supabaseConfigError ?? "Supabase is unavailable.");
}

function createUnavailableQuery(error: Error) {
  const query = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: unknown) => void) => resolve({
            count: null,
            data: null,
            error,
            status: 0,
            statusText: error.message
          });
        }

        return () => query;
      }
    }
  );

  return query;
}

function createUnavailableAuthClient(error: Error) {
  return {
    getSession: async () => ({ data: { session: null }, error }),
    getUser: async () => ({ data: { user: null }, error }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error }),
    signOut: async () => ({ error }),
    signUp: async () => ({ data: { user: null, session: null }, error })
  } as unknown as AuthClientInstance;
}

function createNoopRealtimeChannel(): RecoveryRealtimeChannel {
  const channel: RecoveryRealtimeChannel = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: async () => "ok"
  };

  return channel;
}

async function safeAuthLock<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) {
  return fn();
}

function createAuthorizedFetch(auth: AuthClientInstance) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("apikey", supabaseAnonKey!);

    // PostgREST/Storage supply the default anon header before calling fetch.
    // Replace that default with the current session on every request.
    if (!headers.has("Authorization") || headers.get("Authorization") === `Bearer ${supabaseAnonKey}`) {
      const { data, error } = await auth.getSession();
      if (error) throw error;
      headers.set("Authorization", `Bearer ${data.session?.access_token ?? supabaseAnonKey}`);
    }

    return fetch(input, {
      ...init,
      headers
    });
  };
}

function fetchInputUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

function isPasswordGrantRequest(url: string) {
  return /\/auth\/v1\/token/i.test(url) && /grant_type=password/i.test(url);
}

function recordAuthRequest(debug: AuthRequestDebug) {
  globalThis.__fuelBankLastAuthRequest = debug;
}

function createAuthFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = fetchInputUrl(input);
    const shouldRecord = isPasswordGrantRequest(url);
    const method = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");

    try {
      const response = await fetch(input, init);
      if (shouldRecord) {
        recordAuthRequest({
          at: new Date().toISOString(),
          method,
          ok: response.ok,
          status: response.status,
          url,
          error: null
        });
      }
      return response;
    } catch (error) {
      if (shouldRecord) {
        recordAuthRequest({
          at: new Date().toISOString(),
          method,
          ok: null,
          status: null,
          url,
          error: error instanceof Error ? error.message : "Auth request failed."
        });
      }
      throw error;
    }
  };
}

function createRecoverySupabaseClient(): RecoverySupabaseClient {
  if (supabaseConfigError || !parsedSupabaseUrl || !supabaseAnonKey) {
    const error = unavailableError();
    const query = createUnavailableQuery(error);

    return {
      auth: createUnavailableAuthClient(error),
      channel: createNoopRealtimeChannel,
      from: () => query,
      removeChannel: async () => "ok",
      rpc: () => query,
      storage: new Proxy({}, { get: () => () => query }) as StorageClient
    } as unknown as RecoverySupabaseClient;
  }

  const authUrl = new URL("auth/v1", parsedSupabaseUrl).href;
  const restUrl = new URL("rest/v1", parsedSupabaseUrl).href;
  const storageUrl = new URL("storage/v1", parsedSupabaseUrl).href;
  const authHeaders = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`
  };
  const auth = new AuthClient({
    url: authUrl,
    headers: authHeaders,
    storage: safeLocalStorage,
    storageKey,
    lock: safeAuthLock,
    fetch: createAuthFetch(),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  });
  const authorizedFetch = createAuthorizedFetch(auth);
  const rest = new PostgrestClient(restUrl, {
    headers: authHeaders,
    fetch: authorizedFetch,
    timeout: 12_000
  });
  const storage = new StorageClient(storageUrl, authHeaders, authorizedFetch);

  return {
    auth,
    channel: createNoopRealtimeChannel,
    from: rest.from.bind(rest),
    removeChannel: async () => "ok",
    rpc: rest.rpc.bind(rest),
    storage
  };
}

export function getLastAuthRequestDebug() {
  return globalThis.__fuelBankLastAuthRequest ?? null;
}

export function getSupabaseBrowserClient() {
  if (!globalThis.__fuelBankSupabaseBrowserClient) {
    globalThis.__fuelBankSupabaseBrowserClient = createRecoverySupabaseClient();
  }

  return globalThis.__fuelBankSupabaseBrowserClient;
}

export const supabase = getSupabaseBrowserClient();
