/**
 * Pure helpers for Journey Playback ↔ Live Fleet mode transitions.
 * Keeps historical GPS overlays from trapping the live map after exit.
 */

export type ForthPlaybackOverlayState = {
  active: boolean;
  points: Array<{
    index: number;
    latitude: number | null;
    longitude: number | null;
    verifiedGps: boolean;
    trailEligible?: boolean;
    isGapEdge?: boolean;
  }>;
  segments: Array<{ fromIndex: number; toIndex: number }>;
  reportedTrailSegments: Array<{ fromIndex: number; toIndex: number }>;
  cursorIndex: number;
  registration: string | null;
};

export type ForthLiveWorkspaceMode = "overview" | "vehicle" | "locations" | "speed";
export type ForthWorkspaceMode = ForthLiveWorkspaceMode | "playback";

export function createInactivePlaybackOverlay(): ForthPlaybackOverlayState {
  return {
    active: false,
    points: [],
    segments: [],
    reportedTrailSegments: [],
    cursorIndex: 0,
    registration: null
  };
}

/** In-flight history responses must be discarded after exit or a newer load. */
export function shouldDiscardPlaybackResponse(sessionAtRequest: number, currentSession: number): boolean {
  return sessionAtRequest !== currentSession;
}

export function nextPlaybackSession(current: number): number {
  return current + 1;
}

/** Modes that restore live fleet markers (not historical overlay). */
export function isLiveWorkspaceMode(mode: ForthWorkspaceMode): mode is ForthLiveWorkspaceMode {
  return mode !== "playback";
}

/**
 * When entering Playback, remember where Exit / Back to Live should return.
 * Vehicle Focus is kept only when a vehicle is selected.
 */
export function resolvePlaybackReturnMode(
  current: ForthWorkspaceMode,
  selectedKey: string | null
): ForthLiveWorkspaceMode {
  if (current === "playback") return "overview";
  if (current === "vehicle" && !selectedKey) return "overview";
  if (current === "speed") return "overview";
  return current;
}

export function resolveExitPlaybackTarget(
  requested: ForthWorkspaceMode | null | undefined,
  returnMode: ForthLiveWorkspaceMode,
  selectedKey: string | null
): ForthLiveWorkspaceMode {
  if (requested && isLiveWorkspaceMode(requested)) {
    if (requested === "vehicle" && !selectedKey) return "overview";
    return requested;
  }
  if (returnMode === "vehicle" && !selectedKey) return "overview";
  return returnMode;
}
