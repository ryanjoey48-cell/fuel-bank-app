/**
 * Read-only pricing verification helpers for the Finance admin workspace and migration rehearsal.
 * Never invents fuel prices or auto-approves imported rate schedules.
 */
import {
  CUSTOMER_RATE_SCHEDULES,
  activeRateMappings,
  diagnoseRate,
  fuelReferenceFor,
  fuelStatusOf,
  type Booking,
  type FuelReference,
  type RateMapping,
  type State
} from "@/lib/finance-demo-centre";

/** Finance operations cutover — older diary jobs are historical, not missing-fuel work. */
export const PRICING_OPERATIONAL_START = "2026-11-01";

export type PricingConflict = {
  clientId: string;
  mappingIds: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: "overlapping_effective_window";
};

export type PricingEffectiveGap = {
  jobId: string;
  clientId: string;
  client: string;
  date: string;
  workOrder: string;
  code: string;
  detail: string;
};

export type PricingVerificationReport = {
  missingFuelDates: string[];
  proposedFuel: FuelReference[];
  disputedFuel: FuelReference[];
  verifiedFuel: FuelReference[];
  /** Imported schedule rows with no owner-approved mapping yet (proposed candidates only). */
  unmappedScheduleRows: { scheduleId: string; scheduleName: string; rowId: string; route: string }[];
  proposedMappings: RateMapping[];
  approvedMappings: RateMapping[];
  conflicts: PricingConflict[];
  effectiveGaps: PricingEffectiveGap[];
  ambiguousJobs: PricingEffectiveGap[];
};

function mappingStatus(m: RateMapping): "proposed" | "approved" {
  return m.reviewStatus ?? "approved";
}

export function proposedRateMappings(state: State): RateMapping[] {
  return (state.rateMappings || []).filter((item) => !item.revokedAt && mappingStatus(item) === "proposed");
}

export function approvedRateMappings(state: State): RateMapping[] {
  return activeRateMappings(state);
}

function windowsOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  const aEnd = aTo || "9999-12-31";
  const bEnd = bTo || "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

/** Active approved mappings whose effective windows overlap for the same client + schedule row + match fingerprint. */
export function findRateMappingConflicts(state: State): PricingConflict[] {
  const approved = approvedRateMappings(state);
  const conflicts: PricingConflict[] = [];
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i];
      const b = approved[j];
      if (a.clientId !== b.clientId || a.scheduleId !== b.scheduleId || a.rowId !== b.rowId) continue;
      if (JSON.stringify(a.match ?? null) !== JSON.stringify(b.match ?? null)) continue;
      if (!windowsOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)) continue;
      conflicts.push({
        clientId: a.clientId,
        mappingIds: [a.id, b.id],
        effectiveFrom: a.effectiveFrom < b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom,
        effectiveTo: !a.effectiveTo || !b.effectiveTo ? null : a.effectiveTo < b.effectiveTo ? a.effectiveTo : b.effectiveTo,
        reason: "overlapping_effective_window"
      });
    }
  }
  return conflicts;
}

export function operationalJobDates(state: State): string[] {
  const dates = new Set<string>();
  for (const job of state.bookings as Booking[]) {
    if (job.date >= PRICING_OPERATIONAL_START || (state.billingSheets || []).some((s) => s.jobIds.includes(job.id))) {
      dates.add(job.date);
    }
  }
  return [...dates].sort();
}

export function missingVerifiedFuelDates(state: State): string[] {
  return operationalJobDates(state).filter((d) => {
    const ref = fuelReferenceFor(state, d);
    return !ref || fuelStatusOf(ref) !== "verified";
  });
}

export function buildPricingVerificationReport(state: State): PricingVerificationReport {
  const refs = (state.fuelReferences || []).filter((r) => !r.supersededAt);
  const approved = approvedRateMappings(state);
  const proposed = proposedRateMappings(state);
  const unmappedScheduleRows: PricingVerificationReport["unmappedScheduleRows"] = [];
  for (const schedule of CUSTOMER_RATE_SCHEDULES) {
    for (const row of schedule.rows) {
      const hasApproved = approved.some((m) => m.scheduleId === schedule.id && m.rowId === row.id);
      if (!hasApproved) {
        unmappedScheduleRows.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          rowId: row.id,
          route: `${row.pickup} → ${row.delivery}`
        });
      }
    }
  }

  const effectiveGaps: PricingEffectiveGap[] = [];
  const ambiguousJobs: PricingEffectiveGap[] = [];
  for (const job of state.bookings as Booking[]) {
    if (job.date < PRICING_OPERATIONAL_START && !(state.billingSheets || []).some((s) => s.jobIds.includes(job.id))) continue;
    const diagnosis = diagnoseRate(state, job);
    if (diagnosis.kind === "suggested") continue;
    const row: PricingEffectiveGap = {
      jobId: job.id,
      clientId: job.clientId,
      client: job.client,
      date: job.date,
      workOrder: job.returned?.workOrder || job.workOrder || job.id,
      code: diagnosis.code,
      detail: diagnosis.en
    };
    if (diagnosis.code === "ambiguous") ambiguousJobs.push(row);
    else if (diagnosis.code === "no_mapping" || diagnosis.code === "mapping_not_effective" || diagnosis.code === "route_mismatch") {
      effectiveGaps.push(row);
    }
  }

  return {
    missingFuelDates: missingVerifiedFuelDates(state),
    proposedFuel: refs.filter((r) => fuelStatusOf(r) === "proposed"),
    disputedFuel: refs.filter((r) => fuelStatusOf(r) === "disputed"),
    verifiedFuel: refs.filter((r) => fuelStatusOf(r) === "verified"),
    unmappedScheduleRows,
    proposedMappings: proposed,
    approvedMappings: approved,
    conflicts: findRateMappingConflicts(state),
    effectiveGaps,
    ambiguousJobs
  };
}
