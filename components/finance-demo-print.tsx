"use client";

import { demoCopy } from "@/lib/finance-demo-copy";
import { EES_COMPANY } from "@/lib/ees-company";
import { customerTotal, confirmedWorkOrder, customerJobReference, batchTotal, docsFor, packManifest, SOURCE_WORKBOOK_SHA256, type Batch, type Booking, type State } from "@/lib/finance-demo-centre";

const currency = (value: number) => `฿${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default function FinanceDemoPrint({
  state,
  batch,
  language,
  preview = false
}: {
  state: State;
  batch: Batch;
  language: "en" | "th";
  /** When true, show on-screen beside Invoices & Documents controls (still printable). */
  preview?: boolean;
}) {
  const c = demoCopy[language];
  const jobs = batch.jobIds.map((id) => state.bookings.find((item) => item.id === id)!).filter(Boolean);
  const client = jobs[0]?.client ?? "";
  const sourceRef = (job: Booking) => job.source ? `${job.source.sheet}!${job.source.row} · ${job.source.historicalTrn}` : c.simulated;
  const manifest = packManifest(state, batch);
  return <section className={`finance-demo-print bg-white p-8 text-black ${preview ? "block" : "hidden"}`}>
    <div className={preview ? "w-full" : "mx-auto max-w-[1080px]"}>
      <p className="border-4 border-violet-800 p-3 text-center text-xl font-black text-violet-900">{c.printWatermark}</p>
      <div className="mt-6 flex flex-wrap justify-between gap-4 border-b-2 border-violet-700 pb-4">
        <div><h1 className="text-xl font-bold">{EES_COMPANY.nameTh}</h1><p className="font-semibold">{EES_COMPANY.nameEn}</p><p className="mt-1 text-xs">{EES_COMPANY.addressEn}</p><p className="text-xs">เลขประจำตัวผู้เสียภาษีอากร {EES_COMPANY.taxId}{EES_COMPANY.phone ? ` · โทร ${EES_COMPANY.phone}` : ""}</p></div>
        <div className="text-right"><p className="rounded bg-violet-200 px-3 py-2 text-lg font-bold">ใบแจ้งหนี้/INVOICE</p><p className="mt-2 font-bold">{c.draftNumber}</p><p className="text-xs">{batch.id}</p></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm"><p><span className="block text-xs text-slate-500">{c.customer}</span><strong>{client}</strong></p><p><span className="block text-xs text-slate-500">{c.period}</span><strong>{batch.week}</strong></p></div>
      <p className="mt-3 text-xs font-semibold text-violet-800">{c.templateRef}</p>
      <table className="mt-5 w-full table-fixed border-collapse text-[10px]"><thead><tr className="border-y-2 border-black bg-violet-100 text-left"><th className="p-1">#</th><th className="p-1">{c.date}</th><th className="p-1">{c.fields.pickup}</th><th className="p-1">{c.fields.delivery}</th><th className="p-1">{c.vehicle}</th><th className="p-1">{c.driver}</th><th className="p-1">{c.workOrder}</th><th className="p-1">{language === "th" ? "เลขที่งานลูกค้า" : "Customer Job Number"}</th><th className="p-1">{c.parking}</th><th className="p-1">{c.overtime}</th><th className="p-1">{c.fuelRate}</th><th className="p-1 text-right">{c.workbookAmount}</th></tr></thead><tbody>{jobs.map((job, index) => <tr key={job.id} className="border-b border-slate-300 align-top"><td className="p-1">{index + 1}</td><td className="p-1">{job.date}</td><td className="break-words p-1">{job.pickup}</td><td className="break-words p-1">{job.delivery}</td><td className="p-1">{job.vehicle}</td><td className="p-1">{job.driver}</td><td className="p-1">{confirmedWorkOrder(job)}</td><td className="break-words p-1">{customerJobReference(job) || "—"}</td><td className="p-1">{job.source?.parkingFees == null ? "—" : currency(job.source.parkingFees)}</td><td className="p-1">{job.source?.overtime == null ? "—" : currency(job.source.overtime)}</td><td className="p-1">—</td><td className="p-1 text-right font-semibold">{currency(customerTotal(job))}</td></tr>)}</tbody></table>
      <p className="mt-3 text-right text-lg font-bold">{c.total}: {currency(batchTotal(state, batch))}</p>
      <p className="mt-2 text-xs">{c.historicalTrn}: {jobs.map((job) => `${confirmedWorkOrder(job)} — ${sourceRef(job)}`).join("; ")}</p>
      <p className="mt-2 text-xs">{c.sourceHash}: {SOURCE_WORKBOOK_SHA256.slice(0, 16)}…</p>
      <p className="mt-4 border-t pt-2 text-xs font-bold text-rose-800">{c.neverSend} · {c.layoutNote}</p>

      <div className="finance-demo-print-break mt-10 border-t-4 border-violet-800 pt-6">
        <p className="border-4 border-violet-800 p-3 text-center text-xl font-black text-violet-900">{c.printWatermark}</p>
        <div className="mt-5 border-b-2 border-violet-700 pb-3 text-xs"><strong className="block text-sm">{EES_COMPANY.nameEn}</strong><span>{EES_COMPANY.addressTh}</span><span className="block">เลขประจำตัวผู้เสียภาษีอากร {EES_COMPANY.taxId}</span></div>
        <h2 className="mt-4 text-lg font-bold">ใบปะหน้า · {c.printWatermark}</h2>
        <p className="mt-2 text-xs">{c.customer}: <strong>{client}</strong> · {c.period}: {batch.week}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full border-collapse text-[10px]"><thead><tr className="border-y-2 border-black bg-violet-100 text-left"><th className="p-1">ลำดับที่</th><th className="p-1">อินวอยซ์เลขที่</th><th className="p-1">วัน เดือน ปี</th><th className="p-1">ค่ารถบรรทุก</th><th className="p-1">หัก ณ ที่จ่าย</th><th className="p-1">ค่าจอด</th><th className="p-1">OT</th><th className="p-1">ยอดที่ต้องชำระ</th></tr></thead><tbody><tr className="border-b border-slate-300"><td className="p-1">1</td><td className="p-1">{batch.id} · {c.draftNumber}</td><td className="p-1">{batch.week}</td><td className="p-1">—</td><td className="p-1">—</td><td className="p-1">—</td><td className="p-1">—</td><td className="p-1">—</td></tr></tbody></table></div>
        <p className="mt-2 text-xs font-semibold">{c.workbookAmount}: {currency(batchTotal(state, batch))}</p>
        <p className="mt-2 text-xs font-semibold text-rose-800">{c.layoutNote} · {c.neverSend}</p>
        <h2 className="mt-6 text-xl font-bold">{c.views.packs} · {batch.id}</h2>
        <p className="mt-2 text-sm">{c.customer}: {client} · {c.period}: {batch.week}</p>
        <h3 className="mt-5 font-bold">{c.packOrder}</h3>
        <ol className="mt-2 space-y-1 text-xs">{manifest.map((item, index) => { const doc = state.documents.find((entry) => entry.id === item.key); const job = state.bookings.find((entry) => entry.id === item.jobId); const label = item.kind === "draft" ? c.draftNumber : item.kind === "work_order" ? `${job ? confirmedWorkOrder(job) : ""} · ${c.historicalTrn}: ${job?.source?.historicalTrn ?? c.notRecorded}` : `${c.kinds[doc!.kind]} · ${doc!.id} · ${c.physical}: ${doc!.physicalRef}`; return <li key={item.key}>{index + 1}. {label}</li>; })}</ol>
        <h3 className="mt-5 font-bold">{c.originals}</h3>
        {jobs.flatMap((job) => docsFor(state, job.id)).map((doc) => <p key={doc.id} className="text-xs">□ {c.kinds[doc.kind]} · {doc.id} · {doc.physicalRef}</p>)}
        <h3 className="mt-5 font-bold">{c.dispatch}</h3>
        {c.dispatchItems.map((item, index) => <p key={index} className="text-xs">□ {item}</p>)}
        <p className="mt-5 text-xs font-bold text-rose-800">{c.packWarning} · {c.neverSend}</p>
      </div>
    </div>
  </section>;
}
