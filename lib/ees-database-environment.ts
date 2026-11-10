/**
 * Environment classification helpers for EES Supabase projects.
 * Keeps production and staging identities explicit. Never logs secrets.
 */

/** Confirmed Vercel Production + live operational database (2026-10-31 safety check). */
export const EES_PRODUCTION_SUPABASE_PROJECT_REF = "hafoaurzfgkkwpvzedvd" as const;

/**
 * Candidate isolated development project recovered via Supabase CLI project list
 * (name: "EES Development", ACTIVE_HEALTHY, created 2026-10-28).
 * Not connected to .env.local until the owner authorises a switch.
 */
export const EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE = "wpmnjfncaoogssgpqxek" as const;

/** Older org project (INACTIVE). Not a staging target without owner revival + review. */
export const EES_LEGACY_INACTIVE_SUPABASE_PROJECT_REF = "kiewhxiwxmpijhlldlpm" as const;

export type EesDatabaseEnvironmentClass =
  | "CONFIRMED_PRODUCTION"
  | "CANDIDATE_STAGING"
  | "LEGACY_INACTIVE"
  | "UNKNOWN";

export function extractSupabaseProjectRef(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  const raw = urlOrHost.trim();
  if (!raw) return null;
  try {
    const host = raw.includes("://") ? new URL(raw).hostname : raw.split("/")[0];
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function classifyEesSupabaseProjectRef(ref: string | null | undefined): EesDatabaseEnvironmentClass {
  if (!ref) return "UNKNOWN";
  const normalized = ref.trim().toLowerCase();
  if (normalized === EES_PRODUCTION_SUPABASE_PROJECT_REF) return "CONFIRMED_PRODUCTION";
  if (normalized === EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE) return "CANDIDATE_STAGING";
  if (normalized === EES_LEGACY_INACTIVE_SUPABASE_PROJECT_REF) return "LEGACY_INACTIVE";
  return "UNKNOWN";
}

export function classifyEesSupabaseUrl(urlOrHost: string | null | undefined): EesDatabaseEnvironmentClass {
  return classifyEesSupabaseProjectRef(extractSupabaseProjectRef(urlOrHost));
}

export function isConfirmedEesProductionUrl(urlOrHost: string | null | undefined): boolean {
  return classifyEesSupabaseUrl(urlOrHost) === "CONFIRMED_PRODUCTION";
}

/** Guard for experimental / review-only SQL apply tooling. */
export function assertNotConfirmedProductionForExperimentalSql(urlOrHost: string | null | undefined): void {
  if (isConfirmedEesProductionUrl(urlOrHost)) {
    throw new Error(
      "Refusing experimental SQL against confirmed EES production Supabase project hafoaurzfgkkwpvzedvd."
    );
  }
}

export function assertApprovedStagingTarget(
  urlOrHost: string | null | undefined,
  approvedStagingRef: string | null | undefined
): void {
  const target = extractSupabaseProjectRef(urlOrHost);
  const approved = approvedStagingRef?.trim().toLowerCase() || null;
  if (!target) throw new Error("Supabase project reference is missing.");
  if (target === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error("Staging operations cannot target confirmed production.");
  }
  if (!approved) throw new Error("Owner-approved staging project reference is required.");
  if (target !== approved) {
    throw new Error("Supabase URL does not match the owner-approved staging project reference.");
  }
}

export class FleetMonitorDatabaseIsolationError extends Error {
  readonly code = "fleet_monitor_database_isolation" as const;
  constructor(message: string) {
    super(message);
    this.name = "FleetMonitorDatabaseIsolationError";
  }
}

/**
 * Fail-closed guard for GET /api/internal/fleet-monitor (pilot / staging).
 * Requires an explicit allowlisted project ref that matches the server Supabase URL
 * and the owner-approved staging ref. Production is always refused.
 * Does not log secrets or connection strings.
 */
export function assertFleetMonitorSupabaseTarget(input: {
  supabaseUrl?: string | null;
  allowedProjectRef?: string | null;
  approvedStagingRef?: string | null;
}): { projectRef: string } {
  const url = input.supabaseUrl?.trim() || null;
  if (!url) {
    throw new FleetMonitorDatabaseIsolationError("Fleet monitor Supabase URL is missing.");
  }
  const target = extractSupabaseProjectRef(url);
  if (!target) {
    throw new FleetMonitorDatabaseIsolationError("Fleet monitor Supabase project reference is missing.");
  }
  if (target === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new FleetMonitorDatabaseIsolationError("Fleet monitor refuses confirmed production database.");
  }

  const allowed = input.allowedProjectRef?.trim().toLowerCase() || null;
  if (!allowed) {
    throw new FleetMonitorDatabaseIsolationError(
      "Fleet monitor allowlisted project reference is required (EES_FLEET_MONITOR_ALLOWED_PROJECT_REF)."
    );
  }
  if (allowed === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new FleetMonitorDatabaseIsolationError("Fleet monitor allowlist cannot include production.");
  }
  if (target !== allowed) {
    throw new FleetMonitorDatabaseIsolationError(
      "Fleet monitor Supabase URL does not match the allowlisted project reference."
    );
  }

  const approved = input.approvedStagingRef?.trim().toLowerCase() || null;
  if (!approved) {
    throw new FleetMonitorDatabaseIsolationError(
      "Owner-approved staging project reference is required for fleet monitor."
    );
  }
  if (approved === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new FleetMonitorDatabaseIsolationError("Fleet monitor staging approval cannot be production.");
  }
  if (approved !== allowed || approved !== target) {
    throw new FleetMonitorDatabaseIsolationError(
      "Fleet monitor staging approval does not match the allowlisted Supabase project."
    );
  }

  return { projectRef: target };
}

/** Read process env for monitor isolation without exposing values. */
export function assertFleetMonitorSupabaseTargetFromEnv(
  environment: NodeJS.Dict<string> = process.env
): { projectRef: string } {
  return assertFleetMonitorSupabaseTarget({
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    allowedProjectRef: environment.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF,
    approvedStagingRef: environment.EES_APPROVED_STAGING_PROJECT_REF
  });
}

/** Owner-approved Pilot 002 EES Lorry Depot staging Directory UUID. */
export const EES_PILOT_002_DEPOT_LOCATION_ID = "cccccccc-dddd-4eee-8fff-000000000002" as const;

const LOCATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parse fail-closed monitor location allowlist from a comma/whitespace-separated env value.
 * Empty input yields an empty list (caller must refuse). Invalid tokens throw.
 */
export function parseFleetMonitorAllowedLocationIds(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const tokens = String(raw)
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (!LOCATION_ID_RE.test(token)) {
      throw new FleetMonitorDatabaseIsolationError(
        "Fleet monitor location allowlist contains an invalid location id."
      );
    }
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Fail-closed location allowlist for supervised fleet monitor pulses.
 * Missing/empty allowlist refuses so CAL-COMP and other active zones cannot receive events by accident.
 */
export function assertFleetMonitorAllowedLocationIds(
  raw: string | null | undefined
): string[] {
  const ids = parseFleetMonitorAllowedLocationIds(raw);
  if (!ids.length) {
    throw new FleetMonitorDatabaseIsolationError(
      "Fleet monitor location allowlist is required (EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS)."
    );
  }
  return ids;
}

export function assertFleetMonitorAllowedLocationIdsFromEnv(
  environment: NodeJS.Dict<string> = process.env
): string[] {
  return assertFleetMonitorAllowedLocationIds(environment.EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS);
}

/** Keep only zones whose locationId is explicitly allowlisted. */
export function filterGeofencesToLocationAllowlist<T extends { locationId: string }>(
  zones: readonly T[],
  allowedLocationIds: readonly string[]
): T[] {
  const allowed = new Set(allowedLocationIds.map((id) => id.toLowerCase()));
  return zones.filter((zone) => allowed.has(zone.locationId.toLowerCase()));
}
