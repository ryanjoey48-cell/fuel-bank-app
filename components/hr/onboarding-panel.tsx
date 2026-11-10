"use client";
import { useEffect, useMemo, useState } from "react";
import { draftStorageKey, onboardingStepsDone } from "@/lib/ees-hr-attention";
import { hrCopy, hrStatus } from "@/lib/ees-hr-v7-copy";
import { hrVehicleType } from "@/lib/ees-hr-v7-vehicle-label";
import { hrV8Copy } from "@/lib/ees-hr-v8-copy";
import type { HRLanguage, HRProfile } from "@/lib/ees-hr-v7-types";
import { HRFields, HRNotice, useHRMutation, type HRField } from "./hr-ui";

type StepId = "identity" | "code" | "employment" | "role" | "vehicle" | "licence" | "documents" | "followups";

const STEPS: StepId[] = ["identity", "code", "employment", "role", "vehicle", "licence", "documents", "followups"];

type Draft = {
  preferredName: string;
  employeeNumber: string;
  jobRole: string;
  department: string;
  employmentStatus: string;
  startDate: string;
  statusReason: string;
  legalNameTh: string;
  englishName: string;
  telephone: string;
};

function draftFromModel(model: HRProfile): Draft {
  const profile = model.data.profile as Record<string, unknown> | null;
  const personal = model.data.private as Record<string, unknown> | null;
  return {
    preferredName: String(profile?.preferred_name ?? model.employee.name ?? ""),
    employeeNumber: String(profile?.employee_number ?? model.employee.employeeNumber ?? ""),
    jobRole: String(profile?.job_role ?? model.employee.jobRole ?? ""),
    department: String(profile?.department ?? model.employee.department ?? ""),
    employmentStatus: String(profile?.employment_status ?? model.employee.employmentStatus ?? "not_recorded"),
    startDate: String(profile?.start_date ?? model.employee.startDate ?? ""),
    statusReason: "",
    legalNameTh: String(personal?.legal_name_th ?? ""),
    englishName: String(personal?.english_name ?? ""),
    telephone: String(personal?.telephone ?? ""),
  };
}

/** Progress uses persisted profile fields only — never unsaved draft values. */
function stepDonePersisted(step: StepId, model: HRProfile): boolean {
  const employee = model.employee;
  switch (step) {
    case "identity":
      return Boolean(employee.name);
    case "code":
      return Boolean(employee.employeeNumber);
    case "employment":
      return employee.employmentStatus !== "not_recorded";
    case "role":
      return Boolean(employee.jobRole);
    case "vehicle":
      return employee.kind === "employee" || Boolean(employee.vehicle);
    case "licence":
      return employee.kind === "employee" || Boolean(employee.documentStatus && employee.documentStatus !== "not_recorded");
    case "documents": {
      if (employee.kind === "employee") return true;
      const docs = (model.data.documents as { state?: string }[] | undefined) ?? [];
      return docs.some((doc) => doc.state === "ready");
    }
    case "followups":
      return !employee.nextFollowup;
    default:
      return false;
  }
}

function draftDiffers(model: HRProfile, draft: Draft): boolean {
  const saved = draftFromModel(model);
  return (Object.keys(saved) as (keyof Draft)[]).some((key) => {
    if (key === "statusReason") return Boolean(draft.statusReason.trim());
    return String(draft[key] ?? "") !== String(saved[key] ?? "");
  });
}

export function OnboardingPanel({
  model,
  language,
  reload,
  onOpenSection,
}: {
  model: HRProfile;
  language: HRLanguage;
  reload: () => Promise<void>;
  onOpenSection: (section: "personnel" | "documents" | "assignments" | "followups") => void;
}) {
  const c = hrCopy(language);
  const v8 = hrV8Copy(language);
  const key = draftStorageKey(model.employee.kind, model.employee.id);
  const [draft, setDraft] = useState<Draft>(() => draftFromModel(model));
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [step, setStep] = useState<StepId>("identity");
  const mutation = useHRMutation(language, reload);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        setDraft(draftFromModel(model));
        setDirty(false);
        setRestored(false);
        return;
      }
      const parsed = JSON.parse(raw) as Draft;
      setDraft({ ...draftFromModel(model), ...parsed });
      setDirty(true);
      setRestored(true);
    } catch {
      setDraft(draftFromModel(model));
      setDirty(false);
      setRestored(false);
    }
    // Re-load draft only when switching employee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (dirty) return;
    setDraft(draftFromModel(model));
  }, [model, dirty]);

  useEffect(() => {
    if (!dirty) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* private mode / quota */
    }
  }, [draft, dirty, key]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const progress = useMemo(() => onboardingStepsDone(model.employee, model.data), [model]);
  const hasUnsaved = dirty && draftDiffers(model, draft);
  const labels: Record<StepId, string> = {
    identity: v8.stepIdentity,
    code: v8.stepCode,
    employment: v8.stepEmployment,
    role: v8.stepRole,
    vehicle: v8.stepVehicle,
    licence: v8.stepLicence,
    documents: v8.stepDocuments,
    followups: v8.stepFollowups,
  };

  const fields: HRField[] = [
    { key: "preferredName", label: c.displayName, required: true },
    { key: "employeeNumber", label: c.employeeNumber, help: c.employeeCodeHelp },
    { key: "legalNameTh", label: c.legalNameTh },
    { key: "englishName", label: c.englishName },
    { key: "telephone", label: c.telephone },
    { key: "jobRole", label: c.jobRole },
    { key: "department", label: c.department },
    {
      key: "employmentStatus",
      label: c.status,
      type: "select",
      options: ["not_recorded", "active", "on_leave", "left"].map((value) => ({ value, label: hrStatus(language, value) })),
    },
    { key: "startDate", label: c.startDate, type: "date" },
    {
      key: "statusReason",
      label: c.statusReason,
      type: "textarea",
      required: !model.employee.employeeId || draft.employmentStatus !== (model.employee.employmentStatus ?? "not_recorded"),
    },
  ];

  const savePersonnel = async () => {
    if (!draft.preferredName.trim()) return;
    if ((!model.employee.employeeId || draft.employmentStatus !== model.employee.employmentStatus) && !draft.statusReason.trim()) return;
    const input: Record<string, unknown> = {
      driverId: model.employee.driverId,
      employeeId: model.employee.employeeId,
      preferredName: draft.preferredName.trim(),
      employeeNumber: draft.employeeNumber.trim(),
      jobRole: draft.jobRole.trim(),
      department: draft.department.trim(),
      employmentStatus: draft.employmentStatus,
      startDate: draft.startDate || undefined,
      legalNameTh: draft.legalNameTh.trim(),
      englishName: draft.englishName.trim(),
      telephone: draft.telephone.trim(),
      statusReason: draft.statusReason.trim() || (language === "th" ? "เติมข้อมูลผ่านขั้นตอนรับเข้า" : "Completed via onboarding workspace"),
    };
    const result = await mutation.run("save_employee", input);
    if (result) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      setDirty(false);
      setRestored(false);
    }
  };

  const clearDraft = () => {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setDraft(draftFromModel(model));
    setDirty(false);
    setRestored(false);
  };

  const updateDraft = (keyName: string, value: unknown) => {
    setDirty(true);
    setDraft((current) => ({ ...current, [keyName]: value }));
  };

  return (
    <section className="hr-panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">{v8.onboardingTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{v8.onboardingHelp}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-violet-700">
            {v8.stepProgress}: {progress} / {STEPS.length}
          </p>
          {hasUnsaved ? <p className="mt-1 text-xs font-semibold text-amber-700">{v8.previewOnly}</p> : null}
        </div>
      </div>
      {restored ? <HRNotice>{v8.draftRestored}</HRNotice> : null}
      {hasUnsaved ? <HRNotice>{language === "th" ? "มีค่าที่แก้ไขในเครื่อง — ยังไม่บันทึกจนกว่าจะกดบันทึกขั้นตอนนี้" : "Local draft differs from saved record — steps stay incomplete until save succeeds."}</HRNotice> : null}
      {mutation.notice ? <HRNotice>{mutation.notice}</HRNotice> : null}
      {mutation.error ? <HRNotice error>{mutation.error}</HRNotice> : null}
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((id) => {
          const done = stepDonePersisted(id, model);
          return (
            <li key={id}>
              <button
                type="button"
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${step === id ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white"}`}
                onClick={() => setStep(id)}
              >
                <span className={`font-semibold ${done ? "text-emerald-700" : "text-slate-900"}`}>{labels[id]}</span>
                <span className="mt-1 block text-xs text-slate-500">{done ? v8.recordedVerified : v8.missing}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === "identity" || step === "code" || step === "employment" || step === "role" ? (
        <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
          <HRFields
            fields={fields}
            values={draft}
            disabled={mutation.busy || !model.access.hr || !model.access.ready}
            onChange={updateDraft}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={mutation.busy || !model.access.hr || !model.access.ready || !hasUnsaved} onClick={() => void savePersonnel()}>
              {v8.saveStep}
            </button>
            <button type="button" className="btn-secondary" onClick={() => onOpenSection("personnel")}>
              {v8.createPersonnel}
            </button>
            <button type="button" className="btn-secondary" disabled={!dirty} onClick={clearDraft}>
              {v8.clearDraft}
            </button>
          </div>
          {!model.access.ready ? <HRNotice>{c.setupDescription}</HRNotice> : null}
        </div>
      ) : null}

      {step === "vehicle" ? (
        <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-sm">
          <p>
            <span className="text-slate-500">{c.vehicle}: </span>
            <strong>{model.employee.vehicle?.registration ?? (model.employee.driverId ? c.notRecorded : c.officeEmployee)}</strong>
          </p>
          <p>
            <span className="text-slate-500">{c.vehicleType}: </span>
            <strong>{model.employee.vehicle?.type ? hrVehicleType(language, model.employee.vehicle.type) : c.notRecorded}</strong>
          </p>
          {model.employee.driverId ? (
            <button type="button" className="btn-secondary" onClick={() => onOpenSection("assignments")}>
              {c.history}
            </button>
          ) : (
            <HRNotice>{c.noDriverLink}</HRNotice>
          )}
        </div>
      ) : null}

      {step === "licence" || step === "documents" ? (
        <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-sm">
          <p>
            {c.licenceReview}: <strong>{model.employee.documentStatus ? hrStatus(language, model.employee.documentStatus) : c.hrOnly}</strong>
          </p>
          {!model.access.storageReady ? <HRNotice>{v8.uploadDisabled}</HRNotice> : <HRNotice>{language === "th" ? "อัปโหลดใช้ขั้นตอนเอกสารที่ได้รับอนุญาตเท่านั้น" : "Use the authorised Documents section for uploads when Gate B is approved."}</HRNotice>}
          <p className="text-xs text-slate-500">{v8.gatedStep}</p>
          <button type="button" className="btn-secondary" onClick={() => onOpenSection("documents")}>
            {c.documents}
          </button>
        </div>
      ) : null}

      {step === "followups" ? (
        <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-sm">
          <p>
            {c.nextFollowup}: <strong>{model.employee.nextFollowup ?? c.noNextAction}</strong>
          </p>
          <button type="button" className="btn-secondary" onClick={() => onOpenSection("followups")}>
            {c.followups}
          </button>
        </div>
      ) : null}
    </section>
  );
}
