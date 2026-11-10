import type { supabase } from "@/lib/supabase";
import type { BookingDiaryEntry } from "@/types/database";

export type CandidateHold = "booking_missing" | "allocated" | "management_hold" | "paperwork_or_verification" | "price_missing" | "price_approval" | "expense_approval" | "booking_or_price_changed";
export type BillingCandidate = { booking: BookingDiaryEntry; ready: boolean; hold: CandidateHold | null; selling_price_thb: number | null; price_revision_id: string | null; allocated_draft_id: string | null };
export type BillingBatch = { id: string; client_id: string; week_start: string; week_end: string; status: "open" | "cancelled"; created_at: string };
export type DraftTrn = { id: string; batch_id: string; draft_identifier: string; status: "draft" | "cancelled"; validation_status: "current" | "stale"; revision_number: number; current_revision_id: string | null; created_at: string };
export type DraftRevision = { id: string; draft_id: string; revision_number: number; action: "created" | "amended"; total_thb: number; line_count: number; changed_by: string; changed_at: string };
export type DraftLine = { id: string; revision_id: string; position: number; booking_id: string; work_order_number: string; booking_snapshot: Record<string, unknown>; pricing_snapshot: Record<string, unknown>; amount_thb: number };
export type BillingEvent = { id: number; draft_id: string; actor_id: string | null; event_type: "created" | "amended" | "cancelled" | "stale"; details: Record<string, unknown>; occurred_at: string };
type Client = Pick<typeof supabase, "from" | "rpc">;

function datePartsInThailand(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function thailandWeekStart(input: Date | string = new Date()): string {
  const dateKey = typeof input === "string" ? input : datePartsInThailand(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("INVALID_BILLING_DATE");
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) throw new Error("INVALID_BILLING_DATE");
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000);
  return monday.toISOString().slice(0, 10);
}
export function thailandWeekEnd(monday: string): string {
  if (thailandWeekStart(monday) !== monday) throw new Error("BILLING_WEEK_MUST_START_MONDAY");
  return new Date(Date.parse(`${monday}T00:00:00.000Z`) + 6 * 86400000).toISOString().slice(0, 10);
}
export function thbToCents(amount: number | string): number {
  const value = String(amount);
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw new Error("INVALID_BILLING_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("INVALID_BILLING_AMOUNT");
  return cents;
}
export function draftTotalCents(candidates: BillingCandidate[], orderedIds: string[]): number {
  const byId = new Map(candidates.map((candidate) => [candidate.booking.id, candidate]));
  if (!orderedIds.length || new Set(orderedIds).size !== orderedIds.length) throw new Error("INVALID_DRAFT_SELECTION");
  const total = orderedIds.reduce((sum, id) => {
    const row = byId.get(id);
    if (!row?.ready || row.selling_price_thb == null) throw new Error("BILLING_JOB_NOT_READY");
    return sum + thbToCents(row.selling_price_thb);
  }, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > 999999999999) throw new Error("INVALID_DRAFT_TOTAL");
  return total;
}
export function customerWeekBookings(bookings: BookingDiaryEntry[], clientId: string, monday: string) {
  const sunday = thailandWeekEnd(monday);
  return bookings.filter((row) => row.client_id === clientId && row.booking_date >= monday && row.booking_date <= sunday)
    .sort((a, b) => a.booking_date.localeCompare(b.booking_date) || (a.job_order_number || "").localeCompare(b.job_order_number || "") || a.id.localeCompare(b.id));
}
export async function loadBillingCandidates(client: Client, bookings: BookingDiaryEntry[], draftId: string | null): Promise<BillingCandidate[]> {
  const result: BillingCandidate[] = [];
  for (let i = 0; i < bookings.length; i += 10) {
    const slice = bookings.slice(i, i + 10);
    const statuses = await Promise.all(slice.map((booking) => client.rpc("finance_billing_candidate", { p_booking_id: booking.id, p_draft_id: draftId })));
    for (let j = 0; j < slice.length; j++) {
      if (statuses[j].error) throw statuses[j].error;
      result.push({ booking: slice[j], ...(statuses[j].data as Omit<BillingCandidate, "booking">) });
    }
  }
  return result;
}
export async function loadWeeklyDrafts(client: Client, clientId: string, weekStart: string) {
  const batches = await client.from("finance_billing_batches").select("id,client_id,week_start,week_end,status,created_at").eq("client_id", clientId).eq("week_start", weekStart).order("created_at", { ascending: false });
  if (batches.error) throw batches.error;
  const batchRows = (batches.data || []) as BillingBatch[];
  if (!batchRows.length) return { batches: batchRows, drafts: [] as DraftTrn[], revisions: [] as DraftRevision[], lines: [] as DraftLine[], events: [] as BillingEvent[] };
  const drafts = await client.from("finance_draft_trns").select("id,batch_id,draft_identifier,status,validation_status,revision_number,current_revision_id,created_at").in("batch_id", batchRows.map((row) => row.id));
  if (drafts.error) throw drafts.error;
  const draftRows = (drafts.data || []) as DraftTrn[];
  if (!draftRows.length) return { batches: batchRows, drafts: draftRows, revisions: [] as DraftRevision[], lines: [] as DraftLine[], events: [] as BillingEvent[] };
  const ids = draftRows.map((row) => row.id);
  const [revisions, events] = await Promise.all([
    client.from("finance_draft_revisions").select("id,draft_id,revision_number,action,total_thb,line_count,changed_by,changed_at").in("draft_id", ids).order("revision_number", { ascending: false }),
    client.from("finance_billing_events").select("id,draft_id,actor_id,event_type,details,occurred_at").in("draft_id", ids).order("id", { ascending: false })
  ]);
  if (revisions.error) throw revisions.error;
  if (events.error) throw events.error;
  const revisionRows = (revisions.data || []) as DraftRevision[];
  const lines = revisionRows.length ? await client.from("finance_draft_revision_lines").select("id,revision_id,position,booking_id,work_order_number,booking_snapshot,pricing_snapshot,amount_thb").in("revision_id", revisionRows.map((row) => row.id)).order("position", { ascending: true }) : { data: [], error: null };
  if (lines.error) throw lines.error;
  return { batches: batchRows, drafts: draftRows, revisions: revisionRows, lines: (lines.data || []) as DraftLine[], events: (events.data || []) as BillingEvent[] };
}
