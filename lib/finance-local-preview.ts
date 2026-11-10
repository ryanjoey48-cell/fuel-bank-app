export { isFinanceFixtureMode, isFinanceLocalPreview } from "@/lib/finance-fixture-mode";

export const financePreviewRoutes = [
  { href: "/finance-preview", labelEn: "Preview hub", labelTh: "ศูนย์ตัวอย่าง", mode: "preview index" },
  { href: "/finance-centre?demo=historical", labelEn: "Finance Centre", labelTh: "ศูนย์การเงิน", mode: "real-page + historical fixture" },
  { href: "/job-verification?demo=historical", labelEn: "Job Verification / Management Review", labelTh: "ตรวจสอบงาน / ผู้บริหารตรวจ", mode: "real-page + historical fixture" },
  { href: "/paperwork-inbox", labelEn: "Paperwork Inbox", labelTh: "กล่องรับเอกสาร", mode: "real-page layout (empty without DB)" },
  { href: "/finance-cost-pricing", labelEn: "Expenses & Pricing", labelTh: "ค่าใช้จ่ายและราคาขาย", mode: "real-page layout (empty without DB)" },
  { href: "/weekly-billing", labelEn: "Weekly Billing", labelTh: "วางบิลรายสัปดาห์", mode: "real-page layout (empty without DB)" },
  { href: "/invoice-approval", labelEn: "Invoice Approval", labelTh: "อนุมัติใบแจ้งหนี้ร่าง", mode: "real-page layout (empty without DB)" },
  { href: "/document-packs", labelEn: "Document Packs", labelTh: "ชุดเอกสารลูกค้า", mode: "real-page layout (empty without DB)" },
  { href: "/booking-diary", labelEn: "Booking Diary (connection check)", labelTh: "สมุดจอง (ตรวจการเชื่อมต่อ)", mode: "real-page · offline in preview" },
  { href: "/finance-demo", labelEn: "Full interactive workflow (15 source rows)", labelTh: "ขั้นตอนโต้ตอบครบ (15 แถวต้นทาง)", mode: "fixture-only E2E" }
] as const;
