import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/admin-user-management-server";
import { isFinanceLocalStoreEnabled } from "@/lib/finance-local-store-server";

// Local test only: serves the original customer pricing PDFs kept in the git-ignored .ees-local/pricing-src folder
// so Finance can check a quoted rate against the source. Fixed whitelist; never a path taken from the request.
const SOURCES: Record<string, string> = {
  apl: "APL Pricing.pdf",
  goodyear: "APL - Goodyear EES Pricing.pdf",
  sirtech: "EES Sirtech Pricing.pdf"
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isFinanceLocalStoreEnabled()) return NextResponse.json({ error: "Finance local store disabled." }, { status: 404 });
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) await requireVerifiedUser(request);
  } catch {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { id } = await context.params;
  const file = SOURCES[id];
  if (!file) return NextResponse.json({ error: "Unknown source." }, { status: 404 });
  try {
    const bytes = await readFile(path.join(process.cwd(), ".ees-local", "pricing-src", file));
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file}"`, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Source PDF is not available in this local workspace." }, { status: 404 });
  }
}
