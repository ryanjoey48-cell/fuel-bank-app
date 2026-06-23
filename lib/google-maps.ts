export const GOOGLE_MAPS_SERVER_ENV = "GOOGLE_MAPS_API_KEY";
export const GOOGLE_MAPS_PUBLIC_ENV = "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY";
const GOOGLE_MAPS_SERVER_ALIASES = ["GOOGLE_MAPS_KEY"] as const;
const GOOGLE_MAPS_PUBLIC_ALIASES = ["NEXT_PUBLIC_GOOGLE_MAPS_KEY", "VITE_GOOGLE_MAPS_API_KEY"] as const;

export type GoogleMapsHealthStatus = {
  hasPublicKey: boolean;
  hasServerKey: boolean;
  scriptLoaded: boolean;
  placesAvailable: boolean;
  directionsAvailable: boolean;
  depotConfigured: boolean;
  publicSource: string | null;
  serverSource: string | null;
  legacyPublicSource: string | null;
  legacyServerSource: string | null;
  missingPublicVariables: string[];
  missingServerVariables: string[];
  errorCode: string | null;
  errorMessage: string | null;
};

function firstEnvValue(names: readonly string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return { name, value };
    }
  }

  return { name: null, value: "" };
}

export function getGoogleMapsEnvironmentStatus() {
  const server = firstEnvValue([GOOGLE_MAPS_SERVER_ENV]);
  const publicKey = firstEnvValue([GOOGLE_MAPS_PUBLIC_ENV]);
  const legacyServer = firstEnvValue(GOOGLE_MAPS_SERVER_ALIASES);
  const legacyPublic = firstEnvValue(GOOGLE_MAPS_PUBLIC_ALIASES);

  return {
    hasServerKey: Boolean(server.value),
    hasPublicKey: Boolean(publicKey.value),
    serverSource: server.name,
    publicSource: publicKey.name,
    legacyServerSource: legacyServer.name,
    legacyPublicSource: legacyPublic.name,
    missingServerVariables: server.value ? [] : [GOOGLE_MAPS_SERVER_ENV],
    missingPublicVariables: publicKey.value ? [] : [GOOGLE_MAPS_PUBLIC_ENV],
    requiredVariables: [GOOGLE_MAPS_PUBLIC_ENV, GOOGLE_MAPS_SERVER_ENV],
    acceptedAliases: [...GOOGLE_MAPS_SERVER_ALIASES, ...GOOGLE_MAPS_PUBLIC_ALIASES]
  };
}

export function getServerGoogleMapsApiKey() {
  return firstEnvValue([GOOGLE_MAPS_SERVER_ENV]).value;
}

export function getClientGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
}

export function getClientGoogleMapsConfig() {
  const publicKey = {
    name: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? GOOGLE_MAPS_PUBLIC_ENV : null,
    value: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""
  };
  const legacyPublic = firstEnvValue(GOOGLE_MAPS_PUBLIC_ALIASES);

  return {
    hasKey: Boolean(publicKey.value),
    key: publicKey.value,
    source: publicKey.name,
    legacySource: legacyPublic.name,
    missingVariable: publicKey.value ? null : GOOGLE_MAPS_PUBLIC_ENV
  };
}

const GOOGLE_MAPS_ERROR_MESSAGES: Record<string, string> = {
  MissingKeyMapError: `Missing ${GOOGLE_MAPS_PUBLIC_ENV}.`,
  InvalidKeyMapError: "Google Maps API key is invalid.",
  RefererNotAllowedMapError: "Google Maps API key referrer is not allowed for this domain.",
  BillingNotEnabledMapError: "Google Maps billing is not enabled for this project.",
  ApiNotActivatedMapError: "Required Google Maps API is not activated for this key.",
  OverQueryLimit: "Google Maps API quota exceeded.",
  OVER_QUERY_LIMIT: "Google Maps API quota exceeded.",
  REQUEST_DENIED: "Google Maps request denied. Check API key restrictions and enabled APIs.",
  RequestDenied: "Google Maps request denied. Check API key restrictions and enabled APIs.",
  ZERO_RESULTS: "Google Maps found no route for these locations.",
  NOT_FOUND: "Google Maps could not find one of these locations."
};

export function getGoogleMapsErrorMessage(errorCode: string | null | undefined, fallback?: string | null) {
  if (!errorCode) {
    return fallback || null;
  }

  return GOOGLE_MAPS_ERROR_MESSAGES[errorCode] || fallback || errorCode;
}

export function extractGoogleMapsErrorCode(message: string | null | undefined) {
  const text = String(message ?? "");
  return Object.keys(GOOGLE_MAPS_ERROR_MESSAGES).find((code) => text.includes(code)) ?? null;
}

export function createGoogleMapsStatus(partial: Partial<GoogleMapsHealthStatus> = {}): GoogleMapsHealthStatus {
  const env = getGoogleMapsEnvironmentStatus();
  const hasPublicKey = partial.hasPublicKey ?? env.hasPublicKey;
  const errorCode =
    partial.errorCode ??
    (!hasPublicKey ? "MissingPublicKey" : null);
  const errorMessage =
    partial.errorMessage ??
    (errorCode === "MissingPublicKey"
      ? `Missing ${GOOGLE_MAPS_PUBLIC_ENV}`
      : errorCode === "MissingServerKey"
        ? `Missing ${GOOGLE_MAPS_SERVER_ENV}`
        : null);

  return {
    hasPublicKey,
    hasServerKey: env.hasServerKey,
    scriptLoaded: false,
    placesAvailable: false,
    directionsAvailable: false,
    depotConfigured: false,
    publicSource: env.publicSource,
    serverSource: env.serverSource,
    legacyPublicSource: env.legacyPublicSource,
    legacyServerSource: env.legacyServerSource,
    missingPublicVariables: env.missingPublicVariables,
    missingServerVariables: env.missingServerVariables,
    errorCode,
    errorMessage,
    ...partial
  };
}
