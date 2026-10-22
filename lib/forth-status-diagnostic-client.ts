export const FORTH_STATUS_DIAGNOSTIC_SESSION_KEY = "ees-forth-status-diagnostic-unknown-labels-v3-used";
export const FORTH_STATUS_DIAGNOSTIC_URL = "/api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only";

export type ForthStatusDiagnosticFailure =
  | "session_unavailable"
  | "already_attempted"
  | "duplicate"
  | "unauthorized"
  | "forbidden"
  | "http_error"
  | "network_error"
  | "invalid_response";

export type ForthStatusDiagnosticOutcome<T> =
  | { kind: "completed"; result: T }
  | { kind: "failed"; reason: ForthStatusDiagnosticFailure; attemptUsed: boolean; httpStatus?: number };

type AttemptStorage = {
  read(): string | null;
  write(value: string): void;
};

export function createForthStatusDiagnosticRunner<T>(options: {
  storage: AttemptStorage;
  getAccessToken(): Promise<string | null>;
  fetcher?: typeof fetch;
  isValidResult(value: unknown): value is T;
}) {
  let inFlight = false;
  let attemptUsedInMemory = false;
  const fetcher = options.fetcher ?? fetch;

  function isAttemptUsed() {
    if (attemptUsedInMemory) return true;
    try {
      return options.storage.read() === "1";
    } catch {
      return false;
    }
  }

  async function run(): Promise<ForthStatusDiagnosticOutcome<T>> {
    if (inFlight) return { kind: "failed", reason: "duplicate", attemptUsed: isAttemptUsed() };
    if (isAttemptUsed()) return { kind: "failed", reason: "already_attempted", attemptUsed: true };

    inFlight = true;
    try {
      let accessToken: string | null;
      try {
        accessToken = await options.getAccessToken();
      } catch {
        accessToken = null;
      }
      if (!accessToken) {
        return { kind: "failed", reason: "session_unavailable", attemptUsed: false };
      }

      // Recheck after asynchronous session lookup so another attempt in this tab wins.
      if (isAttemptUsed()) return { kind: "failed", reason: "already_attempted", attemptUsed: true };

      // Consume the attempt only immediately before initiating the protected request.
      attemptUsedInMemory = true;
      try {
        options.storage.write("1");
      } catch {
        // The in-memory guard still blocks duplicates for this page lifetime.
      }

      let response: Response;
      try {
        response = await fetcher(FORTH_STATUS_DIAGNOSTIC_URL, {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
          headers: { Authorization: "Bearer " + accessToken }
        });
      } catch {
        return { kind: "failed", reason: "network_error", attemptUsed: true };
      }

      if (response.status === 401) return { kind: "failed", reason: "unauthorized", attemptUsed: true, httpStatus: 401 };
      if (response.status === 403) return { kind: "failed", reason: "forbidden", attemptUsed: true, httpStatus: 403 };
      if (!response.ok) return { kind: "failed", reason: "http_error", attemptUsed: true, httpStatus: response.status };

      let result: unknown;
      try {
        result = await response.json();
      } catch {
        return { kind: "failed", reason: "invalid_response", attemptUsed: true };
      }
      if (!options.isValidResult(result)) return { kind: "failed", reason: "invalid_response", attemptUsed: true };
      return { kind: "completed", result };
    } finally {
      inFlight = false;
    }
  }

  return { run, isAttemptUsed };
}
