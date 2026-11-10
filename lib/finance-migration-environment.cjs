/** CommonJS mirror for node:test / CLI. Keep in sync with finance-migration-environment.ts */
"use strict";

const {
  EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE,
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  classifyEesSupabaseProjectRef,
  extractSupabaseProjectRef
} = require("./ees-database-environment.cjs");

const FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF = EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE;
const FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF = EES_PRODUCTION_SUPABASE_PROJECT_REF;
const FINANCE_MIGRATION_TARGET_ENV = "EES_FINANCE_MIGRATION_TARGET";
const FINANCE_MIGRATION_MODE_ENV = "EES_FINANCE_MIGRATION_MODE";
const FINANCE_MIGRATION_ENV_FILE_ENV = "EES_FINANCE_MIGRATION_ENV_FILE";

class FinanceMigrationEnvironmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FinanceMigrationEnvironmentError";
    this.code = code;
  }
}

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

function norm(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeEnvFilePath(raw) {
  return String(raw).replace(/\\/g, "/").replace(/^\.\//, "");
}

function isForbiddenFinanceMigrationEnvFile(envFile) {
  if (!envFile) return false;
  const normalized = normalizeEnvFilePath(envFile).toLowerCase();
  const base = normalized.split("/").pop() || normalized;
  if (FORBIDDEN_ENV_FILES.has(normalized) || FORBIDDEN_ENV_FILES.has(base)) return true;
  if (base === ".env.local" || normalized.endsWith("/.env.local")) return true;
  if (normalized.includes("vercel.prod") || normalized.includes("vercel-preview")) return true;
  return false;
}

function parseFinanceMigrationMode(raw) {
  const value = (norm(raw) || "dry-run").toLowerCase();
  if (value === "dry-run" || value === "dryrun" || value === "dry_run") return "dry-run";
  if (value === "read-only" || value === "readonly" || value === "read_only") return "read-only";
  if (value === "apply" || value === "write" || value === "migrate") return "apply";
  throw new FinanceMigrationEnvironmentError(
    "FINANCE_MIGRATION_MODE_INVALID",
    "Finance migration mode must be dry-run, read-only, or apply (received unsupported value)."
  );
}

function assertFinanceMigrationEnvironment(input = {}) {
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

  const accidentalUrl = norm(input.accidentalLocalUrl);
  const accidentalRef =
    (norm(input.accidentalLocalRef) || "").toLowerCase() ||
    (accidentalUrl ? extractSupabaseProjectRef(accidentalUrl) : null);
  if (accidentalRef === FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF) {
    throw new FinanceMigrationEnvironmentError(
      "FINANCE_MIGRATION_ENV_LOCAL_FALLBACK_REFUSED",
      "Detected production identity from a .env.local / default process.env fallback path. Finance migration tools must use an explicit staging env file only."
    );
  }

  const mode = parseFinanceMigrationMode(input.migrationMode);
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
    dryRun: true,
    applyAllowed: false,
    productionRefBlocked: FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF,
    requiredDevelopmentRef: FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF
  };
}

function financeMigrationEnvFromDict(environment, options = {}) {
  const envFile =
    options.envFile ??
    environment[FINANCE_MIGRATION_ENV_FILE_ENV] ??
    environment.EES_FINANCE_MIGRATION_ENV_FILE ??
    null;
  const input = {
    migrationTarget: environment[FINANCE_MIGRATION_TARGET_ENV] ?? environment.EES_FINANCE_MIGRATION_TARGET,
    migrationMode: environment[FINANCE_MIGRATION_MODE_ENV] ?? environment.EES_FINANCE_MIGRATION_MODE,
    envFile,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    approvedStagingRef: environment.EES_APPROVED_STAGING_PROJECT_REF
  };
  if (options.includeAccidentalLocalProbe) {
    input.accidentalLocalUrl = environment.EES_FINANCE_ACCIDENTAL_LOCAL_URL;
    input.accidentalLocalRef = environment.EES_FINANCE_ACCIDENTAL_LOCAL_REF;
  }
  return input;
}

function financeMigrationEnvSummary(resolution) {
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

module.exports = {
  FINANCE_MIGRATION_REQUIRED_DEVELOPMENT_REF,
  FINANCE_MIGRATION_BLOCKED_PRODUCTION_REF,
  FINANCE_MIGRATION_TARGET_ENV,
  FINANCE_MIGRATION_MODE_ENV,
  FINANCE_MIGRATION_ENV_FILE_ENV,
  FinanceMigrationEnvironmentError,
  isForbiddenFinanceMigrationEnvFile,
  parseFinanceMigrationMode,
  assertFinanceMigrationEnvironment,
  financeMigrationEnvFromDict,
  financeMigrationEnvSummary
};
