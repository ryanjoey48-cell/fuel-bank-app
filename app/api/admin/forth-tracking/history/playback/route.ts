import { createJourneyPlaybackPostHandler } from "@/lib/forth-history-playback-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createJourneyPlaybackPostHandler();
