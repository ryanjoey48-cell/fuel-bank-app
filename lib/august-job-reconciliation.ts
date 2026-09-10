import type { BookingDiaryEntry } from "@/types/database";

export type AugustJobStatus =
  | "exact_match"
  | "probable_match"
  | "new_job"
  | "duplicate"
  | "missing_registration"
  | "conflict";

export type AugustBossJobRow = {
  sourceRowNumber: number;
  date: string;
  client?: string | null;
  pickup: string;
  dropoff: string;
  vehicleType?: string | null;
  registrationCell?: string | null;
  driver?: string | null;
  jobOrderNumber?: string | null;
  pickupTime?: string | null;
  notes?: string | null;
};

export type AugustBookingRow = Pick<
  BookingDiaryEntry,
  | "id"
  | "booking_id"
  | "booking_date"
  | "pickup_time"
  | "client_id"
  | "client"
  | "pickup"
  | "dropoff"
  | "pickup_address"
  | "dropoff_address"
  | "warehouse_no"
  | "vehicle"
  | "vehicle_registration"
  | "trailer_registration"
  | "driver"
  | "job_order_number"
  | "notes"
  | "created_by"
  | "created_by_user_id"
  | "modified_by"
  | "created_at"
  | "updated_at"
>;

export type DriverAssignmentRow = {
  name: string;
  vehicleRegistration: string;
  vehicleType?: string | null;
};

export type AugustJobReconciliationItem = {
  id: string;
  sourceRowNumber: number;
  sourceFingerprint: string;
  status: AugustJobStatus;
  confidence: number;
  reason: string;
  evidence: string[];
  bossRow: AugustBossJobRow & {
    mainRegistration: string | null;
    trailerRegistration: string | null;
  };
  existingBooking: AugustBookingRow | null;
  candidateBookings: AugustBookingRow[];
  proposedValues: {
    vehicle_registration: string | null;
    trailer_registration: string | null;
    vehicle: string | null;
    driver: string | null;
    job_order_number: string | null;
  };
};

export type AugustJobReconciliationResult = {
  items: AugustJobReconciliationItem[];
  summary: Record<AugustJobStatus, number> & { total: number };
};

const AUGUST_START = "2026-08-01";
const AUGUST_END = "2026-08-07";

const DESCRIPTION_PATTERNS = [
  /^(?:4|6|10|18)\s*(?:wheel|wheeler|ล้อ)/i,
  /ล้อ/,
  /คอก/,
  /เฮียบ/,
  /พ่วง/
];

const ROUTE_ALIASES = new Map<string, string>([
  ["สุวรรณภูมิ", "suvarnabhumi"],
  ["สุวรรณภมิ", "suvarnabhumi"],
  ["ท่าเรือ", "port"],
  ["ท่าเรือชายฝั่ง", "port"],
  ["w h", "warehouse"],
  ["wh", "warehouse"],
  ["กม39", "km39"],
  ["กม 39", "km39"],
  ["km39", "km39"],
  ["km 39", "km39"],
  ["cal comp", "calcomp"],
  ["แคลคอม", "calcomp"],
  ["sirtec", "sirtex"],
  ["sirtex", "sirtex"],
  ["เซอร์เทค", "sirtex"],
  ["jinpao", "jinpao"],
  ["จินเป่า", "jinpao"],
  ["tymphany", "tympany"],
  ["tympany", "tympany"],
  ["resonac", "resonac"],
  ["resonae", "resonac"],
  ["เดลต้าเวลโกร์ว", "delta-wellgrow"],
  ["เดลต้าเวลโกรว์", "delta-wellgrow"],
  ["เดลต้าเวลโกรว", "delta-wellgrow"],
  ["เดลต้าบางปู", "delta-bangpoo"],
  ["tri", "tri-medical"],
  ["tri medical", "tri-medical"],
  ["tg", "tg"]
]);

type DriverIdentity = {
  canonicalName: string;
  registration: string;
  registrationIsSuffixOnly?: boolean;
  aliases: string[];
};

const EXPLICIT_DRIVER_IDENTITIES: DriverIdentity[] = [
  { canonicalName: "Ede", registration: "701-5145", aliases: ["Ede", "อี๊ด", "อี๊ด", "วีระพันธ์"] },
  { canonicalName: "Buri", registration: "79-2945", aliases: ["Buri", "บุรี"] },
  { canonicalName: "Film", registration: "61-2835", aliases: ["Film", "ฟิลม์", "ฟิล์ม", "ธัชพล"] },
  { canonicalName: "Golf", registration: "700-4145", aliases: ["Golf", "กลอฟ", "กอล์ฟ", "ธนากร"] },
  { canonicalName: "M", registration: "64-8665", aliases: ["M", "เอ็ม", "Dเลปกร"] },
  { canonicalName: "Maam", registration: "64-5956", aliases: ["Maam", "แหม่ม", "แหม๋ม", "แหม๋ม", "กนกพร"] },
  { canonicalName: "Meuan", registration: "68-7154", aliases: ["Meuan", "เสมือน", "Dณัฐกิตติ์", "ณัฐกิตติ์"] },
  { canonicalName: "Myi", registration: "61-6672", aliases: ["Myi", "หมาย", "นวุฒิ"] },
  { canonicalName: "Nhum", registration: "701-1654", aliases: ["Nhum", "หนุ่ม", "สุวัฒน์ชัย"] },
  { canonicalName: "Sayan", registration: "79-5318", aliases: ["Sayan", "สายันต์", "สายัณห์", "Dสายัณห์"] },
  { canonicalName: "Soh", registration: "700-6659", aliases: ["Soh", "โส", "วิชัย"] },
  { canonicalName: "Sorn", registration: "62-1085", aliases: ["Sorn", "ศร", "อดิศร"] },
  { canonicalName: "Tharworn", registration: "64-5954", aliases: ["Tharworn", "ถาวร", "คถาวร", "สังวร"] },
  { canonicalName: "Thasoh", registration: "63-3543", aliases: ["Thasoh", "ตา", "Dโสภณ", "โสภณ"] },
  { canonicalName: "Theeraphat", registration: "78-6996", aliases: ["Theeraphat", "ธีรภัทร"] },
  { canonicalName: "Thung", registration: "62-4337", aliases: ["Thung", "ถึง", "ศรายุทธ"] },
  { canonicalName: "Wutt", registration: "64-0359", aliases: ["Wutt", "วุฒิ", "วุฒิศักด์", "วุฒิศักดิ์"] },
  { canonicalName: "Fluk", registration: "74-8969", aliases: ["Fluk", "ฟลุก", "พัฒน์พงษ์"] },
  { canonicalName: "Oil", registration: "8453", registrationIsSuffixOnly: true, aliases: ["Oil", "ออย", "สุภาพ"] },
  { canonicalName: "Buew", registration: "9565", registrationIsSuffixOnly: true, aliases: ["Buew", "บิว", "นัทธพงศ์"] }
];

export function normalizeComparisonText(value: string | null | undefined) {
  const cleaned = (value ?? "")
    .normalize("NFKC")
    .replace(/[.,/#!$%^&*;:{}=_`~()[\]"'|\\<>?+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("th-TH");
  return ROUTE_ALIASES.get(cleaned) ?? cleaned;
}

export function normalizeRegistrationKey(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleUpperCase("th-TH");
}

export function isVehicleDescription(value: string | null | undefined) {
  const text = (value ?? "").normalize("NFKC").trim();
  if (!text) return false;
  if (/\d{1,3}\s*[- ]\s*\d{3,4}/.test(text)) return false;
  return DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function parseRegistrationCell(value: string | null | undefined) {
  const text = (value ?? "").normalize("NFKC").trim();
  if (!text || isVehicleDescription(text)) {
    return { mainRegistration: null, trailerRegistration: null, missing: true, reason: text ? "Vehicle description without confirmed registration." : "Missing registration." };
  }
  const registrations = text.match(/[\p{L}]?\d{1,3}\s*[- ]?\s*\d{3,4}/gu) ?? [];
  if (!registrations.length) {
    return { mainRegistration: null, trailerRegistration: null, missing: true, reason: "No confirmed registration pattern found." };
  }
  const normalized = registrations.map((registration) => registration.replace(/\s+/g, "").replace(/(\d{1,3})-?(\d{3,4})$/, "$1-$2").toLocaleUpperCase("th-TH"));
  return {
    mainRegistration: normalized[0] ?? null,
    trailerRegistration: normalized[1] ?? null,
    missing: false,
    reason: normalized.length > 1 ? "Main and trailer registrations parsed." : "Main registration parsed."
  };
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export function inAugustWindow(value: string | null | undefined) {
  const date = dateOnly(value);
  return date >= AUGUST_START && date <= AUGUST_END;
}

function compactRoute(row: Pick<AugustBossJobRow, "pickup" | "dropoff"> | Pick<AugustBookingRow, "pickup" | "dropoff">) {
  return `${normalizeComparisonText(row.pickup)}>${normalizeComparisonText(row.dropoff)}`;
}

function clientName(booking: AugustBookingRow) {
  return booking.client?.name ?? "";
}

function buildDriverAliasMap(drivers: DriverAssignmentRow[]) {
  const aliases = new Map<string, DriverIdentity>();
  const byRegistration = new Map<string, DriverIdentity>();
  for (const identity of EXPLICIT_DRIVER_IDENTITIES) {
    for (const alias of identity.aliases) {
      const key = normalizeComparisonText(alias);
      if (key) aliases.set(key, identity);
      const noPrefix = key.replace(/^d\s*/, "");
      if (noPrefix && noPrefix !== key) aliases.set(noPrefix, identity);
    }
    const registrationKey = normalizeRegistrationKey(identity.registration);
    if (registrationKey) byRegistration.set(registrationKey, identity);
  }
  for (const driver of drivers) {
    const registration = normalizeRegistrationKey(driver.vehicleRegistration);
    const identity = byRegistration.get(registration) ?? {
      canonicalName: driver.name,
      registration: driver.vehicleRegistration,
      registrationIsSuffixOnly: /^\d{3,4}$/.test(driver.vehicleRegistration.trim()),
      aliases: [driver.name]
    };
    const normalized = normalizeComparisonText(driver.name);
    if (normalized) aliases.set(normalized, identity);
    const noPrefix = normalized.replace(/^d\s*/, "");
    if (noPrefix && noPrefix !== normalized) aliases.set(noPrefix, identity);
  }
  return aliases;
}

function driverIdentity(value: string | null | undefined, aliases: Map<string, DriverIdentity>) {
  const key = normalizeComparisonText(value);
  if (!key) return null;
  return aliases.get(key) ?? aliases.get(key.replace(/^d\s*/, "")) ?? null;
}

function registrationsMatch(left: string | null | undefined, right: string | null | undefined, allowSuffixOnly = false) {
  const leftKey = normalizeRegistrationKey(left);
  const rightKey = normalizeRegistrationKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  return allowSuffixOnly && (leftKey.endsWith(rightKey) || rightKey.endsWith(leftKey));
}

function driverMatches(left: string | null | undefined, right: string | null | undefined, aliases: Map<string, DriverIdentity>) {
  const leftKey = normalizeComparisonText(left);
  const rightKey = normalizeComparisonText(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const leftIdentity = driverIdentity(left, aliases);
  const rightIdentity = driverIdentity(right, aliases);
  return Boolean(leftIdentity && rightIdentity && leftIdentity.canonicalName === rightIdentity.canonicalName);
}

function rowFingerprint(row: AugustBossJobRow, mainRegistration: string | null, trailerRegistration: string | null) {
  return stableFingerprint([
    dateOnly(row.date),
    normalizeComparisonText(row.client),
    normalizeComparisonText(row.pickup),
    normalizeComparisonText(row.dropoff),
    normalizeComparisonText(row.driver),
    normalizeRegistrationKey(mainRegistration),
    normalizeRegistrationKey(trailerRegistration),
    normalizeComparisonText(row.jobOrderNumber),
    normalizeComparisonText(row.pickupTime),
    row.sourceRowNumber
  ].join("|"));
}

export function stableFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function scoreCandidate(
  boss: AugustBossJobRow,
  booking: AugustBookingRow,
  mainRegistration: string | null,
  aliases: Map<string, DriverIdentity>
) {
  let score = 0;
  const evidence: string[] = [];
  if (dateOnly(boss.date) !== dateOnly(booking.booking_date)) return { score: -100, evidence: [] };
  score += 25;
  evidence.push("date");

  const bossReference = normalizeComparisonText(boss.jobOrderNumber);
  const bookingReference = normalizeComparisonText(booking.job_order_number || booking.warehouse_no || booking.booking_id);
  if (bossReference && bookingReference && bossReference === bookingReference) {
    score += 35;
    evidence.push("job/reference");
  }

  const bookingIdentity = driverIdentity(booking.driver, aliases);
  const bookingRegistration = booking.vehicle_registration || (bookingIdentity && !bookingIdentity.registrationIsSuffixOnly ? bookingIdentity.registration : null);
  const bossRegistration = mainRegistration;
  if (registrationsMatch(bossRegistration, bookingRegistration)) {
    score += 30;
    evidence.push("main registration");
  }

  if (driverMatches(boss.driver, booking.driver, aliases)) {
    score += 20;
    evidence.push("driver/alias");
  }

  if (normalizeComparisonText(boss.pickup) && normalizeComparisonText(boss.pickup) === normalizeComparisonText(booking.pickup)) {
    score += 12;
    evidence.push("pickup");
  }
  if (normalizeComparisonText(boss.dropoff) && normalizeComparisonText(boss.dropoff) === normalizeComparisonText(booking.dropoff)) {
    score += 12;
    evidence.push("dropoff");
  }
  if (normalizeComparisonText(boss.client) && normalizeComparisonText(boss.client) === normalizeComparisonText(clientName(booking))) {
    score += 8;
    evidence.push("client");
  }
  if (boss.pickupTime && booking.pickup_time && String(boss.pickupTime).slice(0, 5) === String(booking.pickup_time).slice(0, 5)) {
    score += 8;
    evidence.push("pickup time");
  }
  return { score, evidence };
}

function hasRouteEvidence(evidence: string[]) {
  return evidence.includes("pickup") && evidence.includes("dropoff");
}

function hasIndependentIdentityEvidence(evidence: string[]) {
  return evidence.includes("main registration") || evidence.includes("driver/alias") || evidence.includes("job/reference");
}

function isCandidateWorthReview(candidate: { score: number; evidence: string[] }) {
  if (hasIndependentIdentityEvidence(candidate.evidence)) return true;
  return hasRouteEvidence(candidate.evidence);
}

export function reconcileAugustJobs(input: {
  bossRows: AugustBossJobRow[];
  bookingRows: AugustBookingRow[];
  driverRows: DriverAssignmentRow[];
}): AugustJobReconciliationResult {
  const aliases = buildDriverAliasMap(input.driverRows);
  const augustBossRows = input.bossRows.filter((row) => inAugustWindow(row.date));
  const augustBookings = input.bookingRows.filter((row) => inAugustWindow(row.booking_date));
  const routeCounts = new Map<string, number>();
  for (const booking of augustBookings) {
    const key = `${dateOnly(booking.booking_date)}|${compactRoute(booking)}`;
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  const seenSourceRows = new Set<string>();

  const items = augustBossRows.map((bossRow) => {
    const parsed = parseRegistrationCell(bossRow.registrationCell);
    const sourceFingerprint = rowFingerprint(bossRow, parsed.mainRegistration, parsed.trailerRegistration);
    const evidence: string[] = [parsed.reason];
    const proposedValues = {
      vehicle_registration: parsed.mainRegistration,
      trailer_registration: parsed.trailerRegistration,
      vehicle: bossRow.vehicleType?.trim() || null,
      driver: bossRow.driver?.trim() || null,
      job_order_number: bossRow.jobOrderNumber?.trim() || null
    };

    if (seenSourceRows.has(sourceFingerprint)) {
      return {
        id: sourceFingerprint,
        sourceRowNumber: bossRow.sourceRowNumber,
        sourceFingerprint,
        status: "duplicate" as const,
        confidence: 1,
        reason: "This source row fingerprint was already reviewed in the preview.",
        evidence,
        bossRow: { ...bossRow, mainRegistration: parsed.mainRegistration, trailerRegistration: parsed.trailerRegistration },
        existingBooking: null,
        candidateBookings: [],
        proposedValues
      };
    }
    seenSourceRows.add(sourceFingerprint);

    if (parsed.missing) {
      return {
        id: sourceFingerprint,
        sourceRowNumber: bossRow.sourceRowNumber,
        sourceFingerprint,
        status: "missing_registration" as const,
        confidence: 0,
        reason: parsed.reason,
        evidence,
        bossRow: { ...bossRow, mainRegistration: null, trailerRegistration: null },
        existingBooking: null,
        candidateBookings: [],
        proposedValues
      };
    }

    const scored = augustBookings
      .map((booking) => ({ booking, ...scoreCandidate(bossRow, booking, parsed.mainRegistration, aliases) }))
      .filter(isCandidateWorthReview)
      .sort((a, b) => b.score - a.score);
    const best = scored[0] ?? null;
    const sameRouteCount = routeCounts.get(`${dateOnly(bossRow.date)}|${compactRoute(bossRow)}`) ?? 0;
    const bestHasRoute = best ? hasRouteEvidence(best.evidence) : false;
    const bestHasIdentity = best ? hasIndependentIdentityEvidence(best.evidence) : false;
    const nearestCompetitor = scored.find((candidate) => candidate.booking.id !== best?.booking.id) ?? null;
    const uniqueEnough = !nearestCompetitor || best.score - nearestCompetitor.score >= 10;

    if (best && !uniqueEnough) {
      return {
        id: sourceFingerprint,
        sourceRowNumber: bossRow.sourceRowNumber,
        sourceFingerprint,
        status: "conflict" as const,
        confidence: best.score / 150,
        reason: "Multiple existing Booking Diary rows have similar matching evidence.",
        evidence: best.evidence,
        bossRow: { ...bossRow, mainRegistration: parsed.mainRegistration, trailerRegistration: parsed.trailerRegistration },
        existingBooking: best.booking,
        candidateBookings: scored.slice(0, 5).map((candidate) => candidate.booking),
        proposedValues
      };
    }

    if (best && best.score >= 68 && bestHasRoute && bestHasIdentity && uniqueEnough) {
      return {
        id: sourceFingerprint,
        sourceRowNumber: bossRow.sourceRowNumber,
        sourceFingerprint,
        status: "exact_match" as const,
        confidence: Math.min(1, best.score / 120),
        reason: "Date plus registration/driver/reference and route evidence identify one Booking Diary row.",
        evidence: best.evidence,
        bossRow: { ...bossRow, mainRegistration: parsed.mainRegistration, trailerRegistration: parsed.trailerRegistration },
        existingBooking: best.booking,
        candidateBookings: scored.slice(0, 5).map((candidate) => candidate.booking),
        proposedValues
      };
    }

    if (best && best.score >= 57 && (bestHasRoute || bestHasIdentity)) {
      return {
        id: sourceFingerprint,
        sourceRowNumber: bossRow.sourceRowNumber,
        sourceFingerprint,
        status: "probable_match" as const,
        confidence: best.score / 120,
        reason: sameRouteCount > 1 ? "Probable match, but identical same-day routes exist." : "Probable match with partial supporting evidence.",
        evidence: best.evidence,
        bossRow: { ...bossRow, mainRegistration: parsed.mainRegistration, trailerRegistration: parsed.trailerRegistration },
        existingBooking: best.booking,
        candidateBookings: scored.slice(0, 5).map((candidate) => candidate.booking),
        proposedValues
      };
    }

    return {
      id: sourceFingerprint,
      sourceRowNumber: bossRow.sourceRowNumber,
      sourceFingerprint,
      status: "new_job" as const,
      confidence: sameRouteCount > 1 ? 0.62 : 0.8,
      reason: sameRouteCount > 1 ? "No safe existing match; same-day route repeats, so review before adding." : "No existing Booking Diary row has sufficient matching evidence.",
      evidence,
      bossRow: { ...bossRow, mainRegistration: parsed.mainRegistration, trailerRegistration: parsed.trailerRegistration },
      existingBooking: null,
      candidateBookings: scored.slice(0, 5).map((candidate) => candidate.booking),
      proposedValues
    };
  });

  const claimsByBookingId = new Map<string, AugustJobReconciliationItem[]>();
  for (const item of items) {
    if ((item.status === "exact_match" || item.status === "probable_match") && item.existingBooking?.id) {
      claimsByBookingId.set(item.existingBooking.id, [...(claimsByBookingId.get(item.existingBooking.id) ?? []), item]);
    }
  }
  for (const claimedItems of claimsByBookingId.values()) {
    if (claimedItems.length <= 1) continue;
    for (const item of claimedItems) {
      item.status = "conflict";
      item.confidence = Math.min(item.confidence, 0.55);
      item.reason = "Multiple boss rows point to the same Booking Diary candidate; select the correct row manually.";
      item.evidence = [...new Set([...item.evidence, "duplicate existing candidate"])];
    }
  }

  const summary = {
    total: items.length,
    exact_match: 0,
    probable_match: 0,
    new_job: 0,
    duplicate: 0,
    missing_registration: 0,
    conflict: 0
  };
  for (const item of items) summary[item.status] += 1;
  return { items, summary };
}
