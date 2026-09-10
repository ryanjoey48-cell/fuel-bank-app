"use client";

import * as XLSX from "xlsx";

type ExportCellValue = string | number | null | undefined;
type ExportRow = Record<string, ExportCellValue>;
type ExportSheet = {
  name: string;
  rows: ExportRow[];
};

function buildWorksheet(rows: ExportRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  worksheet["!cols"] = headers.map((header) => {
    const maxContentLength = Math.max(
      header.length,
      ...rows.map((row) => String(row[header] ?? "").length)
    );

    return { wch: Math.min(Math.max(maxContentLength + 2, 12), 36) };
  });

  if (headers.length > 0 && rows.length > 0) {
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: headers.length - 1, r: rows.length }
      })
    };
  }

  return worksheet;
}

export function exportToXlsx(
  rows: ExportRow[],
  fileName: string,
  sheetName = "Sheet1"
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildWorksheet(rows), sheetName);
  XLSX.writeFileXLSX(workbook, `${fileName}.xlsx`);
}

export function exportWorkbookToXlsx(sheets: ExportSheet[], fileName: string) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, buildWorksheet(sheet.rows), sheet.name.slice(0, 31));
  }
  XLSX.writeFileXLSX(workbook, `${fileName}.xlsx`);
}

export function exportToCsv(
  rows: ExportRow[],
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
