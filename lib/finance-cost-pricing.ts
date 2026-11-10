import type { supabase } from "@/lib/supabase";

export const expenseCategories = ["driver_trip", "toll", "parking", "overtime", "container_pickup", "overnight", "other"] as const;
export type ExpenseCategory = typeof expenseCategories[number];
export type ExpenseEvent = { id: string; booking_id: string; category: ExpenseCategory; event_kind: "charge" | "adjustment" | "reversal"; amount_delta: number; incurred_on: string; evidence_id: string | null; receipt_reference: string | null; missing_receipt_reason: string | null; corrects_event_id: string | null; note: string; created_by: string; created_at: string };
export type ExpenseDecision = { event_id: string; decision: "approved" | "rejected"; reason: string; decided_by: string; decided_at: string };
export type PriceListVersion = { id: string; client_id: string; route_key: string; effective_from: string; amount_thb: number; included_expense_categories: ExpenseCategory[]; terms_note: string; created_at: string };
export type JobPriceRevision = { id: string; booking_id: string; source: "price_list" | "manual"; price_list_version_id: string | null; original_price_thb: number | null; selling_price_thb: number; override_reason: string | null; created_by: string; created_at: string };
export type PriceDecision = { revision_id: string; decision: "approved" | "rejected"; reason: string; decided_by: string; decided_at: string };
type Client = Pick<typeof supabase, "from" | "rpc">;

export function parseThb(value: string): number {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("INVALID_THB_AMOUNT");
  return Number(value);
}
export function expenseTotal(events: ExpenseEvent[], decisions: ExpenseDecision[]) {
  const approved = new Set(decisions.filter((row) => row.decision === "approved").map((row) => row.event_id));
  return Math.round(events.reduce((sum, row) => sum + (approved.has(row.id) ? Number(row.amount_delta) : 0), 0) * 100) / 100;
}
export function effectivePriceList(versions: PriceListVersion[], clientId: string, routeKey: string, bookingDate: string) {
  return versions.filter((row) => row.client_id === clientId && row.route_key === routeKey && row.effective_from <= bookingDate)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
}
export function pricingReady(verified: boolean, managementHold: boolean, revisions: JobPriceRevision[], priceDecisions: PriceDecision[], expenses: ExpenseEvent[], expenseDecisions: ExpenseDecision[]) {
  if (!verified || managementHold) return false;
  const latest = [...revisions].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
  return !!latest && priceDecisions.some((row) => row.revision_id === latest.id && row.decision === "approved")
    && expenses.every((row) => expenseDecisions.some((decision) => decision.event_id === row.id && decision.decision === "approved"));
}
export async function loadCostPricing(client: Client, bookingId: string, clientId: string | null) {
  const [expenses, expenseDecisions, revisions, priceDecisions, priceLists, paperwork, verification, discrepancies, grants, readiness] = await Promise.all([
    client.from("finance_expense_events").select("id,booking_id,category,event_kind,amount_delta,incurred_on,evidence_id,receipt_reference,missing_receipt_reason,corrects_event_id,note,created_by,created_at").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    client.from("finance_expense_decisions").select("event_id,decision,reason,decided_by,decided_at"),
    client.from("finance_job_price_revisions").select("id,booking_id,source,price_list_version_id,original_price_thb,selling_price_thb,override_reason,created_by,created_at").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    client.from("finance_pricing_decisions").select("revision_id,decision,reason,decided_by,decided_at"),
    client.from("finance_price_list_versions").select("id,client_id,route_key,effective_from,amount_thb,included_expense_categories,terms_note,created_at").eq("client_id", clientId || "00000000-0000-0000-0000-000000000000"),
    client.from("finance_paperwork_documents").select("id,booking_id,kind,status,original_filename").eq("booking_id", bookingId).eq("status", "reviewed"),
    client.from("finance_job_verifications").select("booking_id,status,handover_status").eq("booking_id", bookingId).maybeSingle(),
    client.from("finance_discrepancies").select("id").eq("booking_id", bookingId).eq("status", "open"),
    client.from("finance_role_grants").select("capability"),
    client.rpc("finance_job_pricing_ready", { p_booking_id: bookingId })
  ]);
  for (const result of [expenses, expenseDecisions, revisions, priceDecisions, priceLists, paperwork, verification, discrepancies, grants, readiness]) if (result.error) throw result.error;
  const expenseRows = (expenses.data || []) as ExpenseEvent[];
  const priceRows = (revisions.data || []) as JobPriceRevision[];
  return { expenses: expenseRows, expenseDecisions: ((expenseDecisions.data || []) as ExpenseDecision[]).filter((row) => expenseRows.some((expense) => expense.id === row.event_id)),
    revisions: priceRows, priceDecisions: ((priceDecisions.data || []) as PriceDecision[]).filter((row) => priceRows.some((revision) => revision.id === row.revision_id)),
    priceLists: (priceLists.data || []) as PriceListVersion[], paperwork: (paperwork.data || []) as { id: string; kind: string; original_filename: string }[],
    verified: verification.data?.status === "verified" && verification.data?.handover_status === "ready", managementHold: (discrepancies.data || []).length > 0,
    capabilities: (grants.data || []).map((row) => row.capability as string), serverReady: readiness.data === true };
}
export async function financeRpc<T>(client: Client, name: string, params: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, params);
  if (result.error || !result.data) throw result.error || new Error("FINANCE_SAVE_FAILED");
  return result.data as T;
}
