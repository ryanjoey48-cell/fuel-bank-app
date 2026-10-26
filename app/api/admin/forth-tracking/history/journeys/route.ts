import { createJourneyHistoryPostHandler } from "@/lib/forth-history-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createJourneyHistoryPostHandler();
