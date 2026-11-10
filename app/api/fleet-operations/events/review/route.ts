import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * Office review/correction for visit events and Booking Diary proposals.
 * Review update and audit history are committed atomically via RPC.
 * Never writes invoices, TRNs, finance, mileage, maintenance or fuel records.
 */
export async function PATCH(request: Request) {
  try {
    const { user, admin, access } = await requireFleetOfficeAccess(request, true);
    if (!hasPermission(access, "business:write")) {
      throw new AdminApiError(403, "Write access is required to review fleet visit events.");
    }
    const body = await request.json() as {
      eventKey?: string;
      action?: "confirm" | "mark_review" | "match_booking" | "reject_booking_match";
      bookingId?: string | null;
      reason?: string;
      requestId?: string | null;
      idempotencyKey?: string | null;
    };
    const eventKey = String(body.eventKey ?? "").trim();
    const action = body.action;
    const reason = String(body.reason ?? "").trim();
    const requestId = String(body.requestId ?? "").trim() || randomUUID();
    const idempotencyKey = String(body.idempotencyKey ?? "").trim() || null;
    if (!eventKey) throw new AdminApiError(400, "Provide the visit event key.");
    if (!action) throw new AdminApiError(400, "Provide a review action.");
    if (reason.length < 5 || reason.length > 500) {
      throw new AdminApiError(400, "Provide an audit reason between 5 and 500 characters.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new AdminApiError(400, "Provide a valid requestId UUID for idempotent review.");
    }

    const { data, error } = await admin.rpc("commit_ees_fleet_event_review", {
      p_event_key: eventKey,
      p_action: action,
      p_actor_user_id: user.id,
      p_reason: reason,
      p_request_id: requestId,
      p_booking_id: action === "match_booking" ? String(body.bookingId ?? "").trim() || null : null,
      p_idempotency_key: idempotencyKey
    });
    if (error) {
      const message = String(error.message ?? "").toLowerCase();
      if (message.includes("event not found")) throw new AdminApiError(404, "Visit event not found.");
      if (message.includes("booking not found")) throw new AdminApiError(404, "Booking Diary record not found.");
      if (message.includes("booking id required")) throw new AdminApiError(400, "Provide a Booking Diary id to confirm.");
      if (message.includes("could not find the function") || message.includes("pgrst202") || message.includes("does not exist")) {
        throw new AdminApiError(503, "Transactional review storage is not installed yet.");
      }
      throw new Error("Fleet visit review could not be committed.");
    }

    const payload = data as Record<string, unknown>;
    return NextResponse.json({
      event: {
        event_key: payload.event_key ?? eventKey,
        review_status: payload.review_status,
        booking_id: payload.booking_id ?? null,
        booking_match_status: payload.booking_match_status,
        reviewed_at: payload.reviewed_at ?? null
      },
      historyId: payload.history_id ?? null,
      replayed: Boolean(payload.replayed),
      requestId
    }, { headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof AdminApiError ? error.message : "Visit review storage is not ready."
    }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
