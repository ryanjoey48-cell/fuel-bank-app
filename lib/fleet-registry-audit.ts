/** Read-only classification of EES registry rows. It never merges, renames, deletes or reassigns anything. */
export type RegistryRow = { id: string; vehicle_reg: string; active?: boolean | null; vehicle_type?: string | null; vehicle_name?: string | null; created_at?: string | null };
export type RegistryReferences = { fuelLogs: number | null; weeklyMileage: number | null; bookings: number | null };
export type RegistryClass = "confirmed_active" | "inactive_historical" | "duplicate_candidate" | "test_candidate" | "unresolved";
export type RegistryFinding = { vehicleId: string; registration: string; classification: RegistryClass; reasons: string[]; forthTracked: boolean; active: boolean | null; references: RegistryReferences; duplicateGroup: string | null; aliasSource: boolean };

const key = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
/** A registration that is only a short digit run, with no Thai province prefix or dash, looks like a placeholder. */
const placeholderLike = (reg: string) => /^\d{3,6}$/.test(reg.trim());

export function classifyRegistry(input: { rows: readonly RegistryRow[]; trackedRegistrations: ReadonlySet<string>; references: ReadonlyMap<string, RegistryReferences>; aliasSources: ReadonlySet<string> }): RegistryFinding[] {
  const groups = new Map<string, RegistryRow[]>();
  for (const r of input.rows) groups.set(key(r.vehicle_reg), [...(groups.get(key(r.vehicle_reg)) ?? []), r]);
  return input.rows.map(row => {
    const k = key(row.vehicle_reg), tracked = input.trackedRegistrations.has(k), refs = input.references.get(row.id) ?? { fuelLogs: null, weeklyMileage: null, bookings: null };
    const known = [refs.fuelLogs, refs.weeklyMileage, refs.bookings].filter((n): n is number => n !== null);
    const anyRefs = known.some(n => n > 0), refsKnown = known.length === 3;
    const active: boolean | null = typeof row.active === "boolean" ? row.active : null;
    const dup = (groups.get(k)?.length ?? 0) > 1;
    const reasons: string[] = [];
    let classification: RegistryClass = "unresolved";
    if (dup) { classification = "duplicate_candidate"; reasons.push(`registration_shared_by_${groups.get(k)!.length}_rows`); }
    else if (placeholderLike(row.vehicle_reg) && !tracked && refsKnown && !anyRefs) { classification = "test_candidate"; reasons.push("placeholder_style_registration", "not_in_live_gps_fleet", "no_fuel_weekly_or_booking_references"); }
    else if (active === false) { classification = "inactive_historical"; reasons.push("marked_inactive"); }
    else if (tracked) { classification = "confirmed_active"; reasons.push("matches_live_gps_vehicle"); if (active === null) reasons.push("active_flag_not_available"); }
    else { reasons.push(tracked ? "tracked_but_status_unclear" : "not_in_live_gps_fleet"); if (anyRefs) reasons.push("has_historical_references"); if (!refsKnown) reasons.push("reference_counts_incomplete"); }
    if (input.aliasSources.has(k)) reasons.push("is_alias_source_registration");
    return { vehicleId: row.id, registration: row.vehicle_reg, classification, reasons, forthTracked: tracked, active, references: refs, duplicateGroup: dup ? k : null, aliasSource: input.aliasSources.has(k) };
  });
}

/** Display-only status for report filtering. Unknown stays "unknown"; nothing is inferred as inactive. */
export function registryStatuses(rows: readonly { id: string; vehicle_reg: string; active?: boolean | null }[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r.vehicle_reg), (counts.get(key(r.vehicle_reg)) ?? 0) + 1);
  return new Map(rows.map(r => [r.id, (counts.get(key(r.vehicle_reg)) ?? 0) > 1 ? "duplicate" as const : r.active === false ? "inactive" as const : r.active === true ? "active" as const : "unknown" as const]));
}

export function registryCounts(findings: readonly RegistryFinding[]) {
  const by: Record<RegistryClass, number> = { confirmed_active: 0, inactive_historical: 0, duplicate_candidate: 0, test_candidate: 0, unresolved: 0 };
  for (const f of findings) by[f.classification]++;
  return by;
}
