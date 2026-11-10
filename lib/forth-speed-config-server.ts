/**
 * Server-side Forth speed-config review/audit helpers.
 * Owner-reported catalogue stays in lib/forth-speed-config.ts.
 * These helpers never call Forth or change tracker settings.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listForthSpeedDeviceConfigs,
  lookupForthSpeedConfig,
  type ForthSpeedDeviceConfig
} from "@/lib/forth-speed-config";
import { normalizeForthRegistration } from "@/lib/forth-tracking";

export type ForthSpeedConfigReviewStatus = "office_confirmed" | "conflict" | "cleared";

export type ForthSpeedConfigReviewRow = {
  registrationKey: string;
  registrationDisplay: string;
  reviewStatus: ForthSpeedConfigReviewStatus;
  note: string;
  ownerSpeedAlertKmh: number;
  ownerAlertDelaySeconds: number;
  independentlyVerified: boolean;
  source: "owner_forth_console" | "office_review";
  reviewedByUserId: string;
  reviewedByName: string;
  reviewedAt: string;
  updatedAt: string;
};

export type ForthSpeedConfigAuditRow = {
  id: string;
  registrationKey: string;
  registrationDisplay: string;
  action: ForthSpeedConfigReviewStatus | "note_update";
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
  source: "owner_forth_console" | "office_review";
  reason: string;
  reviewerUserId: string;
  reviewerName: string;
  createdAt: string;
};

export type ForthSpeedConfigOfficeAction = "office_confirmed" | "conflict" | "cleared";

type ReviewDbRow = {
  registration_key: string;
  registration_display: string;
  review_status: ForthSpeedConfigReviewStatus;
  note: string | null;
  owner_speed_alert_kmh: number;
  owner_alert_delay_seconds: number;
  independently_verified: boolean;
  source: "owner_forth_console" | "office_review";
  reviewed_by_user_id: string;
  reviewed_by_name: string;
  reviewed_at: string;
  updated_at: string;
};

type AuditDbRow = {
  id: string;
  registration_key: string;
  registration_display: string;
  action: ForthSpeedConfigReviewStatus | "note_update";
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  source: "owner_forth_console" | "office_review";
  reason: string | null;
  reviewer_user_id: string;
  reviewer_name: string;
  created_at: string;
};

function mapReview(row: ReviewDbRow): ForthSpeedConfigReviewRow {
  return {
    registrationKey: row.registration_key,
    registrationDisplay: row.registration_display,
    reviewStatus: row.review_status,
    note: row.note ?? "",
    ownerSpeedAlertKmh: row.owner_speed_alert_kmh,
    ownerAlertDelaySeconds: row.owner_alert_delay_seconds,
    independentlyVerified: row.independently_verified,
    source: row.source,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at
  };
}

function mapAudit(row: AuditDbRow): ForthSpeedConfigAuditRow {
  return {
    id: row.id,
    registrationKey: row.registration_key,
    registrationDisplay: row.registration_display,
    action: row.action,
    previousValue: row.previous_value,
    newValue: row.new_value,
    source: row.source,
    reason: row.reason ?? "",
    reviewerUserId: row.reviewer_user_id,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at
  };
}

function reviewSnapshot(row: ForthSpeedConfigReviewRow | null) {
  if (!row) return null;
  return {
    reviewStatus: row.reviewStatus,
    note: row.note,
    ownerSpeedAlertKmh: row.ownerSpeedAlertKmh,
    ownerAlertDelaySeconds: row.ownerAlertDelaySeconds,
    independentlyVerified: row.independentlyVerified,
    source: row.source,
    reviewedByName: row.reviewedByName,
    reviewedAt: row.reviewedAt
  };
}

export function resolveCatalogueConfig(registration: string): ForthSpeedDeviceConfig | null {
  return lookupForthSpeedConfig(registration);
}

export async function listForthSpeedConfigReviews(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("forth_speed_config_reviews")
    .select("*")
    .order("registration_key", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ReviewDbRow[]).map(mapReview);
}

export async function listForthSpeedConfigAudit(
  admin: SupabaseClient,
  options?: { registrationKey?: string; limit?: number }
) {
  let query = admin
    .from("forth_speed_config_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 200));
  if (options?.registrationKey) {
    query = query.eq("registration_key", options.registrationKey);
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as AuditDbRow[]).map(mapAudit);
}

export type ForthSpeedConfigCatalogueView = {
  config: ForthSpeedDeviceConfig;
  officeReview: ForthSpeedConfigReviewRow | null;
};

export async function buildForthSpeedConfigCatalogueView(admin: SupabaseClient): Promise<ForthSpeedConfigCatalogueView[]> {
  const reviews = await listForthSpeedConfigReviews(admin);
  const byKey = new Map(reviews.map((row) => [row.registrationKey, row]));
  return listForthSpeedDeviceConfigs().map((config) => ({
    config,
    officeReview: byKey.get(config.registrationKey) ?? null
  }));
}

export async function applyForthSpeedConfigOfficeAction(
  admin: SupabaseClient,
  input: {
    registrationKeyOrDisplay: string;
    action: ForthSpeedConfigOfficeAction;
    note?: string;
    reason?: string;
    reviewerUserId: string;
    reviewerName: string;
  }
) {
  const config = lookupForthSpeedConfig(input.registrationKeyOrDisplay);
  if (!config) {
    throw new Error("Registration is not in the owner-reported Forth speed-config catalogue.");
  }

  const registrationKey = config.registrationKey || normalizeForthRegistration(input.registrationKeyOrDisplay);
  const note = (input.note ?? "").trim().slice(0, 500);
  const reason = (input.reason?.trim() || note || `Office marked ${input.action.replaceAll("_", " ")}.`).slice(0, 500);
  const reviewerName = input.reviewerName.trim().slice(0, 120) || "Office";

  const { data: existingRaw, error: existingError } = await admin
    .from("forth_speed_config_reviews")
    .select("*")
    .eq("registration_key", registrationKey)
    .maybeSingle();
  if (existingError) throw existingError;
  const previous = existingRaw ? mapReview(existingRaw as ReviewDbRow) : null;

  if (input.action === "cleared") {
    if (previous) {
      const { error: deleteError } = await admin
        .from("forth_speed_config_reviews")
        .delete()
        .eq("registration_key", registrationKey);
      if (deleteError) throw deleteError;
    }
    const { error: auditError } = await admin.from("forth_speed_config_audit").insert({
      registration_key: registrationKey,
      registration_display: config.registrationDisplay,
      action: "cleared",
      previous_value: reviewSnapshot(previous),
      new_value: { reviewStatus: "cleared" },
      source: "office_review",
      reason,
      reviewer_user_id: input.reviewerUserId,
      reviewer_name: reviewerName
    });
    if (auditError) throw auditError;
    return { config, officeReview: null as ForthSpeedConfigReviewRow | null };
  }

  const payload = {
    registration_key: registrationKey,
    registration_display: config.registrationDisplay,
    review_status: input.action,
    note,
    owner_speed_alert_kmh: config.speedAlertKmh,
    owner_alert_delay_seconds: config.alertDelaySeconds,
    independently_verified: false,
    source: "office_review" as const,
    reviewed_by_user_id: input.reviewerUserId,
    reviewed_by_name: reviewerName,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data: upserted, error: upsertError } = await admin
    .from("forth_speed_config_reviews")
    .upsert(payload, { onConflict: "registration_key" })
    .select("*")
    .single();
  if (upsertError) throw upsertError;

  const next = mapReview(upserted as ReviewDbRow);
  const { error: auditError } = await admin.from("forth_speed_config_audit").insert({
    registration_key: registrationKey,
    registration_display: config.registrationDisplay,
    action: input.action,
    previous_value: reviewSnapshot(previous),
    new_value: reviewSnapshot(next),
    source: "office_review",
    reason,
    reviewer_user_id: input.reviewerUserId,
    reviewer_name: reviewerName
  });
  if (auditError) throw auditError;

  return { config, officeReview: next };
}
