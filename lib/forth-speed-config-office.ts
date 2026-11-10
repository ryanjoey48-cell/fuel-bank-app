/**
 * @deprecated V12.1 — browser-local reviews were replaced by shared Supabase
 * tables + `/api/admin/forth-tracking/speed-config`.
 * Kept only so older imports fail closed instead of writing browser storage.
 */

export const FORTH_SPEED_CONFIG_OFFICE_STORAGE_KEY = "ees.forth-speed-config.office-reviews.v1.retired";

export type ForthSpeedConfigOfficeReview = {
  registrationKey: string;
  status: "office_confirmed" | "conflict";
  note: string;
  updatedAt: string;
  updatedByLabel: string;
};

export function readForthSpeedConfigOfficeReviews(): ForthSpeedConfigOfficeReview[] {
  return [];
}

export function writeForthSpeedConfigOfficeReview(_input: {
  registrationKey: string;
  status: "office_confirmed" | "conflict";
  note?: string;
  updatedByLabel?: string;
}): ForthSpeedConfigOfficeReview[] {
  throw new Error("Browser-local speed-config reviews are retired. Use the shared EES speed-config API.");
}

export function clearForthSpeedConfigOfficeReview(_registrationKey: string): ForthSpeedConfigOfficeReview[] {
  throw new Error("Browser-local speed-config reviews are retired. Use the shared EES speed-config API.");
}
