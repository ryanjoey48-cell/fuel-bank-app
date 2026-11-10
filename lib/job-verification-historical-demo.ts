// Source facts were read from the named workbook, sheet and row. Workflow actions below are simulated.
// The workbook contains no customer/client column and no returned paperwork images; those facts are unavailable.
export const historicalWorkbook = {
  file: "EES System upload data.xlsx",
  sha256: "4eccbd2bcf136957acd607060d8adc0ad6ff4acd927f615b17505e2d046edfef"
} as const;

export const historicalDemoRecords = [
  {
    source: { sheet: "January", row: 2, cells: { A: "2026-01-02T00:00:00", B: "สุวรรณภูมิ", C: "RUNERGY", D: 820317, E: "700-4145", F: "ธนากร", G: 456, H: "TRN025/2026", I: 500, J: 35, O: 5000 } },
    simulation: { status: "verified", handover: "ready", en: "SIMULATED: returned job order matches this workbook row and required paperwork was checked.", th: "จำลอง: ใบสั่งงานที่ส่งคืนตรงกับแถวนี้ในสมุดงานและตรวจเอกสารที่จำเป็นแล้ว" }
  },
  {
    source: { sheet: "Feb", row: 4, cells: { A: "2026-02-01T00:00:00", B: "สุวรรณภูมิ", C: "RUNERGY", D: 822357, E: "63-3543", F: "Dโสภณ", G: 671, H: "TRN099/2026", I: 700, J: 280, O: 7500 } },
    simulation: { status: "missing_paperwork", handover: "blocked", en: "SIMULATED: signed green job order was not returned; no document absence is asserted by the workbook.", th: "จำลอง: ยังไม่ได้รับใบสั่งงานสีเขียวที่ลงนาม สมุดงานไม่ได้ยืนยันว่าเอกสารจริงสูญหาย" }
  },
  {
    source: { sheet: "April", row: 8, cells: { A: "2026-04-24T00:00:00", B: "เดลต้าเวลโกร์ว", C: "สุวรรณภูมิ", E: "73-5641", F: "Aกฤต30-4-2026", G: 439, H: "TRN224/2026", I: 2100, K: 35, O: 2724 } },
    simulation: { status: "discrepancy", handover: "blocked", en: "SIMULATED: a returned job order gives a different destination; management review is required.", th: "จำลอง: ใบสั่งงานที่ส่งคืนระบุจุดส่งต่างกัน จึงต้องให้ผู้บริหารตรวจ" }
  },
  {
    source: { sheet: "July", row: 3, cells: { A: "2026-07-18T00:00:00", B: "เดลต้าเวลโกร์ว", C: "สุวรรณภูมิ", E: "71-8047", F: "Aประสิทธ์", G: 4465.2, H: "TRN440/2026", I: 2100, K: 200, L: 400, O: 2724 } },
    simulation: { status: "verified", handover: "ready", en: "SIMULATED: management recorded a discrepancy decision, then office rechecked and verified the source details.", th: "จำลอง: ผู้บริหารบันทึกคำตัดสินเรื่องข้อมูลต่างกัน จากนั้นสำนักงานตรวจซ้ำและยืนยันรายละเอียดต้นฉบับ" }
  },
  {
    source: { sheet: "September", row: 2, cells: { A: "2026-09-04T00:00:00", B: "BENCHMARK", C: "ท่าเรือ", D: "S0046633", E: "4 ฒก 7996", F: "APJ", G: 5085.1, H: "TRN548/2026", I: 1400, O: 1990 } },
    simulation: { status: "verified", handover: "ready", en: "SIMULATED: verified job appears in the read-only Finance Centre overview.", th: "จำลอง: งานที่ตรวจแล้วแสดงในหน้าศูนย์การเงินแบบอ่านอย่างเดียว" }
  }
] as const;
