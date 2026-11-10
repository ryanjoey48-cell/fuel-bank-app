import type { supabase } from "@/lib/supabase";

export type PackPaperworkRef = {
  document_id: string;
  kind: string;
  status: string;
  original_filename: string;
  physical_location: string | null;
};
export type PackReviewLine = {
  position: number;
  booking_id: string;
  work_order_number: string;
  amount_thb: number;
  booking_snapshot: Record<string, unknown>;
  pricing_snapshot: Record<string, unknown>;
  paperwork_refs: PackPaperworkRef[];
};
export type PackReviewSnapshot = {
  client_id: string;
  client_name: string;
  week_start: string;
  week_end: string;
  draft_identifier: string;
  revision_number: number;
  total_thb: number;
  line_count: number;
  missing_green_paper: boolean;
  lines: PackReviewLine[];
  layout_note?: string;
};
export type DocumentPackStatus = "prepared" | "held" | "superseded";
export type DocumentPack = {
  id: string;
  draft_id: string;
  submission_id: string;
  pack_number: number;
  status: DocumentPackStatus;
  hold_reasons: string[];
  pack_snapshot: PackReviewSnapshot;
  created_by: string;
  created_at: string;
};
export type DocumentPackLine = {
  id: string;
  pack_id: string;
  position: number;
  booking_id: string;
  work_order_number: string;
  amount_thb: number;
  booking_snapshot: Record<string, unknown>;
  pricing_snapshot: Record<string, unknown>;
  paperwork_refs: PackPaperworkRef[];
};
export type DocumentPackChecklist = {
  id: string;
  pack_id: string;
  checklist_type: "green_paper_retrieval" | "customer_dispatch";
  items: Array<Record<string, unknown>>;
};
type Client = Pick<typeof supabase, "from" | "rpc">;

export const invoiceLayoutHeadings = [
  "วันที่",
  "สถานทีรับ",
  "สถานที่ส่ง",
  "ใบงาน",
  "ค่าจอด",
  "OT",
  "เรทน้ำมัน",
  "AMOUNT"
] as const;

export const coverLayoutHeadings = [
  "ลำดับที่",
  "อินวอยซ์เลขที่",
  "วัน เดือน ปี",
  "ค่ารถบรรทุก",
  "หัก ณ ที่จ่าย",
  "ค่าจอด",
  "OT",
  "ยอดที่ต้องชำระ"
] as const;

export function packMatchesApprovedOrder(packLines: Array<Pick<DocumentPackLine, "position" | "booking_id">>, approvedBookingIds: string[]): boolean {
  const ordered = [...packLines].sort((a, b) => a.position - b.position);
  if (ordered.length !== approvedBookingIds.length) return false;
  return ordered.every((line, index) => line.position === index + 1 && line.booking_id === approvedBookingIds[index]);
}

export function packDispatchBlocked(pack: Pick<DocumentPack, "status" | "hold_reasons">): boolean {
  return pack.status !== "prepared" || pack.hold_reasons.includes("missing_paperwork") || pack.hold_reasons.includes("approval_hold");
}

export function buildPackManifest(snapshot: PackReviewSnapshot) {
  const lines = [...(snapshot.lines || [])].sort((a, b) => a.position - b.position);
  if (!lines.length || lines.length !== snapshot.line_count || lines.some((line, index) => line.position !== index + 1)) {
    throw new Error("INVALID_PACK_SNAPSHOT");
  }
  const items: Array<{ key: string; kind: "draft" | "work_order" | "document"; label: string; bookingId?: string }> = [
    { key: `draft:${snapshot.draft_identifier}`, kind: "draft", label: snapshot.draft_identifier }
  ];
  for (const line of lines) {
    items.push({
      key: `wo:${line.booking_id}`,
      kind: "work_order",
      bookingId: line.booking_id,
      label: `${line.position}. ${line.work_order_number}`
    });
    for (const doc of line.paperwork_refs || []) {
      items.push({
        key: `doc:${doc.document_id}`,
        kind: "document",
        bookingId: line.booking_id,
        label: `${doc.kind} · ${doc.original_filename}${doc.physical_location ? ` · ${doc.physical_location}` : ""}`
      });
    }
  }
  return items;
}

export function canPreparePack(args: {
  canFinance: boolean;
  submission: { status: string } | null;
}): boolean {
  return !!args.canFinance && args.submission?.status === "approved";
}

export async function loadDocumentPacks(client: Client, draftId: string) {
  const packs = await client.from("finance_document_packs")
    .select("id,draft_id,submission_id,pack_number,status,hold_reasons,pack_snapshot,created_by,created_at")
    .eq("draft_id", draftId)
    .order("pack_number", { ascending: false });
  if (packs.error) throw packs.error;
  const packRows = (packs.data || []) as DocumentPack[];
  if (!packRows.length) {
    return { packs: packRows, lines: [] as DocumentPackLine[], checklists: [] as DocumentPackChecklist[] };
  }
  const ids = packRows.map((row) => row.id);
  const [lines, checklists] = await Promise.all([
    client.from("finance_document_pack_lines")
      .select("id,pack_id,position,booking_id,work_order_number,amount_thb,booking_snapshot,pricing_snapshot,paperwork_refs")
      .in("pack_id", ids)
      .order("position", { ascending: true }),
    client.from("finance_document_pack_checklists")
      .select("id,pack_id,checklist_type,items")
      .in("pack_id", ids)
  ]);
  if (lines.error) throw lines.error;
  if (checklists.error) throw checklists.error;
  return {
    packs: packRows,
    lines: (lines.data || []) as DocumentPackLine[],
    checklists: (checklists.data || []) as DocumentPackChecklist[]
  };
}
