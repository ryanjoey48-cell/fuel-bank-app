import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess, requireVerifiedUser } from "@/lib/admin-user-management-server";
import {
  isFinanceLocalStoreEnabled,
  readFinanceLocalAttachment,
  writeFinanceLocalAttachment
} from "@/lib/finance-local-store-server";

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function gate(request: Request, mode: "read" | "write") {
  if (!isFinanceLocalStoreEnabled()) {
    return NextResponse.json({ error: "Finance local store disabled." }, { status: 404 });
  }
  if (!hasSupabaseEnv()) return null;
  if (mode === "write") await requireAdminAccess(request);
  else await requireVerifiedUser(request);
  return null;
}

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const blocked = await gate(request, "write");
    if (blocked) return blocked;
    const form = await request.formData();
    const documentId = String(form.get("documentId") || "").trim();
    const file = form.get("file");
    if (!documentId || !(file instanceof File)) {
      return NextResponse.json({ error: "documentId and file are required." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Attachment must be 1 byte–4 MB." }, { status: 400 });
    }
    const type = file.type || "application/octet-stream";
    if (!ALLOWED.has(type)) {
      return NextResponse.json({ error: "Only PDF/JPEG/PNG/WebP test attachments are accepted." }, { status: 400 });
    }
    const ext = type === "application/pdf" ? "pdf" : type.split("/")[1] || "bin";
    const safeDoc = documentId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const storedName = `${Date.now()}-${safeDoc}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFinanceLocalAttachment(storedName, bytes);
    return NextResponse.json({
      ok: true,
      storedName,
      fileName: file.name,
      size: file.size,
      contentType: type,
      note: "Stored under .ees-local/finance-test/attachments · local development only"
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to store local test attachment." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const blocked = await gate(request, "read");
    if (blocked) return blocked;
    const storedName = new URL(request.url).searchParams.get("storedName") || "";
    const bytes = await readFinanceLocalAttachment(storedName);
    const lower = storedName.toLowerCase();
    const contentType = lower.endsWith(".pdf")
      ? "application/pdf"
      : lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${storedName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to read local test attachment." }, { status: 404 });
  }
}
