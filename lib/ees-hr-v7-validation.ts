import { HR_ACTIONS, HRV7Error, dateKey, driverId, uuid, type HRAction } from "@/lib/ees-hr-v7-types";

const common = ["id", "driverId", "employeeId"];
const fields: Record<HRAction, string[]> = {
  save_employee: ["preferredName","employeeNumber","jobRole","department","employmentStatus","startDate","endDate","statusReason","legalNameTh","englishName","telephone","address","emergencyContact","emergencyPhone","employmentNotes"],
  save_compensation: ["effectiveFrom","amount","period","reason"],
  save_driver: ["name","active","vehicleId","reason"], deactivate_driver:["reason"],
  change_vehicle:["vehicleId","date","kind","endDate","reason","notes"],end_cover:["date"],
  record_meeting:["date","category","subject","attendees","discussion","response","actions","followup","acknowledgement"],
  add_meeting_addendum:["meetingId","kind","reason","content","acknowledgement"],
  save_followup:["meetingId","dueDate","responsibleId","requiredAction"],complete_followup:["outcome"],reopen_followup:["outcome"],
  save_document_policy:["category","purpose","lawfulBasis","reference","retentionDays","approved"],
  prepare_document:["category","policyId","description","filename","mimeType","sizeBytes","replacesId","issueDate","expiryDate"],
  finish_document:[],fail_document:["reason"],retire_document:["reason"],hold_document:["reason","hold"],prepare_purge:["reason"],finish_purge:[],
  save_licence:["category","number","issueDate","expiryDate","frontId","backId","verificationStatus"],
  save_licence_rule:["category","vehicleType","compatible","source"],
  save_training:["course","completedOn","expiresOn","certificateId","notes"],
  identify_test_meeting:["reason"],archive_test_meeting:["reason"],grant_manager:["userId","active","allDrivers","driverIds"],link_driver:["linkDriverId"]
};
const dateFields = ["date","startDate","endDate","effectiveFrom","followup","dueDate","issueDate","expiryDate","completedOn","expiresOn"];
const uuidFields = ["id","employeeId","vehicleId","meetingId","responsibleId","policyId","replacesId","frontId","backId","certificateId","userId"];
export function validateHRAction(action: unknown, input: unknown) {
  if (!HR_ACTIONS.includes(action as HRAction) || !input || typeof input !== "object" || Array.isArray(input)) throw new HRV7Error("HR_INVALID_ACTION");
  const result = { ...input } as Record<string, unknown>;
  const allowed = new Set([...common,...fields[action as HRAction]]);
  for (const [key,value] of Object.entries(result)) {
    if (!allowed.has(key)) throw new HRV7Error("HR_INVALID_INPUT");
    if (typeof value === "string" && value.length > (["discussion","response","actions","content","employmentNotes"].includes(key) ? 20000 : ["address","notes","outcome","requiredAction"].includes(key) ? 4000 : 2000)) throw new HRV7Error("HR_INVALID_TEXT");
    if (dateFields.includes(key)) result[key] = dateKey(value,true);
    if (uuidFields.includes(key) && value) result[key] = uuid(value);
    if (["driverId","linkDriverId"].includes(key) && value) result[key] = driverId(value);
  }
  if (Array.isArray(result.driverIds)) result.driverIds=result.driverIds.map(driverId);
  if (typeof result.employeeNumber === "string" && /^\d{13}$/.test(result.employeeNumber.trim())) throw new HRV7Error("HR_EMPLOYEE_CODE_REQUIRED");
  if (action === "save_compensation" && !/^\d{1,10}(\.\d{1,2})?$/.test(String(result.amount ?? ""))) throw new HRV7Error("HR_AMOUNT_INVALID");
  if(action==="save_document_policy" && (result.approved!==true || !Number.isSafeInteger(Number(result.retentionDays)) || Number(result.retentionDays)<=0))throw new HRV7Error("HR_POLICY_REQUIRED");
  if (action === "save_licence_rule") {
    try {
      const source=new URL(String(result.source));
      if (source.protocol!=="https:" || !(source.hostname==="dlt.go.th" || source.hostname.endsWith(".dlt.go.th"))) throw new Error();
    } catch { throw new HRV7Error("HR_RULE_SOURCE_REQUIRED"); }
  }
  return { action: action as HRAction, input: result };
}

export const MAX_DOCUMENT_BYTES=10*1024*1024;
export function validateDocumentBytes(bytes: Uint8Array, filename: string, declaredType: string) {
  if (!bytes.length || bytes.length>MAX_DOCUMENT_BYTES) throw new HRV7Error("HR_FILE_TOO_LARGE",413);
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  let mime="";
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) mime="image/jpeg";
  else if ([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)) mime="image/png";
  else if (ascii(0,5)==="%PDF-") mime="application/pdf";
  else if (ascii(4,8)==="ftyp" && /heic|heix|hevc|hevx/.test(ascii(8,40))) mime="image/heic";
  if (!mime || (declaredType && ![mime,"application/octet-stream",...(mime==="image/heic"?["image/heif"]:[])].includes(declaredType))) throw new HRV7Error("HR_INVALID_FILE");
  const extension=filename.split(".").pop()?.toLowerCase();
  const permitted:Record<string,string[]>={"image/jpeg":["jpg","jpeg"],"image/png":["png"],"application/pdf":["pdf"],"image/heic":["heic","heif"]};
  if (!extension || !permitted[mime].includes(extension)) throw new HRV7Error("HR_INVALID_FILE");
  if (mime==="application/pdf") {
    // Never execute PDF actions. Reject obvious active content; preview uses
    // the canvas-only PDF.js API, without a scripting manager or raw embed.
    const content=new TextDecoder("latin1").decode(bytes);
    if (/\/(JavaScript|JS|Launch|OpenAction|EmbeddedFile|RichMedia|XFA)\b/i.test(content)) throw new HRV7Error("HR_PDF_ACTIVE_CONTENT");
  }
  return { mime, filename: filename.normalize("NFC").replace(/[\x00-\x1f\x7f/\\]/g,"_").slice(0,200) };
}

