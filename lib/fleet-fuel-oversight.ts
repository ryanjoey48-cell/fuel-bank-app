/**
 * V7.7.1 fleet-wide fuel and mileage oversight. Pure and read-only. It merges two existing, already-authorised read results for the same
 * period: the Fuel Logs range summary (per registry vehicle) and the cache-only Forth day coverage (per registry vehicle). It calculates no
 * new distance, never converts purchases into consumption, never turns an unread or missing source into zero, and never merges registry rows.
 */
export type FuelByTypeInput = { fuelType: string; records: number; litres: number | null; costThb: number | null };
export type FuelVehicleInput = {
  vehicleId: string; registration: string; records: number | null; litres: number | null; costThb: number | null; litresByType: FuelByTypeInput[] | null;
  reviewRecords: number | null; reviewFlags: number | null; registryStatus?: "active" | "inactive" | "duplicate" | "unknown";
  coverage: { records: number; withOdometer: number; withFuelType: number } | null;
};
export type CoverageVehicleInput = {
  vehicleId: string; registration: string; vehicleType: string | null; registryStatus: "active" | "inactive" | "duplicate" | "unknown";
  reviewedDays: number; verifiedDays: number; partlyVerifiedDays: number; unverifiedDays: number; noPositionDays: number;
  providerKm: number | null; providerKmDays: number; gpsKm: number | null; gpsKmDays: number; reviewedDayList: string[]; unverifiedDayList: string[];
  /** V7.8.1 (optional so older callers keep working): days with a material tracking gap, days where reconciled provider km and GPS km disagree, partly verified days. */
  /** V7.8.2: when the earliest cached reviewed day of this vehicle leaves this user's server memory. */
  earliestExpiresAt?: string | null;
  gapDays?: { day: string; minutes: number }[]; disagreeDays?: { day: string; providerKm: number; gpsKm: number }[]; partlyVerifiedDayList?: string[];
};
/** A tracking gap is reported as material from this many recorded-missing minutes in one day (shorter gaps are normal reporting spacing). */
export const MATERIAL_GAP_MINUTES = 60;
/** Same display rule as the Daily Activity headline: at least 5 km and at least 10% of the larger figure. It only decides whether to raise a review item; no figure is adjusted. */
export function distancesDisagree(providerKm: number | null, gpsKm: number | null) {
  if (providerKm === null || gpsKm === null) return false;
  const diff = Math.abs(providerKm - gpsKm);
  return diff >= 5 && diff >= 0.1 * Math.max(providerKm, gpsKm);
}

export type FuelState = "not_loaded" | "unavailable" | "not_attributed" | "no_records" | "recorded";
export type IssueSeverity = "high" | "medium" | "info";
export type IssueKey = "fuel_unusual_records" | "odometer_intervals_review" | "fuel_cost_missing" | "fuel_type_unrecorded" | "registration_shared" | "fuel_without_forth_review" | "positions_not_verified" | "positions_partly_verified" | "tracking_gap_material" | "distance_sources_disagree" | "recurring_unknown_area";
export type OversightIssue = { key: IssueKey; severity: IssueSeverity; evidence: Record<string, number | string>; day: string | null; /** Every day behind the issue (bounded), so a reviewer can go straight to them. */ days?: string[] };
/** One recurring stopping area with no saved-location match that this vehicle returned to on several reviewed days. Counts only: no coordinates. */
export type RecurringUnknownInput = { registration: string; areas: number; distinctDays: number; days: string[] };
export type OversightRow = {
  vehicleId: string; registration: string; vehicleType: string | null; registryStatus: "active" | "inactive" | "duplicate" | "unknown"; eligible: boolean;
  fuelState: FuelState; records: number | null; costThb: number | null; byType: FuelByTypeInput[] | null;
  calendarDays: number; reviewedDays: number; unreviewedDays: number; verifiedDays: number; partlyVerifiedDays: number; unverifiedDays: number; noPositionDays: number;
  providerKm: number | null; providerKmDays: number; gpsKm: number | null; issues: OversightIssue[];
};

export const SEVERITY_RANK: Record<IssueSeverity, number> = { high: 3, medium: 2, info: 1 };
/**
 * V7.8.2 evidence class, separate from severity. "observed": the source itself shows it (a recorded gap, positions returned unverified, a missing
 * field). "candidate": a rule noticed something worth checking; it is not a finding. "insufficient": there is not enough evidence to say anything
 * (for example unreviewed days). None of these claims equipment failure, inactivity, misconduct or a financial discrepancy.
 */
export type IssueClass = "observed" | "candidate" | "insufficient";
export const ISSUE_CLASS: Record<IssueKey, IssueClass> = {
  positions_not_verified: "observed", positions_partly_verified: "observed", tracking_gap_material: "observed", fuel_cost_missing: "observed", fuel_type_unrecorded: "observed", registration_shared: "observed",
  distance_sources_disagree: "candidate", fuel_unusual_records: "candidate", odometer_intervals_review: "candidate", recurring_unknown_area: "candidate",
  fuel_without_forth_review: "insufficient"
};
export const CLASS_COPY: Record<IssueClass, readonly [string, string]> = {
  observed: ["Observed in the source", "พบในข้อมูลต้นทาง"], candidate: ["Review candidate", "ควรตรวจสอบ"], insufficient: ["Insufficient evidence", "หลักฐานไม่พอ"]
};

export function buildOversightRows(input: {
  fuel: { status: "not_loaded" | "available" | "unavailable" | "truncated"; vehicles: readonly FuelVehicleInput[] };
  coverage: readonly CoverageVehicleInput[]; calendarDays: number; recurringUnknown?: readonly RecurringUnknownInput[];
}): OversightRow[] {
  const unknownByReg = new Map((input.recurringUnknown ?? []).map(r => [r.registration, r] as const));
  const fuelById = new Map(input.fuel.vehicles.map(f => [f.vehicleId, f]));
  // The registry list comes from the coverage response (every registry vehicle, once each); the fuel summary is joined by vehicle id and never creates a row.
  return input.coverage.map(c => {
    const f = fuelById.get(c.vehicleId) ?? null;
    const registryStatus = c.registryStatus;
    const eligible = registryStatus === "active" || registryStatus === "unknown";
    const fuelState: FuelState = input.fuel.status === "not_loaded" ? "not_loaded" : input.fuel.status !== "available" ? "unavailable" : !f || f.records === null ? "not_attributed" : f.records === 0 ? "no_records" : "recorded";
    const issues: OversightIssue[] = [];
    if (fuelState === "not_attributed") issues.push({ key: "registration_shared", severity: "info", evidence: {}, day: null });
    if (fuelState === "recorded" && f) {
      if ((f.reviewRecords ?? 0) > 0) issues.push({ key: "fuel_unusual_records", severity: "medium", evidence: { records: f.reviewRecords! }, day: null });
      if ((f.reviewFlags ?? 0) > 0) issues.push({ key: "odometer_intervals_review", severity: "info", evidence: { intervals: f.reviewFlags! }, day: null });
      if (f.costThb === null) issues.push({ key: "fuel_cost_missing", severity: "info", evidence: { records: f.records! }, day: null });
      const untyped = f.coverage ? f.coverage.records - f.coverage.withFuelType : 0;
      if (untyped > 0) issues.push({ key: "fuel_type_unrecorded", severity: "info", evidence: { records: untyped }, day: null });
      if (c.reviewedDays === 0) issues.push({ key: "fuel_without_forth_review", severity: "info", evidence: { days: input.calendarDays }, day: null });
    }
    // A whole reviewed day without a single verified position is a material GPS problem; a partly verified day is informational.
    if (c.unverifiedDays > 0) issues.push({ key: "positions_not_verified", severity: "medium", evidence: { days: c.unverifiedDays }, day: c.unverifiedDayList[0] ?? null, days: c.unverifiedDayList.slice(0, 10) });
    if ((c.partlyVerifiedDayList?.length ?? 0) > 0) issues.push({ key: "positions_partly_verified", severity: "info", evidence: { days: c.partlyVerifiedDayList!.length }, day: c.partlyVerifiedDayList![0], days: c.partlyVerifiedDayList!.slice(0, 10) });
    const gaps = (c.gapDays ?? []).filter(g => g.minutes >= MATERIAL_GAP_MINUTES);
    if (gaps.length) { const worst = [...gaps].sort((a, b) => b.minutes - a.minutes)[0]; issues.push({ key: "tracking_gap_material", severity: "medium", evidence: { days: gaps.length, longest_min: Math.round(worst.minutes) }, day: worst.day, days: gaps.map(g => g.day).slice(0, 10) }); }
    const dis = c.disagreeDays ?? [];
    if (dis.length) { const worst = [...dis].sort((a, b) => Math.abs(b.providerKm - b.gpsKm) - Math.abs(a.providerKm - a.gpsKm))[0]; issues.push({ key: "distance_sources_disagree", severity: "medium", evidence: { days: dis.length, largest_diff_km: Math.round(Math.abs(worst.providerKm - worst.gpsKm) * 10) / 10 }, day: worst.day, days: dis.map(d => d.day).slice(0, 10) }); }
    const unk = unknownByReg.get(c.registration);
    if (unk && unk.areas > 0) issues.push({ key: "recurring_unknown_area", severity: unk.distinctDays >= 3 ? "medium" : "info", evidence: { areas: unk.areas, days: unk.distinctDays }, day: unk.days[0] ?? null, days: unk.days.slice(0, 10) });
    return {
      vehicleId: c.vehicleId, registration: c.registration, vehicleType: c.vehicleType, registryStatus, eligible,
      fuelState, records: f?.records ?? null, costThb: f?.costThb ?? null, byType: f?.litresByType ?? null,
      calendarDays: input.calendarDays, reviewedDays: c.reviewedDays, unreviewedDays: Math.max(0, input.calendarDays - c.reviewedDays),
      verifiedDays: c.verifiedDays, partlyVerifiedDays: c.partlyVerifiedDays, unverifiedDays: c.unverifiedDays, noPositionDays: c.noPositionDays,
      providerKm: c.providerKmDays > 0 ? c.providerKm : null, providerKmDays: c.providerKmDays, gpsKm: c.gpsKmDays > 0 ? c.gpsKm : null, issues
    };
  });
}

export type OversightSummary = {
  eligibleVehicles: number; excluded: { inactive: number; duplicate: number };
  vehiclesWithFuel: number; vehiclesNoRecord: number; vehiclesNotLoaded: number; vehiclesNotAttributed: number;
  vehiclesWithReviewedForth: number; reviewedVehicleDays: number; eligibleVehicleDays: number;
  providerKm: number | null; providerKmVehicles: number; gpsKm: number | null; vehiclesWithIssues: number;
};
/** Fleet figures over ELIGIBLE vehicles (active or status unknown). Inactive and duplicate registry rows are counted aside, never merged or hidden. */
export function summarizeOversight(rows: readonly OversightRow[]): OversightSummary {
  const eligible = rows.filter(r => r.eligible);
  const withProvider = eligible.filter(r => r.providerKm !== null), withGps = eligible.filter(r => r.gpsKm !== null);
  const sum = (v: number[]) => Math.round(v.reduce((n, x) => n + x, 0) * 100) / 100;
  return {
    eligibleVehicles: eligible.length, excluded: { inactive: rows.filter(r => r.registryStatus === "inactive").length, duplicate: rows.filter(r => r.registryStatus === "duplicate").length },
    vehiclesWithFuel: eligible.filter(r => r.fuelState === "recorded").length, vehiclesNoRecord: eligible.filter(r => r.fuelState === "no_records").length,
    vehiclesNotLoaded: eligible.filter(r => r.fuelState === "not_loaded" || r.fuelState === "unavailable").length, vehiclesNotAttributed: eligible.filter(r => r.fuelState === "not_attributed").length,
    vehiclesWithReviewedForth: eligible.filter(r => r.reviewedDays > 0).length, reviewedVehicleDays: eligible.reduce((n, r) => n + r.reviewedDays, 0), eligibleVehicleDays: eligible.reduce((n, r) => n + r.calendarDays, 0),
    providerKm: withProvider.length ? sum(withProvider.map(r => r.providerKm!)) : null, providerKmVehicles: withProvider.length, gpsKm: withGps.length ? sum(withGps.map(r => r.gpsKm!)) : null,
    vehiclesWithIssues: eligible.filter(r => r.issues.some(i => i.severity !== "info")).length
  };
}

export type SortKey = "registration" | "spend" | "distance" | "missing_evidence" | "issues";
export type ShowFilter = "all" | "with_fuel" | "without_fuel" | "issues" | "unreviewed" | "excluded";
export function filterSortRows(rows: readonly OversightRow[], opts: { search: string; show: ShowFilter; sort: SortKey }): OversightRow[] {
  const norm = (s: string) => s.normalize("NFKC").replace(/[\s-]/g, "").toLowerCase();
  const q = norm(opts.search);
  const reg = (a: OversightRow, b: OversightRow) => a.registration.localeCompare(b.registration);
  const score = (r: OversightRow) => r.issues.reduce((n, i) => n + SEVERITY_RANK[i.severity] * 10 + 1, 0);
  const pass = (r: OversightRow) => (opts.show === "excluded" ? !r.eligible : r.eligible) && (!q || norm(r.registration).includes(q)) &&
    (opts.show === "all" || opts.show === "excluded" || (opts.show === "with_fuel" ? r.fuelState === "recorded" : opts.show === "without_fuel" ? r.fuelState === "no_records" : opts.show === "issues" ? r.issues.length > 0 : r.reviewedDays === 0));
  const out = rows.filter(pass);
  const num = (pick: (r: OversightRow) => number | null) => (a: OversightRow, b: OversightRow) => (pick(b) ?? -1) - (pick(a) ?? -1) || reg(a, b);
  switch (opts.sort) {
    case "spend": return out.sort(num(r => r.costThb));
    case "distance": return out.sort(num(r => r.providerKm));
    case "missing_evidence": return out.sort(num(r => r.unreviewedDays));
    case "issues": return out.sort(num(score));
    default: return out.sort(reg);
  }
}

export type RelatedIssue = { key: IssueKey; days: string[] };
export type OversightIssueGroup = { key: IssueKey; severity: IssueSeverity; vehicles: { vehicleId: string; registration: string; severity: IssueSeverity; evidence: Record<string, number | string>; day: string | null; days: string[]; related: RelatedIssue[] }[] };
/**
 * V7.8.3: other day-level notices for the SAME vehicle that share at least one date with this one. They come from the same reviewed
 * vehicle-day evidence (for example a distance disagreement on a day that also has a 60-minute tracking gap), so the office can treat them
 * as one investigation instead of separate warnings. Only dated issues are linked; nothing is merged, removed or re-graded.
 */
export function relatedDayIssues(row: OversightRow, key: IssueKey): RelatedIssue[] {
  const self = row.issues.find(i => i.key === key); const own = new Set(self?.days ?? (self?.day ? [self.day] : []));
  if (!own.size) return [];
  return row.issues.filter(i => i.key !== key).map(i => ({ key: i.key, days: (i.days ?? (i.day ? [i.day] : [])).filter(d => own.has(d)).sort() })).filter(r => r.days.length > 0);
}
/** One group per issue type (repeated notices are grouped, one entry per vehicle). Eligible vehicles only; higher severity first. */
export function groupOversightIssues(rows: readonly OversightRow[]): OversightIssueGroup[] {
  const groups = new Map<IssueKey, OversightIssueGroup>();
  for (const r of rows) if (r.eligible) for (const i of r.issues) {
    const g = groups.get(i.key) ?? { key: i.key, severity: i.severity, vehicles: [] };
    if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[g.severity]) g.severity = i.severity;
    if (!g.vehicles.some(v => v.vehicleId === r.vehicleId)) g.vehicles.push({ vehicleId: r.vehicleId, registration: r.registration, severity: i.severity, evidence: i.evidence, day: i.day, days: i.days ?? (i.day ? [i.day] : []), related: relatedDayIssues(r, i.key) });
    groups.set(i.key, g);
  }
  const list = [...groups.values()];
  for (const g of list) g.vehicles.sort((a, b) => a.registration.localeCompare(b.registration));
  return list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.vehicles.length - a.vehicles.length || a.key.localeCompare(b.key));
}

type Pair = readonly [string, string];
export const OVERSIGHT_ISSUE_COPY: Record<IssueKey, { title: Pair; reason: Pair; action: Pair; source: Pair }> = {
  fuel_unusual_records: { title: ["Fuel Log records that look unusual", "บันทึกเชื้อเพลิงที่ดูผิดปกติ"], reason: ["Price per litre outside ฿10–100, or zero or missing values. Totals include them exactly as recorded.", "ราคาต่อลิตรนอกช่วง ฿10–100 หรือค่าเป็นศูนย์/ขาด ยอดรวมใช้ค่าตามที่บันทึก"], action: ["Check the records in Fuel Logs. Nothing is changed here.", "ตรวจสอบในบันทึกเชื้อเพลิง ไม่มีการแก้ไขที่นี่"], source: ["Fuel Logs", "บันทึกเชื้อเพลิง"] },
  odometer_intervals_review: { title: ["Odometer intervals need review", "ช่วงเลขไมล์ที่ต้องตรวจสอบ"], reason: ["A reading decreased, jumped implausibly, repeated, or an interval was withheld.", "เลขไมล์ลดลง กระโดดผิดปกติ ซ้ำ หรือช่วงถูกระงับ"], action: ["Open the vehicle's Fuel Intelligence for the exact intervals.", "เปิดข้อมูลเชื้อเพลิงของรถเพื่อดูช่วงที่แน่นอน"], source: ["Fuel Log odometer", "เลขไมล์จากบันทึกเชื้อเพลิง"] },
  fuel_cost_missing: { title: ["Fuel records without a cost", "รายการเชื้อเพลิงที่ไม่มีจำนวนเงิน"], reason: ["The spend total for this vehicle is unknown, not zero.", "ยอดค่าใช้จ่ายของรถคันนี้ไม่ทราบ ไม่ใช่ศูนย์"], action: ["Check the cost entries in Fuel Logs.", "ตรวจสอบจำนวนเงินในบันทึกเชื้อเพลิง"], source: ["Fuel Logs", "บันทึกเชื้อเพลิง"] },
  fuel_type_unrecorded: { title: ["Fuel records without a fuel type", "รายการเชื้อเพลิงที่ไม่ระบุชนิด"], reason: ["Litres are kept per type; these records are shown separately and not added to any type.", "ลิตรแยกตามชนิด รายการเหล่านี้แยกไว้และไม่รวมเข้าชนิดใด"], action: ["Check the fuel type in Fuel Logs.", "ตรวจสอบชนิดเชื้อเพลิงในบันทึกเชื้อเพลิง"], source: ["Fuel Logs", "บันทึกเชื้อเพลิง"] },
  registration_shared: { title: ["Registration shared by more than one registry vehicle", "ทะเบียนซ้ำในทะเบียนรถ"], reason: ["Purchases are not attributed to either row and the rows are not merged.", "ไม่ระบุการซื้อให้รถคันใดและไม่รวมแถว"], action: ["Resolve in the vehicle registry (outside Fleet Tracking).", "แก้ไขในทะเบียนรถ (นอก Fleet Tracking)"], source: ["Vehicle registry", "ทะเบียนรถ"] },
  fuel_without_forth_review: { title: ["Fuel recorded but no Forth day reviewed", "มีบันทึกเชื้อเพลิงแต่ยังไม่ได้ตรวจวัน Forth"], reason: ["No Forth distance evidence is cached for this period, so no distance comparison is possible. Fuel bought on unreviewed days is not a discrepancy and this is not zero driving.", "ไม่มีหลักฐานระยะทาง Forth ในแคชของช่วงนี้ จึงเทียบระยะทางไม่ได้ เชื้อเพลิงที่ซื้อในวันที่ยังไม่ตรวจไม่ใช่ความผิดปกติ และไม่ได้หมายความว่าไม่ได้ขับ"], action: ["Read specific days in Daily Activity if a comparison is needed. Nothing is read automatically.", "อ่านบางวันใน กิจกรรมประจำวัน หากต้องการเปรียบเทียบ ไม่มีการอ่านอัตโนมัติ"], source: ["Forth day cache", "แคชวัน Forth"] },
  positions_not_verified: { title: ["Reviewed days with no GPS-verified position", "วันที่ตรวจแล้วแต่ไม่มีตำแหน่งที่ยืนยันด้วย GPS"], reason: ["Every position Forth returned for these days is unverified; distances from them stay provider-reported and no visit location is verified. This alone does not show a faulty tracker.", "ตำแหน่งทั้งหมดที่ Forth ส่งในวันเหล่านี้ไม่ยืนยัน ระยะทางยังเป็นค่าที่ผู้ให้บริการรายงาน และไม่มีตำแหน่งการเข้าเยี่ยมที่ยืนยัน ลำพังเรื่องนี้ไม่ได้แสดงว่าตัวติดตามเสีย"], action: ["Open the day in Daily Activity and check GPS health. The tracker is not necessarily faulty.", "เปิดวันนั้นใน กิจกรรมประจำวัน และตรวจสถานะ GPS ตัวติดตามไม่จำเป็นต้องเสีย"], source: ["Forth day evidence", "หลักฐานวัน Forth"] },
  positions_partly_verified: { title: ["Reviewed days with partly verified positions", "วันที่ตรวจแล้วที่ยืนยันตำแหน่งบางส่วน"], reason: ["Some positions are verified and some are not; verified ones are used where GPS is required.", "บางตำแหน่งยืนยันแล้วและบางส่วนยังไม่ยืนยัน ใช้เฉพาะที่ยืนยันเมื่อจำเป็นต้องใช้ GPS"], action: ["Open the day in Daily Activity.", "เปิดวันนั้นใน กิจกรรมประจำวัน"], source: ["Forth day evidence", "หลักฐานวัน Forth"] },
  tracking_gap_material: { title: ["Material tracking gaps (60+ minutes in a day)", "ช่วงขาดการติดตามที่มีนัยสำคัญ (60 นาทีขึ้นไปในหนึ่งวัน)"], reason: ["The report shows periods with no tracker data. Distance there is unknown and time is never counted as stay. Missing data is not evidence that the vehicle was idle.", "รายงานแสดงช่วงที่ไม่มีข้อมูลจากตัวติดตาม ระยะทางช่วงนั้นไม่ทราบ และไม่นับเป็นเวลาจอด ข้อมูลที่ขาดไม่ใช่หลักฐานว่ารถไม่ได้ใช้งาน"], action: ["Open the day to see where the gap falls in the timeline.", "เปิดวันนั้นเพื่อดูว่าช่วงขาดอยู่ตรงไหนในไทม์ไลน์"], source: ["Forth journey ledger", "บัญชีเที่ยวของ Forth"] },
  distance_sources_disagree: { title: ["Forth report and GPS distance disagree", "ระยะทางรายงาน Forth กับ GPS ไม่ตรงกัน"], reason: ["At least 5 km and 10% apart on a reconciled day. They measure different things and neither is declared correct; nothing is adjusted.", "ต่างกันอย่างน้อย 5 กม. และ 10% ในวันที่กระทบยอดแล้ว วัดคนละอย่างและไม่ตัดสินว่าแหล่งใดถูก ไม่มีการปรับตัวเลข"], action: ["Open the day and check coverage gaps and the open final segment.", "เปิดวันนั้นและตรวจช่วงขาดและช่วงสุดท้ายที่ยังไม่ปิด"], source: ["Forth report vs GPS", "รายงาน Forth เทียบ GPS"] },
  recurring_unknown_area: { title: ["Recurring stopping areas with no saved location", "พื้นที่จอดซ้ำที่ไม่มีสถานที่ที่บันทึก"], reason: ["The vehicle stopped at the same unnamed area on several reviewed days. It is not given a company name and is not a violation.", "รถจอดที่พื้นที่เดิมที่ไม่มีชื่อในหลายวันที่ตรวจแล้ว ไม่ตั้งชื่อบริษัทให้ และไม่ใช่การกระทำผิด"], action: ["Open the day, view the visit location, and use Recurring places to review. Nothing is saved automatically.", "เปิดวันนั้น ดูตำแหน่งการเข้าเยี่ยม และใช้ จุดที่เกิดซ้ำ เพื่อตรวจสอบ ไม่มีการบันทึกอัตโนมัติ"], source: ["Recurring places (cached days)", "จุดที่เกิดซ้ำ (วันในแคช)"] }
};
export const FUEL_STATE_COPY: Record<FuelState, Pair> = {
  not_loaded: ["Fuel evidence not loaded", "ยังไม่ได้โหลดข้อมูลเชื้อเพลิง"], unavailable: ["Fuel source unavailable", "แหล่งเชื้อเพลิงไม่พร้อม"], not_attributed: ["Not attributed (shared registration)", "ไม่ระบุให้รถ (ทะเบียนซ้ำ)"],
  no_records: ["No fuel record found", "ไม่พบบันทึกเชื้อเพลิง"], recorded: ["Recorded", "มีบันทึก"]
};
export const SORT_COPY: Record<SortKey, Pair> = {
  registration: ["Registration", "ทะเบียน"], spend: ["Highest recorded spend", "ค่าใช้จ่ายที่บันทึกสูงสุด"], distance: ["Largest reviewed distance", "ระยะทางที่ตรวจแล้วมากสุด"], missing_evidence: ["Most missing evidence", "ขาดหลักฐานมากสุด"], issues: ["Most significant issues", "ปัญหาสำคัญมากสุด"]
};

/** What the server keeps from one cached provider day for the period coverage: distance and verification counts only (no positions, journeys or drivers). */
export type CachedDayFacts = { day: string; providerKm: number | null; providerReconciled: boolean; gpsKm: number | null; logAvailable: boolean; observations: number; verifiedObservations: number; /** Recorded-missing minutes from the journey ledger, when the ledger is available. */ missingMinutes?: number | null };
/** Recurring analysis areas (as returned by the recurring route) reduced to unknown areas per vehicle. Counts and dates only. */
export function unknownAreasByVehicle(areas: readonly { vehicles: readonly string[]; distinctDays: number; days: readonly string[]; siteMatch?: { status: string } | null; visitList?: readonly { registration: string; day: string }[] }[]): RecurringUnknownInput[] {
  const out = new Map<string, { areas: number; days: Set<string> }>();
  for (const a of areas) {
    if (a.siteMatch && a.siteMatch.status !== "unknown_stopping_area") continue;
    if (a.distinctDays < 2) continue;
    for (const reg of a.vehicles) {
      const days = (a.visitList ?? []).filter(v => v.registration === reg).map(v => v.day);
      const e = out.get(reg) ?? { areas: 0, days: new Set<string>() }; e.areas++; for (const d of days.length ? days : a.days) e.days.add(d); out.set(reg, e);
    }
  }
  return [...out.entries()].map(([registration, e]) => ({ registration, areas: e.areas, distinctDays: e.days.size, days: [...e.days].sort() }));
}
/** Pure coverage fold over the days that ARE in this user's cache. Days not in the cache are simply absent: not reviewed, never zero driving. */
export function summarizeCachedDays(facts: readonly CachedDayFacts[]): Omit<CoverageVehicleInput, "vehicleId" | "registration" | "vehicleType" | "registryStatus"> {
  const round = (n: number) => Math.round(n * 100) / 100;
  let verified = 0, partly = 0, unverified = 0, none = 0, providerKm = 0, providerDays = 0, gpsKm = 0, gpsDays = 0;
  const reviewedDayList: string[] = [], unverifiedDayList: string[] = [], partlyVerifiedDayList: string[] = [], gapDays: { day: string; minutes: number }[] = [], disagreeDays: { day: string; providerKm: number; gpsKm: number }[] = [];
  for (const f of [...facts].sort((a, b) => a.day.localeCompare(b.day))) {
    reviewedDayList.push(f.day);
    if (f.providerReconciled && f.providerKm !== null) { providerKm += f.providerKm; providerDays++; }
    if (f.logAvailable && f.observations > 0) {
      if (f.verifiedObservations === f.observations) verified++; else if (f.verifiedObservations === 0) { unverified++; unverifiedDayList.push(f.day); } else { partly++; partlyVerifiedDayList.push(f.day); }
    } else none++;
    if (f.gpsKm !== null) { gpsKm += f.gpsKm; gpsDays++; }
    if (typeof f.missingMinutes === "number" && f.missingMinutes > 0) gapDays.push({ day: f.day, minutes: f.missingMinutes });
    if (f.providerReconciled && distancesDisagree(f.providerKm, f.gpsKm)) disagreeDays.push({ day: f.day, providerKm: f.providerKm!, gpsKm: f.gpsKm! });
  }
  return { reviewedDays: facts.length, verifiedDays: verified, partlyVerifiedDays: partly, unverifiedDays: unverified, noPositionDays: none,
    providerKm: providerDays ? round(providerKm) : null, providerKmDays: providerDays, gpsKm: gpsDays ? round(gpsKm) : null, gpsKmDays: gpsDays, reviewedDayList, unverifiedDayList, partlyVerifiedDayList, gapDays, disagreeDays };
}
