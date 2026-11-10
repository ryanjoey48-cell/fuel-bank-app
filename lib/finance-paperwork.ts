import type { supabase } from "@/lib/supabase";

export const PAPERWORK_BUCKET = "ees-finance-paperwork";
export const PAPERWORK_MAX_BYTES = 10 * 1024 * 1024;
export type PaperworkKind = "green_job_order" | "parking_receipt" | "toll_receipt" | "other";
export type PaperworkStatus = "pending" | "uploaded" | "reviewed" | "rejected" | "superseded";
export type PaperworkDocument = {
  id: string; booking_id: string; kind: PaperworkKind; object_key: string; original_filename: string;
  mime_type: string; size_bytes: number; status: PaperworkStatus; revision_of: string | null;
  physical_location: string | null; created_at: string; reviewed_at: string | null;
};
export type PaperworkEvent = { id: number; document_id: string; booking_id: string; event_type: string; occurred_at: string };
type PaperworkClient = Pick<typeof supabase, "from" | "rpc" | "storage">;
type FileLike = Pick<File, "name" | "type" | "size" | "slice">;

export function safePaperworkFilename(name: string) {
  return name.replace(/[\\/\x00-\x1f\x7f]/g, "_").trim().slice(0, 180);
}

export async function validatePaperworkFile(file: FileLike) {
  const name = safePaperworkFilename(file.name);
  if (!name || file.size < 1 || file.size > PAPERWORK_MAX_BYTES) throw new Error("PAPERWORK_SIZE_OR_NAME_INVALID");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  const mime = starts(0x25, 0x50, 0x44, 0x46, 0x2d) ? "application/pdf"
    : starts(0xff, 0xd8, 0xff) ? "image/jpeg"
    : starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? "image/png"
    : starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 ? "image/webp" : null;
  if (!mime || file.type !== mime) throw new Error("PAPERWORK_TYPE_INVALID");
  return { name, mime, size: file.size };
}

export class PaperworkUploadError extends Error {
  constructor(message: string, public readonly pending: PaperworkDocument) { super(message); }
}

export async function uploadReservedPaperwork(client: PaperworkClient, document: PaperworkDocument, file: FileLike) {
  const checked = await validatePaperworkFile(file);
  if (document.status !== "pending" || checked.name !== document.original_filename || checked.mime !== document.mime_type || checked.size !== document.size_bytes) throw new Error("PAPERWORK_RETRY_FILE_MISMATCH");
  const uploaded = await client.storage.from(PAPERWORK_BUCKET).upload(document.object_key, file as File, { upsert: false, contentType: checked.mime });
  if (uploaded.error) {
    // A timed-out upload may have reached Storage. Finalization is idempotent and checks the stored object.
    const completed = await client.rpc("finance_finalize_paperwork", { p_document_id: document.id });
    if (!completed.error && completed.data) return completed.data as PaperworkDocument;
    throw new PaperworkUploadError(uploaded.error.message, document);
  }
  const completed = await client.rpc("finance_finalize_paperwork", { p_document_id: document.id });
  if (completed.error || !completed.data) throw new PaperworkUploadError(completed.error?.message || "PAPERWORK_FINALIZE_FAILED", document);
  return completed.data as PaperworkDocument;
}

export async function reserveAndUploadPaperwork(client: PaperworkClient, bookingId: string, kind: PaperworkKind, file: FileLike, revisionOf: string | null = null) {
  const checked = await validatePaperworkFile(file);
  const reserved = await client.rpc("finance_reserve_paperwork", {
    p_booking_id: bookingId, p_kind: kind, p_filename: checked.name, p_mime: checked.mime, p_size: checked.size, p_revision_of: revisionOf
  });
  if (reserved.error || !reserved.data) throw reserved.error || new Error("PAPERWORK_RESERVATION_FAILED");
  return uploadReservedPaperwork(client, reserved.data as PaperworkDocument, file);
}

export async function loadBookingPaperwork(client: PaperworkClient, bookingId: string) {
  const [documents, events] = await Promise.all([
    client.from("finance_paperwork_documents").select("id,booking_id,kind,object_key,original_filename,mime_type,size_bytes,status,revision_of,physical_location,created_at,reviewed_at").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    client.from("finance_paperwork_events").select("id,document_id,booking_id,event_type,occurred_at").eq("booking_id", bookingId).order("id", { ascending: false })
  ]);
  if (documents.error) throw documents.error;
  if (events.error) throw events.error;
  return { documents: (documents.data ?? []) as PaperworkDocument[], events: (events.data ?? []) as PaperworkEvent[] };
}

export async function reviewBookingPaperwork(client: PaperworkClient, documentId: string, approved: boolean, physicalLocation: string, note: string) {
  const result = await client.rpc("finance_review_paperwork", { p_document_id: documentId, p_approved: approved, p_physical_location: physicalLocation, p_note: note });
  if (result.error || !result.data) throw result.error || new Error("PAPERWORK_REVIEW_FAILED");
  return result.data as PaperworkDocument;
}

export async function downloadBookingPaperwork(client: PaperworkClient, document: PaperworkDocument) {
  if (document.status === "pending") throw new Error("PAPERWORK_NOT_UPLOADED");
  const result = await client.storage.from(PAPERWORK_BUCKET).download(document.object_key);
  if (result.error || !result.data) throw result.error || new Error("PAPERWORK_DOWNLOAD_FAILED");
  return result.data;
}

export function paperworkMissing(documents: PaperworkDocument[]) {
  return (["green_job_order", "parking_receipt", "toll_receipt"] as const).filter((kind) => !documents.some((document) => document.kind === kind && document.status === "reviewed"));
}
