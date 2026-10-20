import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidCoordinates, type LocationPinType } from "@/lib/locations-directory";
import type { GeoapifyCandidate } from "@/lib/location-geocoding";

const TOKEN_LIFETIME_MS = 15 * 60 * 1000;

type ConfirmationPayload = {
  actorId: string;
  locationId: string;
  pinType: LocationPinType;
  latitude: number;
  longitude: number;
  placeId: string | null;
  candidateId: string;
  attribution: string;
  license: string | null;
  dataSource: string | null;
  expiresAt: number;
};

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function signGeoapifyCandidate(
  candidate: GeoapifyCandidate,
  input: { actorId: string; locationId: string; pinType: LocationPinType },
  secret: string,
  now = Date.now()
) {
  if (!secret || !isValidCoordinates(candidate.latitude, candidate.longitude)) throw new Error("Cannot sign an invalid geocoding candidate.");
  const payload: ConfirmationPayload = {
    actorId: input.actorId,
    locationId: input.locationId,
    pinType: input.pinType,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    placeId: candidate.placeId,
    candidateId: candidate.id,
    attribution: candidate.attribution,
    license: candidate.license,
    dataSource: candidate.dataSource,
    expiresAt: now + TOKEN_LIFETIME_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyGeoapifyConfirmationToken(
  token: unknown,
  expected: { actorId: string; locationId: string; pinType: LocationPinType },
  secret: string,
  now = Date.now()
): ConfirmationPayload | null {
  if (typeof token !== "string" || token.length > 8192 || !secret) return null;
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra !== undefined) return null;
  if (!safeEqual(signature(encodedPayload, secret), suppliedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<ConfirmationPayload>;
    if (payload.actorId !== expected.actorId || payload.locationId !== expected.locationId || payload.pinType !== expected.pinType) return null;
    if (!isValidCoordinates(payload.latitude, payload.longitude) || !Number.isFinite(payload.expiresAt) || (payload.expiresAt ?? 0) < now) return null;
    if (typeof payload.candidateId !== "string" || !payload.candidateId || typeof payload.attribution !== "string" || !payload.attribution) return null;
    if (payload.placeId !== null && typeof payload.placeId !== "string") return null;
    if (payload.license !== null && typeof payload.license !== "string") return null;
    if (payload.dataSource !== null && typeof payload.dataSource !== "string") return null;
    return payload as ConfirmationPayload;
  } catch {
    return null;
  }
}

export function geoapifySourceReference(payload: ConfirmationPayload) {
  return JSON.stringify({
    provider: "Geoapify Geocoding",
    place_id: payload.placeId,
    attribution: payload.attribution,
    license: payload.license,
    data_source: payload.dataSource
  });
}
