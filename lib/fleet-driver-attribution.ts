/**
 * V7.3 driver attribution for ONE vehicle-day. Pure and read-only.
 *
 * The EES database holds only the driver a vehicle is assigned to NOW (drivers.assigned_vehicle_id); there is no dated assignment
 * history. So this resolver never uses the current assignment, the Booking Diary or GPS positions to say who drove on a past day.
 * What can be used is a dated record that names a driver for that vehicle on that exact day. Today that is a Fuel Log entry. It shows
 * who recorded a fuel purchase, which supports but does not confirm who drove, so it is labelled "supporting evidence only".
 * Confirmed requires a dated assignment-history record, which does not exist yet.
 */
export type DriverEvidenceSource = "assignment_history" | "fuel_log" | "weekly_mileage" | "booking_diary" | "current_assignment";
export type DriverEvidence = { source: DriverEvidenceSource; driverId: string; driverName?: string | null; /** The Bangkok day the record is dated to. */ day: string };
export type DriverAttributionStatus = "confirmed" | "supporting_evidence_only" | "needs_review" | "not_confirmed";
export type DriverAttribution = {
  status: DriverAttributionStatus;
  drivers: { id: string; name: string | null; sources: DriverEvidenceSource[] }[];
  /** Sources that were offered but deliberately not used, so the screen can say so. */
  ignored: DriverEvidenceSource[];
};

/** Sources that may support attribution for a given day, strongest first. */
const SUPPORTING: DriverEvidenceSource[] = ["fuel_log"];

export function resolveDriverForDay(day: string, evidence: readonly DriverEvidence[]): DriverAttribution {
  const ignored = [...new Set(evidence.filter(e => e.source === "booking_diary" || e.source === "current_assignment" || e.source === "weekly_mileage").map(e => e.source))];
  const confirmedRows = evidence.filter(e => e.source === "assignment_history" && e.day === day && e.driverId);
  const supportRows = evidence.filter(e => SUPPORTING.includes(e.source) && e.day === day && e.driverId);
  const group = (rows: readonly DriverEvidence[]) => {
    const byId = new Map<string, { id: string; name: string | null; sources: Set<DriverEvidenceSource> }>();
    for (const r of rows) { const e = byId.get(r.driverId) ?? { id: r.driverId, name: r.driverName ?? null, sources: new Set<DriverEvidenceSource>() }; e.sources.add(r.source); if (!e.name && r.driverName) e.name = r.driverName; byId.set(r.driverId, e); }
    return [...byId.values()].map(e => ({ id: e.id, name: e.name, sources: [...e.sources] })).sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  const confirmed = group(confirmedRows);
  if (confirmed.length === 1) return { status: "confirmed", drivers: confirmed, ignored };
  if (confirmed.length > 1) return { status: "needs_review", drivers: confirmed, ignored };
  const supporting = group(supportRows);
  if (supporting.length === 1) return { status: "supporting_evidence_only", drivers: supporting, ignored };
  if (supporting.length > 1) return { status: "needs_review", drivers: supporting, ignored };
  return { status: "not_confirmed", drivers: [], ignored };
}

type Lang = "en" | "th";
export function driverLabel(a: DriverAttribution, language: Lang, canSeeNames: boolean) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const names = a.drivers.map(d => (canSeeNames ? d.name ?? t("a driver (name unavailable)", "คนขับ (ไม่มีชื่อ)") : t("a driver", "คนขับ"))).join(", ");
  if (a.status === "confirmed") return { title: names, note: t("Confirmed by a dated assignment record.", "ยืนยันโดยบันทึกการมอบหมายที่ระบุวันที่") };
  if (a.status === "supporting_evidence_only") return { title: `${t("Fuel record names", "บันทึกเชื้อเพลิงระบุ")} ${names}`, note: t("Supporting evidence only. A fuel entry shows who recorded the purchase, not who drove.", "เป็นหลักฐานประกอบเท่านั้น บันทึกเชื้อเพลิงแสดงผู้บันทึกการซื้อ ไม่ใช่ผู้ขับ") };
  if (a.status === "needs_review") return { title: t("Driver assignment needs review", "ต้องตรวจสอบการมอบหมายคนขับ"), note: t("More than one driver is named for this day.", "มีคนขับมากกว่าหนึ่งคนในวันนี้") };
  return { title: t("Driver not confirmed", "ยังไม่ยืนยันคนขับ"), note: t("No dated assignment history exists. The vehicle's current driver, the Booking Diary and GPS are not used for past days.", "ยังไม่มีประวัติการมอบหมายที่ระบุวันที่ ไม่ใช้คนขับปัจจุบัน สมุดจอง หรือ GPS สำหรับวันที่ผ่านมา") };
}
