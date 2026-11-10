"use client";

import { useMemo, useState } from "react";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import {
  CUSTOMER_BILLING_PROFILES,
  profileRequiredGaps,
  profilesForLookup,
  type CustomerBillingProfile
} from "@/lib/finance-customer-profiles";
import { formatBangkokDateTime } from "@/lib/finance-display";

const input = "min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";

const emptyDraft = (clientHint = ""): CustomerBillingProfile => ({
  id: "",
  version: 1,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  reviewStatus: "draft",
  source: "",
  match: clientHint ? [clientHint] : [],
  legalNameTh: "",
  legalNameEn: null,
  billingAddressTh: "",
  billingAddressEn: null,
  taxId: "",
  contact: null,
  invoiceTemplate: "ees-xls-invoice-v1",
  trnStatementTemplate: "ees-trn-statement-v1",
  signatureName: null,
  deduction: null,
  advancePaymentAllowed: false,
  parkingOvertime: "own_columns",
  fuelRateDisplay: "per_line",
  paymentTerms: null,
  supportingDocuments: [],
  notes: [],
  withholdingNote: null,
  updatedBy: null,
  updatedAt: null
});

/**
 * Authorized local editor for customer billing profiles. Seed catalogue rows stay read-only until copied into a local
 * draft. Nothing is auto-approved; APL and other unknown customers stay empty until staff enter evidence-backed values.
 */
export default function FinanceCustomerProfileAdmin({ t, run, report }: {
  t: FlowT; run: FlowRun; report: (r: ReturnType<FlowRun>, ok: string) => boolean;
}) {
  const { state } = useFinanceFixture();
  const catalog = useMemo(() => profilesForLookup(state.customerProfiles), [state.customerProfiles]);
  const clients = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of state.bookings) map.set(job.clientId, job.client);
    return [...map.entries()].map(([clientId, client]) => ({ clientId, client }));
  }, [state.bookings]);
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = catalog.find((p) => p.id === selectedId) || null;
  const [draft, setDraft] = useState<CustomerBillingProfile>(emptyDraft());
  const [local, setLocal] = useState("");
  const events = (state.customerProfileEvents || []).filter((e) => !selectedId || e.profileId === selectedId).slice(-40).reverse();

  const load = (profile: CustomerBillingProfile | null, hint = "") => {
    setLocal("");
    if (!profile) {
      setSelectedId("");
      setDraft(emptyDraft(hint));
      return;
    }
    setSelectedId(profile.id);
    setDraft({ ...profile, match: [...profile.match], notes: [...profile.notes], supportingDocuments: [...profile.supportingDocuments], deduction: profile.deduction ? { ...profile.deduction } : null });
  };

  const gaps = profileRequiredGaps(draft);
  const isSeedOnly = selected && !state.customerProfiles?.some((p) => p.id === selected.id) && CUSTOMER_BILLING_PROFILES.some((p) => p.id === selected.id);
  const lockedApproved = draft.reviewStatus === "approved";

  const saveDraft = () => {
    if (lockedApproved) { setLocal(t("Approved profiles cannot be edited in place. Retire first if a new version is required.", "โปรไฟล์ที่อนุมัติแล้วแก้ไขตรงนี้ไม่ได้")); return; }
    const result = run({
      type: "upsert_customer_profile_draft",
      profile: {
        id: draft.id || undefined,
        match: draft.match,
        legalNameTh: draft.legalNameTh,
        legalNameEn: draft.legalNameEn,
        billingAddressTh: draft.billingAddressTh,
        billingAddressEn: draft.billingAddressEn,
        taxId: draft.taxId,
        contact: draft.contact,
        signatureName: draft.signatureName,
        paymentTerms: draft.paymentTerms,
        withholdingNote: draft.withholdingNote ?? null,
        source: draft.source,
        notes: draft.notes,
        advancePaymentAllowed: draft.advancePaymentAllowed,
        deduction: draft.deduction,
        effectiveFrom: draft.effectiveFrom
      }
    });
    if (!result.ok) { setLocal(sheetErrorText(result.code, result.detail, t)); return; }
    setLocal("");
    report(result, t("Draft saved — still pending verification.", "บันทึกแบบร่างแล้ว — ยังไม่ยืนยัน"));
  };

  return (
    <div className="space-y-3" data-testid="profile-admin">
      <section className="ees-fc-card space-y-2 px-4 py-3">
        <h2 className="text-base font-bold">{t("Customer billing profiles", "โปรไฟล์วางบิลลูกค้า")}</h2>
        <p className="text-sm text-slate-700">{t("Enter only evidence-backed legal details. Unknown APL fields stay blank. Approved profiles require an explicit owner confirmation and never rewrite historical invoice snapshots.", "กรอกเฉพาะรายละเอียดที่มีหลักฐาน ช่อง APL ที่ยังไม่ทราบให้ว่างไว้ โปรไฟล์ที่อนุมัติต้องยืนยันโดยเจ้าของ และไม่เขียนทับใบแจ้งหนี้ย้อนหลัง")}</p>
        <div className="flex flex-wrap gap-2">
          {catalog.map((p) => (
            <button key={p.id} type="button" data-testid={`profile-pick-${p.id}`} onClick={() => load(p)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${selectedId === p.id ? "bg-violet-700 text-white ring-violet-700" : "bg-white text-violet-950 ring-violet-200"}`}>
              {p.id} · {p.reviewStatus}
            </button>
          ))}
          <button type="button" className={btn} data-testid="profile-new" onClick={() => load(null)}>{t("New draft", "แบบร่างใหม่")}</button>
        </div>
        {clients.length ? (
          <p className="text-xs text-slate-600">{t("Customers in workspace:", "ลูกค้าในพื้นที่ทำงาน:")}{" "}
            {clients.map((c) => (
              <button key={c.clientId} type="button" className="mr-2 underline" onClick={() => load(null, c.client.split(/\s+/)[0] || c.client)}>{c.client}</button>
            ))}
          </p>
        ) : null}
      </section>

      <section className="ees-fc-card grid gap-3 px-4 py-3 lg:grid-cols-2" data-testid="profile-editor">
        <label className="text-xs font-semibold">{t("Profile id", "รหัสโปรไฟล์")}<input className={input} value={draft.id} disabled={!!selectedId && !isSeedOnly} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="e.g. apl-transport" /></label>
        <label className="text-xs font-semibold">{t("Match tokens (comma)", "คำที่จับคู่ชื่อ (คั่นด้วยจุลภาค)")}<input className={input} value={draft.match.join(", ")} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, match: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="APL, เอพีแอล" /></label>
        <label className="text-xs font-semibold">{t("Legal name (TH)", "ชื่อนิติบุคคล (ไทย)")}<input className={input} value={draft.legalNameTh} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, legalNameTh: e.target.value })} /></label>
        <label className="text-xs font-semibold">{t("Legal name (EN)", "ชื่อนิติบุคคล (อังกฤษ)")}<input className={input} value={draft.legalNameEn || ""} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, legalNameEn: e.target.value || null })} /></label>
        <label className="text-xs font-semibold lg:col-span-2">{t("Billing address (TH)", "ที่อยู่วางบิล (ไทย)")}<textarea className={`${input} h-16`} value={draft.billingAddressTh} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, billingAddressTh: e.target.value })} /></label>
        <label className="text-xs font-semibold">{t("Tax ID", "เลขผู้เสียภาษี")}<input className={input} value={draft.taxId} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} /></label>
        <label className="text-xs font-semibold">{t("Payment terms", "เงื่อนไขการชำระ")}<input className={input} value={draft.paymentTerms || ""} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value || null })} /></label>
        <label className="text-xs font-semibold">{t("Authorized signatory", "ชื่อผู้มีอำนาจลงนาม")}<input className={input} value={draft.signatureName || ""} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, signatureName: e.target.value || null })} /></label>
        <label className="text-xs font-semibold">{t("Withholding note", "หมายเหตุหัก ณ ที่จ่าย")}<input className={input} value={draft.withholdingNote || ""} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, withholdingNote: e.target.value || null })} /></label>
        <label className="text-xs font-semibold lg:col-span-2">{t("Evidence / source (required)", "หลักฐาน / แหล่งที่มา (จำเป็น)")}<input className={input} value={draft.source} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder={t("Customer registration / contract page reference", "อ้างอิงหนังสือรับรอง / สัญญา")} /></label>
        <label className="text-xs font-semibold">{t("Effective from", "มีผลตั้งแต่")}<input className={input} type="date" value={draft.effectiveFrom} disabled={lockedApproved} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} /></label>
        <div className="text-xs text-slate-600">
          <p><b>{t("Status", "สถานะ")}:</b> {draft.reviewStatus}</p>
          <p><b>{t("Last updated", "อัปเดตล่าสุด")}:</b> {draft.updatedBy || "—"} · {draft.updatedAt ? formatBangkokDateTime(draft.updatedAt) : "—"}</p>
          <p className={gaps.length ? "font-semibold text-amber-900" : "font-semibold text-emerald-800"}>
            {gaps.length ? t(`Missing for approval: ${gaps.join(", ")}`, `ยังขาดสำหรับอนุมัติ: ${gaps.join(", ")}`) : t("Required fields present (still needs explicit approval).", "ครบฟิลด์ที่ต้องมี (ยังต้องอนุมัติแยก)")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <button type="button" className="ees-fc-btn-primary !py-1" data-testid="profile-save-draft" disabled={lockedApproved} onClick={saveDraft}>{t("Save draft", "บันทึกแบบร่าง")}</button>
          <button type="button" className={btn} data-testid="profile-submit" disabled={draft.reviewStatus === "approved" || gaps.length > 0 || !selectedId && !draft.id}
            onClick={() => {
              const id = draft.id || selectedId;
              if (!id) { setLocal(t("Save a draft with an id first.", "บันทึกแบบร่างพร้อมรหัสก่อน")); return; }
              report(run({ type: "submit_customer_profile", profileId: id }), t("Submitted for owner approval.", "ส่งให้เจ้าของอนุมัติแล้ว"));
            }}>{t("Submit for approval", "ส่งขออนุมัติ")}</button>
          <button type="button" className={btn} data-testid="profile-approve" disabled={draft.reviewStatus !== "pending_owner_approval"}
            onClick={() => report(run({ type: "approve_customer_profile", profileId: draft.id || selectedId }), t("Profile approved.", "อนุมัติโปรไฟล์แล้ว"))}>{t("Approve profile", "อนุมัติโปรไฟล์")}</button>
          <button type="button" className="text-xs font-semibold text-rose-800 underline" data-testid="profile-retire" disabled={!selectedId}
            onClick={() => {
              const why = window.prompt(t("Retire reason (kept in history)", "เหตุผลที่เลิกใช้ (เก็บในประวัติ)"));
              if (why) report(run({ type: "retire_customer_profile", profileId: selectedId, note: why }), t("Profile retired.", "เลิกใช้โปรไฟล์แล้ว"));
            }}>{t("Retire", "เลิกใช้")}</button>
        </div>
        {local ? <p role="alert" className="text-sm font-semibold text-rose-800 lg:col-span-2" data-testid="profile-admin-error">{local}</p> : null}
        {isSeedOnly ? <p className="text-xs text-amber-900 lg:col-span-2">{t("This row is from the seed catalogue. Saving creates a local workspace copy — the seed file is not modified.", "รายการนี้มาจากแคตตาล็อกต้นทาง การบันทึกจะสร้างสำเนาในพื้นที่ทำงานเท่านั้น")}</p> : null}
      </section>

      <section className="ees-fc-card px-4 py-3">
        <h2 className="text-base font-bold">{t("Change history", "ประวัติการเปลี่ยนแปลง")}</h2>
        <ul className="mt-1 space-y-0.5 text-xs" data-testid="profile-admin-audit">
          {events.length ? events.map((e) => (
            <li key={e.id}><b>{formatBangkokDateTime(e.at)}</b> · {e.by} · {e.action} · {e.profileId} · {e.fromStatus || "—"} → {e.toStatus} · {e.note.slice(0, 160)}</li>
          )) : <li className="text-slate-600">—</li>}
        </ul>
      </section>
    </div>
  );
}
