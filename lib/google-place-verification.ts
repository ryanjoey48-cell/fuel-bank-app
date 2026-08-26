export type VerifiedGooglePlace = {
  placeId: string;
  displayName: string;
  fullGoogleAddress: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
};

type CachedPlace = {
  place: VerifiedGooglePlace;
  expiresAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

declare global {
  var __fuelBankVerifiedGooglePlaces: Map<string, CachedPlace> | undefined;
}

function cache() {
  globalThis.__fuelBankVerifiedGooglePlaces ??= new Map<string, CachedPlace>();
  return globalThis.__fuelBankVerifiedGooglePlaces;
}

function cacheKey(placeId: string) {
  return placeId.replace(/^places\//, "").trim();
}

export function rememberVerifiedGooglePlace(place: VerifiedGooglePlace) {
  const entries = cache();
  const key = cacheKey(place.placeId);
  if (!key) return;

  entries.set(key, { place: { ...place, placeId: key }, expiresAt: Date.now() + CACHE_TTL_MS });
  if (entries.size <= MAX_CACHE_ENTRIES) return;

  const oldest = entries.keys().next().value;
  if (oldest) entries.delete(oldest);
}

export function getRememberedVerifiedGooglePlace(placeId: string) {
  const entries = cache();
  const key = cacheKey(placeId);
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return { ...entry.place };
}
