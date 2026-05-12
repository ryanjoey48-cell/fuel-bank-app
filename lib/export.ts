"use client";

import * as XLSX from "xlsx";

export function exportToXlsx(
  rows: Record<string, string | number | null | undefined>[],
  fileName: string,
  sheetName = "Sheet1"
) {
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
