/**
 * Fail-closed environment guards for future Finance shared-storage migration tools.
 * Never applies SQL. Never logs secrets, connection strings, or key material.
 *
 * Default posture: dry-run / read-only. Production is refused under every path.
 */
import {
  EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE,
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  classifyEesSupabaseProjectRef,
  extractSupabaseProjectRef,
  type EesDatabaseEnvironmentClass
} from "@/lib/ees-database-environment";

export const FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF = EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE;
export const FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF = EES_PRODUCTION_SUPABASE_PROJECT_REF;

/** Explicit staging selector — required before any Finance migration tool may proceed past dry-run identity checks. */
export const FINANCE_MIGRATION_TARGET_ENV = "EES_FINANCE_MIGRATION_TARGET" as const;
export const FINANCE_MIGRATION_MODE_ENV = "EES_FINANCE_MIGRATION_MODE" as const;
export const FINANCE_MIGRATION_ENV_FILE_ENV = "EES_FINANCE_MIGRATION_ENV_FILE" as const;

export type FinanceMigrationTarget = "development";
export type FinanceMigrationMode = "dry-run" | "read-only" | "apply";

export class FinanceMigrationEnvironmentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceMigrationEnvironmentError";
    this.code = code;
  }
}

export type FinanceMigrationEnvInput = {
  /** Must be exactly "development". */
  migrationTarget?: string | null;
  /** Defaults to dry-run when omitted / empty. */
  migrationMode?: string | null;
  /** Explicit env-file path the tool was told to load (never .env.local). */
  envFile?: string | null;
  /** Supabase URL from the *explicit* staging env file only. */
  supabaseUrl?: string | null;
  /** Must equal development ref. */
  approvedStagingRef?: string | null;
  /**
   * Optional: values that would have come from process.env / .env.local if the tool
   * accidentally fell back. If present and they look like production, refuse even harder.
   */
  accidentalLocalUrl?: string | null;
  accidentalLocalRef?: string | null;
};

export type FinanceMigrationEnvResolution = {
  mode: FinanceMigrationMode;
  target: FinanceMigrationTarget;
  projectRef: string;
  projectClass: EesDatabaseEnvironmentClass;
  envFile: string;
  dryRun: true | false;
  applyAllowed: false;
  productionRefBlocked: typeof FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF;
  requiredDevelopmentRef: typeof FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF;
};

const FORBIDDEN_ENV_FILES = new Set([
  ".env.local",
  ".env",
  ".env.production",
  ".env.production.local",
  "tmp/.env.vercel.prod",
  "tmp/.env.vercel.pull",
  ".env.vercel-preview.local",
  ".env.local.backup"
]);

function norm(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeEnvFilePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isForbiddenFinanceMigrationEnvFile(envFile: string | null | undefined): boolean {
  if (!envFile) return false;
  const normalized = normalizeEnvFilePath(envFile).toLowerCase();
  const base = normalized.split("/").pop() || normalized;
  if (FORBIDDEN_ENV_FILES.has(normalized) || FORBIDDEN_ENV_FILES.has(base)) return true;
  if (base === ".env.local" || normalized.endsWith("/.env.local")) return true;
  if (normalized.includes("vercel.prod") || normalized.includes("vercel-preview")) return true;
  return false;
}

export function parseFinanceMigrationMode(raw: string | null | undefined): FinanceMigrationMode {
  const value = (norm(raw) || "dry-run").toLowerCase();
  if (value === "dry-run" || value === "dryrun" || value === "dry_run") return "dry-run";
  if (value === "read-only" || value === "readonly" || value === "read_only") return "read-only";
  if (value === "apply" || value === "write" || value === "migrate") return "apply";
  throw new FinanceMigrationEnvironmentError(
    "FINANCE_MIGRATION_MODE_INVALID",
    `Finance migration mode must be dry-run, read-only, or apply (received unsupported value).`
  );
}

/**
 * Resolve and validate the Finance migration target environment.
 * Always refuses production. Defaults to dry-run. Never returns secrets.
 */
export function assertFinanceMigrationEnvironment(input: FinanceMigrationEnvInput = {}): FinanceMigrationEnvResolution {
  const migrationTarget = (norm(input.migrationTarget) || "").toLowerCase();
  if (!migrationTarget) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_TARGET_REQUIRED",
      `Explicit ${FINANCE_MIGRATION_TARGET_ENV}=development is required. Default localhost /.env.local is production and must not be used.`
    );
  }
  if (migrationTarget === "production" || migrationTarget === "prod" || migrationTarget === "live") {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_PRODUCTION_TARGET_REFUSED",
      "Finance migration tools refuse production under all circumstances."
    );
  }
  if (migrationTarget !== "development" && migrationTarget !== "staging" && migrationTarget !== "dev") {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_TARGET_UNKNOWN",
      "Finance migration target must be explicitly set to development."
    );
  }

  const envFile = norm(input.envFile);
  if (!envFile) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_ENV_FILE_REQUIRED",
      `Explicit ${FINANCE_MIGRATION_ENV_FILE_ENV} (e.g. .env.staging.local) is required. Falling back to .env.local is refused.`
    );
  }
  if (isForbiddenFinanceMigrationEnvFile(envFile)) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_ENV_FILE_FORBIDDEN",
      "Finance migration tools refuse .env.local, Vercel production/preview env pulls, and other production-linked env files."
    );
  }

  const url = norm(input.supabaseUrl);
  if (!url) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_URL_MISSING",
      "Supabase URL is missing from the explicit staging env file."
    );
  }

  const projectRef = extractSupabaseProjectRef(url);
  if (!projectRef) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_REF_MISSING",
      "Unable to derive a Supabase project reference from the staging URL."
    );
  }

  if (projectRef === FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_PRODUCTION_REFUSED",
      `Refusing Finance migration against confirmed production project ${FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF}.`
    );
  }

  const projectClass = classifyEesSupabaseProjectRef(projectRef);
  if (projectClass === "CONFIRMED_PRODUCTION") {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_PRODUCTION_REFUSED",
      "Refusing Finance migration against a confirmed production classification."
    );
  }
  if (projectClass === "UNKNOWN" || projectClass === "LEGACY_INACTIVE") {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_REF_UNKNOWN",
      "Finance migration requires the known EES Development project reference; unknown or legacy projects are refused."
    );
  }
  if (projectRef !== FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_REF_MISMATCH",
      `Finance migration requires development project ${FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF}.`
    );
  }

  const approved = (norm(input.approvedStagingRef) || "").toLowerCase();
  if (!approved) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_APPROVED_REF_REQUIRED",
      "EES_APPROVED_STAGING_PROJECT_REF must be set to the development project reference."
    );
  }
  if (approved === FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_APPROVED_REF_PRODUCTION",
      "EES_APPROVED_STAGING_PROJECT_REF cannot be production."
    );
  }
  if (approved !== FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_APPROVED_REF_MISMATCH",
      "EES_APPROVED_STAGING_PROJECT_REF must equal the EES Development project reference."
    );
  }
  if (approved !== projectRef) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_CONFLICTING_REFS",
      "Supabase URL project ref conflicts with EES_APPROVED_STAGING_PROJECT_REF."
    );
  }

  // Accidental .env.local / process.env fallback detection (values compared by ref only).
  const accidentalUrl = norm(input.accidentalLocalUrl);
  const accidentalRef =
    (norm(input.accidentalLocalRef) || "").toLowerCase() ||
    (accidentalUrl ? extractSupabaseProjectRef(accidentalUrl) : null);
  if (accidentalRef === FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF) {
    // Presence of a production-shaped accidental fallback is only fatal when the tool
    // would have used it. Callers that pass accidentalLocal* are asserting they detected
    // a forbidden fallback path — refuse.
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_ENV_LOCAL_FALLBACK_REFUSED",
      "Detected production identity from a .env.local / default process.env fallback path. Finance migration tools must use an explicit staging env file only."
    );
  }

  const mode = parseFinanceMigrationMode(input.migrationMode);

  // Apply is never enabled by this resolver in the current product phase.
  // Even if mode=apply is requested, identity checks must pass AND applyAllowed stays false
  // until a future owner-approved cutover flips a dedicated constant (not process.env alone).
  if (mode === "apply") {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_APPLY_DISABLED",
      "Finance migration apply/write mode is hard-disabled. Only dry-run and read-only are available."
    );
  }

  return {
    mode,
    target: "development",
    projectRef,
    projectClass,
    envFile: normalizeEnvFilePath(envFile),
    dryRun: mode === "dry-run" || mode === "read-only",
    applyAllowed: false,
    productionRefBlocked: FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF,
    requiredDevelopmentRef: FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF
  };
}

/**
 * Build guard input from a plain env dict (tests / CLI).
 * Does not read .env.local. Does not print values.
 */
export function financeMigrationEnvFromDict(
  environment: Record<string, string | undefined>,
  options: { envFile?: string | null; includeAccidentalLocalProbe?: boolean } = {}
): FinanceMigrationEnvInput {
  const envFile =
    options.envFile ??
    environment[FINANCE_MIGRATION_ENV_FILE_ENV] ??
    environment.EES_FINANCE_MIGRATION_ENV_FILE ??
    null;

  const input: FinanceMigrationEnvInput = {
    migrationTarget: environment[FINANCE_MIGRATION_TARGET_ENV] ?? environment.EES_FINANCE_MIGRATION_TARGET,
    migrationMode: environment[FINANCE_MIGRATION_MODE_ENV] ?? environment.EES_FINANCE_MIGRATION_MODE,
    envFile,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    approvedStagingRef: environment.EES_APPROVED_STAGING_PROJECT_REF
  };

  if (options.includeAccidentalLocalProbe) {
    // Probe only when the caller admits they merged process.env that may contain .env.local.
    input.accidentalLocalUrl = environment.EES_FINANCE_ACCIDENTAL_LOCAL_URL;
    input.accidentalLocalRef = environment.EES_FINANCE_ACCIDENTAL_LOCAL_REF;
  }

  return input;
}

/** Safe summary for logs / CLI — never includes keys or full URLs. */
export function financeMigrationEnvSummary(resolution: FinanceMigrationEnvResolution): Record<string, string | boolean | null> {
  return {
    ok: true,
    mode: resolution.mode,
    target: resolution.target,
    projectRef: resolution.projectRef,
    projectClass: resolution.projectClass,
    envFile: resolution.envFile,
    dryRun: resolution.dryRun,
    applyAllowed: resolution.applyAllowed,
    productionRefBlocked: resolution.productionRefBlocked,
    requiredDevelopmentRef: resolution.requiredDevelopmentRef
  };
}
