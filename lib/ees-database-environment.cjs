/** CommonJS mirror for node:test. Keep in sync with ees-database-environment.ts */
const EES_PRODUCTION_SUPABASE_PROJECT_REF = "hafoaurzfgkkwpvzedvd";
const EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE = "wpmnjfncaoogssgpqxek";
const EES_LEGACY_INACTIVE_SUPABASE_PROJECT_REF = "kiewhxiwxmpijhlldlpm";

function extractSupabaseProjectRef(urlOrHost) {
  if (!urlOrHost) return null;
  const raw = String(urlOrHost).trim();
  if (!raw) return null;
  try {
    const host = raw.includes("://") ? new URL(raw).hostname : raw.split("/")[0];
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function classifyEesSupabaseProjectRef(ref) {
  if (!ref) return "UNKNOWN";
  const normalized = String(ref).trim().toLowerCase();
  if (normalized === EES_PRODUCTION_SUPABASE_PROJECT_REF) return "CONFIRMED_PRODUCTION";
  if (normalized === EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE) return "CANDIDATE_STAGING";
  if (normalized === EES_LEGACY_INACTIVE_SUPABASE_PROJECT_REF) return "LEGACY_INACTIVE";
  return "UNKNOWN";
}

function classifyEesSupabaseUrl(urlOrHost) {
  return classifyEesSupabaseProjectRef(extractSupabaseProjectRef(urlOrHost));
}

function isConfirmedEesProductionUrl(urlOrHost) {
  return classifyEesSupabaseUrl(urlOrHost) === "CONFIRMED_PRODUCTION";
}

function assertNotConfirmedProductionForExperimentalSql(urlOrHost) {
  if (isConfirmedEesProductionUrl(urlOrHost)) {
    throw new Error(
      "Refusing experimental SQL against confirmed EES production Supabase project hafoaurzfgkkwpvzedvd."
    );
  }
}

function assertApprovedStagingTarget(urlOrHost, approvedStagingRef) {
  const target = extractSupabaseProjectRef(urlOrHost);
  const approved = approvedStagingRef ? String(approvedStagingRef).trim().toLowerCase() : null;
  if (!target) throw new Error("Supabase project reference is missing.");
  if (target === EES_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error("Staging operations cannot target confirmed production.");
  }
  if (!approved) throw new Error("Owner-approved staging project reference is required.");
  if (target !== approved) {
    throw new Error("Supabase URL does not match the owner-approved staging project reference.");
  }
}

class FleetMonitorDatabaseIsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FleetMonitorDatabaseIsolationError";
    this.code = "fleet_monitor_database_isolation";
  }
}

function assertFleetMonitorSupabaseTarget(input) {
  const url = input?.supabaseUrl ? String(input.supabaseUrl).trim() : null;
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
  const allowed = input?.allowedProjectRef ? String(input.allowedProjectRef).trim().toLowerCase() : null;
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
  const approved = input?.approvedStagingRef ? String(input.approvedStagingRef).trim().toLowerCase() : null;
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

function assertFleetMonitorSupabaseTargetFromEnv(environment) {
  const env = environment || process.env;
  return assertFleetMonitorSupabaseTarget({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    allowedProjectRef: env.EES_FLEET_MONITOR_ALLOWED_PROJECT_REF,
    approvedStagingRef: env.EES_APPROVED_STAGING_PROJECT_REF
  });
}

const EES_PILOT_002_DEPOT_LOCATION_ID = "cccccccc-dddd-4eee-8fff-000000000002";
const LOCATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseFleetMonitorAllowedLocationIds(raw) {
  if (raw == null) return [];
  const tokens = String(raw)
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
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

function assertFleetMonitorAllowedLocationIds(raw) {
  const ids = parseFleetMonitorAllowedLocationIds(raw);
  if (!ids.length) {
    throw new FleetMonitorDatabaseIsolationError(
      "Fleet monitor location allowlist is required (EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS)."
    );
  }
  return ids;
}

function assertFleetMonitorAllowedLocationIdsFromEnv(environment) {
  const env = environment || process.env;
  return assertFleetMonitorAllowedLocationIds(env.EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS);
}

function filterGeofencesToLocationAllowlist(zones, allowedLocationIds) {
  const allowed = new Set((allowedLocationIds || []).map((id) => String(id).toLowerCase()));
  return (zones || []).filter((zone) => allowed.has(String(zone.locationId).toLowerCase()));
}

module.exports = {
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE,
  EES_LEGACY_INACTIVE_SUPABASE_PROJECT_REF,
  EES_PILOT_002_DEPOT_LOCATION_ID,
  extractSupabaseProjectRef,
  classifyEesSupabaseProjectRef,
  classifyEesSupabaseUrl,
  isConfirmedEesProductionUrl,
  assertNotConfirmedProductionForExperimentalSql,
  assertApprovedStagingTarget,
  FleetMonitorDatabaseIsolationError,
  assertFleetMonitorSupabaseTarget,
  assertFleetMonitorSupabaseTargetFromEnv,
  parseFleetMonitorAllowedLocationIds,
  assertFleetMonitorAllowedLocationIds,
  assertFleetMonitorAllowedLocationIdsFromEnv,
  filterGeofencesToLocationAllowlist
};
