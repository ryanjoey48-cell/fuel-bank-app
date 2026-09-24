"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileText,
  History,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Search,
  X
} from "lucide-react";
import { Header } from "@/components/header";
import { InsuranceIntelligenceWorkspace } from "@/components/insurance-intelligence-workspace";
import { InsuranceProfileInsights } from "@/components/insurance-profile-insights";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useLanguage } from "@/lib/language-provider";
import {
  matchesInsuranceSearch,
  insuranceRequirement,
  isAwaitingInsuranceReview,
  isInsuranceNotRequired,
  type InsuranceAssetRecord,
  type InsuranceDocumentRecord,
  type InsuranceStatus,
  type VerificationStatus
} from "@/lib/insurance-intelligence";
import {
  canonicalInsurerName,
  canonicalInsurerOptions
} from "@/lib/insurance-providers";

type ViewMode = "review" | "renewals" | "all" | "verified";

type InsuranceRecord = InsuranceAssetRecord;
type InsuranceDocument = InsuranceDocumentRecord;

type InsuranceHistoryRecord = {
  id: string;
  insurance_record_id: string;
  vehicle_registration: string;
  insurer_th: string | null;
  insurer_en: string | null;
  policy_number: string | null;
  insurance_class: string | null;
  policy_issue_date: string | null;
  insurance_start_date: string | null;
  insurance_expiry_date: string | null;
  insured_value: number | null;
  repair_type: string | null;
  insurance_premium: number | null;
  compulsory_insurance_premium: number | null;
  vehicle_tax: number | null;
  additional_premium: number | null;
  insurance_document_path: string | null;
  insurance_document_name: string | null;
  compulsory_document_path: string | null;
  compulsory_document_name: string | null;
  archived_at: string;
};

type Draft = {
  insurance_requirement: "required" | "not_required" | "unknown";
  insurance_requirement_reason: string;
  insurer_th: string;
  insurer_en: string;
  policy_number: string;
  insurance_class: string;
  policy_issue_date: string;
  insured_value: string;
  repair_type: string;
  vehicle_make: string;
  vehicle_year: string;
  chassis_number: string;
  compulsory_included: "" | "yes" | "no";
  compulsory_policy_number: string;
  compulsory_policy_issue_date: string;
  compulsory_start_date: string;
  compulsory_expiry_date: string;
  insurance_start_date: string;
  insurance_expiry_date: string;
  registration_date: string;
  registration_expiry_date: string;
  laos_expiry_date: string;
  insurance_premium: string;
  compulsory_insurance_premium: string;
  vehicle_tax: string;
  additional_premium: string;
  notes: string;
};

type NewVehicleDraft = {
  vehicle_registration: string;
  vehicle_make: string;
  vehicle_year: string;
  chassis_number: string;
  ownership_holder: string;
};

const EMPTY_NEW_VEHICLE: NewVehicleDraft = {
  vehicle_registration: "",
  vehicle_make: "",
  vehicle_year: "",
  chassis_number: "",
  ownership_holder: ""
};

const PAGE_SIZE = 12;

function toDraft(record: InsuranceRecord): Draft {
  return {
    insurance_requirement: insuranceRequirement(record),
    insurance_requirement_reason: record.insurance_requirement_reason ?? "",
    insurer_th: record.insurer_th ?? "",
    insurer_en: record.insurer_en ?? "",
    policy_number: record.policy_number ?? "",
    insurance_class: record.insurance_class ?? "",
    policy_issue_date: record.policy_issue_date ?? "",
    insured_value:
      record.insured_value == null ? "" : String(record.insured_value),
    repair_type: record.repair_type ?? "",
    vehicle_make: record.vehicle_make ?? "",
    vehicle_year: record.vehicle_year == null ? "" : String(record.vehicle_year),
    chassis_number: record.chassis_number ?? "",
    compulsory_included:
      record.compulsory_included === true
        ? "yes"
        : record.compulsory_included === false
          ? "no"
          : "",
    compulsory_policy_number: record.compulsory_policy_number ?? "",
    compulsory_policy_issue_date: record.compulsory_policy_issue_date ?? "",
    compulsory_start_date: record.compulsory_start_date ?? "",
    compulsory_expiry_date: record.compulsory_expiry_date ?? "",
    insurance_start_date: record.insurance_start_date ?? "",
    insurance_expiry_date: record.insurance_expiry_date ?? "",
    registration_date: record.registration_date ?? "",
    registration_expiry_date: record.registration_expiry_date ?? "",
    laos_expiry_date: record.laos_expiry_date ?? "",
    insurance_premium:
      record.insurance_premium === null ? "" : String(record.insurance_premium),
    compulsory_insurance_premium:
      record.compulsory_insurance_premium === null
        ? ""
        : String(record.compulsory_insurance_premium),
    vehicle_tax: record.vehicle_tax === null ? "" : String(record.vehicle_tax),
    additional_premium:
      record.additional_premium === null ? "" : String(record.additional_premium),
    notes: record.notes ?? ""
  };
}

function nullableNumber(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const parsed = Number(clean.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: string) {
  const clean = value.trim();
  return clean ? clean : null;
}

function dateState(date: string | null) {
  if (!date) return "missing" as const;
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "expired" as const;
  if (days <= 30) return "due30" as const;
  if (days <= 90) return "due90" as const;
  return "ok" as const;
}

function urgencyRank(record: InsuranceRecord) {
  if (isInsuranceNotRequired(record)) return 98;
  if (record.verification_status === "verified") return 99;
  if (record.insurance_status === "expired") return 0;
  if (record.insurance_status === "due_30") return 1;
  if (record.insurance_status === "due_60") return 2;
  if (record.insurance_status === "due_90") return 3;
  if (record.insurance_status === "missing") return 4;

  const registration = dateState(record.registration_expiry_date);
  if (registration === "expired") return 5;
  if (registration === "due30") return 6;
  if (registration === "due90") return 7;
  return 8;
}

function isRenewalAttention(record: InsuranceRecord) {
  if (isInsuranceNotRequired(record)) return false;
  return ["expired", "due_30", "due_60", "due_90", "missing"].includes(
    record.insurance_status
  );
}

function deriveInsuranceState(record: Omit<InsuranceRecord, "insurance_status" | "days_to_insurance_expiry"> & Partial<Pick<InsuranceRecord, "insurance_status" | "days_to_insurance_expiry">>): InsuranceRecord {
  if (isInsuranceNotRequired(record as InsuranceRecord)) {
    return { ...record, insurance_status: "missing", days_to_insurance_expiry: null } as InsuranceRecord;
  }
  const expiry = record.insurance_expiry_date;
  if (!expiry) return { ...record, insurance_status: "missing", days_to_insurance_expiry: null } as InsuranceRecord;
  const target = new Date(`${expiry}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  const insurance_status: InsuranceStatus = days < 0 ? "expired" : days <= 30 ? "due_30" : days <= 60 ? "due_60" : days <= 90 ? "due_90" : "active";
  return { ...record, insurance_status, days_to_insurance_expiry: days } as InsuranceRecord;
}

export default function InsurancePage() {
  const { language } = useLanguage();
  const isThai = language === "th";

  const [records, setRecords] = useState<InsuranceRecord[]>([]);
  const [allHistory, setAllHistory] = useState<InsuranceHistoryRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("review");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<InsuranceDocument[]>([]);
  const [insuranceDocs, setInsuranceDocs] = useState<Record<string, InsuranceDocument>>({});
  const [compulsoryDocs, setCompulsoryDocs] = useState<Record<string, InsuranceDocument>>({});
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [compulsoryDocumentUrl, setCompulsoryDocumentUrl] = useState<string | null>(null);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState<NewVehicleDraft>(EMPTY_NEW_VEHICLE);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [addVehicleError, setAddVehicleError] = useState<string | null>(null);
  const [history, setHistory] = useState<InsuranceHistoryRecord[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [renewalBusy, setRenewalBusy] = useState(false);

  const c = {
    title: isThai ? "ประกันภัยและเอกสารรถ" : "Insurance & Compliance",
    description: isThai
      ? "จัดการการต่ออายุ ตรวจสอบเอกสาร และติดตามวันหมดอายุของรถทั้งหมด"
      : "Manage renewals, document checks and vehicle compliance in one place.",
    refresh: isThai ? "รีเฟรช" : "Refresh",
    reviewNext: isThai ? "ตรวจรายการถัดไป" : "Review next vehicle",
    reviewQueue: isThai ? "รอตรวจเอกสาร" : "Review queue",
    renewals: isThai ? "ต่ออายุ" : "Renewals",
    allVehicles: isThai ? "รถทั้งหมด" : "All vehicles",
    verified: isThai ? "ตรวจสอบแล้ว" : "Verified",
    attention: isThai ? "ต้องดำเนินการ" : "Needs attention",
    expired: isThai ? "หมดอายุ" : "Expired",
    due30: isThai ? "ภายใน 30 วัน" : "Due in 30 days",
    missing: isThai ? "ข้อมูลไม่ครบ" : "Missing information",
    total: isThai ? "รถในระบบ" : "Vehicles in system",
    search: isThai
      ? "ค้นหาทะเบียน เลขตัวถัง ยี่ห้อ บริษัท หรือกรมธรรม์"
      : "Search registration, chassis, make, insurer or policy",
    vehicle: isThai ? "รถ" : "Vehicle",
    cover: isThai ? "ประกันภัย" : "Insurance",
    insuranceExpiry: isThai ? "ประกันหมดอายุ" : "Insurance expiry",
    registrationExpiry: isThai ? "ทะเบียนหมดอายุ" : "Registration expiry",
    review: isThai ? "การตรวจเอกสาร" : "Review",
    previous: isThai ? "ก่อนหน้า" : "Previous",
    next: isThai ? "ถัดไป" : "Next",
    page: isThai ? "หน้า" : "Page",
    of: isThai ? "จาก" : "of",
    noRecords: isThai ? "ไม่พบรายการ" : "No records in this view",
    remaining: isThai ? "รายการที่เหลือ" : "remaining",
    complete: isThai ? "เสร็จแล้ว" : "complete",
    details: isThai ? "รายละเอียด" : "Vehicle details",
    policy: isThai ? "เลขกรมธรรม์" : "Policy number",
    insuranceClass: isThai ? "ประเภทประกัน" : "Insurance class",
    policyIssueDate: isThai ? "วันที่ออกกรมธรรม์" : "Policy issue date",
    insuredValue: isThai ? "ทุนประกัน" : "Insured value",
    repairType: isThai ? "ประเภทการซ่อม" : "Repair type",
    vehicleMake: isThai ? "ยี่ห้อรถ" : "Vehicle make",
    vehicleYear: isThai ? "ปีรถ" : "Vehicle year",
    chassisNumber: isThai ? "เลขตัวถัง" : "Chassis number",
    compulsoryIncluded: isThai ? "รวม พ.ร.บ." : "Compulsory insurance included",
    yes: isThai ? "ใช่" : "Yes",
    no: isThai ? "ไม่" : "No",
    unknown: isThai ? "ไม่ทราบ" : "Unknown",
    insuranceRequirement: isThai ? "ข้อกำหนดประกัน" : "Insurance Requirement",
    insuranceRequired: isThai ? "ต้องมีประกัน" : "Insurance Required",
    insuranceNotRequired: isThai ? "ไม่ต้องมีประกัน" : "Insurance Not Required",
    requirementReason: isThai ? "เหตุผล" : "Reason",
    trailer: isThai ? "รถพ่วง" : "Trailer",
    uploadBeforeVerify: isThai
      ? "กรุณาอัปโหลดเอกสารประกันก่อนยืนยันการตรวจสอบ"
      : "Upload the insurance document before marking this vehicle verified.",
    insurer: isThai ? "บริษัทประกัน" : "Insurer",
    owner: isThai ? "ผู้ครอบครอง" : "Ownership",
    insuranceStart: isThai ? "วันเริ่มประกัน" : "Insurance start",
    registrationDate: isThai ? "วันจดทะเบียน" : "Registration date",
    laosExpiry: isThai ? "เอกสารลาวหมดอายุ" : "Laos expiry",
    premium: isThai ? "เบี้ยประกัน" : "Insurance premium",
    compulsory: isThai ? "พ.ร.บ." : "Compulsory insurance",
    compulsoryPolicy: isThai ? "เลขกรมธรรม์ พ.ร.บ." : "Compulsory policy number",
    compulsoryIssueDate: isThai ? "วันที่ออก พ.ร.บ." : "Compulsory policy issue date",
    compulsoryStart: isThai ? "พ.ร.บ. เริ่มคุ้มครอง" : "Compulsory cover start",
    compulsoryExpiry: isThai ? "พ.ร.บ. หมดอายุ" : "Compulsory cover expiry",
    mainInsuranceDocument: isThai ? "เอกสารประกันหลัก" : "Main insurance document",
    compulsoryDocument: isThai ? "เอกสาร พ.ร.บ." : "Compulsory insurance document",
    compulsoryUploadRequired: isThai
      ? "มีเลขกรมธรรม์ พ.ร.บ. แล้ว กรุณาอัปโหลดเอกสาร พ.ร.บ. ก่อนยืนยัน"
      : "A compulsory policy number is entered. Upload the compulsory insurance document before verifying.",
    tax: isThai ? "ภาษีรถ" : "Vehicle tax",
    additional: isThai ? "เบี้ยเพิ่ม" : "Additional premium",
    totalCost: isThai ? "ค่าใช้จ่ายรวม" : "Recorded total",
    source: isThai ? "ข้อมูลเดิม" : "Source information",
    importNotes: isThai ? "หมายเหตุจากไฟล์เดิม" : "Import review note",
    notes: isThai ? "หมายเหตุ" : "Notes",
    edit: isThai ? "แก้ไข" : "Edit details",
    cancel: isThai ? "ยกเลิก" : "Cancel",
    save: isThai ? "บันทึก" : "Save changes",
    verify: isThai ? "ยืนยันแล้ว" : "Mark verified",
    verifyNext: isThai ? "ยืนยันและถัดไป" : "Verify & next",
    reopen: isThai ? "ตรวจสอบอีกครั้ง" : "Return to review",
    verifiedOn: isThai ? "ตรวจสอบเมื่อ" : "Verified on",
    loadError: isThai ? "โหลดข้อมูลไม่สำเร็จ" : "Unable to load insurance data",
    saveError: isThai ? "บันทึกไม่สำเร็จ" : "Unable to save changes",
    days: isThai ? "วัน" : "days",
    document: isThai ? "เอกสารประกัน" : "Insurance document",
    documentReady: isThai ? "มีเอกสาร" : "Document uploaded",
    noDocument: isThai ? "ยังไม่มีเอกสาร" : "No document yet",
    uploadDocument: isThai ? "อัปโหลดเอกสาร" : "Upload document",
    replaceDocument: isThai ? "เปลี่ยนเอกสาร" : "Replace document",
    deleteDocument: isThai ? "ลบเอกสาร" : "Delete document",
    viewDocument: isThai ? "เปิดเอกสาร" : "Open document",
    documentHelp: isThai ? "รองรับ PDF, JPG, PNG, WEBP สูงสุด 10 MB" : "PDF, JPG, PNG or WEBP · max 10 MB",
    documentUploadError: isThai ? "อัปโหลดเอกสารไม่สำเร็จ" : "Unable to upload document",
    documentDeleteError: isThai ? "ลบเอกสารไม่สำเร็จ" : "Unable to delete document",
    addVehicle: isThai ? "เพิ่มรถ" : "Add vehicle",
    addVehicleTitle: isThai ? "เพิ่มรถเข้าสู่ระบบ" : "Add vehicle to system",
    addVehicleHelp: isThai
      ? "สร้างข้อมูลรถก่อน แล้วจึงเพิ่มข้อมูลประกันภัยและเอกสาร"
      : "Create the vehicle first, then add its insurance details and documents.",
    registration: isThai ? "ทะเบียนรถ" : "Registration",
    make: isThai ? "ยี่ห้อ" : "Make",
    year: isThai ? "ปีรถ" : "Year",
    chassis: isThai ? "เลขตัวถัง" : "Chassis number",
    ownership: isThai ? "ผู้ครอบครอง" : "Ownership",
    createVehicle: isThai ? "สร้างรถ" : "Create vehicle",
    registrationRequired: isThai ? "กรุณากรอกทะเบียนรถ" : "Registration is required.",
    vehicleAlreadyExists: isThai ? "มีทะเบียนรถนี้อยู่ในระบบแล้ว" : "This registration already exists.",
    addVehicleFailed: isThai ? "เพิ่มรถไม่สำเร็จ" : "Unable to add vehicle",
    deleteVehicle: isThai ? "ลบรายการรถ" : "Delete vehicle record",
    deleteVehicleConfirm: isThai
      ? "ลบรายการรถนี้ถาวรหรือไม่? เอกสารประกันที่อัปโหลดไว้จะถูกลบด้วย"
      : "Permanently delete this vehicle record? Its uploaded insurance documents will also be deleted.",
    deleteVehicleFailed: isThai ? "ลบรายการรถไม่สำเร็จ" : "Unable to delete vehicle record",
    history: isThai ? "ประวัติประกันภัย" : "Insurance history",
    noHistory: isThai ? "ยังไม่มีประวัติกรมธรรม์เก่า" : "No previous policies yet",
    startRenewal: isThai ? "เริ่มต่ออายุกรมธรรม์" : "Start renewal",
    startRenewalConfirm: isThai
      ? "เก็บกรมธรรม์ปัจจุบันไว้ในประวัติและเริ่มกรอกกรมธรรม์ใหม่หรือไม่?"
      : "Archive the current policy and start a new renewal? The old policy and document links will be preserved.",
    renewalFailed: isThai ? "เริ่มต่ออายุไม่สำเร็จ" : "Unable to start renewal",
    previousPolicy: isThai ? "กรมธรรม์เดิม" : "Previous policy",
    archivedOn: isThai ? "เก็บเมื่อ" : "Archived",
    deletingVehicle: isThai ? "กำลังลบ..." : "Deleting..."
  };

  const load = useCallback(async () => {
    setBusy(true);

    const [recordsResult, documentsResult, historyResult] = await Promise.all([
      supabase
        .from("vehicle_insurance_compliance")
        .select("*")
        .eq("record_status", "current"),
      supabase
        .from("vehicle_insurance_documents")
        .select("*"),
      supabase
        .from("vehicle_insurance_history")
        .select("*")
        .order("archived_at", { ascending: false })
    ]);

    if (recordsResult.error) {
      console.error("Insurance load failed", recordsResult.error);
      setError(recordsResult.error.message);
      setRecords([]);
    } else {
      setRecords((recordsResult.data ?? []).map((record) => deriveInsuranceState(record as InsuranceRecord)));
      setError(null);
    }

    if (documentsResult.error) {
      console.error("Insurance documents load failed", documentsResult.error);
      setInsuranceDocs({});
      setCompulsoryDocs({});
      setDocuments([]);
    } else {
      const insuranceMap: Record<string, InsuranceDocument> = {};
      const compulsoryMap: Record<string, InsuranceDocument> = {};
      const loadedDocuments = (documentsResult.data ?? []) as InsuranceDocument[];
      for (const item of loadedDocuments) {
        if (item.document_type === "insurance") {
          insuranceMap[item.insurance_record_id] = item;
        } else if (item.document_type === "compulsory") {
          compulsoryMap[item.insurance_record_id] = item;
        }
      }
      setInsuranceDocs(insuranceMap);
      setCompulsoryDocs(compulsoryMap);
      setDocuments(loadedDocuments);
    }

    if (historyResult.error) {
      console.error("Insurance history load failed", historyResult.error);
      setAllHistory([]);
    } else {
      setAllHistory((historyResult.data ?? []) as InsuranceHistoryRecord[]);
    }

    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    setDocumentUrl(null);
    setCompulsoryDocumentUrl(null);

    if (!selectedId) return;

    const signDocument = async (
      doc: InsuranceDocument | undefined,
      setter: (value: string | null) => void
    ) => {
      if (!doc) return;

      const { data, error } = await supabase.storage
        .from("insurance-documents")
        .createSignedUrl(doc.file_path, 3600);

      if (!active) return;
      if (error) {
        console.error("Insurance document preview failed", error);
        return;
      }

      setter(data.signedUrl);
    };

    void signDocument(insuranceDocs[selectedId], setDocumentUrl);
    void signDocument(compulsoryDocs[selectedId], setCompulsoryDocumentUrl);

    return () => {
      active = false;
    };
  }, [insuranceDocs, compulsoryDocs, selectedId]);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setHistory([]);
      return;
    }

    setHistoryBusy(true);
    void supabase
      .from("vehicle_insurance_history")
      .select("*")
      .eq("insurance_record_id", selectedId)
      .order("archived_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Insurance history load failed", error);
          setHistory([]);
        } else {
          setHistory((data ?? []) as InsuranceHistoryRecord[]);
        }
        setHistoryBusy(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const openArchivedDocument = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage
      .from("insurance-documents")
      .createSignedUrl(path, 3600);
    if (error) {
      setActionError(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const sortedRecords = useMemo(
    () =>
      [...records].sort((a, b) => {
        const rank = urgencyRank(a) - urgencyRank(b);
        if (rank !== 0) return rank;
        const aDays = a.days_to_insurance_expiry ?? 99999;
        const bDays = b.days_to_insurance_expiry ?? 99999;
        if (aDays !== bDays) return aDays - bDays;
        return a.vehicle_registration.localeCompare(b.vehicle_registration);
      }),
    [records]
  );

  const stats = useMemo(() => {
    const context = { records, documents };
    const remaining = records.filter((record) => isAwaitingInsuranceReview(record, context)).length;
    const verified = records.length - remaining;
    const expired = records.filter((r) => !isInsuranceNotRequired(r) && r.insurance_status === "expired").length;
    const due30 = records.filter((r) => !isInsuranceNotRequired(r) && r.insurance_status === "due_30").length;
    const missing = records.filter(
      (r) => !isInsuranceNotRequired(r) && (r.insurance_status === "missing" || !r.insurer_en || !r.policy_number)
    ).length;

    return {
      total: records.length,
      verified,
      remaining,
      expired,
      due30,
      missing
    };
  }, [documents, records]);

  const reviewQueue = useMemo(
    () => sortedRecords.filter((record) => isAwaitingInsuranceReview(record, { records, documents })),
    [documents, records, sortedRecords]
  );

  const filtered = useMemo(() => {
    return sortedRecords.filter((record) => {
      if (!matchesInsuranceSearch(record, search)) return false;

      if (view === "review") return isAwaitingInsuranceReview(record, { records, documents });
      if (view === "renewals") return isRenewalAttention(record);
      if (view === "verified") return record.verification_status === "verified";
      return true;
    });
  }, [documents, records, search, sortedRecords, view]);

  useEffect(() => setPage(1), [search, view]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRecords = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId]
  );

  const selectedQueueIndex = selected
    ? reviewQueue.findIndex((r) => r.id === selected.id)
    : -1;

  const openRecord = (record: InsuranceRecord) => {
    setSelectedId(record.id);
    setDraft(toDraft(record));
    setEditMode(false);
    setActionError(null);
  };

  const openRecordForReview = (record: InsuranceRecord) => {
    setSelectedId(record.id);
    setDraft(toDraft(record));
    setEditMode(true);
    setActionError(null);
  };

  const closeDrawer = () => {
    setSelectedId(null);
    setDraft(null);
    setEditMode(false);
    setActionError(null);
  };

  const startReview = () => {
    if (reviewQueue[0]) openRecord(reviewQueue[0]);
  };

  const updateLocal = (id: string, patch: Partial<InsuranceRecord>) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === id ? { ...record, ...patch } : record
      )
    );
  };

  const startRenewal = async () => {
    if (!selected || renewalBusy || isInsuranceNotRequired(selected)) return;

    const confirmed = window.confirm(c.startRenewalConfirm);
    if (!confirmed) return;

    setRenewalBusy(true);
    setActionError(null);

    const { data: userData } = await supabase.auth.getUser();
    const currentInsuranceDoc = insuranceDocs[selected.id];
    const currentCompulsoryDoc = compulsoryDocs[selected.id];

    const archive = {
      insurance_record_id: selected.id,
      vehicle_registration: selected.vehicle_registration,
      insurer_th: selected.insurer_th,
      insurer_en: selected.insurer_en,
      policy_number: selected.policy_number,
      insurance_class: selected.insurance_class,
      policy_issue_date: selected.policy_issue_date,
      insured_value: selected.insured_value,
      repair_type: selected.repair_type,
      vehicle_make: selected.vehicle_make,
      vehicle_year: selected.vehicle_year,
      chassis_number: selected.chassis_number,
      compulsory_included: selected.compulsory_included,
      compulsory_policy_number: selected.compulsory_policy_number,
      compulsory_policy_issue_date: selected.compulsory_policy_issue_date,
      compulsory_start_date: selected.compulsory_start_date,
      compulsory_expiry_date: selected.compulsory_expiry_date,
      insurance_start_date: selected.insurance_start_date,
      insurance_expiry_date: selected.insurance_expiry_date,
      registration_date: selected.registration_date,
      registration_expiry_date: selected.registration_expiry_date,
      laos_expiry_date: selected.laos_expiry_date,
      insurance_premium: selected.insurance_premium,
      compulsory_insurance_premium: selected.compulsory_insurance_premium,
      vehicle_tax: selected.vehicle_tax,
      additional_premium: selected.additional_premium,
      notes: selected.notes,
      archived_by: userData.user?.id ?? null,
      insurance_document_path: currentInsuranceDoc?.file_path ?? null,
      insurance_document_name: currentInsuranceDoc?.file_name ?? null,
      compulsory_document_path: currentCompulsoryDoc?.file_path ?? null,
      compulsory_document_name: currentCompulsoryDoc?.file_name ?? null
    };

    const archiveResult = await supabase
      .from("vehicle_insurance_history")
      .insert(archive)
      .select("*")
      .single();

    if (archiveResult.error) {
      setActionError(`${c.renewalFailed}: ${archiveResult.error.message}`);
      setRenewalBusy(false);
      return;
    }

    // Remove only the live document rows. The files stay in Storage because
    // the history row now points to them. This prevents old scans being lost.
    const documentIds = [currentInsuranceDoc?.id, currentCompulsoryDoc?.id].filter(Boolean);
    if (documentIds.length) {
      const docsResult = await supabase
        .from("vehicle_insurance_documents")
        .delete()
        .in("id", documentIds as string[]);
      if (docsResult.error) {
        setActionError(`${c.renewalFailed}: ${docsResult.error.message}`);
        setRenewalBusy(false);
        return;
      }
    }

    const clearPolicy = {
      insurer_th: null,
      insurer_en: null,
      policy_number: null,
      insurance_class: null,
      policy_issue_date: null,
      insured_value: null,
      repair_type: null,
      compulsory_included: null,
      compulsory_policy_number: null,
      compulsory_policy_issue_date: null,
      compulsory_start_date: null,
      compulsory_expiry_date: null,
      insurance_start_date: null,
      insurance_expiry_date: null,
      insurance_premium: null,
      compulsory_insurance_premium: null,
      additional_premium: null,
      verification_status: "needs_review",
      verified_at: null
    };

    const updateResult = await supabase
      .from("vehicle_insurance_compliance")
      .update(clearPolicy)
      .eq("id", selected.id);

    if (updateResult.error) {
      setActionError(`${c.renewalFailed}: ${updateResult.error.message}`);
      setRenewalBusy(false);
      return;
    }

    setHistory((old) => [archiveResult.data as InsuranceHistoryRecord, ...old]);
    setInsuranceDocs((old) => { const copy = { ...old }; delete copy[selected.id]; return copy; });
    setCompulsoryDocs((old) => { const copy = { ...old }; delete copy[selected.id]; return copy; });
    setDocumentUrl(null);
    setCompulsoryDocumentUrl(null);
    await load();

    const refreshedDraft: Draft = {
      ...toDraft(selected),
      insurer_th: "", insurer_en: "", policy_number: "", insurance_class: "",
      policy_issue_date: "", insured_value: "", repair_type: "",
      compulsory_included: "", compulsory_policy_number: "",
      compulsory_policy_issue_date: "", compulsory_start_date: "", compulsory_expiry_date: "",
      insurance_start_date: "", insurance_expiry_date: "", insurance_premium: "",
      compulsory_insurance_premium: "", additional_premium: ""
    };
    setDraft(refreshedDraft);
    setEditMode(true);
    setRenewalBusy(false);
  };

  const saveDraft = async () => {
    if (!selected || !draft) return;

    setSaving(true);
    setActionError(null);

    const patch = {
      insurance_requirement: draft.insurance_requirement,
      insurance_requirement_reason: nullableText(draft.insurance_requirement_reason),
      insurer_th: nullableText(draft.insurer_th),
      insurer_en: nullableText(draft.insurer_en),
      policy_number: nullableText(draft.policy_number),
      insurance_class: nullableText(draft.insurance_class),
      policy_issue_date: nullableText(draft.policy_issue_date),
      insured_value: nullableNumber(draft.insured_value),
      repair_type: nullableText(draft.repair_type),
      vehicle_make: nullableText(draft.vehicle_make),
      vehicle_year: nullableNumber(draft.vehicle_year),
      chassis_number: nullableText(draft.chassis_number),
      compulsory_included:
        draft.compulsory_included === "yes"
          ? true
          : draft.compulsory_included === "no"
            ? false
            : null,
      compulsory_policy_number: nullableText(draft.compulsory_policy_number),
      compulsory_policy_issue_date: nullableText(draft.compulsory_policy_issue_date),
      compulsory_start_date: nullableText(draft.compulsory_start_date),
      compulsory_expiry_date: nullableText(draft.compulsory_expiry_date),
      insurance_start_date: nullableText(draft.insurance_start_date),
      insurance_expiry_date: nullableText(draft.insurance_expiry_date),
      registration_date: nullableText(draft.registration_date),
      registration_expiry_date: nullableText(draft.registration_expiry_date),
      laos_expiry_date: nullableText(draft.laos_expiry_date),
      insurance_premium: nullableNumber(draft.insurance_premium),
      compulsory_insurance_premium: nullableNumber(
        draft.compulsory_insurance_premium
      ),
      vehicle_tax: nullableNumber(draft.vehicle_tax),
      additional_premium: nullableNumber(draft.additional_premium),
      notes: nullableText(draft.notes)
    };

    const { error } = await supabase
      .from("vehicle_insurance_compliance")
      .update(patch)
      .eq("id", selected.id);

    if (error) {
      setActionError(`${c.saveError}: ${error.message}`);
      setSaving(false);
      return;
    }

    setEditMode(false);
    await load();
    setSaving(false);
  };

  const createVehicle = async () => {
    const registration = newVehicle.vehicle_registration.trim();
    if (!registration) {
      setAddVehicleError(c.registrationRequired);
      return;
    }

    setAddingVehicle(true);
    setAddVehicleError(null);

    const existing = await supabase
      .from("vehicle_insurance_compliance")
      .select("id, vehicle_registration")
      .eq("vehicle_registration", registration)
      .eq("record_status", "current")
      .maybeSingle();

    if (existing.error) {
      setAddVehicleError(`${c.addVehicleFailed}: ${existing.error.message}`);
      setAddingVehicle(false);
      return;
    }

    if (existing.data) {
      setAddVehicleError(c.vehicleAlreadyExists);
      setAddingVehicle(false);
      return;
    }

    const payload = {
      vehicle_registration: registration,
      vehicle_make: nullableText(newVehicle.vehicle_make),
      vehicle_year: nullableNumber(newVehicle.vehicle_year),
      chassis_number: nullableText(newVehicle.chassis_number),
      ownership_holder: nullableText(newVehicle.ownership_holder),
      record_status: "current",
      verification_status: "needs_review",
      source: "manual",
      notes: null
    };

    const result = await supabase
      .from("vehicle_insurance_compliance")
      .insert(payload)
      .select("*")
      .single();

    if (result.error) {
      setAddVehicleError(`${c.addVehicleFailed}: ${result.error.message}`);
      setAddingVehicle(false);
      return;
    }

    const created = result.data as InsuranceRecord;

    setAddVehicleOpen(false);
    setNewVehicle(EMPTY_NEW_VEHICLE);
    await load();

    // Open the newly-created vehicle straight away in the full editor
    // so insurance, costs, compulsory details and documents can be added.
    setSelectedId(created.id);
    setDraft(toDraft(created));
    setEditMode(true);
    setActionError(null);
    setAddingVehicle(false);
  };

  const uploadDocument = async (
    recordId: string,
    file: File,
    documentType: "insurance" | "compulsory"
  ) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setActionError(c.documentHelp);
      return;
    }

    setDocumentBusy(true);
    setActionError(null);

    const current =
      documentType === "insurance"
        ? insuranceDocs[recordId]
        : compulsoryDocs[recordId];

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `${recordId}/${documentType}/${Date.now()}-${safeName}`;

    const upload = await supabase.storage
      .from("insurance-documents")
      .upload(path, file, { upsert: false, contentType: file.type });

    if (upload.error) {
      setActionError(`${c.documentUploadError}: ${upload.error.message}`);
      setDocumentBusy(false);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    const values = {
      insurance_record_id: recordId,
      document_type: documentType,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size,
      uploaded_by: userData.user?.id ?? null,
      updated_at: new Date().toISOString()
    };

    const result = current
      ? await supabase
          .from("vehicle_insurance_documents")
          .update(values)
          .eq("id", current.id)
          .select("*")
          .single()
      : await supabase
          .from("vehicle_insurance_documents")
          .insert(values)
          .select("*")
          .single();

    if (result.error) {
      await supabase.storage.from("insurance-documents").remove([path]);
      setActionError(`${c.documentUploadError}: ${result.error.message}`);
      setDocumentBusy(false);
      return;
    }

    if (current?.file_path && current.file_path !== path) {
      await supabase.storage.from("insurance-documents").remove([current.file_path]);
    }

    const doc = result.data as InsuranceDocument;

    setDocuments((old) => [
      ...old.filter((item) => item.id !== doc.id),
      doc
    ]);

    if (documentType === "insurance") {
      setInsuranceDocs((old) => ({ ...old, [recordId]: doc }));
    } else {
      setCompulsoryDocs((old) => ({ ...old, [recordId]: doc }));
    }

    setDocumentBusy(false);
  };

  const deleteDocument = async (
    recordId: string,
    documentType: "insurance" | "compulsory"
  ) => {
    const current =
      documentType === "insurance"
        ? insuranceDocs[recordId]
        : compulsoryDocs[recordId];

    if (!current) return;

    setDocumentBusy(true);
    setActionError(null);

    const storageResult = await supabase.storage
      .from("insurance-documents")
      .remove([current.file_path]);

    if (storageResult.error) {
      setActionError(`${c.documentDeleteError}: ${storageResult.error.message}`);
      setDocumentBusy(false);
      return;
    }

    const rowResult = await supabase
      .from("vehicle_insurance_documents")
      .delete()
      .eq("id", current.id);

    if (rowResult.error) {
      setActionError(`${c.documentDeleteError}: ${rowResult.error.message}`);
      setDocumentBusy(false);
      return;
    }

    if (documentType === "insurance") {
      setInsuranceDocs((old) => {
        const copy = { ...old };
        delete copy[recordId];
        return copy;
      });
      setDocumentUrl(null);
    } else {
      setCompulsoryDocs((old) => {
        const copy = { ...old };
        delete copy[recordId];
        return copy;
      });
      setCompulsoryDocumentUrl(null);
    }

    setDocuments((old) => old.filter((item) => item.id !== current.id));

    setDocumentBusy(false);
  };

  const deleteVehicleRecord = async () => {
    if (!selected || deleting) return;

    const confirmed = window.confirm(
      `${c.deleteVehicleConfirm}\n\n${selected.vehicle_registration}`
    );
    if (!confirmed) return;

    setDeleting(true);
    setActionError(null);

    const recordDocuments = documents.filter(
      (item) => item.insurance_record_id === selected.id
    );
    const storagePaths = recordDocuments
      .map((item) => item.file_path)
      .filter((path): path is string => Boolean(path));

    if (storagePaths.length > 0) {
      const storageResult = await supabase.storage
        .from("insurance-documents")
        .remove(storagePaths);

      if (storageResult.error) {
        setActionError(
          `${c.deleteVehicleFailed}: ${storageResult.error.message}`
        );
        setDeleting(false);
        return;
      }
    }

    const documentsResult = await supabase
      .from("vehicle_insurance_documents")
      .delete()
      .eq("insurance_record_id", selected.id);

    if (documentsResult.error) {
      setActionError(
        `${c.deleteVehicleFailed}: ${documentsResult.error.message}`
      );
      setDeleting(false);
      return;
    }

    const recordResult = await supabase
      .from("vehicle_insurance_compliance")
      .delete()
      .eq("id", selected.id);

    if (recordResult.error) {
      setActionError(`${c.deleteVehicleFailed}: ${recordResult.error.message}`);
      setDeleting(false);
      return;
    }

    closeDrawer();
    await load();
    setDeleting(false);
  };

  const setVerification = async (
    record: InsuranceRecord,
    verification: VerificationStatus
  ) => {
    if (verification === "verified" && !isInsuranceNotRequired(record) && !insuranceDocs[record.id]) {
      setActionError(c.uploadBeforeVerify);
      return false;
    }

    if (
      verification === "verified" &&
      !isInsuranceNotRequired(record) &&
      record.compulsory_policy_number &&
      !compulsoryDocs[record.id]
    ) {
      setActionError(c.compulsoryUploadRequired);
      return false;
    }

    setSaving(true);
    setActionError(null);

    const patch =
      verification === "verified"
        ? {
            verification_status: "verified",
            verified_at: new Date().toISOString()
          }
        : {
            verification_status: "needs_review",
            verified_at: null
          };

    const { error } = await supabase
      .from("vehicle_insurance_compliance")
      .update(patch)
      .eq("id", record.id);

    if (error) {
      setActionError(`${c.saveError}: ${error.message}`);
      setSaving(false);
      return false;
    }

    updateLocal(record.id, patch as Partial<InsuranceRecord>);
    setSaving(false);
    return true;
  };

  const verifyAndNext = async () => {
    if (!selected) return;

    const index = reviewQueue.findIndex((r) => r.id === selected.id);
    const nextRecord = index >= 0 ? reviewQueue[index + 1] ?? null : null;

    const ok = await setVerification(selected, "verified");
    if (!ok) return;

    if (nextRecord) {
      window.setTimeout(() => openRecord(nextRecord), 0);
    } else {
      closeDrawer();
    }
  };

  const progress =
    stats.total === 0 ? 0 : Math.round((stats.verified / stats.total) * 100);

  return (
    <div className="maintenance-shell -m-3 min-h-full space-y-4 bg-[#f7f7fa] p-3 sm:-m-4 sm:p-4 lg:-m-5 lg:p-5">
      <Header title={c.title} description={c.description} />

      <InsuranceIntelligenceWorkspace
        records={records}
        documents={documents}
        historyRecords={allHistory}
        language={language}
        onOpenRecord={openRecord}
        onReviewRecord={openRecordForReview}
      />

      <details className="group rounded-2xl border border-slate-200/80 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 sm:px-5">
          <span>{isThai ? "พื้นที่ตรวจสอบข้อมูลต้นทางและเพิ่มรถ" : "Source review workspace and vehicle administration"}</span>
          <ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" />
        </summary>
        <div className="space-y-4 border-t border-slate-200 bg-[#f7f7fa] p-3 sm:p-4">
      {stats.remaining === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm font-semibold text-emerald-800">
          <FileCheck2 className="h-4 w-4" />
          <span>{isThai ? `สถานะข้อมูล: ตรวจสอบแล้ว ${stats.verified} / ${stats.total} รายการ ✓` : `Data status: ${stats.verified} / ${stats.total} records reviewed ✓`}</span>
        </div>
      ) : (
      <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(31,27,61,0.06)]">
        <div className="grid gap-0 xl:grid-cols-[1.2fr_.8fr]">
          <div className="p-5 sm:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-violet-600">
              {c.reviewQueue}
            </p>

            <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-3xl font-bold tracking-tight text-slate-950">
                  {stats.remaining}
                </p>
                <p className="mt-1 text-sm text-slate-500">{c.remaining}</p>
              </div>

              <button
                type="button"
                onClick={startReview}
                disabled={!reviewQueue.length}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#31245c] px-4 text-sm font-bold text-white shadow-[0_8px_20px_rgba(49,36,92,0.18)] transition hover:bg-[#271c4b] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileCheck2 className="h-4 w-4" />
                {c.reviewNext}
              </button>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-500">
                  {stats.verified} / {stats.total} {c.verified}
                </span>
                <span className="text-[#31245c]">{progress}% {c.complete}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#6654c6] transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200/80 bg-[#fbfaf8] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-slate-500">
              {c.attention}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <QuietStat
                label={c.expired}
                value={stats.expired}
                tone="danger"
                onClick={() => setView("renewals")}
              />
              <QuietStat
                label={c.due30}
                value={stats.due30}
                tone="warning"
                onClick={() => setView("renewals")}
              />
              <QuietStat
                label={c.missing}
                value={stats.missing}
                tone="neutral"
                onClick={() => setView("renewals")}
              />
            </div>
          </div>
        </div>
      </section>
      )}

      <section className="rounded-[24px] border border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(31,27,61,0.05)]">
        <div className="border-b border-slate-200/80 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
              {(
                [
                  ["review", c.reviewQueue, stats.remaining],
                  ["renewals", c.renewals, stats.expired + stats.due30],
                  ["all", c.allVehicles, stats.total],
                  ["verified", c.verified, stats.verified]
                ] as Array<[ViewMode, string, number]>
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={
                    view === key
                      ? "rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-950 shadow-sm"
                      : "rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition hover:text-slate-900"
                  }
                >
                  {label}
                  <span
                    className={
                      view === key
                        ? "ml-2 rounded-full bg-[#eeecfb] px-2 py-0.5 text-[11px] text-[#5140aa]"
                        : "ml-2 text-xs text-slate-400"
                    }
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex w-full gap-2 xl:w-auto">
              <div className="relative min-w-0 flex-1 xl:w-[360px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="form-input w-full border-slate-200 bg-white pl-9 shadow-none"
                  type="search"
                  placeholder={c.search}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setNewVehicle(EMPTY_NEW_VEHICLE);
                  setAddVehicleError(null);
                  setAddVehicleOpen(true);
                }}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#31245c] px-3.5 text-sm font-bold text-white shadow-[0_6px_16px_rgba(49,36,92,0.16)] transition hover:bg-[#271c4b]"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{c.addVehicle}</span>
              </button>

              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                onClick={() => void load()}
                disabled={busy}
                title={c.refresh}
              >
                <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
              {c.loadError}: {error}
            </p>
          )}
        </div>

        <div className="hidden bg-[#f5f5f8] p-3 lg:block">
          <div className="grid grid-cols-[150px_minmax(260px,1.35fr)_190px_190px_150px_44px] gap-4 px-4 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">
            <div>{c.vehicle}</div>
            <div>{c.cover}</div>
            <div>{c.insuranceExpiry}</div>
            <div>{c.registrationExpiry}</div>
            <div>{c.review}</div>
            <div />
          </div>

          <div className="space-y-2">
            {pageRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => openRecord(record)}
                className={`group relative grid w-full grid-cols-[150px_minmax(260px,1.35fr)_190px_190px_150px_44px] items-center gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-[0_3px_12px_rgba(15,23,42,0.035)] transition hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)] ${
                  record.insurance_status === "expired"
                    ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-rose-400"
                    : record.insurance_status === "due_30" ||
                        record.insurance_status === "due_60" ||
                        record.insurance_status === "due_90"
                      ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-amber-400"
                      : record.insurance_status === "missing"
                        ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-slate-300"
                        : "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-emerald-400"
                }`}
              >
                <div className="pl-1">
                  <span className="inline-flex rounded-lg border border-slate-200 bg-[#fafafa] px-2.5 py-1 text-[15px] font-bold tracking-[.01em] text-slate-950">
                    {record.vehicle_registration}
                  </span>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {record.ownership_holder || "—"}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {isInsuranceNotRequired(record)
                      ? c.insuranceNotRequired
                      : canonicalInsurerName(record.insurer_en, record.insurer_th, language) || c.missing}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {record.policy_number || c.missing}
                  </p>
                </div>

                <ExpiryCell
                  date={record.insurance_expiry_date}
                  language={language}
                  days={record.days_to_insurance_expiry}
                  status={record.insurance_status}
                />

                <SimpleExpiryCell
                  date={record.registration_expiry_date}
                  language={language}
                />

                <div>
                  <ReviewBadge
                    status={record.verification_status}
                    language={language}
                    notRequired={isInsuranceNotRequired(record)}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold">
                    <span className={`flex items-center gap-1 ${insuranceDocs[record.id] ? "text-emerald-600" : "text-slate-400"}`}>
                      <FileText className="h-3.5 w-3.5" />
                      {insuranceDocs[record.id] ? (isThai ? "ประกัน ✓" : "Insurance ✓") : (isThai ? "ประกัน —" : "Insurance —")}
                    </span>
                    <span className={`flex items-center gap-1 ${compulsoryDocs[record.id] ? "text-emerald-600" : "text-slate-400"}`}>
                      <FileText className="h-3.5 w-3.5" />
                      {compulsoryDocs[record.id] ? (isThai ? "พ.ร.บ. ✓" : "Compulsory ✓") : (isThai ? "พ.ร.บ. —" : "Compulsory —")}
                    </span>
                  </div>
                </div>

                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-300 transition group-hover:bg-[#f1effb] group-hover:text-[#5b49b8]">
                  <ChevronRight className="h-4 w-4" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 p-3 lg:hidden">
          {pageRecords.map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => openRecord(record)}
              className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 pl-5 text-left shadow-sm ${
                record.insurance_status === "expired"
                  ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-rose-400"
                  : record.insurance_status === "due_30" ||
                      record.insurance_status === "due_60" ||
                      record.insurance_status === "due_90"
                    ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-amber-400"
                    : record.insurance_status === "missing"
                      ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-slate-300"
                      : "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-emerald-400"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-slate-950">
                    {record.vehicle_registration}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {isInsuranceNotRequired(record)
                      ? c.insuranceNotRequired
                      : canonicalInsurerName(record.insurer_en, record.insurer_th, language) || c.missing}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {record.policy_number || c.missing}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 text-slate-300" />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {c.insuranceExpiry}
                  </p>
                  <div className="mt-1">
                    <ExpiryCell
                      date={record.insurance_expiry_date}
                      language={language}
                      days={record.days_to_insurance_expiry}
                      status={record.insurance_status}
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {c.review}
                  </p>
                  <div className="mt-1">
                    <ReviewBadge
                      status={record.verification_status}
                      language={language}
                      notRequired={isInsuranceNotRequired(record)}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs font-semibold">
                <span className={`flex items-center gap-1.5 ${insuranceDocs[record.id] ? "text-emerald-600" : "text-slate-400"}`}>
                  <FileText className="h-4 w-4" />
                  {insuranceDocs[record.id] ? (isThai ? "ประกัน ✓" : "Insurance ✓") : (isThai ? "ประกัน —" : "Insurance —")}
                </span>
                <span className={`flex items-center gap-1.5 ${compulsoryDocs[record.id] ? "text-emerald-600" : "text-slate-400"}`}>
                  <FileText className="h-4 w-4" />
                  {compulsoryDocs[record.id] ? (isThai ? "พ.ร.บ. ✓" : "Compulsory ✓") : (isThai ? "พ.ร.บ. —" : "Compulsory —")}
                </span>
              </div>
            </button>
          ))}
        </div>

        {!busy && pageRecords.length === 0 && (
          <div className="p-12 text-center text-sm text-slate-500">
            {c.noRecords}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200/80 bg-[#fafafa] px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-slate-600 transition hover:bg-white disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            {c.previous}
          </button>

          <p className="text-xs font-semibold text-slate-400">
            {c.page} {safePage} {c.of} {totalPages}
          </p>

          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-slate-600 transition hover:bg-white disabled:opacity-30"
          >
            {c.next}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>
        </div>
      </details>

      {addVehicleOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              if (addingVehicle) return;
              setAddVehicleOpen(false);
              setAddVehicleError(null);
            }}
            className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
          />

          <section className="relative z-10 w-full max-w-xl overflow-hidden rounded-[26px] border border-slate-200 bg-[#f8f8fa] shadow-[0_28px_90px_rgba(35,25,66,0.24)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
                  {c.addVehicle}
                </p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">
                  {c.addVehicleTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{c.addVehicleHelp}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (addingVehicle) return;
                  setAddVehicleOpen(false);
                  setAddVehicleError(null);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              {addVehicleError && (
                <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
                  {addVehicleError}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <EditField label={`${c.registration} *`}>
                  <input
                    autoFocus
                    className="form-input w-full"
                    value={newVehicle.vehicle_registration}
                    onChange={(e) =>
                      setNewVehicle((current) => ({
                        ...current,
                        vehicle_registration: e.target.value
                      }))
                    }
                    placeholder="e.g. 701-5145"
                  />
                </EditField>

                <EditField label={c.make}>
                  <input
                    className="form-input w-full"
                    value={newVehicle.vehicle_make}
                    onChange={(e) =>
                      setNewVehicle((current) => ({
                        ...current,
                        vehicle_make: e.target.value
                      }))
                    }
                    placeholder="e.g. ISUZU"
                  />
                </EditField>

                <EditField label={c.year}>
                  <input
                    className="form-input w-full"
                    inputMode="numeric"
                    value={newVehicle.vehicle_year}
                    onChange={(e) =>
                      setNewVehicle((current) => ({
                        ...current,
                        vehicle_year: e.target.value
                      }))
                    }
                    placeholder="e.g. 2021"
                  />
                </EditField>

                <EditField label={c.chassis}>
                  <input
                    className="form-input w-full"
                    value={newVehicle.chassis_number}
                    onChange={(e) =>
                      setNewVehicle((current) => ({
                        ...current,
                        chassis_number: e.target.value
                      }))
                    }
                    placeholder="e.g. MP1FTR34THT002477"
                  />
                </EditField>
              </div>

              <EditField label={c.ownership}>
                <input
                  className="form-input w-full"
                  value={newVehicle.ownership_holder}
                  onChange={(e) =>
                    setNewVehicle((current) => ({
                      ...current,
                      ownership_holder: e.target.value
                    }))
                  }
                  placeholder={isThai ? "ถ้ามี" : "Optional"}
                />
              </EditField>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
              <button
                type="button"
                disabled={addingVehicle}
                onClick={() => {
                  setAddVehicleOpen(false);
                  setAddVehicleError(null);
                }}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {c.cancel}
              </button>
              <button
                type="button"
                disabled={addingVehicle || !newVehicle.vehicle_registration.trim()}
                onClick={() => void createVehicle()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#31245c] px-4 text-sm font-bold text-white shadow-[0_6px_16px_rgba(49,36,92,0.16)] transition hover:bg-[#271c4b] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {addingVehicle ? (isThai ? "กำลังเพิ่ม..." : "Adding...") : c.createVehicle}
              </button>
            </div>
          </section>
        </div>
      )}

      {selected && draft && (
        <div className="fixed inset-0 z-[80]">
          <button
            type="button"
            aria-label="Close"
            onClick={closeDrawer}
            className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
          />

          <aside
            className={
              editMode
                ? "absolute inset-0 flex w-full flex-col bg-[#f6f6f8] shadow-2xl"
                : "absolute left-1/2 top-1/2 flex max-h-[92vh] w-[min(94vw,980px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-[#f8f8fa] shadow-[0_28px_90px_rgba(35,25,66,0.24)]"
            }
          >
            <div className="border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">
                    {editMode
                      ? isThai
                        ? "แก้ไขข้อมูลเต็ม"
                        : "FULL RECORD EDITOR"
                      : c.details}
                  </p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-950">
                    {selected.vehicle_registration}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedQueueIndex >= 0
                      ? `${selectedQueueIndex + 1} / ${reviewQueue.length} ${c.reviewQueue.toLowerCase()}`
                      : c.verified}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeDrawer}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {actionError && (
                <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
                  {actionError}
                </p>
              )}

              {!historyBusy && history.length > 0 && (
                <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <History className="h-4 w-4 text-violet-700" />
                        <p className="text-sm font-bold text-violet-950">
                          {isThai ? "ประวัติประกันภัย" : "Insurance History"}
                        </p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">
                          {history.length} {isThai ? "กรมธรรม์เก่า" : history.length === 1 ? "previous policy" : "previous policies"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-600">
                        {history[0]?.policy_number || (isThai ? "กรมธรรม์ก่อนหน้า" : "Previous policy")}
                        {history[0]?.insurance_expiry_date
                          ? ` · ${isThai ? "หมดอายุ" : "Expired"} ${dateSafe(history[0].insurance_expiry_date, language)}`
                          : ""}
                        {history[0]?.insurance_premium != null
                          ? ` · ${moneySafe(history[0].insurance_premium, language)}`
                          : ""}
                      </p>
                    </div>
                    {history[0]?.insurance_document_path && (
                      <button
                        type="button"
                        onClick={() => void openArchivedDocument(history[0].insurance_document_path)}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-3 text-xs font-bold text-violet-800 shadow-sm transition hover:bg-violet-100"
                      >
                        <FileText className="h-4 w-4" />
                        {isThai ? "เปิดกรมธรรม์เก่า" : "Open previous policy"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div
              className={
                editMode
                  ? "flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6"
                  : "flex-1 overflow-y-auto bg-[#f8f8fa] p-5 sm:p-6"
              }
            >
              {!editMode ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                  <InsuranceProfileInsights
                    record={selected}
                    records={records}
                    documents={documents}
                    language={language}
                  />
                  <DetailCard title={c.cover}>
                    <DetailRow
                      label={c.insurer}
                      value={canonicalInsurerName(selected.insurer_en, selected.insurer_th, language)}
                    />
                    <DetailRow label={c.policy} value={selected.policy_number} />
                    <DetailRow
                      label={c.insuranceClass}
                      value={selected.insurance_class}
                    />
                    <DetailRow
                      label={c.policyIssueDate}
                      value={dateSafe(selected.policy_issue_date, language)}
                    />
                    <DetailRow
                      label={c.insuranceStart}
                      value={dateSafe(selected.insurance_start_date, language)}
                    />
                    <DetailRow
                      label={c.insuranceExpiry}
                      value={dateSafe(selected.insurance_expiry_date, language)}
                      strong
                    />
                    <DetailRow
                      label={c.insuredValue}
                      value={moneySafe(selected.insured_value, language)}
                    />
                    <DetailRow label={c.repairType} value={selected.repair_type} />
                    <DetailRow
                      label={c.compulsoryIncluded}
                      value={
                        selected.compulsory_included === true
                          ? c.yes
                          : selected.compulsory_included === false
                            ? c.no
                            : c.unknown
                      }
                    />
                  </DetailCard>

                  <DetailCard
                    title={isThai ? "ข้อมูลรถจากกรมธรรม์" : "Vehicle on policy"}
                  >
                    <DetailRow label={c.vehicleMake} value={selected.vehicle_make} />
                    <DetailRow
                      label={c.vehicleYear}
                      value={
                        selected.vehicle_year === null
                          ? "—"
                          : String(selected.vehicle_year)
                      }
                    />
                    <DetailRow
                      label={c.chassisNumber}
                      value={selected.chassis_number}
                      strong
                    />
                  </DetailCard>

                  <DetailCard title={c.compulsory}>
                    <DetailRow
                      label={c.compulsoryIncluded}
                      value={
                        selected.compulsory_included === true
                          ? c.yes
                          : selected.compulsory_included === false
                            ? c.no
                            : c.unknown
                      }
                    />
                    <DetailRow label={c.compulsoryPolicy} value={selected.compulsory_policy_number} />
                    <DetailRow
                      label={c.compulsoryIssueDate}
                      value={dateSafe(selected.compulsory_policy_issue_date, language)}
                    />
                    <DetailRow
                      label={c.compulsoryStart}
                      value={dateSafe(selected.compulsory_start_date, language)}
                    />
                    <DetailRow
                      label={c.compulsoryExpiry}
                      value={dateSafe(selected.compulsory_expiry_date, language)}
                    />
                    <DetailRow
                      label={c.compulsory}
                      value={moneySafe(selected.compulsory_insurance_premium, language)}
                      strong
                    />
                  </DetailCard>

                  <DetailCard
                    title={isThai ? "ทะเบียนและเอกสาร" : "Registration & documents"}
                  >
                    <DetailRow
                      label={c.registrationDate}
                      value={dateSafe(selected.registration_date, language)}
                    />
                    <DetailRow
                      label={c.registrationExpiry}
                      value={dateSafe(selected.registration_expiry_date, language)}
                    />
                    <DetailRow
                      label={c.laosExpiry}
                      value={dateSafe(selected.laos_expiry_date, language)}
                    />
                    <DetailRow label={c.owner} value={selected.ownership_holder} />
                  </DetailCard>

                  <DetailCard title={isThai ? "ค่าใช้จ่าย" : "Costs"}>
                    <DetailRow
                      label={c.premium}
                      value={moneySafe(selected.insurance_premium, language)}
                    />
                    <DetailRow
                      label={c.compulsory}
                      value={moneySafe(
                        selected.compulsory_insurance_premium,
                        language
                      )}
                    />
                    <DetailRow
                      label={c.tax}
                      value={moneySafe(selected.vehicle_tax, language)}
                    />
                    <DetailRow
                      label={c.additional}
                      value={moneySafe(selected.additional_premium, language)}
                    />
                    <DetailRow
                      label={c.totalCost}
                      value={moneySafe(selected.total_recorded_cost, language)}
                      strong
                    />
                  </DetailCard>

                  <DetailCard title={c.history}>
                    {historyBusy ? (
                      <p className="text-sm text-slate-500">{isThai ? "กำลังโหลด..." : "Loading history..."}</p>
                    ) : history.length === 0 ? (
                      <p className="text-sm text-slate-500">{c.noHistory}</p>
                    ) : (
                      <div className="space-y-3">
                        {history.map((item) => (
                          <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-slate-900">{item.policy_number || c.previousPolicy}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {dateSafe(item.insurance_start_date, language)} → {dateSafe(item.insurance_expiry_date, language)}
                                </p>
                              </div>
                              <span className="text-xs font-bold text-slate-700">{moneySafe(item.insurance_premium, language)}</span>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              {canonicalInsurerName(item.insurer_en, item.insurer_th, language) || "—"}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.insurance_document_path && (
                                <button type="button" onClick={() => void openArchivedDocument(item.insurance_document_path)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                  <FileText className="h-3.5 w-3.5" /> {isThai ? "เปิดประกันหลัก" : "Main document"}
                                </button>
                              )}
                              {item.compulsory_document_path && (
                                <button type="button" onClick={() => void openArchivedDocument(item.compulsory_document_path)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                  <FileText className="h-3.5 w-3.5" /> {isThai ? "เปิด พ.ร.บ." : "Compulsory document"}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </DetailCard>

                  {(selected.import_review_notes ||
                    selected.original_insurance_expiry ||
                    selected.source) && (
                    <DetailCard title={c.source}>
                      <DetailRow label={c.source} value={selected.source} />
                      <DetailRow
                        label={isThai ? "แถวเดิม" : "Original Excel row"}
                        value={
                          selected.source_row === null
                            ? "-"
                            : String(selected.source_row)
                        }
                      />
                      <DetailRow
                        label={
                          isThai
                            ? "วันหมดอายุจากไฟล์เดิม"
                            : "Original Excel expiry"
                        }
                        value={selected.original_insurance_expiry}
                      />
                      {selected.import_review_notes && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                            {c.importNotes}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">
                            {selected.import_review_notes}
                          </p>
                        </div>
                      )}
                    </DetailCard>
                  )}

                  {selected.notes && (
                    <DetailCard title={c.notes}>
                      <p className="text-sm leading-6 text-slate-700">
                        {selected.notes}
                      </p>
                    </DetailCard>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">
                          {c.review}
                        </p>
                        <div className="mt-2">
                          <ReviewBadge
                            status={selected.verification_status}
                            language={language}
                            notRequired={isInsuranceNotRequired(selected)}
                          />
                        </div>
                      </div>
                      {selected.verified_at && (
                        <p className="text-right text-xs text-slate-400">
                          {c.verifiedOn}
                          <br />
                          {new Date(selected.verified_at).toLocaleString(
                            isThai ? "th-TH" : "en-GB"
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                  <div className="space-y-3">
                    <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_4px_16px_rgba(15,23,42,0.035)]">
                      <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">
                        {isThai ? "เอกสารอ้างอิง" : "SOURCE DOCUMENTS"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {isThai
                          ? "ดูเอกสารที่อัปโหลดแล้ว"
                          : "Uploaded source documents"}
                      </p>
                    </div>

                    <DocumentPanel
                      title={c.mainInsuranceDocument}
                      help={c.documentHelp}
                      document={insuranceDocs[selected.id]}
                      documentUrl={documentUrl}
                      busy={documentBusy}
                      uploadLabel={insuranceDocs[selected.id] ? c.replaceDocument : c.uploadDocument}
                      viewLabel={c.viewDocument}
                      deleteLabel={c.deleteDocument}
                      emptyLabel={c.noDocument}
                      onUpload={(file) => void uploadDocument(selected.id, file, "insurance")}
                      onDelete={() => void deleteDocument(selected.id, "insurance")}
                    />

                    <DocumentPanel
                      title={c.compulsoryDocument}
                      help={c.documentHelp}
                      document={compulsoryDocs[selected.id]}
                      documentUrl={compulsoryDocumentUrl}
                      busy={documentBusy}
                      uploadLabel={compulsoryDocs[selected.id] ? c.replaceDocument : c.uploadDocument}
                      viewLabel={c.viewDocument}
                      deleteLabel={c.deleteDocument}
                      emptyLabel={
                        isThai
                          ? "ยังไม่มีเอกสาร พ.ร.บ."
                          : "No compulsory document yet"
                      }
                      onUpload={(file) => void uploadDocument(selected.id, file, "compulsory")}
                      onDelete={() => void deleteDocument(selected.id, "compulsory")}
                    />
                  </div>
                </div>
              ) : (
                <div className="mx-auto grid w-full max-w-[1500px] gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,.85fr)]">
                  <div className="space-y-3">
                  <EditCard title={c.insuranceRequirement}>
                    <EditField label={c.insuranceRequirement}>
                      <select
                        className="form-input"
                        value={draft.insurance_requirement}
                        onChange={(event) => setDraft({ ...draft, insurance_requirement: event.target.value as Draft["insurance_requirement"] })}
                      >
                        <option value="required">{c.insuranceRequired}</option>
                        <option value="not_required">{c.insuranceNotRequired}</option>
                        <option value="unknown">{c.unknown}</option>
                      </select>
                    </EditField>
                    <EditField label={c.requirementReason}>
                      <input
                        className="form-input"
                        value={draft.insurance_requirement_reason}
                        placeholder={draft.insurance_requirement === "not_required" ? c.trailer : ""}
                        onChange={(event) => setDraft({ ...draft, insurance_requirement_reason: event.target.value })}
                      />
                    </EditField>
                    {draft.insurance_requirement === "not_required" && <p className="text-xs leading-5 text-slate-500">{isThai ? "ระบบจะไม่เรียกกรมธรรม์หรือเอกสารประกัน แต่จะเก็บข้อมูลและเอกสารเดิมไว้" : "Policy and insurance-document requirements will be suppressed; existing data and documents remain stored."}</p>}
                  </EditCard>
                  <EditCard title={c.cover}>
                    <EditField label={`${c.insurer} (TH)`}>
                      <input
                        className="form-input"
                        list="insurance-provider-options-th"
                        value={draft.insurer_th}
                        onChange={(e) =>
                          setDraft({ ...draft, insurer_th: e.target.value })
                        }
                      />
                    </EditField>
                    <EditField label={`${c.insurer} (EN)`}>
                      <input
                        className="form-input"
                        list="insurance-provider-options-en"
                        value={draft.insurer_en}
                        onChange={(e) =>
                          setDraft({ ...draft, insurer_en: e.target.value })
                        }
                      />
                    </EditField>
                    <datalist id="insurance-provider-options-th">{canonicalInsurerOptions("th").map((name) => <option key={name} value={name} />)}</datalist>
                    <datalist id="insurance-provider-options-en">{canonicalInsurerOptions("en").map((name) => <option key={name} value={name} />)}</datalist>
                    <p className="text-xs leading-5 text-slate-500">{isThai ? "ชื่อที่รู้จักจะแสดงและรวมผลภายใต้ชื่อมาตรฐาน โดยยังเก็บข้อความที่กรอกไว้เป็นข้อมูลต้นฉบับ" : "Known aliases display and aggregate under the canonical provider while the entered source wording remains unchanged."}</p>
                    <EditField label={c.policy}>
                      <input
                        className="form-input"
                        value={draft.policy_number}
                        onChange={(e) =>
                          setDraft({ ...draft, policy_number: e.target.value })
                        }
                      />
                    </EditField>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.insuranceClass}>
                        <input
                          className="form-input"
                          placeholder={isThai ? "เช่น ประเภท 1" : "e.g. Class 1"}
                          value={draft.insurance_class}
                          onChange={(e) =>
                            setDraft({ ...draft, insurance_class: e.target.value })
                          }
                        />
                      </EditField>
                      <EditField label={c.policyIssueDate}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.policy_issue_date}
                          onChange={(e) =>
                            setDraft({ ...draft, policy_issue_date: e.target.value })
                          }
                        />
                      </EditField>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.insuranceStart}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.insurance_start_date}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              insurance_start_date: e.target.value
                            })
                          }
                        />
                      </EditField>
                      <EditField label={c.insuranceExpiry}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.insurance_expiry_date}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              insurance_expiry_date: e.target.value
                            })
                          }
                        />
                      </EditField>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.insuredValue}>
                        <input
                          className="form-input"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={draft.insured_value}
                          onChange={(e) =>
                            setDraft({ ...draft, insured_value: e.target.value })
                          }
                        />
                      </EditField>
                      <EditField label={c.repairType}>
                        <input
                          className="form-input"
                          placeholder={isThai ? "เช่น ซ่อมห้าง" : "e.g. Dealer repair"}
                          value={draft.repair_type}
                          onChange={(e) =>
                            setDraft({ ...draft, repair_type: e.target.value })
                          }
                        />
                      </EditField>
                    </div>

                  </EditCard>

                  <EditCard title={isThai ? "ข้อมูลรถจากกรมธรรม์" : "Vehicle on policy"}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.vehicleMake}>
                        <input
                          className="form-input"
                          value={draft.vehicle_make}
                          onChange={(e) =>
                            setDraft({ ...draft, vehicle_make: e.target.value })
                          }
                        />
                      </EditField>
                      <EditField label={c.vehicleYear}>
                        <input
                          className="form-input"
                          inputMode="numeric"
                          placeholder="e.g. 2013"
                          value={draft.vehicle_year}
                          onChange={(e) =>
                            setDraft({ ...draft, vehicle_year: e.target.value })
                          }
                        />
                      </EditField>
                    </div>
                    <EditField label={c.chassisNumber}>
                      <input
                        className="form-input"
                        value={draft.chassis_number}
                        onChange={(e) =>
                          setDraft({ ...draft, chassis_number: e.target.value })
                        }
                      />
                    </EditField>
                  </EditCard>

                  <EditCard title={c.compulsory}>
                    <EditField label={c.compulsoryIncluded}>
                      <select
                        className="form-input"
                        value={draft.compulsory_included}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            compulsory_included: e.target.value as "" | "yes" | "no"
                          })
                        }
                      >
                        <option value="">{c.unknown}</option>
                        <option value="yes">{c.yes}</option>
                        <option value="no">{c.no}</option>
                      </select>
                    </EditField>

                    <EditField label={c.compulsoryPolicy}>
                      <input
                        className="form-input"
                        value={draft.compulsory_policy_number}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            compulsory_policy_number: e.target.value
                          })
                        }
                      />
                    </EditField>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.compulsoryIssueDate}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.compulsory_policy_issue_date}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              compulsory_policy_issue_date: e.target.value
                            })
                          }
                        />
                      </EditField>

                      <EditField label={c.compulsoryStart}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.compulsory_start_date}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              compulsory_start_date: e.target.value
                            })
                          }
                        />
                      </EditField>
                    </div>

                    <EditField label={c.compulsoryExpiry}>
                      <input
                        type="date"
                        className="form-input"
                        value={draft.compulsory_expiry_date}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            compulsory_expiry_date: e.target.value
                          })
                        }
                      />
                    </EditField>
                  </EditCard>

                  <EditCard
                    title={isThai ? "ทะเบียนและเอกสาร" : "Registration & documents"}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.registrationDate}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.registration_date}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              registration_date: e.target.value
                            })
                          }
                        />
                      </EditField>
                      <EditField label={c.registrationExpiry}>
                        <input
                          type="date"
                          className="form-input"
                          value={draft.registration_expiry_date}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              registration_expiry_date: e.target.value
                            })
                          }
                        />
                      </EditField>
                    </div>
                    <EditField label={c.laosExpiry}>
                      <input
                        type="date"
                        className="form-input"
                        value={draft.laos_expiry_date}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            laos_expiry_date: e.target.value
                          })
                        }
                      />
                    </EditField>
                  </EditCard>

                  <EditCard title={isThai ? "ค่าใช้จ่าย" : "Costs"}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditField label={c.premium}>
                        <input
                          className="form-input"
                          inputMode="decimal"
                          value={draft.insurance_premium}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              insurance_premium: e.target.value
                            })
                          }
                        />
                      </EditField>
                      <EditField label={c.compulsory}>
                        <input
                          className="form-input"
                          inputMode="decimal"
                          value={draft.compulsory_insurance_premium}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              compulsory_insurance_premium: e.target.value
                            })
                          }
                        />
                      </EditField>
                      <EditField label={c.tax}>
                        <input
                          className="form-input"
                          inputMode="decimal"
                          value={draft.vehicle_tax}
                          onChange={(e) =>
                            setDraft({ ...draft, vehicle_tax: e.target.value })
                          }
                        />
                      </EditField>
                      <EditField label={c.additional}>
                        <input
                          className="form-input"
                          inputMode="decimal"
                          value={draft.additional_premium}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              additional_premium: e.target.value
                            })
                          }
                        />
                      </EditField>
                    </div>
                  </EditCard>

                  <EditCard title={c.notes}>
                    <textarea
                      rows={4}
                      className="form-input min-h-28"
                      value={draft.notes}
                      onChange={(e) =>
                        setDraft({ ...draft, notes: e.target.value })
                      }
                    />
                  </EditCard>
                  </div>

                  <div className="xl:sticky xl:top-0 xl:self-start">
                    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                      <div className="mb-4">
                        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">
                          {isThai ? "เอกสารอ้างอิง" : "SOURCE DOCUMENTS"}
                        </p>
                        <h3 className="mt-1 text-lg font-bold text-slate-950">
                          {selected.vehicle_registration}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {isThai
                            ? "ตรวจเอกสารด้านขวาและกรอกข้อมูลด้านซ้าย"
                            : "Read the scan here while completing the fields on the left."}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <DocumentPanel
                          title={c.mainInsuranceDocument}
                          help={c.documentHelp}
                          document={insuranceDocs[selected.id]}
                          documentUrl={documentUrl}
                          busy={documentBusy}
                          uploadLabel={
                            insuranceDocs[selected.id]
                              ? c.replaceDocument
                              : c.uploadDocument
                          }
                          viewLabel={c.viewDocument}
                          deleteLabel={c.deleteDocument}
                          emptyLabel={c.noDocument}
                          onUpload={(file) =>
                            void uploadDocument(selected.id, file, "insurance")
                          }
                          onDelete={() =>
                            void deleteDocument(selected.id, "insurance")
                          }
                        />

                        <DocumentPanel
                          title={c.compulsoryDocument}
                          help={c.documentHelp}
                          document={compulsoryDocs[selected.id]}
                          documentUrl={compulsoryDocumentUrl}
                          busy={documentBusy}
                          uploadLabel={
                            compulsoryDocs[selected.id]
                              ? c.replaceDocument
                              : c.uploadDocument
                          }
                          viewLabel={c.viewDocument}
                          deleteLabel={c.deleteDocument}
                          emptyLabel={
                            isThai
                              ? "ยังไม่มีเอกสาร พ.ร.บ."
                              : "No compulsory document yet"
                          }
                          onUpload={(file) =>
                            void uploadDocument(selected.id, file, "compulsory")
                          }
                          onDelete={() =>
                            void deleteDocument(selected.id, "compulsory")
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 bg-white p-4 sm:p-5">
              <div className={editMode ? "mx-auto w-full max-w-[1500px]" : ""}>
              {editMode ? (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDraft(toDraft(selected));
                      setEditMode(false);
                    }}
                    className="btn-secondary min-h-10"
                  >
                    {c.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveDraft()}
                    className="btn-primary min-h-10"
                  >
                    {c.save}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-bold text-violet-800 transition hover:bg-violet-100 disabled:opacity-50"
                      onClick={() => void startRenewal()}
                      disabled={renewalBusy || deleting || !selected.policy_number || isInsuranceNotRequired(selected)}
                    >
                      <History className="h-4 w-4" />
                      {renewalBusy ? (isThai ? "กำลังเก็บ..." : "Archiving...") : c.startRenewal}
                    </button>

                    <button
                      type="button"
                      className="btn-secondary min-h-10"
                      onClick={() => setEditMode(true)}
                      disabled={deleting}
                    >
                      <Pencil className="h-4 w-4" />
                      {c.edit}
                    </button>

                    <button
                      type="button"
                      disabled={saving || deleting}
                      onClick={() => void deleteVehicleRecord()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deleting ? c.deletingVehicle : c.deleteVehicle}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selected.verification_status === "verified" ? (
                      <button
                        type="button"
                        className="btn-secondary min-h-10"
                        disabled={saving}
                        onClick={() =>
                          void setVerification(selected, "needs_review")
                        }
                      >
                        {c.reopen}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-secondary min-h-10"
                          disabled={saving}
                          onClick={() =>
                            void setVerification(selected, "verified")
                          }
                        >
                          <Check className="h-4 w-4" />
                          {c.verify}
                        </button>
                        <button
                          type="button"
                          className="btn-primary min-h-10"
                          disabled={saving}
                          onClick={() => void verifyAndNext()}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {c.verifyNext}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function QuietStat({
  label,
  value,
  tone,
  onClick
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "neutral";
  onClick?: () => void;
}) {
  const styles = {
    danger: "text-rose-700",
    warning: "text-amber-700",
    neutral: "text-slate-700"
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-slate-300 hover:shadow-sm"
    >
      <p className={`text-2xl font-bold ${styles[tone]}`}>{value}</p>
      <p className="mt-1 text-[11px] font-semibold leading-tight text-slate-500">
        {label}
      </p>
    </button>
  );
}

function ExpiryCell({
  date,
  language,
  days,
  status
}: {
  date: string | null;
  language: "en" | "th";
  days: number | null;
  status: InsuranceStatus;
}) {
  if (!date) {
    return (
      <div>
        <p className="text-sm font-semibold text-slate-500">—</p>
        <p className="mt-1 text-xs text-slate-400">
          {language === "th" ? "ไม่มีข้อมูล" : "Missing date"}
        </p>
      </div>
    );
  }

  let helper = "";
  let helperClass = "text-slate-400";

  if (status === "expired") {
    helper =
      language === "th"
        ? "หมดอายุแล้ว"
        : "Expired";
    helperClass = "text-rose-600";
  } else if (typeof days === "number") {
    helper = `${days} ${language === "th" ? "วัน" : "days"}`;
    if (days <= 30) helperClass = "text-amber-700";
  }

  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">
        {formatDate(date, language)}
      </p>
      {helper && (
        <p className={`mt-1 text-xs font-semibold ${helperClass}`}>{helper}</p>
      )}
    </div>
  );
}

function SimpleExpiryCell({
  date,
  language
}: {
  date: string | null;
  language: "en" | "th";
}) {
  if (!date) {
    return (
      <div>
        <p className="text-sm text-slate-400">—</p>
        <p className="mt-1 text-xs text-slate-400">
          {language === "th" ? "ตรวจสอบ" : "Needs checking"}
        </p>
      </div>
    );
  }

  const state = dateState(date);
  const danger = state === "expired";

  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">
        {formatDate(date, language)}
      </p>
      <p
        className={`mt-1 text-xs font-semibold ${
          danger ? "text-rose-600" : "text-slate-400"
        }`}
      >
        {danger
          ? language === "th"
            ? "หมดอายุแล้ว"
            : "Expired"
          : language === "th"
            ? "บันทึกแล้ว"
            : "Recorded"}
      </p>
    </div>
  );
}

function ReviewBadge({
  status,
  language,
  notRequired = false
}: {
  status: VerificationStatus;
  language: "en" | "th";
  notRequired?: boolean;
}) {
  const verified = status === "verified";

  return (
    <span
      className={
        notRequired
          ? "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"
          : verified
          ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
          : "inline-flex items-center gap-1.5 rounded-full bg-[#f1effb] px-2.5 py-1 text-xs font-bold text-[#5b49b8]"
      }
    >
      <span
        className={
          notRequired
            ? "h-1.5 w-1.5 rounded-full bg-slate-400"
            : verified
            ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
            : "h-1.5 w-1.5 rounded-full bg-[#7b68d9]"
        }
      />
      {notRequired
        ? language === "th" ? "ไม่ต้องมีประกัน" : "Not required"
        : verified
        ? language === "th"
          ? "ตรวจสอบแล้ว"
          : "Verified"
        : language === "th"
          ? "รอตรวจ"
          : "To review"}
    </span>
  );
}

function DocumentPanel({
  title,
  help,
  document,
  documentUrl,
  busy,
  uploadLabel,
  viewLabel,
  deleteLabel,
  emptyLabel,
  onUpload,
  onDelete
}: {
  title: string;
  help: string;
  document?: InsuranceDocument;
  documentUrl: string | null;
  busy: boolean;
  uploadLabel: string;
  viewLabel: string;
  deleteLabel: string;
  emptyLabel: string;
  onUpload: (file: File) => void;
  onDelete: () => void;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_4px_16px_rgba(15,23,42,0.035)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">{help}</p>
          {document && (
            <p className="mt-1 text-[11px] font-semibold text-emerald-600">
              Paper preview
            </p>
          )}
        </div>

        <label
          className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 ${
            busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <Upload className="h-4 w-4" />
          {uploadLabel}
          <input
            type="file"
            className="hidden"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      {document ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f7fa] p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#5b49b8] shadow-sm">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {document.file_name}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {document.file_size
                    ? `${Math.max(1, Math.round(document.file_size / 1024))} KB`
                    : "Document uploaded"}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              {documentUrl && (
                <a
                  href={documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  title={viewLabel}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                title={deleteLabel}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {documentUrl && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              <div className="flex justify-center bg-[#ececf0] p-4">
                <iframe
                  title={title}
                  src={`${documentUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                  className="h-[620px] w-full max-w-[470px] rounded-sm bg-white shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-[#fafafa] p-4 text-center text-xs font-semibold text-slate-400">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function DetailCard({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      <div className="mt-3 divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  strong
}: {
  label: string;
  value: string | null | undefined;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-5 py-2.5 first:pt-0 last:pb-0">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`max-w-[60%] break-words text-right text-sm ${
          strong ? "font-bold text-slate-950" : "font-medium text-slate-800"
        }`}
      >
        {value || "Not recorded / ไม่ได้บันทึก"}
      </p>
    </div>
  );
}

function EditCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function dateSafe(date: string | null, language: "en" | "th") {
  return date
    ? formatDate(date, language)
    : language === "th"
      ? "ไม่ได้บันทึก"
      : "Not recorded";
}

function moneySafe(value: number | null, language: "en" | "th") {
  return value === null
    ? language === "th"
      ? "ไม่ได้บันทึก"
      : "Not recorded"
    : formatCurrency(value, language);
}
