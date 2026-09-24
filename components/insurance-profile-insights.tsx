"use client";

import { AlertTriangle, CheckCircle2, Clock3, History, ShieldCheck } from "lucide-react";
import {
  annualInsuranceCost,
  buildDataQualityFindings,
  categoryLabel,
  getAssetCategory,
  insuranceHistoryStatus,
  insuranceRequirement,
  isCompulsoryConfirmed,
  isInsuranceNotRequired,
  isSeparateCompulsoryConfirmed,
  normalizeInsuranceRegistration,
  type InsuranceAssetRecord,
  type InsuranceDocumentRecord
} from "@/lib/insurance-intelligence";
import { canonicalInsurerName } from "@/lib/insurance-providers";

function profileMoney(value: number | null, language: "en" | "th") {
  if (value == null) return language === "th" ? "ไม่ได้บันทึก" : "Not recorded";
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}

function profileDate(value: string | null, language: "en" | "th") {
  if (!value) return language === "th" ? "ไม่ได้บันทึก" : "Not recorded";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
}

function qualityLabel(code: string, fallback: string, language: "en" | "th") {
  if (language === "en") return fallback;
  const labels: Record<string, string> = {
    expired_insurance: "ประกันภัยหมดอายุ", insurance_due_30: "ประกันภัยหมดอายุภายใน 30 วัน", insurance_due_60: "ประกันภัยหมดอายุภายใน 60 วัน", vehicle_tax_expired: "ภาษีรถหมดอายุ", vehicle_tax_due_30: "ภาษีรถหมดอายุภายใน 30 วัน", invalid_policy_dates: "ลำดับวันที่กรมธรรม์ไม่ถูกต้อง", missing_insurer: "ไม่มีข้อมูลบริษัทประกัน", missing_policy: "ไม่มีเลขกรมธรรม์", missing_expiry: "ไม่มีวันหมดอายุกรมธรรม์", missing_class: "ไม่มีประเภทประกัน", missing_repair: "ไม่มีประเภทการซ่อม", missing_make: "ไม่มียี่ห้อรถ", missing_model: "ไม่ได้บันทึกรุ่นแยกต่างหาก", missing_chassis: "ไม่มีเลขตัวถัง", missing_year: "ไม่มีปีรถ", missing_insured_value: "ไม่มีทุนประกัน", missing_premium: "ไม่มีเบี้ยประกัน", compulsory_unknown: "ไม่ทราบสถานะ พ.ร.บ.", compulsory_expired: "พ.ร.บ. หมดอายุ", duplicate_registration: "ทะเบียนซ้ำหลังปรับรูปแบบ", duplicate_chassis: "เลขตัวถังซ้ำ", description_in_policy: "เลขกรมธรรม์ต้องตรวจสอบ", duplicate_policy: "เลขกรมธรรม์อาจซ้ำ", insured_value_invalid: "ทุนประกันผิดปกติ", premium_invalid: "เบี้ยประกันผิดปกติ", premium_value_ratio: "อัตราเบี้ยต่อทุนผิดปกติ", premium_outlier: "เบี้ยประกันแตกต่างจากกลุ่มมาก", missing_main_document: "ไม่มีเอกสารกรมธรรม์หลัก", missing_compulsory_document: "ไม่มีเอกสาร พ.ร.บ."
  };
  return labels[code] ?? fallback;
}

export function InsuranceProfileInsights({
  record,
  records,
  documents,
  language
}: {
  record: InsuranceAssetRecord;
  records: InsuranceAssetRecord[];
  documents: InsuranceDocumentRecord[];
  language: "en" | "th";
}) {
  const isThai = language === "th";
  const category = getAssetCategory(record);
  const recordDocuments = documents.filter(
    (document) => document.insurance_record_id === record.id
  );
  const findings = buildDataQualityFindings(record, { records, documents });
  const separateCompulsory = isSeparateCompulsoryConfirmed(record);
  const notRequired = isInsuranceNotRequired(record);
  const canonicalInsurer = canonicalInsurerName(record.insurer_en, record.insurer_th, language);
  const rawInsurer = isThai ? record.insurer_th || record.insurer_en : record.insurer_en || record.insurer_th;
  const missing = isThai ? "ไม่ได้บันทึก" : "Not recorded";

  return (
    <div className="space-y-3">
      {notRequired && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" /><div><h3 className="text-sm font-bold text-slate-950">{isThai ? "ไม่ต้องมีประกัน" : "Insurance Not Required"}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{isThai ? "ทรัพย์สินนี้ได้รับการจัดประเภทว่าไม่ต้องมีกรมธรรม์ประกันภัย จึงไม่ถูกแจ้งเตือนเรื่องกรมธรรม์หรือเอกสารประกันที่ขาดหาย เอกสารเดิมและข้อมูลภาษียังคงเก็บไว้" : "This asset is classified as not requiring an insurance policy. Missing policy/document and renewal warnings are suppressed, while existing documents and tax compliance remain available."}</p></div></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><ProfileFact label={isThai ? "ข้อกำหนดประกัน" : "Insurance Requirement"} value={isThai ? "ไม่ต้องมีประกัน" : "Not Required"} /><ProfileFact label={isThai ? "เหตุผล" : "Reason"} value={record.insurance_requirement_reason || missing} /></div>
        </section>
      )}
      <section className="rounded-2xl border border-violet-100 bg-[#faf9fd] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-violet-600">
              {isThai ? "ข้อมูลประจำทรัพย์สิน" : "Asset identity"}
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              {record.vehicle_registration}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {isThai ? "ทะเบียนสำหรับจับคู่" : "Normalized for matching"}: {normalizeInsuranceRegistration(record.vehicle_registration)}
            </p>
          </div>
          <span className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-[#5140aa]">
            {categoryLabel(category, language)}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ProfileFact label={isThai ? "ยี่ห้อ" : "Make"} value={record.vehicle_make || missing} />
          <ProfileFact label={isThai ? "รุ่น" : "Model"} value={missing} />
          <ProfileFact label={isThai ? "ปี" : "Year"} value={record.vehicle_year == null ? missing : String(record.vehicle_year)} />
          <ProfileFact label={isThai ? "เลขตัวถัง" : "Chassis number"} value={record.chassis_number || missing} />
          <ProfileFact label={isThai ? "ประเภทตัวถัง" : "Body type"} value={category === "trailer" ? (isThai ? "รถพ่วง" : "Trailer") : missing} />
          <ProfileFact label={isThai ? "คำอธิบายรถ" : "Vehicle description"} value={category === "trailer" ? (isThai ? "ทรัพย์สินรถพ่วง — ไม่ต้องมีคนขับ น้ำมัน หรือเครื่องยนต์" : "First-class trailer asset — driver, fuel and engine data do not apply") : missing} />
          {!notRequired && <ProfileFact label={isThai ? "ข้อกำหนดประกัน" : "Insurance Requirement"} value={insuranceRequirement(record) === "required" ? (isThai ? "ต้องมีประกัน" : "Required") : (isThai ? "ไม่ทราบ" : "Unknown")} />}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">{isThai ? "ประกันภัยหลัก" : "Main Insurance"}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ProfileFact label={isThai ? "บริษัทประกัน" : "Insurer"} value={canonicalInsurer || missing} />
          <ProfileFact label={isThai ? "เลขกรมธรรม์" : "Policy number"} value={record.policy_number || missing} />
          <ProfileFact label={isThai ? "ประเภทประกัน" : "Insurance class"} value={record.insurance_class || missing} />
          <ProfileFact label={isThai ? "ประเภทการซ่อม" : "Repair type"} value={record.repair_type || missing} />
          <ProfileFact label={isThai ? "วันเริ่ม" : "Start date"} value={profileDate(record.insurance_start_date, language)} />
          <ProfileFact label={isThai ? "วันหมดอายุ" : "Expiry date"} value={profileDate(record.insurance_expiry_date, language)} />
          <ProfileFact label={isThai ? "เบี้ยพื้นฐาน" : "Base premium"} value={profileMoney(record.insurance_premium, language)} />
          <ProfileFact label={isThai ? "อากรแสตมป์" : "Stamp duty"} value={missing} />
          <ProfileFact label={isThai ? "ภาษีมูลค่าเพิ่ม" : "VAT"} value={missing} />
          <ProfileFact label={isThai ? "เบี้ยรวมที่บันทึก" : "Recorded total premium"} value={profileMoney(record.total_recorded_cost, language)} />
          <ProfileFact label={isThai ? "ทุนประกัน" : "Insured value"} value={profileMoney(record.insured_value, language)} />
          <ProfileFact label={isThai ? "เอกสารปัจจุบัน" : "Current document"} value={recordDocuments.find((document) => document.document_type === "insurance")?.file_name || missing} />
          <ProfileFact label={isThai ? "หมายเหตุ" : "Notes"} value={record.notes || missing} />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">{isThai ? "ระบบเดิมไม่มีช่องแยกอากรแสตมป์และภาษีมูลค่าเพิ่ม จึงแสดงว่าไม่ได้บันทึกและไม่คำนวณขึ้นเอง" : "The legacy record has no separate stamp-duty or VAT fields, so they remain Not recorded and are not inferred."}</p>
        {rawInsurer && rawInsurer !== canonicalInsurer && <p className="mt-1 text-[11px] leading-5 text-slate-500">{isThai ? "ชื่อบริษัทจากข้อมูลต้นฉบับ" : "Raw insurer wording"}: {rawInsurer}</p>}
      </section>

      <section className={`rounded-2xl border p-4 ${notRequired ? "border-slate-200 bg-slate-50" : isCompulsoryConfirmed(record) ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
        <div className="flex items-start gap-3">
          {notRequired ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" /> : isCompulsoryConfirmed(record) ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />}
          <div>
            <h3 className="text-sm font-bold text-slate-950">
              {isThai ? "สถานะ พ.ร.บ." : "Compulsory insurance status"}: {notRequired ? (isThai ? "ไม่ต้องมีประกัน" : "Not Required") : isCompulsoryConfirmed(record) ? (isThai ? "ยืนยันแล้ว" : "Confirmed") : (isThai ? "ไม่ทราบ" : "Unknown")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {notRequired
                ? isThai ? "การยกเว้นนี้ไม่ลบเอกสาร พ.ร.บ. เดิม" : "This exemption does not remove any previously uploaded compulsory-insurance documents."
                : separateCompulsory
                ? isThai
                  ? `กรมธรรม์หลัก${record.compulsory_included === false ? "ไม่รวม" : "ไม่ได้ยืนยันว่ารวม"} พ.ร.บ. และมีกรมธรรม์ พ.ร.บ. แยก ${record.compulsory_policy_number}`
                  : `The main policy ${record.compulsory_included === false ? "does not include" : "does not confirm included"} compulsory cover; separate policy ${record.compulsory_policy_number} provides it.`
                : record.compulsory_included === true
                  ? isThai
                    ? "กรมธรรม์หลักระบุว่ารวม พ.ร.บ."
                    : "The main policy records compulsory cover as included."
                  : isThai
                    ? "ยังไม่มีหลักฐานเพียงพอเพื่อยืนยัน พ.ร.บ."
                    : "There is not enough evidence to confirm compulsory cover."}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ProfileFact label={isThai ? "ผู้ให้บริการ พ.ร.บ." : "Compulsory provider"} value={missing} />
          <ProfileFact label={isThai ? "เลขกรมธรรม์ พ.ร.บ." : "Compulsory policy number"} value={record.compulsory_policy_number || missing} />
          <ProfileFact label={isThai ? "วันเริ่ม พ.ร.บ." : "Compulsory start date"} value={profileDate(record.compulsory_start_date, language)} />
          <ProfileFact label={isThai ? "วันหมดอายุ พ.ร.บ." : "Compulsory expiry date"} value={profileDate(record.compulsory_expiry_date, language)} />
          <ProfileFact label={isThai ? "ค่า พ.ร.บ." : "Compulsory cost"} value={profileMoney(record.compulsory_insurance_premium, language)} />
          <ProfileFact label={isThai ? "เอกสาร พ.ร.บ." : "Compulsory document"} value={recordDocuments.find((document) => document.document_type === "compulsory")?.file_name || missing} />
          <ProfileFact label={isThai ? "หมายเหตุ พ.ร.บ." : "Compulsory notes"} value={missing} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">{isThai ? "ภาษีรถ" : "Vehicle Tax"}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ProfileFact label={isThai ? "วันหมดอายุภาษี" : "Tax expiry date"} value={profileDate(record.registration_expiry_date, language)} />
          <ProfileFact label={isThai ? "ค่าภาษีรถ" : "Tax cost"} value={profileMoney(record.vehicle_tax, language)} />
          <ProfileFact label={isThai ? "เอกสารทะเบียน/ภาษี" : "Registration/tax document"} value={recordDocuments.find((document) => document.document_type === "registration" || document.document_type === "tax")?.file_name || missing} />
          <ProfileFact label={isThai ? "หมายเหตุภาษี" : "Tax notes"} value={missing} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">{isThai ? "ค่าใช้จ่ายอื่น" : "Other Costs"}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ProfileFact label={isThai ? "ภาษีรถ" : "Vehicle tax"} value={profileMoney(record.vehicle_tax, language)} />
          <ProfileFact label={isThai ? "เบี้ยเพิ่ม" : "Additional premium"} value={profileMoney(record.additional_premium, language)} />
          <ProfileFact label={isThai ? "ค่าใช้จ่ายประกันรายปีที่บันทึก" : "Recorded annual insurance cost"} value={profileMoney(annualInsuranceCost(record), language)} />
          <ProfileFact label={isThai ? "ค่าใช้จ่ายอื่นที่เกี่ยวกับประกัน" : "Other recorded insurance-related costs"} value={missing} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-violet-600" />
          <h3 className="text-sm font-bold text-slate-950">
            {isThai ? "ประวัติประกันภัย" : "Insurance history"}
          </h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {isThai
            ? "ระบบเดิมจัดเก็บกรมธรรม์ปัจจุบันหนึ่งช่วงเวลา ยังไม่มีรายการกรมธรรม์ก่อนหน้าที่ปลอดภัยให้แสดง"
            : "The legacy schema stores one current policy period. No reliable previous-policy rows are available to display."}
        </p>
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-violet-600">{isThai ? "ปัจจุบัน" : "Current"}</p>
              <p className="mt-1 font-bold text-slate-900">{record.policy_number || missing}</p>
              <p className="mt-1 text-xs text-slate-500">{canonicalInsurer || missing} · {record.insurance_class || missing}</p>
            </div>
            <HistoryBadge status={insuranceHistoryStatus(record)} language={language} />
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <span>{isThai ? "เริ่ม" : "Start"}: {record.insurance_start_date || missing}</span>
            <span>{isThai ? "หมดอายุ" : "Expiry"}: {record.insurance_expiry_date || missing}</span>
            <span>{isThai ? "ทุนประกัน" : "Insured value"}: {record.insured_value == null ? missing : record.insured_value.toLocaleString()}</span>
            <span>{isThai ? "เบี้ย" : "Premium"}: {record.insurance_premium == null ? missing : record.insurance_premium.toLocaleString()}</span>
            <span className="sm:col-span-2">{isThai ? "เอกสารต้นทาง" : "Source document"}: {recordDocuments.find((document) => document.document_type === "insurance")?.file_name || missing}</span>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">{isThai ? "ไม่มีประวัติกรมธรรม์ก่อนหน้าในโครงสร้างข้อมูลปัจจุบัน ระบบไม่ได้สร้างหรือคาดเดาข้อมูลย้อนหลัง" : "No previous policy history exists in the current data model. Historical values are not generated or inferred."}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-950">
            {isThai ? "เอกสารและการปฏิบัติตามข้อกำหนด" : "Documents and Compliance"}
          </h3>
          <span className="text-xs font-semibold text-slate-500">
            {recordDocuments.length} {isThai ? "เอกสาร" : "document(s)"}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {findings.length ? findings.map((finding) => (
            <div key={finding.code} className={`rounded-xl border px-3 py-2.5 ${finding.severity === "critical" ? "border-rose-200 bg-rose-50" : finding.severity === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-center gap-2">
                {finding.severity === "critical" ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : finding.severity === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <Clock3 className="h-4 w-4 text-slate-500" />}
                <p className="text-xs font-bold text-slate-800">{qualityLabel(finding.code, finding.label, language)}</p>
              </div>
              {!isThai && <p className="mt-1 pl-6 text-xs leading-5 text-slate-600">{finding.detail}</p>}
            </div>
          )) : (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{isThai ? "ไม่พบข้อสังเกตอัตโนมัติ" : "No automated findings."}</div>
          )}
        </div>
        {recordDocuments.length > 0 && (
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
            {recordDocuments.map((document) => <div key={document.id} className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="min-w-0 truncate font-semibold text-slate-700">{document.file_name}</span><span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">{document.document_type === "insurance" ? (isThai ? "ประกันหลัก" : "Main insurance") : document.document_type === "compulsory" ? (isThai ? "พ.ร.บ." : "Compulsory") : document.document_type === "registration" ? (isThai ? "ทะเบียน/ภาษี" : "Registration/tax") : document.document_type}</span></div>)}
          </div>
        )}
        <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
          <span><strong>{isThai ? "สถานะปัจจุบัน" : "Current status"}:</strong> {notRequired ? (isThai ? "ไม่ต้องมีประกัน" : "Not Required") : insuranceHistoryStatus(record) === "CURRENT" ? (isThai ? "มีผลปัจจุบัน" : "Current") : insuranceHistoryStatus(record) === "EXPIRED" ? (isThai ? "หมดอายุ" : "Expired") : insuranceHistoryStatus(record) === "FUTURE" ? (isThai ? "ยังไม่เริ่ม" : "Future") : (isThai ? "ไม่ทราบ" : "Unknown")}</span>
          <span><strong>{isThai ? "ระยะเวลาต่ออายุ" : "Renewal timing"}:</strong> {notRequired ? (isThai ? "ไม่ต้องต่ออายุประกัน" : "No insurance renewal required") : record.days_to_insurance_expiry == null ? missing : record.days_to_insurance_expiry < 0 ? (isThai ? `หมดอายุแล้ว ${Math.abs(record.days_to_insurance_expiry)} วัน` : `Expired ${Math.abs(record.days_to_insurance_expiry)} days ago`) : (isThai ? `เหลือ ${record.days_to_insurance_expiry} วัน` : `${record.days_to_insurance_expiry} days remaining`)}</span>
          <span><strong>{isThai ? "สถานะการตรวจ" : "Verification"}:</strong> {record.verification_status === "verified" ? (isThai ? "ตรวจสอบแล้ว" : "Verified") : (isThai ? "รอตรวจ" : "Awaiting review")}</span>
          <span><strong>{isThai ? "อัปเดตล่าสุด" : "Last updated"}:</strong> {record.updated_at ? new Date(record.updated_at).toLocaleString(isThai ? "th-TH" : "en-GB") : missing}</span>
          <span><strong>{isThai ? "แหล่งข้อมูล" : "Source"}:</strong> {record.source || missing}</span>
          <span><strong>{isThai ? "แถวต้นทาง" : "Source row"}:</strong> {record.source_row == null ? missing : record.source_row}</span>
        </div>
      </section>
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-violet-100 bg-white px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div>;
}

function HistoryBadge({ status, language }: { status: "CURRENT" | "EXPIRED" | "FUTURE" | "UNKNOWN" | "NOT_REQUIRED"; language: "en" | "th" }) {
  const classes = status === "CURRENT" ? "bg-emerald-50 text-emerald-700" : status === "EXPIRED" ? "bg-rose-50 text-rose-700" : status === "FUTURE" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600";
  const text = language === "th" ? status === "CURRENT" ? "มีผลปัจจุบัน" : status === "EXPIRED" ? "หมดอายุ" : status === "FUTURE" ? "ยังไม่เริ่ม" : status === "NOT_REQUIRED" ? "ไม่ต้องมีประกัน" : "ไม่ทราบ" : status === "NOT_REQUIRED" ? "NOT REQUIRED" : status;
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${classes}`}>{text}</span>;
}
