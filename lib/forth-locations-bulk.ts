/**
 * Pure bulk-review helpers for Forth → EES Directory drafts.
 * Bulk approve never confirms pins or activates geofences.
 */

import {
  buildForthImportApprovalPayload,
  type ForthLocationReconcileItem
} from "@/lib/forth-locations-import";

export type ForthBulkAction = "approve_drafts" | "skip" | "defer";

export type ForthBulkItemResult = {
  forthLocationId: string;
  status: "created" | "already_imported" | "skipped" | "deferred" | "rejected" | "failed";
  eesLocationId?: string | null;
  error?: string;
};

export function isBulkDraftEligible(item: ForthLocationReconcileItem): boolean {
  return item.classification === "NEW_LOCATION"
    && Boolean(item.record.name?.trim())
    && item.record.latitude != null
    && item.record.longitude != null
    && Boolean(item.proposedDirectory)
    && item.bulkEligible !== false;
}

export function previewForthBulkAction(
  items: readonly ForthLocationReconcileItem[],
  forthLocationIds: readonly string[],
  action: ForthBulkAction
) {
  const selected = forthLocationIds.map((id) => items.find((item) => item.record.forthLocationId === id) ?? null);
  const missingIds = forthLocationIds.filter((_, index) => !selected[index]);
  const found = selected.filter((item): item is ForthLocationReconcileItem => Boolean(item));
  if (action === "approve_drafts") {
    const eligible = found.filter(isBulkDraftEligible);
    const ineligible = found.filter((item) => !isBulkDraftEligible(item));
    return {
      action,
      requested: forthLocationIds.length,
      eligibleCount: eligible.length,
      ineligible: ineligible.map((item) => ({
        forthLocationId: item.record.forthLocationId,
        classification: item.classification,
        reason: item.classification === "POSSIBLE_DUPLICATE"
          ? "Possible duplicates require individual review."
          : item.classification === "REQUIRES_REVIEW"
            ? "Requires individual review."
            : item.classification === "MATCHED"
              ? "Already matched; use link instead of draft import."
              : "Not eligible for bulk draft import."
      })),
      missingIds,
      expectedCreates: eligible.map((item) => ({
        forthLocationId: item.record.forthLocationId,
        companyName: item.proposedDirectory!.companyName,
        category: item.suggestedCategory
      })),
      note: "Bulk approve creates needs_check Directory drafts only. Destination pins and geofences stay inactive."
    };
  }
  return {
    action,
    requested: forthLocationIds.length,
    eligibleCount: found.length,
    ineligible: [] as { forthLocationId: string; classification: string; reason: string }[],
    missingIds,
    expectedCreates: found.map((item) => ({
      forthLocationId: item.record.forthLocationId,
      companyName: item.record.name || item.record.forthLocationId,
      category: item.suggestedCategory
    })),
    note: action === "skip"
      ? "Skip marks candidates deferred from bulk import without creating Directory rows."
      : "Defer keeps candidates for later individual review without creating Directory rows."
  };
}

export function planForthBulkApprovals(
  items: readonly ForthLocationReconcileItem[],
  forthLocationIds: readonly string[],
  alreadyImportedIds: ReadonlySet<string>
): ForthBulkItemResult[] {
  const results: ForthBulkItemResult[] = [];
  for (const id of forthLocationIds) {
    if (alreadyImportedIds.has(id)) {
      results.push({ forthLocationId: id, status: "already_imported" });
      continue;
    }
    const item = items.find((candidate) => candidate.record.forthLocationId === id);
    if (!item) {
      results.push({ forthLocationId: id, status: "failed", error: "Forth location ID not found in export." });
      continue;
    }
    if (!isBulkDraftEligible(item)) {
      results.push({
        forthLocationId: id,
        status: "rejected",
        error: item.classification === "POSSIBLE_DUPLICATE"
          ? "Possible duplicates cannot be bulk-approved."
          : "Record is not eligible for bulk draft import."
      });
      continue;
    }
    try {
      buildForthImportApprovalPayload(item);
      results.push({ forthLocationId: id, status: "created" });
    } catch (error) {
      results.push({
        forthLocationId: id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}
