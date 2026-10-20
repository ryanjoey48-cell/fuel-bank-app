export type HRLanguage = "en" | "th";
export type EmployeeStatus = "not_recorded" | "active" | "on_leave" | "left";
export type ProfileSection = "absences" | "incidents" | "overview" | "personnel" | "assignments" | "meetings" | "documents" | "followups" | "training";
export type EmployeeRef = { kind: "driver" | "employee"; id: string };
export type HRSetupDependency = {rpc:string;migration:string;reason:"missing_rpc"|"checks_failed"|"missing_dependency"};
export type HRAccess = { setupDependencies?:HRSetupDependency[]; peopleReady?:boolean; ready: boolean; releaseReady?:boolean; hr: boolean; operate: boolean; admin: boolean; storageReady: boolean; userId: string };
export type HRVehicle = { id: string; registration: string; type: string | null; model: string | null; name: string | null };
export type DirectoryEmployee = {
  id: string; kind: "driver" | "employee"; driverId: string | null; employeeId: string | null;
  name: string; employeeNumber: string | null; employmentStatus: EmployeeStatus;
  operationalActive: boolean | null; jobRole: string | null; department: string | null;
  vehicle: HRVehicle | null; regularVehicle: HRVehicle | null;
  documentStatus: string | null; nextFollowup: string | null;
  awayToday?:boolean|null; startDate?:string|null; personnelRecorded?:boolean; profileCompleteness?:{recorded:number;total:number}|null;
};
export type HRDirectory = {
  access: HRAccess; rows: DirectoryEmployee[]; total: number;
  roles?:string[]; vehicleTypes?:string[];
  summary: { awayToday?:number|null; actionsDue?:number|null; total: number; activeEmployees: number; activeDrivers: number; assignments: number; followupsDue: number | null; unrecordedEmployment: number };
};
export type HRProfile = { access: HRAccess; employee: DirectoryEmployee; section: ProfileSection; data: Record<string, unknown> };
export type HRMeetingV7 = {
  id: string; driver_id: string | null; employee_id: string | null;
  employee_name: string; meeting_date: string; category: string; subject: string;
  attendees: string; discussion: string; employee_response: string | null; agreed_actions: string | null;
  follow_up_date: string | null; acknowledgement: string; author_name: string | null;
  created_by: string; created_at: string;
  addenda: { id: string; kind: string; reason: string; content: string; acknowledgement: string | null; created_by: string; created_at: string }[];
};
export type HRFollowup = {
  id: string; employee_name: string; employee_id: string | null; driver_id: string | null;
  meeting_id: string | null; due_date: string; responsible_id: string | null; responsible_name: string | null;
  required_action: string; completed_at: string | null; outcome_notes: string | null;
  events: { id: string; action: string; outcome_notes: string | null; actor_id: string; recorded_at: string }[];
};
export type HRDocument = {
  id: string; employee_id: string; category: string; description: string | null;
  original_filename: string; mime_type: string; size_bytes: number;
  version_group: string; version: number; replaces_id: string | null;
  issue_date: string | null; expiry_date: string | null; retain_until: string;
  legal_hold: boolean; state: string; uploaded_by: string; uploaded_at: string;
};
export type HRDocumentPolicy = {
  id: string; category: string; processing_purpose: string; documented_lawful_basis: string;
  retention_days: number; policy_reference: string; active: boolean;
};
export class HRV7Error extends Error {
  constructor(public code: string, public status = 400, public dependencies?:HRSetupDependency[]) { super(code); this.name = "HRV7Error"; }
}
export function driverId(value: unknown) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new HRV7Error("HR_INVALID_ID");
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807")) throw new HRV7Error("HR_INVALID_ID");
  return id;
}
export function uuid(value: unknown) {
  const id = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HRV7Error("HR_INVALID_ID");
  return id;
}
export function bangkokToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dateKey(value: unknown, optional = false) {
  const date = String(value ?? "");
  if (!date && optional) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new HRV7Error("HR_INVALID_DATE");
  return date;
}
export function followupStatus(item: Pick<HRFollowup, "due_date" | "completed_at">, today = bangkokToday()) {
  return item.completed_at ? "completed" : item.due_date < today ? "overdue" : item.due_date === today ? "due_today" : "upcoming";
}
export function safeDirectoryExport(rows: DirectoryEmployee[]) {
  return rows.map(row => ({ name: row.name, employee_number: row.employeeNumber ?? "", employment_status: row.employmentStatus,
    vehicle_registration: row.vehicle?.registration ?? "", vehicle_type: row.vehicle?.type ?? "", job_role: row.jobRole ?? "" }));
}
export const HR_ACTIONS = ["save_employee", "save_compensation", "save_driver", "deactivate_driver", "change_vehicle", "end_cover", "record_meeting",
  "add_meeting_addendum", "save_followup", "complete_followup", "reopen_followup", "save_document_policy", "prepare_document", "finish_document",
  "fail_document", "retire_document", "hold_document", "prepare_purge", "finish_purge", "save_licence", "save_licence_rule", "save_training",
  "identify_test_meeting", "archive_test_meeting", "grant_manager", "link_driver"] as const;
export type HRAction = (typeof HR_ACTIONS)[number];
