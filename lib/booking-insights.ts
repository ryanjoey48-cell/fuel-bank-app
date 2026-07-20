import type { BookingDiaryEntry, Driver, DriverVehicleType, TripJourney, Vehicle } from "@/types/database";

export type BookingInsightsPeriodKey = "7d" | "30d" | "90d" | "all" | "custom";

export type BookingInsightsPeriod = {
  key: BookingInsightsPeriodKey;
  startDate: string | null;
  endDate: string | null;
};

export type BookingComparisonStatus = "available" | "no_previous_data" | "incomplete_history" | "not_applicable";
export type CanonicalVehicleType = DriverVehicleType | "UNCLASSIFIED";
export type ReadinessKey = "client" | "google" | "distance" | "vehicle_recorded" | "vehicle_recognized" | "driver" | "trip";
export type PickupTimeTrend = "improving" | "declining" | "steady" | "not_comparable";

export type BookingCountShare = {
  label: string;
  count: number;
  percent: number;
};

export type BookingWeekdayDemand = BookingCountShare & {
  occurrences: number;
  averagePerOccurrence: number;
};

export type BookingVehicleDemand = BookingCountShare & {
  type: CanonicalVehicleType;
};

export type BookingRouteInsight = {
  routeKey: string;
  friendlyName: string;
  bookings: number;
  sharePercent: number;
  activeBookingDates: number;
  averageGapDays: number | null;
  mostRequestedVehicleType: CanonicalVehicleType;
  averageDistanceKm: number | null;
  distanceRecordCount: number;
  latestBookingDate: string;
  labelVariants: string[];
  multipleMappedLocations: boolean;
};

export type BookingNewRouteInsight = {
  routeKey: string;
  friendlyName: string;
  firstRecordedDate: string;
  latestBookingDate: string;
  bookings: number;
  activeBookingDates: number;
  mostRequestedVehicleType: CanonicalVehicleType;
  status: "watch" | "growing" | "strong_pattern";
  classification: "recurring_opportunity" | "one_off" | "initial_records" | "same_day_repeat";
};

export type BookingDailyWorkload = {
  date: string;
  count: number;
};

export type BookingWeeklyWorkload = {
  weekStartDate: string;
  weekEndDate: string;
  bookings: number;
  activeDays: number;
  averagePerActiveDay: number;
  changePercent: number | null;
};

export type BookingUpcomingWorkload = {
  next7Bookings: number;
  next14Bookings: number;
  busiestDate: string | null;
  busiestDateBookings: number;
  vehicleDemand: BookingVehicleDemand[];
  missingDriverBookings: number;
  missingPickupTimeBookings: number;
  topRoutes: BookingRouteInsight[];
  topClients: BookingUpcomingClientInsight[];
};

export type BookingUpcomingClientInsight = {
  key: string;
  name: string;
  next7Bookings: number;
  next14Bookings: number;
  busiestDate: string | null;
  mostRequestedVehicleType: CanonicalVehicleType;
  missingDriverBookings: number;
  missingPickupTimeBookings: number;
};

export type BookingCustomerInsight = {
  key: string;
  name: string;
  bookings: number;
  sharePercent: number;
  mostCommonRoute: string | null;
  mostRequestedVehicleType: CanonicalVehicleType;
  latestBookingDate: string;
  firstBookingDate: string;
  activeBookingDates: number;
  mostCommonWeekday: string | null;
  peakPickupTimeBand: string | null;
  sixWheelBookings: number;
  previousBookings: number | null;
  bookingDifference: number | null;
  changePercent: number | null;
};

export type BookingClientCoverage = {
  launchDate: string;
  overall: { captured: number; total: number; percent: number | null };
  recent: { captured: number; total: number; percent: number | null };
  historical: { captured: number; total: number; percent: number | null };
  createdSinceLaunch: { captured: number; total: number; percent: number | null };
};

export type BookingReadinessMetric = {
  key: ReadinessKey;
  count: number;
  total: number;
  percent: number | null;
};

export type BookingReadinessCohort = {
  key: "overall" | "recent" | "historical";
  startDate: string | null;
  endDate: string | null;
  bookingCount: number;
  metrics: BookingReadinessMetric[];
};

export type BookingVehicleValueInsight = BookingCountShare & {
  suggestedType: DriverVehicleType | null;
};

export type BookingTripCoverage = {
  workflowStartDate: string;
  eligibleBookings: number;
  linkedEligibleBookings: number;
  linkedSelectedBookings: number;
  historicalBookingsExcluded: number;
  percent: number | null;
};

export type BookingInsightsResult = {
  selectedBookings: BookingDiaryEntry[];
  selectedPeriod: { startDate: string | null; endDate: string | null };
  previousPeriod: { startDate: string; endDate: string } | null;
  earliestAvailableDate: string | null;
  latestAvailableDate: string | null;
  comparisonStatus: BookingComparisonStatus;
  summary: {
    totalBookings: number;
    previousTotalBookings: number | null;
    bookingChangePercent: number | null;
    repeatRoutePercent: number;
    newRecurringRouteOpportunityCount: number;
    oneOffNewRouteCount: number;
    initialRecordRouteCount: number;
    tripCoveragePercent: number | null;
    mostCommonRoute: string | null;
    busiestWeekday: string | null;
    busiestWeekdayAverage: number | null;
    mostRequestedVehicleType: CanonicalVehicleType;
    peakPickupTimeBand: string | null;
    topFiveRouteSharePercent: number;
    topFiveClientSharePercent: number;
    topUpcomingClient: string | null;
    topSixWheelClient: string | null;
    topDataQualityIssue: "pickup_time" | ReadinessKey | null;
  };
  commonRoutes: BookingRouteInsight[];
  newRecurringRouteOpportunities: BookingNewRouteInsight[];
  oneOffNewRoutes: BookingNewRouteInsight[];
  initialRecordRoutes: BookingNewRouteInsight[];
  insufficientHistoryForNewRoutes: boolean;
  weeklyWorkload: BookingWeeklyWorkload[];
  highestVolumeWeek: BookingWeeklyWorkload | null;
  upcomingWorkload: BookingUpcomingWorkload;
  weekdayDemand: BookingWeekdayDemand[];
  pickupTimeDemand: BookingCountShare[];
  validPickupTimeBookings: number;
  missingPickupTimeBookings: number;
  pickupTimeCapture: {
    overallPercent: number;
    recentPercent: number | null;
    historicalPercent: number | null;
    trend: PickupTimeTrend;
  };
  vehicleDemand: BookingVehicleDemand[];
  unclassifiedVehicleValues: BookingVehicleValueInsight[];
  customerActivity: BookingCustomerInsight[];
  newlyActiveCustomers: BookingCustomerInsight[];
  increasingCustomers: BookingCustomerInsight[];
  reducedCustomers: BookingCustomerInsight[];
  regularCustomersWithoutRecentActivity: BookingCustomerInsight[];
  customerDataAvailable: boolean;
  clientCoverage: BookingClientCoverage;
  readinessCohorts: BookingReadinessCohort[];
  tripCoverage: BookingTripCoverage;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_HISTORY_DAYS = 30;
const RECENT_COHORT_DAYS = 30;
export const TRIP_LINKING_WORKFLOW_START_DATE = "2026-06-30";
export const CLIENT_CAPTURE_LAUNCH_DATE = "2026-07-20";

const timeBands = [
  { label: "00:00-05:59", start: 0, end: 359 },
  { label: "06:00-08:59", start: 360, end: 539 },
  { label: "09:00-11:59", start: 540, end: 719 },
  { label: "12:00-14:59", start: 720, end: 899 },
  { label: "15:00-17:59", start: 900, end: 1079 },
  { label: "18:00-23:59", start: 1080, end: 1439 }
];

const canonicalVehicleTypes = new Set<DriverVehicleType>([
  "EIGHTEEN_WHEELER",
  "SIX_PLUS_SIX_WHEELER",
  "SIX_WHEEL_TRUCK",
  "FOUR_WHEEL_TRUCK"
]);

function parseDateKey(value: string | null | undefined) {
  const key = (value ?? "").slice(0, 10);
  const timestamp = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(timestamp) ? { key, timestamp } : null;
}

function dateKeyFromTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function periodBounds(bookings: BookingDiaryEntry[]) {
  const dates = bookings.map((booking) => parseDateKey(booking.booking_date)).filter(Boolean) as Array<{ key: string; timestamp: number }>;
  return {
    earliest: dates.length ? dateKeyFromTimestamp(Math.min(...dates.map((date) => date.timestamp))) : null,
    latest: dates.length ? dateKeyFromTimestamp(Math.max(...dates.map((date) => date.timestamp))) : null
  };
}

function clampPeriod(bookings: BookingDiaryEntry[], period: BookingInsightsPeriod, todayKey: string) {
  const bounds = periodBounds(bookings);
  if (period.key === "all") return { startDate: bounds.earliest, endDate: bounds.latest };
  if (period.key === "custom") {
    return {
      startDate: parseDateKey(period.startDate)?.key ?? null,
      endDate: parseDateKey(period.endDate)?.key ?? null
    };
  }
  const days = period.key === "7d" ? 7 : period.key === "30d" ? 30 : 90;
  const end = parseDateKey(bounds.latest) ?? parseDateKey(todayKey) ?? { key: todayKey, timestamp: Date.now() };
  return { startDate: dateKeyFromTimestamp(end.timestamp - (days - 1) * DAY_MS), endDate: end.key };
}

function getPreviousPeriod(startDate: string | null, endDate: string | null) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || end.timestamp < start.timestamp) return null;
  const days = Math.round((end.timestamp - start.timestamp) / DAY_MS) + 1;
  const previousEnd = start.timestamp - DAY_MS;
  return {
    startDate: dateKeyFromTimestamp(previousEnd - (days - 1) * DAY_MS),
    endDate: dateKeyFromTimestamp(previousEnd)
  };
}

function inRange(booking: BookingDiaryEntry, startDate: string | null, endDate: string | null) {
  const date = parseDateKey(booking.booking_date);
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  return Boolean(date && (!start || date.timestamp >= start.timestamp) && (!end || date.timestamp <= end.timestamp));
}

export function normalizeRouteLabel(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[→➜➝➡⇢]|-{1,2}>/gu, " ")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function displayLocation(primary: string | null | undefined, address: string | null | undefined, fallback: string) {
  return primary?.trim() || address?.trim() || fallback;
}

function routeName(booking: BookingDiaryEntry) {
  return `${displayLocation(booking.pickup, booking.pickup_address, "Missing pickup")} -> ${displayLocation(booking.dropoff, booking.dropoff_address, "Missing drop-off")}`;
}

export function operationalRouteKey(booking: BookingDiaryEntry) {
  const pickup = displayLocation(booking.pickup, booking.pickup_address, "missing-pickup");
  const dropoff = displayLocation(booking.dropoff, booking.dropoff_address, "missing-dropoff");
  return `${normalizeRouteLabel(pickup)}->${normalizeRouteLabel(dropoff)}`;
}

function mappedLocationKey(placeId: string | null | undefined, lat: number | null | undefined, lng: number | null | undefined) {
  if (placeId?.trim()) return `place:${placeId.trim()}`;
  if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
    return `coord:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }
  return null;
}

function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function countShares(labels: string[], total = labels.length): BookingCountShare[] {
  const counts = new Map<string, number>();
  labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: percent(count, total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function opportunityStatus(activeDates: number): BookingNewRouteInsight["status"] {
  if (activeDates >= 5) return "strong_pattern";
  if (activeDates >= 3) return "growing";
  return "watch";
}

function normalizeCustomerName(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function reportingCustomerName(booking: BookingDiaryEntry) {
  return normalizeCustomerName(booking.client?.name) || null;
}

function customerKey(booking: BookingDiaryEntry) {
  return booking.client_id || "";
}

export function normalizeVehicleValue(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[\s._/\\-]+/gu, "").trim();
}

function validVehicleType(value: string | null | undefined): DriverVehicleType | null {
  return value && canonicalVehicleTypes.has(value as DriverVehicleType) ? value as DriverVehicleType : null;
}

export function aliasVehicleType(value: string): DriverVehicleType | null {
  const clean = normalizeVehicleValue(value);
  const candidates: Array<[DriverVehicleType, boolean]> = [
    ["SIX_PLUS_SIX_WHEELER", /^(?:6\+6|6ล้อพ่วง|พ่วง6ล้อ|หกล้อพ่วง|พ่วงหกล้อ|sixplus(?:six)?|6x6)(?:wheel(?:er|truck)?)?$/u.test(clean)],
    ["EIGHTEEN_WHEELER", /^(?:18ล้อ|สิบแปดล้อ|18wheel(?:er|truck)?|trailer|พ่วง|10ล้อพ่วง|หัวลาก)$/u.test(clean)],
    ["SIX_WHEEL_TRUCK", /^(?:6ล้อ|6ล้|หกล้อ|6wheel(?:er|truck)?|6ล้อเฮียบ|6ล้อ(?:คอก|ครอก))$/u.test(clean)],
    ["FOUR_WHEEL_TRUCK", /^(?:4ล้อ|สี่ล้อ|4wheel(?:er|truck)?|กระบะ|pickup(?:truck)?)$/u.test(clean)]
  ];
  return candidates.find(([, matches]) => matches)?.[0] ?? null;
}

function buildVehicleResolver(vehicles: Vehicle[], drivers: Driver[]) {
  const typeByRegistration = new Map<string, DriverVehicleType>();
  [...vehicles, ...drivers].forEach((record) => {
    const type = validVehicleType(record.vehicle_type);
    const registration = normalizeVehicleValue("vehicle_reg" in record ? record.vehicle_reg : "");
    if (type && registration && !typeByRegistration.has(registration)) typeByRegistration.set(registration, type);
  });

  return (value: string | null | undefined): CanonicalVehicleType => {
    const raw = value?.trim() ?? "";
    if (!raw) return "UNCLASSIFIED";
    const masterType = typeByRegistration.get(normalizeVehicleValue(raw));
    if (masterType) return masterType;
    const directType = validVehicleType(raw);
    if (directType) return directType;
    return aliasVehicleType(raw) ?? "UNCLASSIFIED";
  };
}

function averageGapDays(dates: string[]) {
  const timestamps = [...new Set(dates)].map(parseDateKey).filter(Boolean).map((date) => date!.timestamp).sort((a, b) => a - b);
  if (timestamps.length < 2) return null;
  const gaps = timestamps.slice(1).map((timestamp, index) => (timestamp - timestamps[index]) / DAY_MS);
  return Math.round((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 10) / 10;
}

function validPickupTimeBand(value: string | null | undefined) {
  const match = (value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const totalMinutes = hour * 60 + minute;
  return timeBands.find((band) => totalMinutes >= band.start && totalMinutes <= band.end)?.label ?? null;
}

function hasGoogleVerifiedRoute(booking: BookingDiaryEntry) {
  const hasPlaceIds = Boolean(booking.pickup_place_id && booking.dropoff_place_id);
  const hasCoordinates = [booking.pickup_lat, booking.pickup_lng, booking.dropoff_lat, booking.dropoff_lng]
    .every((value) => typeof value === "number" && Number.isFinite(value));
  return hasPlaceIds || hasCoordinates;
}

function hasDistance(booking: BookingDiaryEntry) {
  return typeof booking.estimated_distance_km === "number" && Number.isFinite(booking.estimated_distance_km) && booking.estimated_distance_km > 0;
}

function isTripCoverageEligible(booking: BookingDiaryEntry, todayKey: string) {
  const bookingDate = parseDateKey(booking.booking_date);
  const createdDate = parseDateKey(booking.created_at);
  const today = parseDateKey(todayKey);
  const workflowStart = parseDateKey(TRIP_LINKING_WORKFLOW_START_DATE);
  return Boolean(
    bookingDate &&
    createdDate &&
    today &&
    workflowStart &&
    bookingDate.timestamp < today.timestamp &&
    createdDate.timestamp >= workflowStart.timestamp
  );
}

function buildReadinessMetrics(
  entries: BookingDiaryEntry[],
  tripsByBookingId: Map<string, TripJourney>,
  todayKey: string,
  resolveVehicleType: (value: string | null | undefined) => CanonicalVehicleType
): BookingReadinessMetric[] {
  const today = parseDateKey(todayKey);
  const eligible = today ? entries.filter((booking) => isTripCoverageEligible(booking, todayKey)) : [];
  const linked = eligible.filter((booking) => tripsByBookingId.has(String(booking.id)));
  const metric = (key: ReadinessKey, count: number, total: number): BookingReadinessMetric => ({
    key,
    count,
    total,
    percent: total > 0 ? percent(count, total) : null
  });
  return [
    metric("client", entries.filter((booking) => Boolean(booking.client_id && reportingCustomerName(booking))).length, entries.length),
    metric("google", entries.filter(hasGoogleVerifiedRoute).length, entries.length),
    metric("distance", entries.filter(hasDistance).length, entries.length),
    metric("vehicle_recorded", entries.filter((booking) => Boolean(booking.vehicle?.trim())).length, entries.length),
    metric("vehicle_recognized", entries.filter((booking) => resolveVehicleType(booking.vehicle) !== "UNCLASSIFIED").length, entries.length),
    metric("driver", entries.filter((booking) => Boolean(booking.driver?.trim())).length, entries.length),
    metric("trip", linked.length, eligible.length)
  ];
}

function buildReadinessCohort(
  key: BookingReadinessCohort["key"],
  entries: BookingDiaryEntry[],
  tripsByBookingId: Map<string, TripJourney>,
  todayKey: string,
  resolveVehicleType: (value: string | null | undefined) => CanonicalVehicleType
): BookingReadinessCohort {
  const dates = entries.map((booking) => booking.booking_date).sort();
  return {
    key,
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
    bookingCount: entries.length,
    metrics: buildReadinessMetrics(entries, tripsByBookingId, todayKey, resolveVehicleType)
  };
}

export function buildBookingBusinessInsights(
  bookings: BookingDiaryEntry[],
  tripsByBookingId: Map<string, TripJourney>,
  vehicles: Vehicle[],
  drivers: Driver[],
  period: BookingInsightsPeriod,
  todayKey: string
): BookingInsightsResult {
  const bounds = periodBounds(bookings);
  const selectedPeriod = clampPeriod(bookings, period, todayKey);
  const selectedBookings = bookings.filter((booking) => inRange(booking, selectedPeriod.startDate, selectedPeriod.endDate));
  const previousPeriod = period.key === "all" ? null : getPreviousPeriod(selectedPeriod.startDate, selectedPeriod.endDate);
  const previousBookings = previousPeriod ? bookings.filter((booking) => inRange(booking, previousPeriod.startDate, previousPeriod.endDate)) : [];
  const previousComplete = Boolean(previousPeriod && bounds.earliest && bounds.earliest <= previousPeriod.startDate);
  const comparisonStatus: BookingComparisonStatus = period.key === "all" || !previousPeriod
    ? "not_applicable"
    : !previousComplete
      ? "incomplete_history"
      : previousBookings.length === 0
        ? "no_previous_data"
        : "available";

  const resolveVehicleType = buildVehicleResolver(vehicles, drivers);
  const routeGroups = new Map<string, BookingDiaryEntry[]>();
  selectedBookings.forEach((booking) => {
    const key = operationalRouteKey(booking);
    routeGroups.set(key, [...(routeGroups.get(key) ?? []), booking]);
  });

  const repeatBookings = [...routeGroups.values()]
    .filter((entries) => new Set(entries.map((entry) => entry.booking_date)).size >= 2)
    .reduce((sum, entries) => sum + entries.length, 0);
  const routeHistoryGroups = new Map<string, BookingDiaryEntry[]>();
  bookings.forEach((booking) => {
    const key = operationalRouteKey(booking);
    routeHistoryGroups.set(key, [...(routeHistoryGroups.get(key) ?? []), booking]);
  });

  const earliestTimestamp = parseDateKey(bounds.earliest)?.timestamp ?? null;
  const initialHistoryCutoff = earliestTimestamp === null ? null : earliestTimestamp + (INITIAL_HISTORY_DAYS - 1) * DAY_MS;
  const firstSeenRoutes = [...routeHistoryGroups.entries()].map(([key, entries]) => {
    const sorted = [...entries].sort((a, b) => a.booking_date.localeCompare(b.booking_date) || a.created_at.localeCompare(b.created_at));
    const first = sorted[0];
    const firstTimestamp = parseDateKey(first.booking_date)?.timestamp ?? 0;
    const selectedEntries = routeGroups.get(key) ?? [];
    const activeBookingDates = new Set(selectedEntries.map((entry) => entry.booking_date)).size;
    const vehicleType = mode(selectedEntries.map((entry) => resolveVehicleType(entry.vehicle))) as CanonicalVehicleType | null;
    let classification: BookingNewRouteInsight["classification"];
    if (initialHistoryCutoff !== null && firstTimestamp <= initialHistoryCutoff) {
      classification = "initial_records";
    } else if (selectedEntries.length === 1) {
      classification = "one_off";
    } else if (selectedEntries.length >= 2 && activeBookingDates >= 2) {
      classification = "recurring_opportunity";
    } else {
      classification = "same_day_repeat";
    }
    return {
      routeKey: key,
      friendlyName: mode(sorted.map(routeName)) ?? routeName(first),
      firstRecordedDate: first.booking_date,
      latestBookingDate: selectedEntries.map((entry) => entry.booking_date).sort().at(-1) ?? first.booking_date,
      bookings: selectedEntries.length,
      activeBookingDates,
      mostRequestedVehicleType: vehicleType ?? "UNCLASSIFIED",
      status: opportunityStatus(activeBookingDates),
      classification
    };
  });
  const routesFirstSeenInSelection = firstSeenRoutes.filter((route) => {
    const booking = { booking_date: route.firstRecordedDate } as BookingDiaryEntry;
    return inRange(booking, selectedPeriod.startDate, selectedPeriod.endDate);
  });
  const newRecurringRouteOpportunities = routesFirstSeenInSelection
    .filter((route) => route.classification === "recurring_opportunity")
    .sort((a, b) => b.activeBookingDates - a.activeBookingDates || b.bookings - a.bookings || b.latestBookingDate.localeCompare(a.latestBookingDate));
  const oneOffNewRoutes = routesFirstSeenInSelection
    .filter((route) => route.classification === "one_off")
    .sort((a, b) => b.firstRecordedDate.localeCompare(a.firstRecordedDate));
  const initialRecordRoutes = routesFirstSeenInSelection
    .filter((route) => route.classification === "initial_records")
    .sort((a, b) => b.firstRecordedDate.localeCompare(a.firstRecordedDate));

  const commonRoutes = [...routeGroups.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => entry.booking_date)).size >= 2)
    .map(([key, entries]): BookingRouteInsight => {
      const distances = entries.filter(hasDistance).map((entry) => entry.estimated_distance_km as number);
      const pickupLocations = new Set(entries.map((entry) => mappedLocationKey(entry.pickup_place_id, entry.pickup_lat, entry.pickup_lng)).filter(Boolean));
      const dropoffLocations = new Set(entries.map((entry) => mappedLocationKey(entry.dropoff_place_id, entry.dropoff_lat, entry.dropoff_lng)).filter(Boolean));
      const vehicleType = mode(entries.map((entry) => resolveVehicleType(entry.vehicle))) as CanonicalVehicleType | null;
      const dates = entries.map((entry) => entry.booking_date);
      return {
        routeKey: key,
        friendlyName: mode(entries.map(routeName)) ?? routeName(entries[0]),
        bookings: entries.length,
        sharePercent: percent(entries.length, selectedBookings.length),
        activeBookingDates: new Set(dates).size,
        averageGapDays: averageGapDays(dates),
        mostRequestedVehicleType: vehicleType ?? "UNCLASSIFIED",
        averageDistanceKm: distances.length ? Math.round((distances.reduce((sum, value) => sum + value, 0) / distances.length) * 10) / 10 : null,
        distanceRecordCount: distances.length,
        latestBookingDate: [...dates].sort().at(-1) ?? "",
        labelVariants: [...new Set(entries.map(routeName))].sort(),
        multipleMappedLocations: pickupLocations.size > 1 || dropoffLocations.size > 1
      };
    })
    .sort((a, b) => b.bookings - a.bookings || b.latestBookingDate.localeCompare(a.latestBookingDate));

  const today = parseDateKey(todayKey);
  const pastSelectedBookings = today
    ? selectedBookings.filter((booking) => (parseDateKey(booking.booking_date)?.timestamp ?? Infinity) < today.timestamp)
    : [];
  const eligibleTripBookings = pastSelectedBookings.filter((booking) => isTripCoverageEligible(booking, todayKey));
  const linkedEligibleTripBookings = eligibleTripBookings.filter((booking) => tripsByBookingId.has(String(booking.id)));
  const linkedSelectedBookings = selectedBookings.filter((booking) => tripsByBookingId.has(String(booking.id)));
  const tripCoverage: BookingTripCoverage = {
    workflowStartDate: TRIP_LINKING_WORKFLOW_START_DATE,
    eligibleBookings: eligibleTripBookings.length,
    linkedEligibleBookings: linkedEligibleTripBookings.length,
    linkedSelectedBookings: linkedSelectedBookings.length,
    historicalBookingsExcluded: pastSelectedBookings.length - eligibleTripBookings.length,
    percent: eligibleTripBookings.length ? percent(linkedEligibleTripBookings.length, eligibleTripBookings.length) : null
  };

  const sortedSelectedDates = selectedBookings.map((booking) => booking.booking_date).sort();
  const latestSelectedDate = sortedSelectedDates.at(-1) ?? null;
  const latestWorkloadEnd = parseDateKey(latestSelectedDate);
  const selectedByDate = new Map<string, number>();
  selectedBookings.forEach((booking) => selectedByDate.set(booking.booking_date, (selectedByDate.get(booking.booking_date) ?? 0) + 1));
  const weeklyWorkload: BookingWeeklyWorkload[] = latestWorkloadEnd
    ? Array.from({ length: 8 }, (_, index) => {
        const weekStartTimestamp = latestWorkloadEnd.timestamp - (7 - index) * 7 * DAY_MS - 6 * DAY_MS;
        const weekStartDate = dateKeyFromTimestamp(weekStartTimestamp);
        const weekEndDate = dateKeyFromTimestamp(weekStartTimestamp + 6 * DAY_MS);
        const dailyCounts = Array.from({ length: 7 }, (__, dayIndex) => selectedByDate.get(dateKeyFromTimestamp(weekStartTimestamp + dayIndex * DAY_MS)) ?? 0);
        const bookingsCount = dailyCounts.reduce((sum, count) => sum + count, 0);
        const activeDays = dailyCounts.filter((count) => count > 0).length;
        return {
          weekStartDate,
          weekEndDate,
          bookings: bookingsCount,
          activeDays,
          averagePerActiveDay: activeDays ? Math.round((bookingsCount / activeDays) * 10) / 10 : 0,
          changePercent: null
        };
      }).map((week, index, weeks) => ({
        ...week,
        changePercent: index === 0 || weeks[index - 1].bookings === 0
          ? null
          : Math.round(((week.bookings - weeks[index - 1].bookings) / weeks[index - 1].bookings) * 1000) / 10
      }))
    : [];
  const highestVolumeWeek = [...weeklyWorkload].sort((a, b) => b.bookings - a.bookings || b.weekStartDate.localeCompare(a.weekStartDate))[0] ?? null;

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdayCounts = new Map<string, number>();
  selectedBookings.forEach((booking) => {
    const date = parseDateKey(booking.booking_date);
    if (date) {
      const label = weekdayNames[new Date(date.timestamp).getUTCDay()];
      weekdayCounts.set(label, (weekdayCounts.get(label) ?? 0) + 1);
    }
  });
  const weekdayOccurrences = new Map<string, number>();
  const selectedStart = parseDateKey(selectedPeriod.startDate);
  const selectedEnd = parseDateKey(selectedPeriod.endDate);
  if (selectedStart && selectedEnd) {
    for (let timestamp = selectedStart.timestamp; timestamp <= selectedEnd.timestamp; timestamp += DAY_MS) {
      const label = weekdayNames[new Date(timestamp).getUTCDay()];
      weekdayOccurrences.set(label, (weekdayOccurrences.get(label) ?? 0) + 1);
    }
  }
  const weekdayDemand: BookingWeekdayDemand[] = weekdayNames
    .map((label) => {
      const count = weekdayCounts.get(label) ?? 0;
      const occurrences = weekdayOccurrences.get(label) ?? 0;
      return {
        label,
        count,
        occurrences,
        percent: percent(count, selectedBookings.length),
        averagePerOccurrence: occurrences ? Math.round((count / occurrences) * 10) / 10 : 0
      };
    })
    .sort((a, b) => b.averagePerOccurrence - a.averagePerOccurrence || b.count - a.count || a.label.localeCompare(b.label));
  const pickupBands = selectedBookings.map((booking) => validPickupTimeBand(booking.pickup_time));
  const validPickupBands = pickupBands.filter((band): band is string => Boolean(band));
  const pickupTimeDemand = countShares(validPickupBands);
  const missingPickupTimeBookings = pickupBands.length - validPickupBands.length;

  const resolvedVehicles = selectedBookings.map((booking) => ({ type: resolveVehicleType(booking.vehicle), raw: booking.vehicle?.trim() || "Missing vehicle" }));
  const vehicleCounts = countShares(resolvedVehicles.map((item) => item.type), selectedBookings.length);
  const vehicleDemand = vehicleCounts.map((item) => ({ ...item, type: item.label as CanonicalVehicleType }));
  const unclassifiedVehicleValues = countShares(resolvedVehicles.filter((item) => item.type === "UNCLASSIFIED").map((item) => item.raw))
    .map((item) => ({ ...item, suggestedType: aliasVehicleType(item.label) }));

  const todayTimestamp = today?.timestamp ?? null;
  const next7End = todayTimestamp === null ? null : todayTimestamp + 6 * DAY_MS;
  const next14End = todayTimestamp === null ? null : todayTimestamp + 13 * DAY_MS;
  const upcoming14 = todayTimestamp === null || next14End === null
    ? []
    : bookings.filter((booking) => {
        const date = parseDateKey(booking.booking_date);
        return Boolean(date && date.timestamp >= todayTimestamp && date.timestamp <= next14End);
      });
  const upcoming7 = todayTimestamp === null || next7End === null
    ? []
    : upcoming14.filter((booking) => (parseDateKey(booking.booking_date)?.timestamp ?? Infinity) <= next7End);
  const upcomingDateCounts = countShares(upcoming14.map((booking) => booking.booking_date));
  const upcomingVehicleCounts = countShares(upcoming14.map((booking) => resolveVehicleType(booking.vehicle)), upcoming14.length)
    .map((item) => ({ ...item, type: item.label as CanonicalVehicleType }));
  const upcomingRouteGroups = new Map<string, BookingDiaryEntry[]>();
  upcoming14.forEach((booking) => {
    const key = operationalRouteKey(booking);
    upcomingRouteGroups.set(key, [...(upcomingRouteGroups.get(key) ?? []), booking]);
  });
  const upcomingRoutes = [...upcomingRouteGroups.entries()].map(([key, entries]): BookingRouteInsight => {
    const dates = entries.map((entry) => entry.booking_date);
    const vehicleType = mode(entries.map((entry) => resolveVehicleType(entry.vehicle))) as CanonicalVehicleType | null;
    return {
      routeKey: key,
      friendlyName: mode(entries.map(routeName)) ?? routeName(entries[0]),
      bookings: entries.length,
      sharePercent: percent(entries.length, upcoming14.length),
      activeBookingDates: new Set(dates).size,
      averageGapDays: averageGapDays(dates),
      mostRequestedVehicleType: vehicleType ?? "UNCLASSIFIED",
      averageDistanceKm: null,
      distanceRecordCount: 0,
      latestBookingDate: [...dates].sort().at(-1) ?? "",
      labelVariants: [...new Set(entries.map(routeName))].sort(),
      multipleMappedLocations: false
    };
  }).sort((a, b) => b.bookings - a.bookings || b.latestBookingDate.localeCompare(a.latestBookingDate));
  const upcomingClientGroups = new Map<string, BookingDiaryEntry[]>();
  upcoming14.forEach((booking) => {
    const key = customerKey(booking);
    if (key && reportingCustomerName(booking)) {
      upcomingClientGroups.set(key, [...(upcomingClientGroups.get(key) ?? []), booking]);
    }
  });
  const upcomingClients = [...upcomingClientGroups.entries()].map(([key, entries]): BookingUpcomingClientInsight => {
    const next7Ids = new Set(upcoming7.map((booking) => booking.id));
    const dates = countShares(entries.map((entry) => entry.booking_date));
    return {
      key,
      name: reportingCustomerName(entries[0])!,
      next7Bookings: entries.filter((entry) => next7Ids.has(entry.id)).length,
      next14Bookings: entries.length,
      busiestDate: dates[0]?.label ?? null,
      mostRequestedVehicleType: (mode(entries.map((entry) => resolveVehicleType(entry.vehicle))) as CanonicalVehicleType | null) ?? "UNCLASSIFIED",
      missingDriverBookings: entries.filter((entry) => !entry.driver?.trim()).length,
      missingPickupTimeBookings: entries.filter((entry) => !validPickupTimeBand(entry.pickup_time)).length
    };
  }).sort((a, b) => b.next14Bookings - a.next14Bookings || a.name.localeCompare(b.name));
  const upcomingWorkload: BookingUpcomingWorkload = {
    next7Bookings: upcoming7.length,
    next14Bookings: upcoming14.length,
    busiestDate: upcomingDateCounts[0]?.label ?? null,
    busiestDateBookings: upcomingDateCounts[0]?.count ?? 0,
    vehicleDemand: upcomingVehicleCounts,
    missingDriverBookings: upcoming14.filter((booking) => !booking.driver?.trim()).length,
    missingPickupTimeBookings: upcoming14.filter((booking) => !validPickupTimeBand(booking.pickup_time)).length,
    topRoutes: upcomingRoutes.slice(0, 5),
    topClients: upcomingClients.slice(0, 5)
  };

  const buildCustomerRows = (entries: BookingDiaryEntry[], previousEntries: BookingDiaryEntry[]) => {
    const groups = new Map<string, { name: string; entries: BookingDiaryEntry[] }>();
    entries.forEach((booking) => {
      const name = reportingCustomerName(booking);
      if (!name) return;
      const key = customerKey(booking);
      if (!key) return;
      const group = groups.get(key) ?? { name, entries: [] };
      group.entries.push(booking);
      groups.set(key, group);
    });
    const previousCounts = new Map<string, number>();
    previousEntries.forEach((booking) => {
      const name = reportingCustomerName(booking);
      const key = customerKey(booking);
      if (name && key) previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1);
    });
    return [...groups.entries()].map(([key, group]): BookingCustomerInsight => {
      const previousCount = comparisonStatus === "available" ? previousCounts.get(key) ?? 0 : null;
      const route = mode(group.entries.map(routeName));
      const vehicleType = mode(group.entries.map((entry) => resolveVehicleType(entry.vehicle))) as CanonicalVehicleType | null;
      const sortedDates = group.entries.map((entry) => entry.booking_date).sort();
      const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const weekdays = group.entries.map((entry) => {
        const parsed = parseDateKey(entry.booking_date);
        return parsed ? weekdayNames[new Date(parsed.timestamp).getUTCDay()] : "";
      }).filter(Boolean);
      const comparable = previousCount !== null && previousCount >= 2 && group.entries.length >= 2;
      return {
        key,
        name: group.name,
        bookings: group.entries.length,
        sharePercent: percent(group.entries.length, selectedBookings.length),
        mostCommonRoute: route,
        mostRequestedVehicleType: vehicleType ?? "UNCLASSIFIED",
        latestBookingDate: sortedDates.at(-1) ?? "",
        firstBookingDate: sortedDates[0] ?? "",
        activeBookingDates: new Set(sortedDates).size,
        mostCommonWeekday: mode(weekdays),
        peakPickupTimeBand: mode(group.entries.map((entry) => validPickupTimeBand(entry.pickup_time)).filter((band): band is string => Boolean(band))),
        sixWheelBookings: group.entries.filter((entry) => resolveVehicleType(entry.vehicle) === "SIX_WHEEL_TRUCK").length,
        previousBookings: previousCount,
        bookingDifference: comparable ? group.entries.length - previousCount : null,
        changePercent: comparable
          ? Math.round(((group.entries.length - previousCount) / previousCount) * 1000) / 10
          : null
      };
    }).sort((a, b) => b.bookings - a.bookings || b.latestBookingDate.localeCompare(a.latestBookingDate));
  };
  const customerActivity = buildCustomerRows(selectedBookings, previousBookings);
  const customerIdsBeforeSelection = new Set(
    bookings
      .filter((booking) => {
        const date = parseDateKey(booking.booking_date);
        const start = parseDateKey(selectedPeriod.startDate);
        return Boolean(date && start && date.timestamp < start.timestamp && customerKey(booking));
      })
      .map(customerKey)
  );
  const newlyActiveCustomers = comparisonStatus === "available"
    ? customerActivity.filter((customer) => !customerIdsBeforeSelection.has(customer.key))
    : [];
  const increasingCustomers = customerActivity.filter((customer) =>
    customer.previousBookings !== null && customer.previousBookings >= 2 && customer.bookings >= 2 && (customer.changePercent ?? 0) > 0
  );
  const reducedCustomers = customerActivity.filter((customer) =>
    customer.previousBookings !== null && customer.previousBookings >= 2 && customer.bookings >= 2 && (customer.changePercent ?? 0) < 0
  );

  const latestSelectedTimestamp = parseDateKey(latestSelectedDate)?.timestamp ?? null;
  const recentCutoff = latestSelectedTimestamp === null ? null : latestSelectedTimestamp - (RECENT_COHORT_DAYS - 1) * DAY_MS;
  const recentBookings = recentCutoff === null ? [] : selectedBookings.filter((booking) => (parseDateKey(booking.booking_date)?.timestamp ?? -Infinity) >= recentCutoff);
  const historicalBookings = recentCutoff === null ? [] : selectedBookings.filter((booking) => (parseDateKey(booking.booking_date)?.timestamp ?? Infinity) < recentCutoff);
  const latestAvailableTimestamp = parseDateKey(bounds.latest)?.timestamp ?? null;
  const recentActivityCutoff = latestAvailableTimestamp === null ? null : latestAvailableTimestamp - (RECENT_COHORT_DAYS - 1) * DAY_MS;
  const regularCustomersWithoutRecentActivity = buildCustomerRows(bookings, [])
    .filter((customer) =>
      customer.bookings >= 2 &&
      customer.activeBookingDates >= 2 &&
      recentActivityCutoff !== null &&
      (parseDateKey(customer.latestBookingDate)?.timestamp ?? Infinity) < recentActivityCutoff
    )
    .sort((a, b) => b.bookings - a.bookings || b.latestBookingDate.localeCompare(a.latestBookingDate));
  const coverage = (entries: BookingDiaryEntry[]) => {
    const captured = entries.filter((booking) => Boolean(booking.client_id && reportingCustomerName(booking))).length;
    return { captured, total: entries.length, percent: entries.length ? percent(captured, entries.length) : null };
  };
  const createdSinceLaunch = selectedBookings.filter((booking) => (booking.created_at ?? "").slice(0, 10) >= CLIENT_CAPTURE_LAUNCH_DATE);
  const clientCoverage: BookingClientCoverage = {
    launchDate: CLIENT_CAPTURE_LAUNCH_DATE,
    overall: coverage(selectedBookings),
    recent: coverage(recentBookings),
    historical: coverage(historicalBookings),
    createdSinceLaunch: coverage(createdSinceLaunch)
  };
  const pickupCaptureRate = (entries: BookingDiaryEntry[]) => entries.length
    ? percent(entries.filter((booking) => Boolean(validPickupTimeBand(booking.pickup_time))).length, entries.length)
    : null;
  const recentPickupCapture = pickupCaptureRate(recentBookings);
  const historicalPickupCapture = pickupCaptureRate(historicalBookings);
  const pickupTrend: PickupTimeTrend = recentPickupCapture === null || historicalPickupCapture === null
    ? "not_comparable"
    : recentPickupCapture >= historicalPickupCapture + 2
      ? "improving"
      : recentPickupCapture <= historicalPickupCapture - 2
        ? "declining"
        : "steady";
  const readinessCohorts = [
    buildReadinessCohort("overall", selectedBookings, tripsByBookingId, todayKey, resolveVehicleType),
    buildReadinessCohort("recent", recentBookings, tripsByBookingId, todayKey, resolveVehicleType),
    buildReadinessCohort("historical", historicalBookings, tripsByBookingId, todayKey, resolveVehicleType)
  ];
  const overallMetrics = readinessCohorts[0].metrics;
  const qualityCandidates: Array<{ key: "pickup_time" | ReadinessKey; missing: number }> = [
    { key: "pickup_time", missing: missingPickupTimeBookings },
    ...overallMetrics.map((metric) => ({ key: metric.key, missing: metric.total - metric.count }))
  ];
  const topDataQualityIssue = qualityCandidates.sort((a, b) => b.missing - a.missing)[0]?.missing ? qualityCandidates[0].key : null;
  const topVehicle = vehicleDemand[0]?.type ?? "UNCLASSIFIED";
  const topFiveRouteSharePercent = percent(commonRoutes.slice(0, 5).reduce((sum, route) => sum + route.bookings, 0), selectedBookings.length);
  const topFiveClientSharePercent = percent(customerActivity.slice(0, 5).reduce((sum, customer) => sum + customer.bookings, 0), selectedBookings.length);
  const topSixWheelClient = [...customerActivity].sort((a, b) => b.sixWheelBookings - a.sixWheelBookings || b.bookings - a.bookings)[0];

  return {
    selectedBookings,
    selectedPeriod,
    previousPeriod,
    earliestAvailableDate: bounds.earliest,
    latestAvailableDate: bounds.latest,
    comparisonStatus,
    summary: {
      totalBookings: selectedBookings.length,
      previousTotalBookings: comparisonStatus === "available" ? previousBookings.length : null,
      bookingChangePercent: comparisonStatus === "available"
        ? Math.round(((selectedBookings.length - previousBookings.length) / previousBookings.length) * 1000) / 10
        : null,
      repeatRoutePercent: percent(repeatBookings, selectedBookings.length),
      newRecurringRouteOpportunityCount: newRecurringRouteOpportunities.length,
      oneOffNewRouteCount: oneOffNewRoutes.length,
      initialRecordRouteCount: initialRecordRoutes.length,
      tripCoveragePercent: tripCoverage.percent,
      mostCommonRoute: commonRoutes[0]?.friendlyName ?? null,
      busiestWeekday: weekdayDemand[0]?.label ?? null,
      busiestWeekdayAverage: weekdayDemand[0]?.averagePerOccurrence ?? null,
      mostRequestedVehicleType: topVehicle,
      peakPickupTimeBand: pickupTimeDemand[0]?.label ?? null,
      topFiveRouteSharePercent,
      topFiveClientSharePercent,
      topUpcomingClient: upcomingClients[0]?.name ?? null,
      topSixWheelClient: topSixWheelClient?.sixWheelBookings ? topSixWheelClient.name : null,
      topDataQualityIssue
    },
    commonRoutes,
    newRecurringRouteOpportunities,
    oneOffNewRoutes,
    initialRecordRoutes,
    insufficientHistoryForNewRoutes: Boolean(initialHistoryCutoff !== null && selectedPeriod.startDate && parseDateKey(selectedPeriod.startDate)?.timestamp! <= initialHistoryCutoff),
    weeklyWorkload,
    highestVolumeWeek,
    upcomingWorkload,
    weekdayDemand,
    pickupTimeDemand,
    validPickupTimeBookings: validPickupBands.length,
    missingPickupTimeBookings,
    pickupTimeCapture: {
      overallPercent: percent(validPickupBands.length, selectedBookings.length),
      recentPercent: recentPickupCapture,
      historicalPercent: historicalPickupCapture,
      trend: pickupTrend
    },
    vehicleDemand,
    unclassifiedVehicleValues,
    customerActivity,
    newlyActiveCustomers,
    increasingCustomers,
    reducedCustomers,
    regularCustomersWithoutRecentActivity,
    customerDataAvailable: bookings.some((booking) => Boolean(booking.client_id && reportingCustomerName(booking))),
    clientCoverage,
    readinessCohorts,
    tripCoverage
  };
}
