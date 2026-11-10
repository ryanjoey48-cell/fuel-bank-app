/**
 * Finance Records + document status wording, English and Thai, in one place (same pattern as the other
 * finance-*-copy modules). `th` is typed against `en`, so a missing Thai string is a compile error.
 */
const en = {
  title: "Finance Records",
  nav: "Finance Records",
  subtitle: "Every work order, charge, billing batch and TRN in one searchable place.",
  localBanner: "Local test records — kept on this computer only, not production data. No genuine TRN or invoice has been issued.",
  sharedNotReadyTitle: "Finance Records needs shared Finance storage",
  sharedNotReadyBody: "Shared, authenticated Finance storage has not been enabled yet, so nothing is shown here. Test and production records are never mixed.",
  backToFinance: "Finance Centre",
  loading: "Loading records…",
  views: { workOrders: "Work Orders", batches: "TRN Batches", label: "Records view" },
  search: { label: "Search Work Order", placeholder: "Work order, TRN, customer, driver, route…" },
  filters: {
    dateFrom: "Date from", dateTo: "Date to", customer: "Customer", allCustomers: "All customers", vehicle: "Vehicle registration",
    allVehicles: "All vehicles", driver: "Driver", allDrivers: "All drivers", month: "Billing period", allMonths: "All months",
    status: "Document status", allStatuses: "All statuses", clear: "Clear filters",
    batchDateHint: "Batches match when any of their work orders has a transport date in the range."
  },
  count: (shown: number, total: number) => (shown === total ? `${shown} records` : `${shown} of ${total} records`),
  countBatches: (shown: number, total: number) => (shown === total ? `${shown} batches` : `${shown} of ${total} batches`),
  kpi: {
    workOrders: "Work orders", draftBatches: "Draft batches", awaitingApproval: "Awaiting approval", issuedTrns: "Issued TRNs",
    billed: "Billed (issued)", draftValue: "Draft value (not invoiced)", attention: "Needs attention",
    billedHint: "Only issued TRNs count as billed. Draft, review and approved-but-unissued amounts are never counted as invoiced revenue."
  },
  columns: {
    workOrder: "Work order", customerJob: "Customer job no.", date: "Transport date", customer: "Customer", pickup: "Pickup", delivery: "Delivery",
    vehicle: "Vehicle", driver: "Driver", transport: "Transport", parking: "Parking", tolls: "Tolls", other: "Other charges", total: "Customer total",
    trn: "TRN", period: "Billing period", status: "Status", workOrders: "Work orders", created: "Created", position: "Paper", open: "Open"
  },
  // Short table headings (the full wording stays in the tooltip and in every export).
  columnsShort: { customerJob: "Cust. job no.", date: "Date", other: "Other", total: "Total" },
  columnsMenu: { label: "Columns", reset: "Reset columns" },
  status: {
    draft: "Draft", needs_correction: "In Progress", ready_for_review: "Ready for review", awaiting_approval: "Awaiting approval",
    approved: "Approved (not issued)", issued: "Issued", not_batched: "Not in a batch"
  },
  statusHint: {
    draft: "A draft billing batch. Not an invoice.",
    needs_correction: "A work order is flagged or the batch was reopened for correction.",
    ready_for_review: "Owner confirmed figures. Waiting for management approval. Not issued.",
    awaiting_approval: "Submitted for approval. Not issued.",
    approved: "Management approved the figures. Still DRAFT/TEST — no official TRN or tax invoice.",
    issued: "An officially issued TRN.",
    not_batched: "Work order entered by Admin but not yet arranged into a billing batch."
  },
  sim: { badge: "TEST", tooltip: "Simulated TRN for local testing — not an issued or official number." },
  empty: {
    noneTitle: "No finance records yet",
    noneBody: "Records appear here once Admin enters green-paper work orders and Finance starts a billing batch.",
    noMatchTitle: "No records match these filters",
    noMatchBody: "Try a different work order number, customer or date range, or clear the filters.",
    goIntake: "Open Admin Intake", goArrange: "Arrange work orders"
  },
  detail: {
    close: "Close", workOrder: "Work order", batch: "Billing batch", bookingDiary: "Original Booking Diary (read-only)", bookingRef: "Booking reference",
    adminEntry: "Admin entry", receipts: "Recorded receipt amounts", billable: "Customer-billable charges", finalPrice: "Final customer selling price",
    batchOrder: "Billing batch and paper order", documents: "Documents", history: "Changes and approval history",
    paperOf: (position: number, count: number) => `Paper ${position} of ${count}`,
    pickupTime: "Pickup time", notes: "Notes", noneRecorded: "Nothing recorded", notBatched: "Not in a billing batch yet",
    customerJobEntered: "Customer job no. (entered)", customerJobOriginal: "Customer job no. (original)", differs: "differs from the original",
    intakeStatus: "Intake check", financeCheck: "Sent back by Finance", confirmed: "Confirmed", flagged: "Flagged", notChecked: "Not separately checked",
    transport: "Transport charge", notPriced: "No price entered", sourceManual: "entered manually", sourceSchedule: "from the rate schedule",
    billed: "Billed", notBillable: "Not billable to the customer", needsDecision: "Awaiting Finance decision", notRecorded: "—",
    openDocuments: "Open documents (preview · PDF · print)", downloadBatchCsv: "Download batch CSV", openBilling: "Open in Customer Billing",
    openIntake: "Open in Admin Intake", openBatch: "Open batch", openWorkOrder: "Open work order",
    batchTotals: "Batch totals", period: "Billing period", created: "Created", confirmedAt: "Confirmed by owner", workOrderList: "Work orders in paper order",
    reopen: "Reopen for correction…", reopenReason: "Reason for correction", reopenConfirm: "Reopen batch", reopenCancel: "Cancel",
    reopenNote: "Amounts stay exactly as saved. The batch becomes editable again and the reopening is recorded in the activity history.",
    reopenNeedsReason: "Write a short reason to reopen.", reopenDone: "Batch reopened. Amounts were not changed.",
    reopenBlockedIssued: "Issued records cannot be edited here. Corrections follow the authorized correction process.",
    reopenBlockedWorkspace: "Switch to the owner workspace to reopen batches.",
    reopenNotReady: "Only a batch that is ready for review can be reopened here; drafts are edited in Customer Billing.",
    reopenBlocked: "This account cannot reopen the batch."
  },
  activity: {
    title: "Activity history", count: (n: number) => `${n} events`, restricted: "Activity history is available to Admin and Finance users.",
    none: "No events recorded.", time: "When", actor: "Who", event: "Event", detail: "Detail",
    showViewChanges: (n: number) => `Show ${n} view changes`, hideViewChanges: "Hide view changes",
    actions: {
      sheet_create: "Batch created", sheet_add_paper: "Paper added", sheet_remove_paper: "Paper removed", sheet_move_paper: "Paper moved",
      sheet_note_missing: "Paper with no record noted", sheet_clear_missing: "No-record note cleared", sheet_set_transport: "Transport charge set",
      sheet_set_extra: "Extra charge decision", sheet_set_stage: "Screen changed", sheet_mark_ready: "Confirmed by owner — ready for review",
      sheet_reopen: "Reopened for correction", flag_needs_checking: "Flagged for checking", admin_save_intake: "Admin intake saved",
      admin_intake_check: "Admin intake check", set_returned_work_order: "Work order entered"
    } as Record<string, string>,
    roles: { office: "Office", admin: "Admin", management: "Management", finance: "Finance", approver: "Approver", super_admin: "Super Admin" } as Record<string, string>
  },
  export: {
    button: "Export", title: "Export the filtered records", csv: "CSV", excel: "Excel",
    currentTable: "Current table", workOrderReport: "Work-order financial report", trnRegister: "TRN register",
    customerHistory: "Customer billing history", monthlyStatement: "Monthly billing statement", month: "Month", noMonth: "Choose a month",
    allMonthsLabel: "All months", filtersApplied: "Filters applied", exportedAt: "Exported",
    banner: "DRAFT/TEST — local test records. Amounts are draft billing values, not issued invoices.",
    subtotal: "Subtotal", grandTotal: "Grand total", issuedPart: "of which issued (billed)", draftPart: "of which not issued (not invoiced)",
    empty: "Nothing to export for these filters.", simulated: "Simulated (local test)", official: "Official", draftRefOnly: "Draft reference (no TRN number)", yes: "Yes", no: "No"
  },
  detailHeaders: {
    trn: "TRN", draftRef: "Draft ref", customer: "Customer", period: "Billing period", workOrders: "Work orders", status: "Status",
    created: "Created", readyAt: "Confirmed by owner", numbering: "TRN type"
  },
  pageSize: { more: (n: number) => `Show more (${n})` },
  localOnly: "Saved on this computer only"
};

export type FinanceRecordsCopy = typeof en;

const th: FinanceRecordsCopy = {
  title: "ประวัติการเงิน",
  nav: "ประวัติการเงิน",
  subtitle: "ใบงาน ค่าใช้จ่าย ชุดวางบิล และ TRN ทั้งหมดในที่เดียว ค้นหาได้",
  localBanner: "ข้อมูลทดสอบในเครื่อง — เก็บบนคอมพิวเตอร์เครื่องนี้เท่านั้น ไม่ใช่ข้อมูลจริง ยังไม่มีการออก TRN หรือใบแจ้งหนี้จริง",
  sharedNotReadyTitle: "ประวัติการเงินต้องใช้ที่เก็บข้อมูลการเงินแบบใช้ร่วมกัน",
  sharedNotReadyBody: "ยังไม่เปิดใช้ที่เก็บข้อมูลการเงินแบบใช้ร่วมกันที่ยืนยันตัวตนได้ จึงยังไม่แสดงข้อมูลที่นี่ ข้อมูลทดสอบและข้อมูลจริงจะไม่ถูกปะปนกัน",
  backToFinance: "ศูนย์การเงิน",
  loading: "กำลังโหลดรายการ…",
  views: { workOrders: "ใบงาน", batches: "ชุดวางบิล (TRN)", label: "มุมมองรายการ" },
  search: { label: "ค้นหาใบงาน", placeholder: "เลขใบงาน, TRN, ลูกค้า, คนขับ, เส้นทาง…" },
  filters: {
    dateFrom: "วันที่เริ่มต้น", dateTo: "วันที่สิ้นสุด", customer: "ลูกค้า", allCustomers: "ทุกลูกค้า", vehicle: "ทะเบียนรถ",
    allVehicles: "ทุกคัน", driver: "คนขับ", allDrivers: "ทุกคน", month: "รอบวางบิล", allMonths: "ทุกเดือน",
    status: "สถานะเอกสาร", allStatuses: "ทุกสถานะ", clear: "ล้างตัวกรอง",
    batchDateHint: "ชุดวางบิลจะแสดงเมื่อมีใบงานใดใบหนึ่งมีวันที่ขนส่งอยู่ในช่วงที่เลือก"
  },
  count: (shown: number, total: number) => (shown === total ? `${shown} รายการ` : `${shown} จาก ${total} รายการ`),
  countBatches: (shown: number, total: number) => (shown === total ? `${shown} ชุด` : `${shown} จาก ${total} ชุด`),
  kpi: {
    workOrders: "ใบงาน", draftBatches: "ชุดวางบิลฉบับร่าง", awaitingApproval: "รออนุมัติ", issuedTrns: "TRN ที่ออกแล้ว",
    billed: "ยอดวางบิล (ออกแล้ว)", draftValue: "มูลค่าฉบับร่าง (ยังไม่ออกใบแจ้งหนี้)", attention: "ต้องตรวจสอบ",
    billedHint: "นับเป็นยอดวางบิลเฉพาะ TRN ที่ออกแล้วเท่านั้น ยอดฉบับร่าง รอตรวจสอบ หรืออนุมัติแล้วแต่ยังไม่ออก จะไม่ถูกนับเป็นรายได้ที่เรียกเก็บ"
  },
  columns: {
    workOrder: "เลขที่ใบงาน", customerJob: "เลขที่งานลูกค้า", date: "วันที่ขนส่ง", customer: "ลูกค้า", pickup: "ต้นทาง", delivery: "ปลายทาง",
    vehicle: "ทะเบียนรถ", driver: "คนขับ", transport: "ค่าขนส่ง", parking: "ค่าจอดรถ", tolls: "ค่าทางด่วน", other: "ค่าอื่น ๆ", total: "ยอดรวมลูกค้า",
    trn: "เลข TRN", period: "รอบวางบิล", status: "สถานะ", workOrders: "ใบงาน", created: "สร้างเมื่อ", position: "ลำดับใบ", open: "เปิด"
  },
  columnsShort: { customerJob: "เลขงานลูกค้า", date: "วันที่", other: "ค่าอื่น ๆ", total: "ยอดรวม" },
  columnsMenu: { label: "คอลัมน์", reset: "คืนค่าคอลัมน์" },
  status: {
    draft: "ฉบับร่าง", needs_correction: "กำลังดำเนินการ", ready_for_review: "พร้อมตรวจสอบ", awaiting_approval: "รออนุมัติ",
    approved: "อนุมัติแล้ว (ยังไม่ออก)", issued: "ออกแล้ว", not_batched: "ยังไม่จัดชุด"
  },
  statusHint: {
    draft: "ชุดวางบิลฉบับร่าง ยังไม่ใช่ใบแจ้งหนี้",
    needs_correction: "มีใบงานที่ถูกแจ้งตรวจสอบ หรือชุดถูกเปิดเพื่อแก้ไข",
    ready_for_review: "เจ้าของยืนยันตัวเลขแล้ว รอผู้บริหารอนุมัติ ยังไม่ออกจริง",
    awaiting_approval: "ส่งขออนุมัติแล้ว ยังไม่ออกจริง",
    approved: "ผู้บริหารอนุมัติตัวเลขแล้ว ยังเป็นร่าง/ทดสอบ — ไม่มี TRN จริงหรือใบกำกับภาษี",
    issued: "TRN ที่ออกอย่างเป็นทางการแล้ว",
    not_batched: "แอดมินบันทึกเลขใบงานแล้วแต่ยังไม่ได้จัดเข้าชุดวางบิล"
  },
  sim: { badge: "ทดสอบ", tooltip: "เลข TRN จำลองสำหรับทดสอบในเครื่อง — ไม่ใช่เลขที่ออกจริงหรือเลขทางการ" },
  empty: {
    noneTitle: "ยังไม่มีรายการการเงิน",
    noneBody: "รายการจะแสดงที่นี่เมื่อแอดมินบันทึกเลขที่ใบงานสีเขียว และฝ่ายการเงินเริ่มชุดวางบิล",
    noMatchTitle: "ไม่พบรายการที่ตรงกับตัวกรอง",
    noMatchBody: "ลองเปลี่ยนเลขใบงาน ลูกค้า หรือช่วงวันที่ หรือล้างตัวกรอง",
    goIntake: "เปิดหน้ารับใบงาน", goArrange: "จัดเรียงใบงาน"
  },
  detail: {
    close: "ปิด", workOrder: "ใบงาน", batch: "ชุดวางบิล", bookingDiary: "ข้อมูลเดิมจากสมุดจอง (อ่านอย่างเดียว)", bookingRef: "เลขที่การจอง",
    adminEntry: "ข้อมูลที่แอดมินบันทึก", receipts: "ยอดใบเสร็จที่บันทึกไว้", billable: "ค่าใช้จ่ายที่เรียกเก็บลูกค้าได้", finalPrice: "ราคาขายสุดท้ายถึงลูกค้า",
    batchOrder: "ชุดวางบิลและลำดับใบงาน", documents: "เอกสาร", history: "ประวัติการแก้ไขและอนุมัติ",
    paperOf: (position: number, count: number) => `ใบที่ ${position} จาก ${count}`,
    pickupTime: "เวลารับ", notes: "หมายเหตุ", noneRecorded: "ไม่มีข้อมูลที่บันทึก", notBatched: "ยังไม่อยู่ในชุดวางบิล",
    customerJobEntered: "เลขที่งานลูกค้า (ที่บันทึก)", customerJobOriginal: "เลขที่งานลูกค้า (เดิม)", differs: "ต่างจากข้อมูลเดิม",
    intakeStatus: "การตรวจตอนรับใบงาน", financeCheck: "การเงินส่งกลับ", confirmed: "ยืนยันแล้ว", flagged: "แจ้งตรวจสอบ", notChecked: "ไม่ได้ตรวจแยก",
    transport: "ค่าขนส่ง", notPriced: "ยังไม่ใส่ราคา", sourceManual: "กรอกเอง", sourceSchedule: "จากตารางราคา",
    billed: "เรียกเก็บ", notBillable: "ไม่เรียกเก็บลูกค้า", needsDecision: "รอฝ่ายการเงินตัดสินใจ", notRecorded: "—",
    openDocuments: "เปิดเอกสาร (ดูตัวอย่าง · PDF · พิมพ์)", downloadBatchCsv: "ดาวน์โหลด CSV ของชุด", openBilling: "เปิดในหน้าวางบิลลูกค้า",
    openIntake: "เปิดในหน้ารับใบงาน", openBatch: "เปิดชุดวางบิล", openWorkOrder: "เปิดใบงาน",
    batchTotals: "ยอดรวมของชุด", period: "รอบวางบิล", created: "สร้างเมื่อ", confirmedAt: "เจ้าของยืนยันเมื่อ", workOrderList: "ใบงานตามลำดับใบ",
    reopen: "เปิดแก้ไข…", reopenReason: "เหตุผลที่ต้องแก้ไข", reopenConfirm: "เปิดชุดนี้", reopenCancel: "ยกเลิก",
    reopenNote: "ยอดเงินคงเดิมตามที่บันทึกไว้ ชุดนี้จะกลับมาแก้ไขได้ และการเปิดแก้ไขจะถูกบันทึกในประวัติการดำเนินการ",
    reopenNeedsReason: "ระบุเหตุผลสั้น ๆ เพื่อเปิดแก้ไข", reopenDone: "เปิดชุดนี้แล้ว ยอดเงินไม่เปลี่ยนแปลง",
    reopenBlockedIssued: "รายการที่ออกแล้วแก้ไขที่นี่ไม่ได้ การแก้ไขต้องทำตามขั้นตอนที่ได้รับอนุญาต",
    reopenBlockedWorkspace: "สลับไปพื้นที่ทำงานของเจ้าของเพื่อเปิดแก้ไขชุด",
    reopenNotReady: "เปิดแก้ไขได้เฉพาะชุดที่พร้อมตรวจสอบ ส่วนฉบับร่างให้แก้ไขในหน้าวางบิลลูกค้า",
    reopenBlocked: "บัญชีนี้เปิดแก้ไขชุดนี้ไม่ได้"
  },
  activity: {
    title: "ประวัติการดำเนินการ", count: (n: number) => `${n} เหตุการณ์`, restricted: "ประวัติการดำเนินการดูได้เฉพาะแอดมินและฝ่ายการเงิน",
    none: "ยังไม่มีเหตุการณ์", time: "เวลา", actor: "ผู้ทำ", event: "เหตุการณ์", detail: "รายละเอียด",
    showViewChanges: (n: number) => `แสดงการเปลี่ยนหน้าจอ ${n} รายการ`, hideViewChanges: "ซ่อนการเปลี่ยนหน้าจอ",
    actions: {
      sheet_create: "สร้างชุดวางบิล", sheet_add_paper: "เพิ่มใบงาน", sheet_remove_paper: "นำใบงานออก", sheet_move_paper: "ย้ายลำดับใบงาน",
      sheet_note_missing: "บันทึกใบงานที่ไม่มีข้อมูล", sheet_clear_missing: "ลบบันทึกใบงานที่ไม่มีข้อมูล", sheet_set_transport: "ตั้งค่าขนส่ง",
      sheet_set_extra: "ตัดสินใจค่าใช้จ่ายเพิ่ม", sheet_set_stage: "เปลี่ยนหน้าจอ", sheet_mark_ready: "เจ้าของยืนยัน — พร้อมตรวจสอบ",
      sheet_reopen: "เปิดแก้ไข", flag_needs_checking: "แจ้งให้ตรวจสอบ", admin_save_intake: "แอดมินบันทึกใบงาน",
      admin_intake_check: "แอดมินตรวจใบงาน", set_returned_work_order: "บันทึกเลขที่ใบงาน"
    },
    roles: { office: "สำนักงาน", admin: "แอดมิน", management: "ผู้บริหาร", finance: "การเงิน", approver: "ผู้อนุมัติ", super_admin: "ผู้ดูแลระบบสูงสุด" }
  },
  export: {
    button: "ส่งออก", title: "ส่งออกรายการตามตัวกรอง", csv: "CSV", excel: "Excel",
    currentTable: "ตารางปัจจุบัน", workOrderReport: "รายงานการเงินรายใบงาน", trnRegister: "ทะเบียน TRN",
    customerHistory: "ประวัติการวางบิลลูกค้า", monthlyStatement: "ใบแจ้งยอดวางบิลรายเดือน", month: "เดือน", noMonth: "เลือกเดือน",
    allMonthsLabel: "ทุกเดือน", filtersApplied: "ตัวกรองที่ใช้", exportedAt: "ส่งออกเมื่อ",
    banner: "ร่าง/ทดสอบ — ข้อมูลทดสอบในเครื่อง ยอดเงินเป็นมูลค่าฉบับร่าง ไม่ใช่ใบแจ้งหนี้ที่ออกจริง",
    subtotal: "รวมย่อย", grandTotal: "รวมทั้งสิ้น", issuedPart: "ในนี้ออกแล้ว (วางบิลแล้ว)", draftPart: "ในนี้ยังไม่ออก (ยังไม่เรียกเก็บ)",
    empty: "ไม่มีข้อมูลให้ส่งออกตามตัวกรองนี้", simulated: "จำลอง (ทดสอบในเครื่อง)", official: "ทางการ", draftRefOnly: "เลขอ้างอิงร่างเท่านั้น (ไม่มีเลข TRN)", yes: "ใช่", no: "ไม่ใช่"
  },
  detailHeaders: {
    trn: "TRN", draftRef: "เลขอ้างอิงร่าง", customer: "ลูกค้า", period: "รอบวางบิล", workOrders: "ใบงาน", status: "สถานะ",
    created: "สร้างเมื่อ", readyAt: "เจ้าของยืนยันเมื่อ", numbering: "ชนิดเลข TRN"
  },
  pageSize: { more: (n: number) => `แสดงเพิ่ม (${n})` },
  localOnly: "เก็บบนคอมพิวเตอร์เครื่องนี้เท่านั้น"
};

export const financeRecordsCopy = { en, th } as const;
export type FinanceRecordsLanguage = keyof typeof financeRecordsCopy;
