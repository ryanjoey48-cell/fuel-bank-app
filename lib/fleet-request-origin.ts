/**
 * V7.8.3 client side of the request-origin diagnostics: every explicit Forth history read labels the application action that started it.
 * The label is a fixed identifier (no user data); the id only correlates one browser request with its server log line.
 */
export type ClientRequestOrigin = "reports_day_review_queue" | "reports_coverage_review" | "daily_read_button" | "daily_refresh_button" | "journeys_unread_batch" | "locations_evidence_panel"
  | "journey_playback_load" | "live_journey_history_form";
export function originHeaders(origin: ClientRequestOrigin): Record<string, string> {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return { "X-EES-Request-Origin": origin, "X-EES-Request-Id": id };
}
