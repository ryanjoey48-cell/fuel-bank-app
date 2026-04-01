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

export function exportToCsv(
  rows: Record<string, string | number | null | undefined>[],
  fileName: string
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
