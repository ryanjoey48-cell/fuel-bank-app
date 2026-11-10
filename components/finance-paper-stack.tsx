"use client";

import { useState } from "react";
import FinanceAdminReceiptSummary from "@/components/finance-admin-receipt-summary";
import { confirmedWorkOrder, customerJobReference, customerTotal, ready, weekOf, type Action, type State, type Role, type CustomerCharge } from "@/lib/finance-demo-centre";

export default function FinancePaperStack({ state, role, dispatch, selectedId, openJob, saveSequence, t }: {
  state: State; role: Role; dispatch: (action: Action) => boolean; selectedId: string;
  openJob: (id: string) => void; t: (en: string, th: string) => string;
  saveSequence: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [week, setWeek] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [savingSequence, setSavingSequence] = useState(false);
  const [chargeCategory, setChargeCategory] = useState<CustomerCharge["category"]>("parking");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeEvidence, setChargeEvidence] = useState("");
  const selected = state.bookings.find((job) => job.id === selectedId);
  const clients = [...new Map(state.bookings.map((job) => [job.clientId, job.client])).entries()];
  const stack = state.paperStacks?.find((item) => item.clientId === clientId && item.week === week);
  const billingBatch = state.batches.find((item) => item.clientId === clientId && item.week === week);
  const inbox = state.bookings.filter((job) => job.clientId === clientId && ready(state, job.id) && (!week || weekOf(job.date) === week));
  const run = (action: Action) => {
    try { if (!dispatch(action)) throw new Error("BLOCKED"); setMessage(""); } catch { setMessage(t("Action blocked. Check paperwork, role and saved sequence.", "ดำเนินการไม่ได้ โปรดตรวจเอกสาร สิทธิ์ และลำดับที่บันทึก")); }
  };
  const csv = () => {
    if (!stack) return;
    const rows = [["DRAFT/TEST", "Date", "Pickup", "Delivery", "Customer Job Number", "Registration", "Driver", "Work order", "Invoice", "Trip charge", "Other charges", "Parking", "Overtime", "Container pickup", "Overnight", "Total", "Tolls", "Waiting"]];
    stack.jobIds.forEach((id, i) => {
      const job = state.bookings.find((item) => item.id === id)!;
      const charge = (category: string) => String((job.customerCharges || []).filter((item) => item.category === category).reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100);
      rows.push([String(i + 1), job.date, job.pickup, job.delivery, customerJobReference(job), job.vehicle, job.driver, confirmedWorkOrder(job), "", job.price?.confirmed ? String(job.price.amount) : "", charge("other"), charge("parking"), charge("overtime"), charge("container_pickup"), charge("overnight"), job.price?.confirmed ? String(customerTotal(job)) : "", charge("toll"), charge("waiting")]);
    });
    const quote = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `DRAFT-paper-stack-${week}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const nextIndex = stack?.jobIds.indexOf(selectedId) ?? -1;
  const nextId = nextIndex >= 0 ? stack?.jobIds[nextIndex + 1] : undefined;
  const btn = "rounded-lg border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-900 disabled:opacity-40";
  return <section className="rounded-xl border border-violet-100 bg-white p-4">
    <h2 className="text-lg font-bold text-violet-950">{t("Finance Paperwork Inbox / Arrange Green Papers", "กล่องรับเอกสารฝ่ายการเงิน / จัดเรียงใบงาน")}</h2>
    <p className="mt-1 text-xs text-amber-900">{t("Local test · role confirmations are simulated. Positions are display order only.", "ทดสอบในเครื่อง · การยืนยันสิทธิ์เป็นการจำลอง ตัวเลขลำดับใช้แสดงผลเท่านั้น")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <select aria-label={t("Paper stack customer", "ลูกค้าของชุดใบงาน")} className={btn} value={clientId} onChange={(event) => setClientId(event.target.value)}>
        <option value="">{t("Select customer", "เลือกลูกค้า")}</option>
        {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <input aria-label={t("Billing week starting Monday", "สัปดาห์วางบิลเริ่มวันจันทร์")} type="date" className={btn} value={week} onChange={(event) => setWeek(event.target.value)} />
      <button className={btn} disabled={role !== "finance" || !clientId || !week || !!stack} onClick={() => run({ type: "create_paper_stack", clientId, week })}>{t("Create paper stack", "สร้างชุดใบงาน")}</button>
      <button className={btn} disabled={!stack} onClick={csv}>{t("Export ordered checklist (CSV)", "ส่งออกรายการตามลำดับ (CSV)")}</button>
      <button className={btn} disabled={!stack || role !== "finance" || savingSequence} onClick={async () => {
        setSavingSequence(true);
        try { await saveSequence(); setMessage(t("Paper arrangement saved to the local store.", "บันทึกลำดับเอกสารลงที่เก็บในเครื่องแล้ว")); }
        catch { setMessage(t("Arrangement save was not confirmed. Keep this page open and retry.", "ยังยืนยันการบันทึกลำดับไม่ได้ โปรดเปิดหน้านี้ไว้แล้วลองอีกครั้ง")); }
        finally { setSavingSequence(false); }
      }}>{t("Save arrangement", "บันทึกลำดับเอกสาร")}</button>
      <button className={btn} disabled={role !== "finance" || !stack?.jobIds.length || !billingBatch || billingBatch.draft || !!billingBatch.jobIds.length}
        onClick={() => stack && billingBatch && run({ type: "allocate_paper_stack", stackId: stack.id, batchId: billingBatch.id })}>
        {t("Use physical order in empty billing batch", "ใช้ลำดับเอกสารในชุดวางบิลว่าง")}
      </button>
    </div>
    {message ? <p role="alert" className="mt-2 text-rose-800">{message}</p> : null}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="font-semibold">{t("Verified paperwork", "เอกสารที่ตรวจยืนยันแล้ว")} ({inbox.length})</h3>
        <input aria-label={t("Find work order or customer job number in paperwork", "ค้นหาเลขที่ใบงานหรือเลขที่งานลูกค้าในเอกสาร")} className="my-2 w-full rounded-lg border p-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search work order or customer job number", "ค้นหาเลขที่ใบงานหรือเลขที่งานลูกค้า")} />
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {inbox.filter((job) => [confirmedWorkOrder(job), customerJobReference(job)].some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))).map((job) => <li key={job.id} className="rounded-lg border p-2 text-sm">
            <button className="text-base font-bold text-violet-950" onClick={() => openJob(job.id)}>WO {confirmedWorkOrder(job)} · {job.date}</button>
            <p>{job.pickup} → {job.delivery} · {job.vehicle} · {job.driver}</p>
            <FinanceAdminReceiptSummary job={job} t={t} />
            <details className="mt-2 text-xs"><summary>{t("Source details", "ข้อมูลต้นทาง")}</summary>{job.jobNumber}</details>
            <p className="text-xs">{job.handover?.receivedAt ? t("Physically received · Awaiting pricing/review", "รับเอกสารจริงแล้ว · รอทบทวนราคา") : job.handover ? t("Ready for physical handover", "พร้อมส่งมอบเอกสารจริง") : t("Digitally verified", "ตรวจยืนยันดิจิทัลแล้ว")}</p>
            {!job.handover ? <button className={btn} disabled={role !== "office"} onClick={() => run({ type: "ready_handover", jobId: job.id })}>{t("Mark ready to hand over", "ยืนยันพร้อมส่งมอบ")}</button> : !job.handover.receivedAt ? <button className={btn} disabled={role !== "finance"} onClick={() => run({ type: "receive_paper", jobId: job.id })}>{t("Confirm physical receipt", "ยืนยันรับเอกสารจริง")}</button> : <button className={btn} disabled={role !== "finance" || !stack || stack.jobIds.includes(job.id)} onClick={() => stack && run({ type: "add_stack_paper", stackId: stack.id, jobId: job.id })}>{t("Add as next paper", "เพิ่มเป็นใบงานถัดไป")}</button>}
          </li>)}
        </ul>
      </div>
      <div>
        <h3 className="font-semibold">{t("Saved physical sequence", "ลำดับเอกสารจริงที่บันทึกไว้")}</h3>
        <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          {stack?.jobIds.map((id, index) => {
            const job = state.bookings.find((item) => item.id === id)!;
            return <li key={id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
              <button className="font-semibold text-violet-900" onClick={() => openJob(id)}>{index + 1}. WO {confirmedWorkOrder(job)} · {job.price?.confirmed ? `฿${job.price.amount.toFixed(2)}` : t("Pricing pending", "รอราคา")}</button>
              <button className={btn} aria-label={t("Move up", "เลื่อนขึ้น")} disabled={role !== "finance" || index === 0} onClick={() => run({ type: "move_stack_paper", stackId: stack.id, jobId: id, direction: -1 })}>↑</button>
              <button className={btn} aria-label={t("Move down", "เลื่อนลง")} disabled={role !== "finance" || index === stack.jobIds.length - 1} onClick={() => run({ type: "move_stack_paper", stackId: stack.id, jobId: id, direction: 1 })}>↓</button>
              <button className={btn} disabled={role !== "finance"} onClick={() => run({ type: "remove_stack_paper", stackId: stack.id, jobId: id })}>{t("Remove", "นำออก")}</button>
            </li>;
          })}
        </ol>
        <button className={`${btn} mt-3`} disabled={!nextId} onClick={() => nextId && openJob(nextId)}>{t("Next Paper", "ไปใบงานถัดไป")}</button>
      </div>
    </div>
    {selected ? <div className="mt-4 rounded-lg border border-violet-100 p-3">
      <FinanceAdminReceiptSummary job={selected} t={t}
        confirmBillable={role === "finance" && selected.handover?.receivedAt && selected.price?.confirmed ? (kind, amount) => run({
          type: "add_customer_charge", jobId: selected.id,
          charge: { category: kind, amount, adminReceiptKind: kind, evidence: `Admin-recorded ${kind} receipt` }
        }) : undefined} />
      <h3 className="font-semibold">{t("Customer extras for current paper", "ค่าบริการเพิ่มเติมของใบงานปัจจุบัน")} · WO {confirmedWorkOrder(selected)}</h3>
      <p className="text-xs text-slate-600">{t("Enter only reviewed customer charges with receipt or approved time/rule evidence. Internal expenses are not added automatically. Tax treatment is not applied.", "กรอกเฉพาะค่าบริการลูกค้าที่ตรวจแล้ว พร้อมใบเสร็จหรือหลักฐานเวลา/เงื่อนไขที่อนุมัติ ไม่รวมค่าใช้จ่ายภายในอัตโนมัติ ยังไม่คำนวณภาษี")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select className={btn} aria-label={t("Customer charge category", "ประเภทค่าบริการลูกค้า")} value={chargeCategory} onChange={(event) => setChargeCategory(event.target.value as CustomerCharge["category"])}>
          {([['parking','Parking','ค่าจอดรถ'],['toll','Tolls','ค่าทางด่วน'],['overtime','Overtime','ล่วงเวลา'],['waiting','Waiting','ค่ารอ'],['container_pickup','Container pickup','รับตู้'],['overnight','Overnight','ค้างคืน'],['other','Other','อื่น ๆ']] as const).map(([value,en,th]) => <option key={value} value={value}>{t(en,th)}</option>)}
        </select>
        <input className={btn} aria-label={t("Customer charge amount", "จำนวนค่าบริการลูกค้า")} inputMode="decimal" value={chargeAmount} onChange={(event) => setChargeAmount(event.target.value)} />
        <input className={btn} aria-label={t("Receipt or approval evidence", "หลักฐานใบเสร็จหรืออนุมัติ")} placeholder={t("Receipt / approved rule and reason", "ใบเสร็จ / เงื่อนไขและเหตุผลที่อนุมัติ")} value={chargeEvidence} onChange={(event) => setChargeEvidence(event.target.value)} />
        <button className={btn} disabled={role !== "finance" || !selected.price?.confirmed || !selected.handover?.receivedAt} onClick={() => {
          if (!/^\d+(\.\d{1,2})?$/.test(chargeAmount) || !dispatch({ type: "add_customer_charge", jobId: selected.id, charge: { category: chargeCategory, amount: Number(chargeAmount), evidence: chargeEvidence } })) {
            setMessage(t("Charge blocked. Check amount, evidence, duplicate receipts and billing allocation.", "เพิ่มค่าบริการไม่ได้ โปรดตรวจจำนวน หลักฐาน ใบเสร็จซ้ำ และชุดวางบิล")); return;
          }
          setChargeAmount(""); setChargeEvidence(""); setMessage("");
        }}>{t("Confirm customer extra (test)", "ยืนยันค่าบริการเพิ่มเติม (ทดสอบ)")}</button>
      </div>
      <ul className="mt-2 text-sm">{selected.customerCharges?.map((charge, index) => <li key={index}>{charge.category}: ฿{charge.amount.toFixed(2)} · {charge.evidence}</li>)}</ul>
      <p className="mt-2 font-bold">{t("Confirmed customer total", "ยอดลูกค้าที่ตรวจยืนยันแล้ว")}: {selected.price?.confirmed ? `฿${customerTotal(selected).toFixed(2)}` : t("Pending pricing", "รอราคา")}</p>
    </div> : null}
  </section>;
}
