import { ADMIN_RECEIPT_FIELDS, customerJobReference, customerJobNumberDiffers, type Booking, type AdminReceiptKind } from "@/lib/finance-demo-centre";
import { receiptLabels } from "@/components/finance-admin-receipt-fields";

export default function FinanceAdminReceiptSummary({ job, t, confirmBillable }: {
  job: Booking; t: (en: string, th: string) => string; confirmBillable?: (kind: AdminReceiptKind, amount: number) => void;
}) {
  return <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
    <p className="break-words text-base"><strong>{t("Customer Job Number", "เลขที่งานลูกค้า")}: </strong>{customerJobReference(job) || "—"}</p>
    {customerJobNumberDiffers(job) ? <p role="alert" className="mt-2 text-sm font-semibold text-amber-800">{t("Customer Job Number differs — reconcile with original Booking Diary reference", "เลขที่งานลูกค้าต่างกัน โปรดกระทบยอดกับสมุดจองต้นฉบับ")}: {job.adminReceipts?.originalCustomerJobNumber ?? job.diarySource?.customer_job_number}</p> : null}
    <h3 className="font-bold text-violet-950">{t("Admin-recorded receipt amounts", "ยอดใบเสร็จที่สำนักงานบันทึก")}</h3>
    <p className="mt-1 text-xs text-slate-700">{t("Recorded from returned papers. These amounts are not customer-billing approvals.", "บันทึกจากเอกสารที่คืน ยอดเหล่านี้ยังไม่ใช่การอนุมัติเรียกเก็บลูกค้า")}</p>
    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
      {ADMIN_RECEIPT_FIELDS.map((kind) => {
        const value = job.adminReceipts?.amounts[kind];
        return <div key={kind} className="text-sm">
          <dt className="text-slate-700">{t(...receiptLabels[kind])}</dt>
          <dd className="font-semibold text-slate-950">{value == null ? t("Not entered", "ยังไม่ได้กรอก") : `฿${value.toFixed(2)}`}</dd>
          {confirmBillable && value != null && value > 0 ? <button type="button"
            className="mt-1 rounded border border-violet-400 bg-white px-2 py-1 text-xs font-semibold text-violet-900"
            disabled={job.customerCharges?.some((charge) => charge.adminReceiptKind === kind)}
            onClick={() => confirmBillable(kind, value)}>{t("Confirm as customer-billable (test)", "ยืนยันเรียกเก็บลูกค้า (ทดสอบ)")}</button> : null}
        </div>;
      })}
    </dl>
    {job.adminReceipts?.notes ? <p className="mt-2 whitespace-pre-wrap text-sm">{job.adminReceipts.notes}</p> : null}
    {job.diarySource?.notes ? <p className="mt-2 whitespace-pre-wrap text-sm"><strong>{t("Original booking notes", "หมายเหตุต้นฉบับ")}: </strong>{job.diarySource.notes}</p> : null}
  </div>;
}
