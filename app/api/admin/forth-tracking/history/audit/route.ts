import { createHistoryAuditGetHandler } from "@/lib/forth-history-audit-route";

export const dynamic = "force-dynamic";
export const GET = createHistoryAuditGetHandler();
