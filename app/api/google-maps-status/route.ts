import {
  extractGoogleMapsErrorCode,
  getGoogleMapsEnvironmentStatus,
  getGoogleMapsErrorMessage,
  getServerGoogleMapsApiKey
} from "@/lib/google-maps";
import { createApiSuccess, parseJsonSafely } from "@/lib/http";

type GoogleStatusResponse = {
  status?: string;
  error_message?: string;
};

type ProbeResult = {
  ok: boolean;
  status: string;
  message: string | null;
};

const REQUIRED_APIS = [
  "Maps JavaScript API",
  "Places API",
  "Directions API"
];

async function probeGoogleEndpoint(url: URL): Promise<ProbeResult> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = await parseJsonSafely<GoogleStatusResponse>(response);
    const status = data.status || (response.ok ? "OK" : `HTTP_${response.status}`);
    const message =
      getGoogleMapsErrorMessage(status, data.error_message || null) ||
      data.error_message ||
      null;

    return {
      ok: response.ok && (status === "OK" || status === "ZERO_RESULTS"),
      status,
      message
    };
  } catch (error) {
    return {
      ok: false,
      status: "FETCH_FAILED",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runGoogleMapsProbe(apiKey: string | null) {
  if (!apiKey) {
    return {
      places: {
        ok: false,
        status: "MISSING_KEY",
        message: "Missing GOOGLE_MAPS_API_KEY."
      },
      directions: {
        ok: false,
        status: "MISSING_KEY",
        message: "Missing GOOGLE_MAPS_API_KEY."
      }
    };
  }

  const placesUrl = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  placesUrl.searchParams.set("input", "Bangkok");
  placesUrl.searchParams.set("language", "en");
  placesUrl.searchParams.set("components", "country:th");
  placesUrl.searchParams.set("key", apiKey);

  const directionsUrl = new URL("https://maps.googleapis.com/maps/api/directions/json");
  directionsUrl.searchParams.set("origin", "Suvarnabhumi Airport Bangkok");
  directionsUrl.searchParams.set("destination", "CentralWorld Bangkok");
  directionsUrl.searchParams.set("mode", "driving");
  directionsUrl.searchParams.set("language", "en");
  directionsUrl.searchParams.set("region", "th");
  directionsUrl.searchParams.set("key", apiKey);

  const [places, directions] = await Promise.all([
    probeGoogleEndpoint(placesUrl),
    probeGoogleEndpoint(directionsUrl)
  ]);

  return { places, directions };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shouldProbe = url.searchParams.get("probe") === "1";
  const env = getGoogleMapsEnvironmentStatus();
  const serverKey = getServerGoogleMapsApiKey();
  const probe = shouldProbe ? await runGoogleMapsProbe(serverKey || null) : null;
  const probeErrorCodes = probe
    ? [
        extractGoogleMapsErrorCode(probe.places.message),
        extractGoogleMapsErrorCode(probe.directions.message)
      ].filter(Boolean)
    : [];

  return Response.json(
    createApiSuccess({
      keys: {
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: {
          detected: env.hasPublicKey,
          source: env.publicSource,
          missing: env.missingPublicVariables
        },
        GOOGLE_MAPS_API_KEY: {
          detected: env.hasServerKey,
          source: env.serverSource,
          missing: env.missingServerVariables
        }
      },
      requiredApis: REQUIRED_APIS,
      notUsedApis: ["Distance Matrix API"],
      probe,
      probeErrorCodes
    })
  );
}
