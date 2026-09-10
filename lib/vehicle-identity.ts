import { normalizeComparableText, normalizeVehicleRegistration } from "@/lib/utils";

export type VehicleRegistrationCorrection = {
  oldRegistration: string;
  canonicalRegistration: string;
  reason: string;
};

export const VEHICLE_REGISTRATION_CORRECTIONS: VehicleRegistrationCorrection[] = [
  {
    oldRegistration: "9565",
    canonicalRegistration: "3ฒน-9565",
    reason: "Buew registration corrected from abbreviated to full Thai registration."
  },
  {
    oldRegistration: "4565",
    canonicalRegistration: "3ฒล-4565",
    reason: "G registration corrected from abbreviated to full Thai registration."
  },
  {
    oldRegistration: "8453",
    canonicalRegistration: "ฒอ-8453",
    reason: "Oil registration corrected from abbreviated to full Thai registration."
  },
  {
    oldRegistration: "100-6659",
    canonicalRegistration: "700-6659",
    reason: "Confirmed historical registration alias for Soh; 700-6659 is the canonical vehicle registration."
  }
];

export function vehicleRegistrationIdentityKey(value: string | null | undefined) {
  return normalizeComparableText(normalizeVehicleRegistration(value));
}

const VEHICLE_REGISTRATION_CORRECTION_BY_OLD = new Map(
  VEHICLE_REGISTRATION_CORRECTIONS.map((mapping) => [
    vehicleRegistrationIdentityKey(mapping.oldRegistration),
    normalizeVehicleRegistration(mapping.canonicalRegistration)
  ])
);

export function canonicalizeKnownVehicleRegistration(
  value: string | null | undefined,
  vehicleLookup?: Map<string, string>
) {
  const normalized = normalizeVehicleRegistration(value);
  const key = vehicleRegistrationIdentityKey(normalized);
  if (!key) return "";

  const directMatch = vehicleLookup?.get(key);
  if (directMatch) return directMatch;

  const canonical = VEHICLE_REGISTRATION_CORRECTION_BY_OLD.get(key) ?? normalized;
  const canonicalKey = vehicleRegistrationIdentityKey(canonical);
  return vehicleLookup?.get(canonicalKey) ?? canonical;
}

export function knownVehicleRegistrationAliases(value: string | null | undefined) {
  const canonical = canonicalizeKnownVehicleRegistration(value);
  const canonicalKey = vehicleRegistrationIdentityKey(canonical);
  const aliases = new Set<string>();

  if (canonical) aliases.add(canonical);

  for (const mapping of VEHICLE_REGISTRATION_CORRECTIONS) {
    if (vehicleRegistrationIdentityKey(mapping.canonicalRegistration) === canonicalKey) {
      aliases.add(normalizeVehicleRegistration(mapping.oldRegistration));
      aliases.add(normalizeVehicleRegistration(mapping.canonicalRegistration));
    }
  }

  return Array.from(aliases);
}
