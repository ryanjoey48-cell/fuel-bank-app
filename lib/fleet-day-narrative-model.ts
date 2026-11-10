/**
 * V7.8.4 one shared model for the Daily Activity operating day. Pure and read-only. The operating summary at the top of the day and the
 * narrative below it (timeline, coverage, provider total, cross-midnight) used to compute the same figures twice and show them twice. They now
 * read this model, so a number can only exist in one version. It adds no rule: it composes the chronology, coverage, provider-total and
 * cross-midnight modules over data the user already loaded.
 */
import { fleetDayChronology, type Chronology } from "./fleet-day-chronology";
import { coverageTruth, type CoverageTruth } from "./fleet-coverage-truth";
import { explainProviderTotal, type ProviderTotalExplanation } from "./fleet-provider-withhold";
import { detectCrossMidnight, type CrossMidnight, type CrossMidnightDay } from "./fleet-cross-midnight";
import type { JourneyLedger } from "./fleet-journey-ledger";
import type { ProviderDay } from "./fleet-intelligence-day";
import type { ChronoVisit } from "./fleet-day-chronology";
import type { ReviewItem } from "./fleet-day-review-copy";
export { reviewItemText, type ReviewItem } from "./fleet-day-review-copy";

/** Adapts a read provider day to the cross-midnight input (journeys and GPS timeline only: no coordinates). */
export function crossMidnightDay(provider: ProviderDay | null): CrossMidnightDay | null {
  if (!provider) return null;
  const ledger = (provider.journeyLedger as JourneyLedger | null | undefined) ?? null;
  return { day: provider.day, journeys: (ledger?.journeys ?? []).map(j => ({ id: j.id, start: j.start, end: j.end, kind: j.kind, providerKm: j.providerKm })), gps: provider.logAvailable ? provider.gps.timeline : null };
}

export type DayNarrativeModel = {
  chrono: Chronology; coverage: CoverageTruth; total: ProviderTotalExplanation;
  endBoundary: CrossMidnight; startBoundary: CrossMidnight | null;
  ledger: JourneyLedger;
  /** Short, ordered reasons the office should look at this day. Codes, not text: the caller localises them. */
  review: ReviewItem[];
};
export function buildDayNarrativeModel(input: { day: string; provider: ProviderDay | null; visits: readonly ChronoVisit[] | null; previousDay: ProviderDay | null; nextDay: ProviderDay | null; nowMs?: number }): DayNarrativeModel | null {
  const { provider } = input;
  const ledger = (provider?.journeyLedger as JourneyLedger | null | undefined) ?? null;
  if (!provider || !ledger) return null;
  const chrono = fleetDayChronology({ day: input.day, nowMs: input.nowMs, journeys: ledger.journeys, gps: provider.logAvailable ? provider.gps.timeline : null, visits: input.visits ?? [], providerLogGaps: ledger.missing, noSpacingOverTenMinutes: ledger.missing.length === 0 });
  const coverage = coverageTruth({
    day: input.day, nowMs: input.nowMs, receivedPositions: provider.gps.observations, verifiedPositions: provider.gps.verifiedObservations, gpsTimeline: provider.logAvailable ? provider.gps.timeline : null,
    ledger: { missingCount: ledger.missing.length, missingMinutes: ledger.totals.missingMinutes, cadenceJitterGaps: ledger.totals.cadenceJitterGaps, openFinal: ledger.totals.openFinal },
    provider: { read: true, reconciled: provider.provider.arithmetic.status === "pass", issues: provider.provider.issues }
  });
  const total = explainProviderTotal({
    read: true, arithmeticStatus: provider.provider.arithmetic.status, arithmeticReason: provider.provider.arithmetic.reason, assertedTotalKm: provider.provider.providerAssertedTotalKm,
    segments: provider.provider.segments, issues: provider.provider.issues, duplicates: provider.provider.duplicates, foreignRows: provider.provider.foreignRows,
    reportedTrailKm: ledger.totals.reportedTrailKm ?? null, gpsKm: provider.sources.gpsDerived.value
  });
  // Continuity across both boundaries of this day, from days already read. Never requests anything.
  const endBoundary = detectCrossMidnight(crossMidnightDay(provider), input.nextDay ? crossMidnightDay(input.nextDay) : null, input.day);
  const startBoundary = input.previousDay ? detectCrossMidnight(crossMidnightDay(input.previousDay), crossMidnightDay(provider), input.previousDay.day) : null;
  const review: ReviewItem[] = [];
  if (total.state === "withheld") review.push({ code: "provider_withheld" });
  if (endBoundary.status === "continuation_observed" || startBoundary?.status === "continuation_observed") review.push({ code: "cross_midnight" });
  if (chrono.overlaps.sourcesDisagree > 0) review.push({ code: "sources_disagree_in_visits", count: chrono.overlaps.sourcesDisagree });
  if (coverage.time && coverage.time.long.intervals > 0) review.push({ code: "long_unobserved", count: coverage.time.long.intervals });
  if (ledger.totals.ambiguousJourneys > 0) review.push({ code: "ambiguous_segments", count: ledger.totals.ambiguousJourneys });
  return { chrono, coverage, total, endBoundary, startBoundary, ledger, review };
}

/** What the operating summary adds to the headline strip: time coverage and the review reasons. Null while the day has no journey analysis. */
export type OperatingSummary = { timeSupportedPct: number | null; inProgress: boolean; providerState: "reconciled" | "withheld" | "not_read"; unobservedMinutes: number | null; review: ReviewItem[] };
export function operatingSummaryOf(model: DayNarrativeModel | null): OperatingSummary | null {
  if (!model) return null;
  return { timeSupportedPct: model.coverage.time ? model.coverage.time.supportedPct : null, inProgress: model.coverage.inProgress, providerState: model.coverage.provider.state, unobservedMinutes: model.coverage.time ? Math.round(model.coverage.time.unobservedSeconds / 60) : null, review: model.review };
}
