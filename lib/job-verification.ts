export const VERIFICATION_FIELDS = ["booking_date", "client_id", "pickup", "dropoff", "driver", "vehicle_registration", "job_order_number"] as const;
export const DOCUMENT_KEYS = ["green_job_order", "parking_receipt", "toll_receipt"] as const;
export type VerificationField = (typeof VERIFICATION_FIELDS)[number];
export type DocumentKey = (typeof DOCUMENT_KEYS)[number];
export type DocumentCheck = { required: boolean; received: boolean; reference: string; not_applicable_reason: string };
export type VerificationInput = {
  expected: Record<VerificationField, string>;
  observed: Record<VerificationField, string>;
  documents: Record<DocumentKey, DocumentCheck>;
};
export type VerificationResult = { status: "verified" | "missing_paperwork" | "discrepancy" | "incomplete_booking"; missingDocuments: DocumentKey[]; mismatches: VerificationField[]; incompleteFields: VerificationField[]; financeReady: boolean };
const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
export function evaluateVerification(input: VerificationInput): VerificationResult {
  const missingDocuments = DOCUMENT_KEYS.filter((key) => { const item = input.documents[key]; return item.required && (!item.received || !item.reference.trim()); });
  const mismatches = VERIFICATION_FIELDS.filter((key) => normalized(input.expected[key]) !== normalized(input.observed[key]));
  const incompleteFields = (["client_id", "driver", "vehicle_registration", "job_order_number"] as const).filter((key) => !input.expected[key].trim());
  const invalidNotApplicable = DOCUMENT_KEYS.filter((key) => !input.documents[key].required && (key === "green_job_order" || input.documents[key].received || input.documents[key].not_applicable_reason.trim().length < 8));
  const status = mismatches.length ? "discrepancy" : missingDocuments.length || invalidNotApplicable.length ? "missing_paperwork" : incompleteFields.length ? "incomplete_booking" : "verified";
  return { status, missingDocuments: [...missingDocuments, ...invalidNotApplicable.filter((key) => !missingDocuments.includes(key))], mismatches, incompleteFields: [...incompleteFields], financeReady: status === "verified" };
}
export const verificationCopy = {
  en: { title: "Job Verification", overview: "Finance Centre", demo: "SIMULATED DEMONSTRATION — no live records", booking: "Booking", client: "Customer", driver: "Driver", vehicle: "Vehicle registration", pickup: "Pickup", dropoff: "Dropoff", date: "Booking date", order: "Job order number", documents: "Paperwork checklist", green: "Signed green job order", parking: "Parking receipt", toll: "Toll receipt", required: "Required", received: "Received", reference: "Paper/photo reference", notApplicable: "Reason not applicable", observed: "Completed job details", compare: "Compare and submit", note: "Review note", missing: "Missing paperwork", incomplete: "Booking details incomplete", mismatch: "Discrepancy for management", verified: "Verified — ready for finance", pending: "Pending review", resolved: "Resolved — recheck required", resolve: "Resolve discrepancy", decision: "Management decision", ready: "Ready for finance", noReady: "No verified jobs are ready for finance.", history: "Verification history", saveError: "Verification could not be saved. Check that the migration and permissions are installed.", permissionError: "You do not have permission for this action.", documentReasonError: "Give a reason when a receipt does not apply.", signedOrderError: "A signed green job order is required.", openDiscrepancyError: "Management must resolve the open discrepancy before another verification.", missingBookingError: "This booking could not be found.", cancelledBookingError: "Cancelled bookings cannot be verified.", resolutionError: "Enter a management decision of at least 10 characters.", loading: "Loading…" },
  th: { title: "ตรวจสอบงาน", overview: "ศูนย์การเงิน", demo: "ข้อมูลสาธิตจำลอง — ไม่มีข้อมูลจริง", booking: "รายการจอง", client: "ลูกค้า", driver: "คนขับ", vehicle: "ทะเบียนรถ", pickup: "จุดรับ", dropoff: "จุดส่ง", date: "วันที่จอง", order: "เลขใบสั่งงาน", documents: "รายการตรวจเอกสาร", green: "ใบสั่งงานสีเขียวที่ลงนามแล้ว", parking: "ใบเสร็จค่าจอดรถ", toll: "ใบเสร็จค่าทางด่วน", required: "จำเป็น", received: "ได้รับแล้ว", reference: "อ้างอิงกระดาษ/ภาพถ่าย", notApplicable: "เหตุผลที่ไม่ต้องใช้", observed: "รายละเอียดงานที่เสร็จแล้ว", compare: "เปรียบเทียบและบันทึก", note: "บันทึกการตรวจ", missing: "เอกสารไม่ครบ", incomplete: "ข้อมูลจองไม่ครบ", mismatch: "ข้อมูลไม่ตรง รอผู้บริหารตรวจ", verified: "ตรวจแล้ว — พร้อมส่งฝ่ายการเงิน", pending: "รอตรวจสอบ", resolved: "แก้ไขแล้ว — ต้องตรวจซ้ำ", resolve: "แก้ไขข้อแตกต่าง", decision: "คำตัดสินของผู้บริหาร", ready: "พร้อมส่งฝ่ายการเงิน", noReady: "ยังไม่มีงานที่ตรวจแล้วและพร้อมส่งฝ่ายการเงิน", history: "ประวัติการตรวจ", saveError: "บันทึกการตรวจไม่ได้ โปรดตรวจว่าติดตั้งฐานข้อมูลและสิทธิ์แล้ว", permissionError: "คุณไม่มีสิทธิ์ดำเนินการนี้", documentReasonError: "กรุณาระบุเหตุผลเมื่อไม่ต้องใช้ใบเสร็จ", signedOrderError: "ต้องมีใบสั่งงานสีเขียวที่ลงนามแล้ว", openDiscrepancyError: "ผู้บริหารต้องแก้ไขข้อแตกต่างที่ค้างอยู่ก่อนตรวจงานอีกครั้ง", missingBookingError: "ไม่พบรายการจองนี้", cancelledBookingError: "ไม่สามารถตรวจงานที่ยกเลิกแล้ว", resolutionError: "กรุณาระบุคำตัดสินของผู้บริหารอย่างน้อย 10 ตัวอักษร", loading: "กำลังโหลด…" }
} as const;

export function verificationErrorMessage(message: string, language: "en" | "th") {
  const copy = verificationCopy[language];
  if (/FINANCE_OFFICE_PERMISSION_REQUIRED|MANAGEMENT_REVIEW_PERMISSION_REQUIRED|permission denied/i.test(message)) return copy.permissionError;
  if (/DOCUMENT_NOT_APPLICABLE_REASON_REQUIRED/i.test(message)) return copy.documentReasonError;
  if (/SIGNED_JOB_ORDER_REQUIRED/i.test(message)) return copy.signedOrderError;
  if (/OPEN_DISCREPANCY_REQUIRES_MANAGEMENT/i.test(message)) return copy.openDiscrepancyError;
  if (/BOOKING_NOT_FOUND|OPEN_DISCREPANCY_NOT_FOUND/i.test(message)) return copy.missingBookingError;
  if (/CANCELLED_BOOKING/i.test(message)) return copy.cancelledBookingError;
  if (/RESOLUTION_REASON_REQUIRED/i.test(message)) return copy.resolutionError;
  return copy.saveError;
}
