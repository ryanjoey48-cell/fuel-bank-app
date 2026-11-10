/**
 * Conditions that must ALL pass before official tax-invoice issuance could ever be enabled.
 * This module is documentation-as-code for production cutover — it does not issue documents.
 * Local / test Finance never sets officialTrn (see finance-demo-centre proposeOfficialTrn / sheet_approve).
 */
export type IssuancePrerequisite = {
  id: string;
  severity: "critical" | "high" | "medium";
  en: string;
  th: string;
  metLocally: boolean;
};

/** Read-only checklist. `metLocally` reflects what the current local workspace can prove today. */
export const FINANCE_ISSUANCE_PREREQUISITES: IssuancePrerequisite[] = [
  {
    id: "shared_storage",
    severity: "critical",
    en: "Shared authenticated Finance storage installed and RLS-reviewed (not the local JSON file).",
    th: "มีที่เก็บข้อมูลการเงินที่ใช้ร่วมกันและตรวจ RLS แล้ว (ไม่ใช่ไฟล์ JSON ในเครื่อง)",
    metLocally: false
  },
  {
    id: "official_trn_register",
    severity: "critical",
    en: "Official TRN register verified (including last issued number) by Super Admin against paper/PDF evidence.",
    th: "ทะเบียน TRN จริงได้รับการยืนยันโดยซูเปอร์แอดมินกับหลักฐานกระดาษ/PDF",
    metLocally: false
  },
  {
    id: "server_approval_rpc",
    severity: "critical",
    en: "Management approval and issuance run as server-side RPCs with capability checks — not client-only reducers.",
    th: "การอนุมัติและออกเอกสารทำงานบนเซิร์ฟเวอร์พร้อมตรวจสิทธิ์ ไม่ใช่เฉพาะฝั่งไคลเอนต์",
    metLocally: false
  },
  {
    id: "customer_profile_approved",
    severity: "critical",
    en: "Customer billing profile approved (legal name, address, tax ID, withholding, payment terms).",
    th: "โปรไฟล์วางบิลลูกค้าได้รับการอนุมัติ (ชื่อ ที่อยู่ เลขผู้เสียภาษี หัก ณ ที่จ่าย เงื่อนไขชำระ)",
    metLocally: false
  },
  {
    id: "prices_verified",
    severity: "critical",
    en: "Every line has a verified transport charge (schedule+verified Diesel B7, or authorized manual override with audit).",
    th: "ทุกรายการมีค่าขนส่งที่ยืนยันแล้ว (ตาราง+ดีเซล B7 ที่ยืนยัน หรือแก้เองโดยมีสิทธิ์และบันทึกเหตุผล)",
    metLocally: false
  },
  {
    id: "flagged_resolved",
    severity: "high",
    en: "All flagged discrepancies resolved or explicitly approved before issuance.",
    th: "ปัญหาที่แจ้งไว้ได้รับการแก้ไขหรืออนุมัติอย่างชัดเจนก่อนออกเอกสาร",
    metLocally: false
  },
  {
    id: "idempotent_issue",
    severity: "critical",
    en: "Issuance uses an idempotency key and advisory lock so double-clicks cannot allocate two TRNs.",
    th: "การออกเอกสารใช้คีย์กันซ้ำและล็อก เพื่อไม่ให้กดซ้ำแล้วได้เลข TRN สองเลข",
    metLocally: false
  },
  {
    id: "snapshot_immutable",
    severity: "high",
    en: "Issued amounts are snapshotted (hash) and subsequent material edits require a correction workflow — never silent overwrite.",
    th: "ยอดที่ออกแล้วถูกเก็บ snapshot และแก้ภายหลังต้องผ่านกระบวนการแก้ไข ไม่เขียนทับเงียบ ๆ",
    metLocally: false
  },
  {
    id: "test_isolation",
    severity: "critical",
    en: "Simulated TRNs (TRN651+) and local JSON drafts are excluded from official registers and revenue reports.",
    th: "เลข TRN จำลองและร่าง JSON ในเครื่องถูกแยกจากทะเบียนจริงและรายงานรายได้",
    metLocally: true
  }
];

export function issuanceBlockedReasons(prereqs: IssuancePrerequisite[] = FINANCE_ISSUANCE_PREREQUISITES) {
  return prereqs.filter((item) => !item.metLocally);
}

/** Hard rule for the current product: official issuance is disabled. */
export function isOfficialIssuanceEnabled() {
  return false;
}
