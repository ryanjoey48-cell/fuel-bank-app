import type {OilChangeStatus} from './operations';
export function oilStatusLabel(status:OilChangeStatus,language:'en'|'th') {
  const labels:Record<OilChangeStatus,[string,string]>={overdue:['Overdue','เกินกำหนด'],urgent:['Urgent','เร่งด่วน'],due_soon:['Due Soon','ใกล้ถึงกำหนด'],ok:['OK','ปกติ'],review_required:['Review Required','ต้องตรวจสอบ'],no_odometer:['No odometer data','ไม่มีข้อมูลเลขไมล์'],not_set:['Not Set','ยังไม่ตั้งค่า'],not_applicable:['Not applicable','ไม่ใช้กับรถคันนี้'],condition_based:['Condition based','ตามสภาพ']};
  return labels[status][language==='th'?1:0];
}
