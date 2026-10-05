import type { DriverJobEvent, DriverJobEventType, DriverPortalJob } from "@/lib/driver-portal";

export const operationStatuses = ["ready", "pickup", "en_route", "delivery", "completed"] as const;
export type OperationStatus = (typeof operationStatuses)[number];
export const statusCopy = {
  en: { ready: "Ready", pickup: "At pickup", en_route: "En route", delivery: "At delivery", completed: "Completed" },
  th: { ready: "พร้อม", pickup: "ถึงจุดรับ", en_route: "กำลังเดินทาง", delivery: "ถึงจุดส่ง", completed: "จบงานแล้ว" }
};
export function jobStatus(events: Pick<DriverJobEvent, "eventType" | "eventTime">[]): OperationStatus {
  const latest = [...events].sort((a, b) => a.eventTime.localeCompare(b.eventTime)).at(-1);
  const statuses: Record<DriverJobEventType, OperationStatus> = { pickup_arrived: "pickup", pickup_departed: "en_route", delivery_arrived: "delivery", job_completed: "completed" };
  return latest ? statuses[latest.eventType] : "ready";
}
export type DriverWork = { job: DriverPortalJob; events: DriverJobEvent[] };
export function nextDriverJob(jobs: DriverPortalJob[], events: Record<string, DriverJobEvent[]>, today?: string) {
  const unfinished = jobs.filter((j) => (!today || j.bookingDate >= today) && jobStatus(events[j.id] || []) !== "completed")
    .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || (a.pickupTime || "99:99").localeCompare(b.pickupTime || "99:99") || a.id.localeCompare(b.id));
  return unfinished[0] ?? null;
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
export type OperationsResult = { date: string; fetchedAt: string; rows: OperationsRow[] };
export function pickupWaitMinutes(events: DriverJobEvent[], serverTime: string): number | null {
  if (events.some((event) => event.eventType === "pickup_departed" || event.eventType === "job_completed")) return null;
  const arrived = events.find((event) => event.eventType === "pickup_arrived");
  if (!arrived) return null;
  const elapsed = Date.parse(serverTime) - Date.parse(arrived.eventTime);
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 60000) : null;
}
export type OperationsHistoryResult = { rows: OperationsRow[]; hasMore: boolean };
export type OperationalNotification = { id: string; bookingId: string; driverId: string; driverName: string; vehicle: string | null; customer: string | null; pickup: string; arrivedAt: string; createdAt: string; readAt: string | null; resolvedAt: string | null };
export type OperationalNotificationsResult = { items: OperationalNotification[]; unreadCount: number; fetchedAt: string };
