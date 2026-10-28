import sourceAvailability from "../data/vehicle-performance-v4/source-availability.json";
import {
  findV4SourceVehicleMapping,
  listV4SourceVehicleMappings,
  resolveV4SourceVehicleMatch
} from "@/lib/vehicle-financial-v4-source-matching";

export const V4_REPORTING_MONTHS_2026 = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"
] as const;

export {
  findV4SourceVehicleMapping,
  listV4SourceVehicleMappings,
  resolveV4SourceVehicleMatch
};

export type V4ReportingMonth2026 = (typeof V4_REPORTING_MONTHS_2026)[number];

export type V4SourceMonthStatus =
  | "source_report_required"
  | "source_verified_readonly"
  | "source_verified_readonly_salary_provisional";

export type V4SourceMonthCatalogEntry = {
  reportingMonth: string;
  status: V4SourceMonthStatus;
  previewAvailable: boolean;
  legacyInventory: {
    recordCount: number;
    availableCategories: string[];
    missingCategories: string[];
    notes: string[];
  } | null;
  requiredFromOwner: string[];
  unresolvedFigures: string[];
  notes?: string[];
};

export type V4SourceAvailabilityCatalog = {
  standardColumns: string[];
  registrationReviewFlags: Array<{
    registration: string;
    reason: string;
    blocking: boolean;
    note: string;
  }>;
  lpgPolicy: {
    onlyVehicle: string;
    januaryToJuly: string;
    augustOnwards: string;
  };
  months: V4SourceMonthCatalogEntry[];
};

export const vehicleFinancialV4SourceAvailability = sourceAvailability as V4SourceAvailabilityCatalog;

export function registrationRequiresOwnerReview(registration: string) {
  return vehicleFinancialV4SourceAvailability.registrationReviewFlags.some(
    (flag) => flag.registration === registration && !flag.blocking
  );
}
