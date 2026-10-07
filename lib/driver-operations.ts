import type { DriverJobEvent, DriverJobEventType, DriverPortalJob } from "@/lib/driver-portal";

export const operationStatuses = ["ready", "pickup", "en_route", "delivery", "completed"] as const;
export type OperationStatus = (typeof operationStatuses)[number];
export const statusCopy = {
  en: { ready: "Ready", pickup: "At pickup", en_route: "En route", delivery: "At delivery", completed: "Completed" },
  th: { ready: "พร้อม", pickup: "ถึงจุดรับ", en_route: "กำลังเดินทาง", delivery: "ถึงจุดส่ง", completed: "จบงานแล้ว" }
};
const progressStatus: Record<DriverJobEventType, OperationStatus> = {
  pickup_arrived: "pickup", pickup_departed: "en_route", delivery_arrived: "delivery", job_completed: "completed"
};
/** The append-only workflow is ordered by event type, never by assignment or clock skew. */
export function normalizeDriverJobProgress<T extends Pick<DriverJobEvent, "eventType" | "eventTime">>(events: readonly T[]) {
  const ordered = [...events].sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  let stage = 0;
  let lastEvent: T | null = null;
  for (const event of ordered) {
    const status = progressStatus[event.eventType];
    if (typeof status !== "string") throw new Error("Invalid driver progress event.");
    const next = operationStatuses.indexOf(status);
    if (next >= stage) { stage = next; lastEvent = event; }
  }
  return { events: ordered, stage, status: operationStatuses[stage], completed: stage === 4, lastEvent };
}
export function jobStatus(events: Pick<DriverJobEvent, "eventType" | "eventTime">[]): OperationStatus {
  return normalizeDriverJobProgress(events).status;
}
export type DriverWork = { job: DriverPortalJob; events: DriverJobEvent[] };
/** Booking dates are Bangkok calendar keys; compare them without UTC conversion. */
export function compareDriverJobs(a: DriverPortalJob, b: DriverPortalJob) {
  return a.bookingDate.localeCompare(b.bookingDate)
    || (a.pickupTime?.trim().slice(0, 5) || "99:99").localeCompare(b.pickupTime?.trim().slice(0, 5) || "99:99")
    || a.id.localeCompare(b.id);
}

export function driverHomeJobs(jobs: DriverPortalJob[], events: Record<string, DriverJobEvent[]>, today?: string, driverId?: string) {
  // The server enforces assignment. Retain that identity in the model so every
  // Home section also derives from the same eligible, unique collection.
  const unique = new Map<string, DriverPortalJob>();
  for (const job of jobs) {
    if (driverId && job.driverId && job.driverId !== driverId) continue;
    const bookingStatus = job.bookingStatus?.trim().toLowerCase();
    if (["completed", "cancelled", "canceled", "rejected"].includes(bookingStatus || "")) continue;
    const status = jobStatus(events[job.id] || []);
    if (status === "completed") continue;
    if (today && job.bookingDate < today && status === "ready") continue;
    if (!unique.has(job.id)) unique.set(job.id, job);
  }
  const normalizedJobs = [...unique.values()].sort(compareDriverJobs);
  const currentJob = normalizedJobs.find(job => jobStatus(events[job.id] || []) !== "ready") ?? null;
  const todayJobs = normalizedJobs.filter(job => job.bookingDate === today);
  const futureJobs = normalizedJobs.filter(job => !today || job.bookingDate > today);
  const nextJob = currentJob ?? todayJobs[0] ?? futureJobs[0] ?? null;
  const additionalTodayJobs = todayJobs.filter(job => job.id !== nextJob?.id);
  const tomorrow = today ? nextBangkokDate(today) : null;
  const tomorrowJobs = futureJobs.filter(job => job.bookingDate === tomorrow && job.id !== nextJob?.id);
  const laterJobs = futureJobs.filter(job => job.bookingDate !== tomorrow && job.id !== nextJob?.id);
  const groups = new Map<string, DriverPortalJob[]>();
  for (const job of normalizedJobs) {
    if (job.id === nextJob?.id || (today && job.bookingDate < today)) continue;
    const group = groups.get(job.bookingDate) ?? [];
    group.push(job);
    groups.set(job.bookingDate, group);
  }
  return { normalizedJobs, currentJob, nextJob, remainingTodayCount: todayJobs.length,
    additionalTodayJobs, tomorrowJobs, laterJobs, upcomingGroups: [...groups.entries()] };
}

export function nextBangkokDate(dateKey: string) {
  const date = new Date(dateKey + "T12:00:00+07:00");
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export function nextDriverJob(jobs: DriverPortalJob[], events: Record<string, DriverJobEvent[]>, today?: string) {
  return driverHomeJobs(jobs, events, today).nextJob;
}
export type DriverProfile = {
  displayName: string; officialName: string; email: string; phone: string;
  driverId: string; vehicle: string | null; avatarUrl: string | null; lastLogin: string | null;
};
export type OperationsRow = DriverWork & {
  driverId: string; driverName: string; accountActive: boolean | null;
  profile: DriverProfile | null;
  waitingMinutes?: number | null;
};
export type OperationsSummary = { driversToday: number; jobsToday: number; activeNow: number; attention: number; completedToday: number };
export type OperationsResult = { date: string; fetchedAt: string; rows: OperationsRow[]; summary: OperationsSummary; driverActivity: Record<string, { jobsToday: number; status: OperationStatus | null }> };
export function pickupWaitMinutes(events: DriverJobEvent[], serverTime: string): number | null {
  if (events.some((event) => event.eventType === "pickup_departed" || event.eventType === "job_completed")) return null;
  const arrived = events.find((event) => event.eventType === "pickup_arrived");
  if (!arrived) return null;
  const elapsed = Date.parse(serverTime) - Date.parse(arrived.eventTime);
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 60000) : null;
}
export type OperationsHistoryResult = { rows: OperationsRow[]; hasMore: boolean; total: number; page: number; pageSize: number };
export type OperationsDriverDetail = { driverId: string; driverName: string; currentVehicle: string | null; portalActive: boolean | null; profile: DriverProfile | null; date: string; stats: { jobsToday: number; activeNow: number; completedToday: number; completedLast7Days: number; totalCompleted: number }; recentCompleted: OperationsRow[]; recentAssigned: DriverPortalJob[] };
export type OperationalNotification = { id: string; bookingId: string; driverId: string; driverName: string; vehicle: string | null; customer: string | null; pickup: string; arrivedAt: string; createdAt: string; readAt: string | null; resolvedAt: string | null };
export type OperationalNotificationsResult = { items: OperationalNotification[]; unreadCount: number; fetchedAt: string };

/** The completion event, rather than planned booking date, owns completion KPIs. */
export function completedDriverEvent(events: DriverJobEvent[]) {
  return events.find(event => event.eventType === "job_completed") ?? null;
}
export function bangkokOperationalDate(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(typeof value === "string" ? new Date(value) : value);
}
export function shiftBangkokDate(dateKey: string, days: number) {
  const date = new Date(dateKey + "T12:00:00+07:00");
  date.setUTCDate(date.getUTCDate() + days);
  return bangkokOperationalDate(date);
}
export function driverCompletedOn(events: DriverJobEvent[], date: string) {
  const completed = completedDriverEvent(events);
  return !!completed && bangkokOperationalDate(completed.eventTime) === date;
}
export function driverDurationMinutes(events: DriverJobEvent[]) {
  const start = events.find(event => event.eventType === "pickup_arrived");
  const completed = completedDriverEvent(events);
  if (!start || !completed) return null;
  const minutes = (Date.parse(completed.eventTime) - Date.parse(start.eventTime)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;
}
export function hasOperationalAttention(row: OperationsRow, fetchedAt: string) {
  if (jobStatus(row.events) === "completed") return false;
  if (["cancelled", "canceled", "rejected"].includes(row.job.bookingStatus?.trim().toLowerCase() || "")) return false;
  if (!row.job.pickupName.trim() || !row.job.dropoffName.trim() || row.accountActive === false || (row.waitingMinutes ?? -1) >= 30) return true;
  if (row.job.bookingStatus?.trim().toLowerCase() === "completed") return true;
  if (jobStatus(row.events) === "ready" && row.job.pickupTime && /^\d{2}:\d{2}/.test(row.job.pickupTime)) {
    return Date.parse(row.job.bookingDate + "T" + row.job.pickupTime.slice(0, 5) + ":00+07:00") < Date.parse(fetchedAt);
  }
  return false;
}
