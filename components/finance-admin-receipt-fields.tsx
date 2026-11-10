"use client";

import { ADMIN_RECEIPT_FIELDS, type AdminReceiptKind } from "@/lib/finance-demo-centre";

export type ReceiptDraft = Record<AdminReceiptKind, string>;
export const emptyReceiptDraft = (): ReceiptDraft => Object.fromEntries(ADMIN_RECEIPT_FIELDS.map((kind) => [kind, ""])) as ReceiptDraft;
export const receiptLabels: Record<AdminReceiptKind, [string, string]> = {
  parking: ["Parking Fees (THB)", "ค่าจอดรถ (บาท)"], toll: ["Toll Fees (THB)", "ค่าทางด่วน (บาท)"],
  overtime: ["Overtime (THB)", "ค่าล่วงเวลา (บาท)"], container_pickup: ["Container pickup (THB)", "ค่ารับตู้ (บาท)"],
  overnight: ["Overnight (THB)", "ค่าค้างคืน (บาท)"], other: ["Other charges (THB)", "ค่าใช้จ่ายอื่น (บาท)"]
};

export default function FinanceAdminReceiptFields({ amounts, notes, onAmount, onNotes, disabled, t }: {
  amounts: ReceiptDraft; notes: string; onAmount: (kind: AdminReceiptKind, value: string) => void;
  onNotes: (value: string) => void; disabled: boolean; t: (en: string, th: string) => string;
}) {
  const field = (kind: AdminReceiptKind) => <label key={kind} className="block text-sm font-semibold text-slate-800">
    {t(...receiptLabels[kind])}
    <input type="text" inputMode="decimal" autoComplete="off" disabled={disabled} value={amounts[kind]}
      onChange={(event) => onAmount(kind, event.target.value)}
      className="mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-base text-slate-950" />
  </label>;
  return <div className="mt-3 space-y-3">
    <div className="grid grid-cols-2 gap-3">{field("parking")}{field("toll")}</div>
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-violet-900">{t("Additional Charges (optional)", "ค่าใช้จ่ายเพิ่มเติม (ไม่บังคับ)")}</summary>
      <div className="mt-3 grid grid-cols-2 gap-3">{ADMIN_RECEIPT_FIELDS.slice(2).map(field)}</div>
      <label className="mt-3 block text-sm font-semibold text-slate-800">{t("Optional notes", "หมายเหตุ (ไม่บังคับ)")}
        <textarea className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-base" maxLength={4000} rows={2}
          value={notes} disabled={disabled} onChange={(event) => onNotes(event.target.value)} />
      </label>
    </details>
    <p className="text-xs leading-relaxed text-slate-700">{t("Leave unused amounts blank. Receipt photos are optional. Finance reviews what is billable to the customer.", "เว้นว่างได้เมื่อไม่มีค่าใช้จ่าย ไม่บังคับแนบรูปใบเสร็จ ฝ่ายการเงินจะตรวจว่ารายการใดเรียกเก็บลูกค้าได้")}</p>
  </div>;
}
