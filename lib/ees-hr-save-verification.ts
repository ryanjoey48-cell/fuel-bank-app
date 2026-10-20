import { HRV7Error, type HRProfile } from "./ees-hr-v7-types";

const profileFields: Record<string,string>={preferredName:"preferred_name",employeeNumber:"employee_number",jobRole:"job_role",department:"department",employmentStatus:"employment_status",startDate:"start_date",endDate:"end_date"};
const privateFields: Record<string,string>={legalNameTh:"legal_name_th",englishName:"english_name",telephone:"telephone",address:"address",emergencyContact:"emergency_contact",emergencyPhone:"emergency_phone",employmentNotes:"employment_notes"};
const normalized=(value:unknown,trim=false)=>trim?String(value??"").trim():String(value??"");
/** Verify every submitted persisted field. Never include confidential values in errors. */
export function verifyPersonnelSave(input:Record<string,unknown>,model:HRProfile) {
  if(model.section!=="personnel" || !model.access.hr || !model.data.profile)throw new HRV7Error("HR_SAVE_UNVERIFIED",409);
  for(const [fields,record] of [[profileFields,model.data.profile],[privateFields,model.data.private]] as const){
    for(const [key,column] of Object.entries(fields)){
      if(Object.prototype.hasOwnProperty.call(input,key) && normalized(input[key],key==="preferredName")!==normalized((record as Record<string,unknown>|null)?.[column],key==="preferredName"))throw new HRV7Error("HR_SAVE_UNVERIFIED",409);
    }
  }
  if(input.driverId && String(input.driverId)!==model.employee.driverId)throw new HRV7Error("HR_SAVE_UNVERIFIED",409);
  if(input.employeeId && String(input.employeeId)!==model.employee.employeeId)throw new HRV7Error("HR_SAVE_UNVERIFIED",409);
  return model;
}
