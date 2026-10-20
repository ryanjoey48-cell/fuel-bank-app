"use client";

import { useEffect, useRef, useState } from "react";
import { hrCopy, hrStatus } from "@/lib/ees-hr-v7-copy";
import { bangkokToday, type HRLanguage, type HRProfile } from "@/lib/ees-hr-v7-types";
import { HRDate, HRDialog, HRFields, HRNotice, useHRMutation, type HRField } from "./hr-ui";
import { hrRequest, profilePath } from "@/lib/ees-hr-v7-client";
import { verifyPersonnelSave } from "@/lib/ees-hr-save-verification";

type FormValues = Record<string, unknown>;
function formFromModel(model: HRProfile): FormValues {
  const profile = model.data.profile as Record<string, unknown> | null;
  const personal = model.data.private as Record<string, unknown> | null;
  return {
    preferredName: profile?.preferred_name ?? model.employee.name ?? "",
    employeeNumber: profile?.employee_number ?? "",
    jobRole: profile?.job_role ?? "",
    department: profile?.department ?? "",
    employmentStatus: profile?.employment_status ?? "not_recorded",
    startDate: profile?.start_date ?? "",
    endDate: profile?.end_date ?? "",
    statusReason: "",
    legalNameTh: personal?.legal_name_th ?? "",
    englishName: personal?.english_name ?? "",
    telephone: personal?.telephone ?? "",
    address: personal?.address ?? "",
    emergencyContact: personal?.emergency_contact ?? "",
    emergencyPhone: personal?.emergency_phone ?? "",
    employmentNotes: personal?.employment_notes ?? "",
  };
}

export function PersonnelSection({ model, language, reload,onDirty,onBusy }: { model: HRProfile; language: HRLanguage; reload: () => Promise<void>;onDirty?:(dirty:boolean)=>void;onBusy?:(busy:boolean)=>void }) {
  const c = hrCopy(language);
  const profile = model.data.profile as Record<string, unknown> | null;
  const [values, setValues] = useState<FormValues>(() => formFromModel(model));
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [salary, setSalary] = useState<FormValues>({ effectiveFrom: bangkokToday(), amount: "", period: "monthly", reason: "" });
  const [dirty, setDirty] = useState(false);
  const touched=useRef(new Set<string>()),[cancelBusy,setCancelBusy]=useState(false);
  const profileIdentity = String(profile?.id ?? model.employee.employeeId ?? model.employee.id);
  useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);

  // Load stored values only when an actual fresh profile record arrives.
  // An unrelated render does not erase unsaved typing.
  useEffect(() => {
    if (!dirty) setValues(formFromModel(model));
  }, [model, profileIdentity, dirty]);

  const mutation = useHRMutation(language, reload);
  useEffect(()=>{onBusy?.(mutation.busy||cancelBusy);return()=>onBusy?.(false);},[mutation.busy,cancelBusy,onBusy]);
  const parent = { driverId: model.employee.driverId, employeeId: model.employee.employeeId };
  const fields: HRField[] = [
    { key: "preferredName", label: language === "th" ? "ชื่อเล่น" : "Nickname / ชื่อเล่น", required: !model.employee.driverId },
    { key: "employeeNumber", label: c.employeeNumber, help: c.employeeCodeHelp },
    { key: "legalNameTh", label: c.legalNameTh },
    { key: "englishName", label: c.englishName },
    { key: "telephone", label: c.telephone },
    { key: "emergencyContact", label: c.emergencyContact },
    { key: "emergencyPhone", label: c.emergencyPhone },
    { key: "jobRole", label: c.jobRole },
    { key: "department", label: c.department },
    { key: "employmentStatus", label: c.status, type: "select", options: ["not_recorded", "active", "on_leave", "left"].map(value => ({ value, label: hrStatus(language, value) })) },
    { key: "startDate", label: c.startDate, type: "date" },
    { key: "endDate", label: c.endDate, type: "date" },
    { key: "address", label: c.address, type: "textarea" },
    { key: "employmentNotes", label: c.employmentNotes, type: "textarea" },
    { key: "statusReason", label: c.statusReason, type: "textarea", required: !profile },
  ];
  const compensation = (model.data.compensation ?? []) as Record<string, unknown>[];
  const history = (model.data.employmentHistory ?? []) as Record<string, unknown>[];
  if(!Object.prototype.hasOwnProperty.call(model.data,"profile")||!Object.prototype.hasOwnProperty.call(model.data,"private"))return <HRNotice error>{language==="th"?"ข้อมูลบุคลากรที่ได้รับไม่ครบถ้วน จึงยังไม่เปิดแก้ไข กรุณาโหลดประวัติใหม่":"The personnel response was incomplete. Editing is disabled; reload the profile."}</HRNotice>;

  return <div className="space-y-5">
    <section className="rounded-xl border border-violet-100 bg-white p-5">
      <h2 className="mb-5 text-lg font-bold text-slate-950">{c.personnel}</h2>
      <form onSubmit={event => {
        event.preventDefault();
        // Only explicitly edited fields are sent for existing records. Unchanged
        // blanks and values from an older form must not erase another HR edit.
        const patch=profile?Object.fromEntries([...touched.current].map(key=>[key,values[key]])):values;
        const submitted={...parent,...patch};
        void mutation.run("save_employee", submitted, async()=>{
          const ref={kind:model.employee.driverId?"driver" as const:"employee" as const,id:model.employee.driverId??model.employee.id};
          const fresh=await hrRequest<HRProfile>(profilePath(ref,"personnel"));
          verifyPersonnelSave(submitted,fresh);
        }).then(result => { if (result) {touched.current.clear();setDirty(false);} });
      }}>
        <HRFields fields={fields} values={values} disabled={mutation.busy||cancelBusy||model.access.releaseReady===false}
          onChange={(key, value) => { touched.current.add(key);setDirty(true); setValues(current => ({ ...current, [key]: value })); }} />
        {mutation.error && <div className="mt-4"><HRNotice error>{mutation.error}</HRNotice></div>}
        {mutation.notice && <div className="mt-4"><HRNotice>{mutation.notice}</HRNotice></div>}
        <footer className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" disabled={mutation.busy||cancelBusy||!dirty} className="btn-secondary" onClick={()=>{setCancelBusy(true);mutation.clear();void reload().then(()=>{touched.current.clear();setDirty(false);}).catch(()=>{}).finally(()=>setCancelBusy(false));}}>{c.cancel}</button>
          <button type="submit" disabled={mutation.busy||cancelBusy||model.access.releaseReady===false||(!!profile&&!dirty)} className="btn-primary">{mutation.busy||cancelBusy ? c.saving : c.save}</button>
        </footer>
      </form>
    </section>
    <details className="rounded-xl border border-violet-100 bg-white p-5">
      <summary className="cursor-pointer text-base font-bold text-slate-950">{c.compensation}</summary>
      <div className="mt-4">
        <div className="mb-3 flex justify-end"><button type="button" className="btn-secondary" disabled={!model.employee.employeeId} onClick={() => { mutation.clear(); setSalaryOpen(true); }}>{c.newCompensation}</button></div>
        {!compensation.length ? <p className="text-sm text-slate-500">{c.noCompensation}</p> : <div className="space-y-3">{compensation.map(row => <article key={String(row.id)} className="rounded-lg bg-slate-50 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" }).format(Number(row.amount))} · {row.period === "daily" ? c.daily : c.monthly}</strong><span><HRDate value={String(row.effective_from)} language={language} /></span></div><p className="mt-2 whitespace-pre-wrap text-slate-600">{String(row.reason)}</p></article>)}</div>}
      </div>
    </details>
    <section className="rounded-xl border border-violet-100 bg-white p-5">
      <h2 className="mb-3 font-bold text-slate-950">{c.employmentHistory}</h2>
      {history.length ? <ol className="space-y-3">{history.map(row => <li key={String(row.id)} className="border-l-2 border-violet-200 pl-4 text-sm"><p className="font-semibold">{hrStatus(language, String(row.employment_status))} · <HRDate value={String(row.effective_on)} language={language} /></p><p className="mt-1 whitespace-pre-wrap text-slate-600">{String(row.reason)}</p></li>)}</ol> : <p className="text-sm text-slate-500">{c.noData}</p>}
    </section>
    {salaryOpen && <HRDialog title={c.newCompensation} language={language} busy={mutation.busy} error={mutation.error} onClose={() => setSalaryOpen(false)} onSubmit={() => { void mutation.run("save_compensation", { ...parent, ...salary }).then(result => { if (result) setSalaryOpen(false); }); }}>
      <HRFields values={salary} disabled={mutation.busy} onChange={(key, value) => setSalary(current => ({ ...current, [key]: value }))} fields={[
        { key: "effectiveFrom", label: c.effectiveDate, type: "date", required: true },
        { key: "amount", label: c.salary, type: "number", step: "0.01", required: true },
        { key: "period", label: c.period, type: "select", options: [{ value: "monthly", label: c.monthly }, { value: "daily", label: c.daily }] },
        { key: "reason", label: c.reason, type: "textarea", required: true },
      ]} />
    </HRDialog>}
  </div>;
}
