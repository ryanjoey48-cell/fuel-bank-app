import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** Allowlisted months for the narrow Release B source-import window. */
export const VEHICLE_FINANCIAL_V4_AUTHORISED_IMPORT_MONTHS = ["2026-08", "2026-09"] as const;

export type AuthorisedImportMonth = (typeof VEHICLE_FINANCIAL_V4_AUTHORISED_IMPORT_MONTHS)[number];

/**
 * Narrow import gate for Release B.
 * Independent from VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED so general draft/upload
 * endpoints can remain locked while a one-time Aug/Sep import is authorised.
 */
export function isVehicleFinancialV4AuthorisedSourceImportEnabled(): boolean {
  return process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT === "true";
}

export function isAuthorisedImportMonth(month: string): month is AuthorisedImportMonth {
  return (VEHICLE_FINANCIAL_V4_AUTHORISED_IMPORT_MONTHS as readonly string[]).includes(month);
}

export function authorisedSourceImportTokenConfigured(): boolean {
  return Boolean(process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN?.trim());
}

export function authorisedSourceImportTokenMatches(headerValue: string | null): boolean {
  const expected = process.env.VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT_TOKEN?.trim() ?? "";
  if (!expected) return false;
  const provided = String(headerValue ?? "").trim();
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

export function disabledAuthorisedSourceImportResponse(reason: "disabled" | "token_required" | "month_not_allowed" = "disabled") {
  const messages = {
    disabled: "Authorised Aug/Sep source import is disabled for this environment.",
    token_required: "Authorised source import requires a valid one-time import token header.",
    month_not_allowed: "Only August and September 2026 authorised preview months may be imported through this endpoint."
  } as const;
  const codes = {
    disabled: "v4_authorised_source_import_disabled",
    token_required: "v4_authorised_source_import_token_required",
    month_not_allowed: "v4_authorised_source_import_month_not_allowed"
  } as const;
  return NextResponse.json({
    error: messages[reason],
    errorCode: codes[reason]
  }, {
    status: 403,
    headers: { "Cache-Control": "private, no-store, max-age=0" }
  });
}
