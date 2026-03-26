"use client";

import * as XLSX from "xlsx";

export function exportToXlsx(
  rows: Record<string, string | number | null | undefined>[],
  fileName: string,
  sheetName = "Sheet1"
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFileXLSX(workbook, `${fileName}.xlsx`);
}
