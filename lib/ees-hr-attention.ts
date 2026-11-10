import type { DirectoryEmployee, HRLanguage } from "@/lib/ees-hr-v7-types";

export type CompletenessState = "recorded_verified" | "recorded_unverified" | "missing" | "not_applicable" | "unknown";
export type AttentionPriority = 1 | 2 | 3 | 4 | 5;

export type AttentionItem = {
  key: string;
  priority: AttentionPriority;
  state: CompletenessState;
  en: string;
  th: string;
};

export type AttentionQueueEntry = {
  id: string;
  kind: "driver" | "employee";
  name: string;
  employeeNumber: string | null;
  employmentStatus: DirectoryEmployee["employmentStatus"];
  href: string;
  priority: AttentionPriority;
  primary: AttentionItem;
  reasons: AttentionItem[];
};

export type AttentionQueue = {
  rows: AttentionQueueEntry[];
  totalNeedingAttention: number;
  scanned: number;
  counts: {
    employmentMissing: number;
    personnelMissing: number;
    licenceMissing: number;
    licenceExpiring: number;
    licenceExpired: number;
    followupsOpen: number;
  };
};

export function completenessFromProfile(recorded: number | null | undefined, total: number | null | undefined): CompletenessState {
  if (recorded == null || total == null || total <= 0) return "unknown";
  if (recorded <= 0) return "missing";
  if (recorded >= total) return "recorded_verified";
  return "recorded_unverified";
}

export function attentionForEmployee(row: DirectoryEmployee): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (row.employmentStatus === "not_recorded") {
    items.push({
      key: "employment",
      priority: 1,
      state: "missing",
      en: "Record employment status",
      th: "บันทึกสถานะการจ้างงาน",
    });
  }
  if (!row.personnelRecorded && row.kind === "driver") {
    items.push({
      key: "personnel",
      priority: 1,
      state: "missing",
      en: "Create linked personnel record",
      th: "สร้างข้อมูลบุคคลที่เชื่อมกับคนขับ",
    });
  }
  if (!row.employeeNumber) {
    items.push({
      key: "employee_number",
      priority: 2,
      state: "missing",
      en: "Add internal employee code",
      th: "เพิ่มรหัสพนักงานภายใน",
    });
  }
  if (!row.jobRole) {
    items.push({
      key: "job_role",
      priority: 3,
      state: "missing",
      en: "Confirm job role",
      th: "ยืนยันตำแหน่งงาน",
    });
  }

  // One document/licence attention item only — distinguish expired vs expiring vs missing.
  if (row.documentStatus === "expired") {
    items.push({
      key: "licence_expired",
      priority: 1,
      state: "missing",
      en: "Licence / documents expired",
      th: "ใบขับขี่ / เอกสารหมดอายุ",
    });
  } else if (row.documentStatus === "expiring") {
    items.push({
      key: "licence_expiring",
      priority: 2,
      state: "recorded_unverified",
      en: "Licence / documents expiring soon",
      th: "ใบขับขี่ / เอกสารใกล้หมดอายุ",
    });
  } else if (row.documentStatus === "needs_review" || row.documentStatus === "incompatible") {
    items.push({
      key: "licence_review",
      priority: 2,
      state: "recorded_unverified",
      en: "Review licence compatibility",
      th: "ทบทวนความเข้ากันได้ของใบขับขี่",
    });
  } else if (row.documentStatus == null && row.kind === "driver") {
    items.push({
      key: "documents_unknown",
      priority: 4,
      state: "unknown",
      en: "Document status unavailable",
      th: "ยังไม่ทราบสถานะเอกสาร",
    });
  } else if (row.documentStatus === "not_recorded" && row.kind === "driver") {
    items.push({
      key: "licence_missing",
      priority: 3,
      state: "missing",
      en: "Record driving licence details",
      th: "บันทึกรายละเอียดใบขับขี่",
    });
  }

  if (row.nextFollowup) {
    items.push({
      key: "followup",
      priority: 2,
      state: "recorded_unverified",
      en: `Open follow-up · ${row.nextFollowup}`,
      th: `งานติดตามที่เปิด · ${row.nextFollowup}`,
    });
  }
  if (row.awayToday) {
    items.push({
      key: "away",
      priority: 2,
      state: "recorded_verified",
      en: "Currently away / on approved leave",
      th: "ไม่อยู่ / ลาที่อนุมัติแล้ววันนี้",
    });
  }
  if (row.kind === "driver" && !row.vehicle) {
    items.push({
      key: "vehicle",
      priority: 4,
      state: "missing",
      en: "No current vehicle assignment",
      th: "ยังไม่มีการจัดรถปัจจุบัน",
    });
  }
  if (row.kind === "employee") {
    items.push({
      key: "vehicle_na",
      priority: 5,
      state: "not_applicable",
      en: "Vehicle not required for office employee",
      th: "พนักงานสำนักงานไม่ต้องมีรถประจำ",
    });
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

export function actionableAttention(row: DirectoryEmployee): AttentionItem[] {
  return attentionForEmployee(row).filter((item) => item.state !== "not_applicable" && item.state !== "recorded_verified");
}

export function primaryAttention(row: DirectoryEmployee, language: HRLanguage): string {
  const first = actionableAttention(row)[0];
  if (!first) return language === "th" ? "ไม่มีงานที่ค้าง" : "No outstanding HR action";
  return language === "th" ? first.th : first.en;
}

export function attentionScore(row: DirectoryEmployee): number {
  const items = actionableAttention(row);
  if (!items.length) return 99;
  return items[0].priority;
}

export function employeeHref(row: Pick<DirectoryEmployee, "kind" | "id">): string {
  return row.kind === "driver" ? `/drivers/${row.id}` : `/employees/${row.id}`;
}

export function buildAttentionQueue(rows: DirectoryEmployee[], limit = 12): AttentionQueue {
  const counts = {
    employmentMissing: 0,
    personnelMissing: 0,
    licenceMissing: 0,
    licenceExpiring: 0,
    licenceExpired: 0,
    followupsOpen: 0,
  };

  const needing = rows
    .map((row) => {
      const reasons = actionableAttention(row);
      if (!reasons.length) return null;
      const keys = new Set(reasons.map((reason) => reason.key));
      // Counts use the full reason set — not the truncated display slice.
      if (keys.has("employment")) counts.employmentMissing += 1;
      if (keys.has("personnel")) counts.personnelMissing += 1;
      if (keys.has("licence_missing") || keys.has("documents_unknown")) counts.licenceMissing += 1;
      if (keys.has("licence_expiring") || keys.has("licence_review")) counts.licenceExpiring += 1;
      if (keys.has("licence_expired")) counts.licenceExpired += 1;
      if (keys.has("followup")) counts.followupsOpen += 1;
      const primary = reasons[0];
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        employeeNumber: row.employeeNumber,
        employmentStatus: row.employmentStatus,
        href: employeeHref(row),
        priority: primary.priority,
        primary,
        reasons: reasons.slice(0, 3),
      } satisfies AttentionQueueEntry;
    })
    .filter((row): row is AttentionQueueEntry => Boolean(row))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    rows: needing.slice(0, Math.max(1, Math.min(limit, 50))),
    totalNeedingAttention: needing.length,
    scanned: rows.length,
    counts,
  };
}

/** @deprecated Prefer buildAttentionQueue for workforce-wide results. */
export function prioritisedAttentionRows(rows: DirectoryEmployee[], limit = 8): DirectoryEmployee[] {
  const ranked = buildAttentionQueue(rows, limit).rows;
  const byId = new Map(rows.map((row) => [`${row.kind}:${row.id}`, row]));
  return ranked.map((entry) => byId.get(`${entry.kind}:${entry.id}`)!).filter(Boolean);
}

export function draftStorageKey(kind: string, id: string): string {
  return `ees-hr-onboarding-draft:v1:${kind}:${id}`;
}

export function onboardingStepsDone(modelEmployee: DirectoryEmployee, data: Record<string, unknown>): number {
  const docs = (data.documents as { state?: string }[] | undefined) ?? [];
  const steps = [
    Boolean(modelEmployee.name),
    Boolean(modelEmployee.employeeNumber),
    modelEmployee.employmentStatus !== "not_recorded",
    Boolean(modelEmployee.jobRole),
    modelEmployee.kind === "employee" || Boolean(modelEmployee.vehicle),
    modelEmployee.kind === "employee" || Boolean(modelEmployee.documentStatus && modelEmployee.documentStatus !== "not_recorded"),
    modelEmployee.kind === "employee" || docs.some((doc) => doc.state === "ready"),
    !modelEmployee.nextFollowup,
  ];
  return steps.filter(Boolean).length;
}
