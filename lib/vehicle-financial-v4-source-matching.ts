import sourceVehicleMappings from "../data/vehicle-performance-v4/source-vehicle-mappings.json";
import {
  formatVehicleRegistrationDisplay,
  knownVehicleRegistrationAliases,
  vehicleRegistrationIdentityKey
} from "@/lib/vehicle-identity";

export type V4SourceVehicleMapping = {
  sourceRegistration: string;
  canonicalRegistration: string;
  canonicalVehicleId: string;
  sourceAliases: string[];
  ownerConfirmed: boolean;
  reason: string;
  ignoredDuplicateVehicleIds?: string[];
};

export type V4SourceVehicleMatchStatus = "matched" | "ambiguous" | "missing";

export type V4SourceVehicleMatch = {
  status: V4SourceVehicleMatchStatus;
  sourceRegistration: string;
  displayRegistration: string;
  canonicalRegistration: string | null;
  vehicleId: string | null;
  candidateVehicleIds: string[];
  mappingApplied: boolean;
  ownerConfirmed: boolean;
  note: string | null;
};

type VehicleCandidate = { id: string; vehicle_reg: string };

const mappings = (sourceVehicleMappings.mappings ?? []) as V4SourceVehicleMapping[];

function mappingLookupKey(value: string | null | undefined) {
  return vehicleRegistrationIdentityKey(value);
}

const mappingsBySourceKey = new Map<string, V4SourceVehicleMapping>();
for (const mapping of mappings) {
  mappingsBySourceKey.set(mappingLookupKey(mapping.sourceRegistration), mapping);
  for (const alias of mapping.sourceAliases ?? []) {
    mappingsBySourceKey.set(mappingLookupKey(alias), mapping);
  }
}

export function listV4SourceVehicleMappings() {
  return mappings.slice();
}

export function findV4SourceVehicleMapping(sourceRegistration: string | null | undefined) {
  const key = mappingLookupKey(sourceRegistration);
  if (!key) return null;
  return mappingsBySourceKey.get(key) ?? null;
}

/**
 * Resolve a V4 source-report registration to an EES vehicle.
 * Explicit owner-confirmed mappings win. Otherwise exact/alias identity matching is used.
 * Never applies a general last-four-digits rule.
 */
export function resolveV4SourceVehicleMatch(
  sourceRegistration: string | null | undefined,
  vehicles: VehicleCandidate[]
): V4SourceVehicleMatch {
  const sourceDisplay = formatVehicleRegistrationDisplay(sourceRegistration);
  const empty: V4SourceVehicleMatch = {
    status: "missing",
    sourceRegistration: sourceDisplay,
    displayRegistration: sourceDisplay,
    canonicalRegistration: null,
    vehicleId: null,
    candidateVehicleIds: [],
    mappingApplied: false,
    ownerConfirmed: false,
    note: null
  };
  if (!sourceDisplay) return empty;

  const explicit = findV4SourceVehicleMapping(sourceDisplay);
  if (explicit) {
    const ignored = new Set(explicit.ignoredDuplicateVehicleIds ?? []);
    const preferred = vehicles.find((vehicle) => vehicle.id === explicit.canonicalVehicleId) ?? null;
    const sameRegistration = vehicles.filter((vehicle) => {
      if (ignored.has(vehicle.id)) return false;
      return mappingLookupKey(vehicle.vehicle_reg) === mappingLookupKey(explicit.canonicalRegistration);
    });
    const candidates = preferred
      ? [preferred, ...sameRegistration.filter((vehicle) => vehicle.id !== preferred.id)]
      : sameRegistration;

    if (preferred || candidates.length === 1 || candidates.some((vehicle) => vehicle.id === explicit.canonicalVehicleId)) {
      return {
        status: "matched",
        sourceRegistration: sourceDisplay,
        displayRegistration: formatVehicleRegistrationDisplay(explicit.canonicalRegistration),
        canonicalRegistration: explicit.canonicalRegistration,
        vehicleId: preferred?.id ?? explicit.canonicalVehicleId,
        candidateVehicleIds: candidates.map((vehicle) => vehicle.id),
        mappingApplied: true,
        ownerConfirmed: explicit.ownerConfirmed === true,
        note: explicit.reason
      };
    }

    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        sourceRegistration: sourceDisplay,
        displayRegistration: formatVehicleRegistrationDisplay(explicit.canonicalRegistration),
        canonicalRegistration: explicit.canonicalRegistration,
        vehicleId: null,
        candidateVehicleIds: candidates.map((vehicle) => vehicle.id),
        mappingApplied: true,
        ownerConfirmed: explicit.ownerConfirmed === true,
        note: explicit.reason
      };
    }

    return {
      ...empty,
      displayRegistration: formatVehicleRegistrationDisplay(explicit.canonicalRegistration),
      canonicalRegistration: explicit.canonicalRegistration,
      mappingApplied: true,
      ownerConfirmed: explicit.ownerConfirmed === true,
      note: explicit.reason
    };
  }

  const aliasKeys = new Set(
    knownVehicleRegistrationAliases(sourceDisplay).map((alias) => mappingLookupKey(alias)).filter(Boolean)
  );
  const matchedVehicles = vehicles.filter((vehicle) => {
    const vehicleKeys = new Set(
      [vehicle.vehicle_reg, ...knownVehicleRegistrationAliases(vehicle.vehicle_reg)]
        .map((alias) => mappingLookupKey(alias))
        .filter(Boolean)
    );
    for (const key of aliasKeys) if (vehicleKeys.has(key)) return true;
    return false;
  });
  const uniqueIds = [...new Set(matchedVehicles.map((vehicle) => vehicle.id))];
  const uniqueRegistrations = [
    ...new Set(matchedVehicles.map((vehicle) => mappingLookupKey(vehicle.vehicle_reg)).filter(Boolean))
  ];

  if (uniqueIds.length === 1) {
    const vehicle = matchedVehicles[0];
    return {
      status: "matched",
      sourceRegistration: sourceDisplay,
      displayRegistration: formatVehicleRegistrationDisplay(vehicle.vehicle_reg),
      canonicalRegistration: formatVehicleRegistrationDisplay(vehicle.vehicle_reg),
      vehicleId: vehicle.id,
      candidateVehicleIds: uniqueIds,
      mappingApplied: false,
      ownerConfirmed: false,
      note: null
    };
  }

  if (uniqueIds.length > 1) {
    return {
      status: "ambiguous",
      sourceRegistration: sourceDisplay,
      displayRegistration: sourceDisplay,
      canonicalRegistration: uniqueRegistrations.length === 1
        ? formatVehicleRegistrationDisplay(matchedVehicles[0]?.vehicle_reg)
        : null,
      vehicleId: null,
      candidateVehicleIds: uniqueIds,
      mappingApplied: false,
      ownerConfirmed: false,
      note: uniqueRegistrations.length === 1
        ? "Multiple vehicle directory rows share this registration; no explicit V4 mapping is available."
        : "Registration matches more than one vehicle identity."
    };
  }

  return empty;
}
