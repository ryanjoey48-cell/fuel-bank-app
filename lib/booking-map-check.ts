import { normalizeBookingLocationName, type CanonicalLocationMatch } from "@/lib/booking-maps-backfill";

export type BookingCheckField<T> = {
  confirmed: boolean;
  value: T | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

export type BookingCheckLocationValue = {
  displayName: string;
  fullGoogleAddress: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
};

export type BookingCheckReview = {
  version: 1;
  original: {
    clientId: string | null;
    clientName: string;
    pickup: string;
    dropoff: string;
  };
  client: BookingCheckField<{ id: string; name: string }>;
  pickup: BookingCheckField<BookingCheckLocationValue>;
  dropoff: BookingCheckField<BookingCheckLocationValue>;
  disposition: "active" | "skipped" | "investigation";
  updatedBy: string;
  updatedAt: string;
};

export type BookingCheckStatus = "unchecked" | "partial" | "completed" | "investigation";

export function bookingCheckStatus(review: BookingCheckReview | null): BookingCheckStatus {
  if (!review) return "unchecked";
  if (review.disposition === "investigation") return "investigation";
  const confirmations = [review.client.confirmed, review.pickup.confirmed, review.dropoff.confirmed];
  if (confirmations.every(Boolean)) return "completed";
  if (confirmations.some(Boolean)) return "partial";
  return "unchecked";
}

export function matchingBookingIds<T extends {
  id: string;
  clientId: string | null;
  pickup: string;
  dropoff: string;
}>(bookings: T[], anchor: T) {
  const pickup = normalizeBookingLocationName(anchor.pickup);
  const dropoff = normalizeBookingLocationName(anchor.dropoff);
  return bookings
    .filter((booking) =>
      booking.clientId === anchor.clientId &&
      normalizeBookingLocationName(booking.pickup) === pickup &&
      normalizeBookingLocationName(booking.dropoff) === dropoff
    )
    .map((booking) => booking.id);
}

function emptyField<T>(): BookingCheckField<T> {
  return { confirmed: false, value: null, confirmedBy: null, confirmedAt: null };
}

export function createBookingCheckReview(input: {
  current: BookingCheckReview | null;
  actorUserId: string;
  now: string;
  original: BookingCheckReview["original"];
  action: "confirm_all" | "confirm_client" | "confirm_pickup" | "confirm_dropoff" | "skip" | "investigate";
  client?: { id: string; name: string } | null;
  pickup?: BookingCheckLocationValue | null;
  dropoff?: BookingCheckLocationValue | null;
}) {
  const review: BookingCheckReview = input.current ?? {
    version: 1,
    original: input.original,
    client: emptyField(),
    pickup: emptyField(),
    dropoff: emptyField(),
    disposition: "active",
    updatedBy: input.actorUserId,
    updatedAt: input.now
  };
  const confirm = <T>(value: T): BookingCheckField<T> => ({
    confirmed: true,
    value,
    confirmedBy: input.actorUserId,
    confirmedAt: input.now
  });

  if (input.action === "confirm_all" || input.action === "confirm_client") {
    if (!input.client) throw new Error("A verified client selection is required.");
    review.client = confirm(input.client);
  }
  if (input.action === "confirm_all" || input.action === "confirm_pickup") {
    if (!input.pickup?.googlePlaceId) throw new Error("A verified pickup Place ID is required.");
    review.pickup = confirm(input.pickup);
  }
  if (input.action === "confirm_all" || input.action === "confirm_dropoff") {
    if (!input.dropoff?.googlePlaceId) throw new Error("A verified drop-off Place ID is required.");
    review.dropoff = confirm(input.dropoff);
  }
  review.disposition = input.action === "investigate"
    ? "investigation"
    : input.action === "skip"
      ? "skipped"
      : "active";
  review.updatedBy = input.actorUserId;
  review.updatedAt = input.now;
  return review;
}

export function canonicalToBookingCheckLocation(location: CanonicalLocationMatch): BookingCheckLocationValue {
  return {
    displayName: location.displayName,
    fullGoogleAddress: location.fullGoogleAddress,
    googlePlaceId: location.googlePlaceId,
    latitude: location.latitude,
    longitude: location.longitude
  };
}

export function clientNameSimilarity(left: string, right: string) {
  const a = normalizeBookingLocationName(left);
  const b = normalizeBookingLocationName(right);
  if (a === b) return 1;
  if (!a || !b) return 0;
  const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let j = 1; j <= b.length; j += 1) {
    let previous = rows[0];
    rows[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const current = rows[i];
      rows[i] = Math.min(rows[i] + 1, rows[i - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return Math.max(0, 1 - rows[a.length] / Math.max(a.length, b.length));
}
