import type { supabase } from "@/lib/supabase";

export type InvoiceSubmissionStatus = "pending" | "approved" | "rejected" | "invalidated" | "withdrawn";

function thbToCents(amount: number | string): number {
  const value = String(amount);
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw new Error("INVALID_REVIEW_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("INVALID_REVIEW_AMOUNT");
  return cents;
}
export type InvoiceSubmission = {
  id: string;
  draft_id: string;
  draft_revision_id: string;
  submission_number: number;
  status: InvoiceSubmissionStatus;
  submitted_by: string;
  submitted_at: string;
  review_snapshot: InvoiceReviewSnapshot;
};
export type InvoiceDecision = {
  id: string;
  submission_id: string;
  decision: "approved" | "rejected";
  reason: string;
  decided_by: string;
  decided_at: string;
};
export type ApprovalEvent = {
  id: number;
  draft_id: string;
  submission_id: string | null;
  pack_id: string | null;
  actor_id: string | null;
  event_type: "submitted" | "approved" | "rejected" | "invalidated" | "withdrawn" | "pack_prepared" | "pack_superseded";
  details: Record<string, unknown>;
  occurred_at: string;
};
export type InvoiceReviewLine = {
  position: number;
  booking_id: string;
  work_order_number: string;
  amount_thb: number;
  booking_snapshot: Record<string, unknown>;
  pricing_snapshot: Record<string, unknown>;
  paperwork_refs: Array<{
    document_id: string;
    kind: string;
    status: string;
    original_filename: string;
    physical_location: string | null;
  }>;
};
export type InvoiceReviewSnapshot = {
  client_id: string;
  client_name: string;
  week_start: string;
  week_end: string;
  draft_identifier: string;
  revision_number: number;
  total_thb: number;
  line_count: number;
  missing_green_paper: boolean;
  lines: InvoiceReviewLine[];
  layout_note?: string;
};
type Client = Pick<typeof supabase, "from" | "rpc">;

export function snapshotTotalCents(snapshot: InvoiceReviewSnapshot): number {
  const lines = snapshot.lines || [];
  if (!lines.length || lines.length !== snapshot.line_count) throw new Error("INVALID_REVIEW_SNAPSHOT");
  const ordered = [...lines].sort((a, b) => a.position - b.position);
  if (ordered.some((line, index) => line.position !== index + 1)) throw new Error("INVALID_REVIEW_SNAPSHOT");
  const total = ordered.reduce((sum, line) => sum + thbToCents(line.amount_thb), 0);
  if (total !== thbToCents(snapshot.total_thb) || total <= 0) throw new Error("INVALID_REVIEW_TOTAL");
  return total;
}

export function canSubmitDraft(args: {
  canFinance: boolean;
  draftStatus: "draft" | "cancelled" | null;
  validationStatus: "current" | "stale" | null;
  revisionNumber: number | null;
  activeSubmission: InvoiceSubmission | null;
}): boolean {
  if (!args.canFinance || args.draftStatus !== "draft" || args.validationStatus !== "current" || !args.revisionNumber) return false;
  if (args.activeSubmission?.status === "pending" || args.activeSubmission?.status === "approved") return false;
  return true;
}

export function canDecideSubmission(args: {
  canApprove: boolean;
  userId: string | null;
  submission: InvoiceSubmission | null;
}): boolean {
  return !!args.canApprove && !!args.userId && !!args.submission
    && args.submission.status === "pending"
    && args.submission.submitted_by !== args.userId;
}

export function latestActiveSubmission(submissions: InvoiceSubmission[]): InvoiceSubmission | null {
  const ranked = [...submissions].sort((a, b) => b.submission_number - a.submission_number);
  return ranked.find((row) => row.status === "pending" || row.status === "approved")
    || ranked.find((row) => row.status === "rejected")
    || ranked[0]
    || null;
}

export async function loadInvoiceApprovals(client: Client, draftId: string) {
  const [submissions, events] = await Promise.all([
    client.from("finance_invoice_submissions")
      .select("id,draft_id,draft_revision_id,submission_number,status,submitted_by,submitted_at,review_snapshot")
      .eq("draft_id", draftId)
      .order("submission_number", { ascending: false }),
    client.from("finance_approval_events")
      .select("id,draft_id,submission_id,pack_id,actor_id,event_type,details,occurred_at")
      .eq("draft_id", draftId)
      .order("id", { ascending: false })
  ]);
  if (submissions.error) throw submissions.error;
  if (events.error) throw events.error;
  const submissionRows = (submissions.data || []) as InvoiceSubmission[];
  const decisions = submissionRows.length
    ? await client.from("finance_invoice_decisions")
      .select("id,submission_id,decision,reason,decided_by,decided_at")
      .in("submission_id", submissionRows.map((row) => row.id))
    : { data: [], error: null };
  if (decisions.error) throw decisions.error;
  return {
    submissions: submissionRows,
    decisions: (decisions.data || []) as InvoiceDecision[],
    events: (events.data || []) as ApprovalEvent[]
  };
}
