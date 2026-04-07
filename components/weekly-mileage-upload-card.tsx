"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Filter,
  FileImage,
  LoaderCircle,
  Trash2,
  Upload
} from "lucide-react";
import Image from "next/image";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { saveWeeklyMileage } from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import type { Language } from "@/lib/translations";
import {
  canSaveMileageRow,
  parseExtractedData,
  revalidateMileageRows,
  type DuplicateResolution,
  type ExtractedMileageRow,
  type MileagePreviewRow
} from "@/lib/weekly-mileage-upload";
import { formatNumber } from "@/lib/utils";
import type { Driver, WeeklyMileageEntry } from "@/types/database";

const OCR_URL = "https://hafoaurzfgkkwpvzedvd.supabase.co/functions/v1/weekly-mileage-ocr";

type UploadPreview = {
  id: string;
  name: string;
  url: string;
};

type SaveSummary = {
  total: number;
  saved: number;
  skipped: number;
  errors: number;
};

type RowFilter = "all" | "errors" | "valid";

type ProcessedImagePayload = {
  file_name: string;
  mime_type: string;
  image_data_url: string;
  source_index: number;
};

type WeeklyMileageUploadCardProps = {
  drivers: Driver[];
  entries: WeeklyMileageEntry[];
  language: Language;
  onSaved: () => Promise<void>;
};

function getStatusClasses(status: MileagePreviewRow["status"]) {
  if (status === "error") return "border-rose-200 bg-rose-50/70";
  if (status === "warning") return "border-amber-200 bg-amber-50/70";
  if (status === "ignored") return "border-slate-200 bg-slate-50/80";
  return "border-emerald-200 bg-emerald-50/70";
}

function getStatusLabel(status: MileagePreviewRow["status"]) {
  if (status === "error") return "Error";
  if (status === "warning") return "Warning";
  if (status === "ignored") return "Ignored";
  return "Valid";
}

function getRowHighlightClasses(status: MileagePreviewRow["status"]) {
  if (status === "error") return "bg-rose-50/70";
  if (status === "warning") return "bg-amber-50/70";
  if (status === "ignored") return "bg-slate-50/80";
  return "bg-white";
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function buildProcessingErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Unable to process uploaded sheets.";
}
async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function loadBitmap(file: File) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }

  const image = document.createElement("img");
  image.decoding = "async";
  image.src = await fileToDataUrl(file);
  await image.decode();

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    close() {},
    image
  };
}

function sampleLuminance(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function findContentBounds(imageData: ImageData) {
  const { width, height, data } = imageData;
  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  const threshold = 245;

  const rowHasInk = (y: number) => {
    for (let x = 0; x < width; x += 4) {
      const index = (y * width + x) * 4;
      if (sampleLuminance(data, index) < threshold) return true;
    }
    return false;
  };

  const colHasInk = (x: number) => {
    for (let y = 0; y < height; y += 4) {
      const index = (y * width + x) * 4;
      if (sampleLuminance(data, index) < threshold) return true;
    }
    return false;
  };

  while (top < bottom && !rowHasInk(top)) top += 1;
  while (bottom > top && !rowHasInk(bottom)) bottom -= 1;
  while (left < right && !colHasInk(left)) left += 1;
  while (right > left && !colHasInk(right)) right -= 1;

  const padding = 24;
  return {
    left: Math.max(0, left - padding),
    top: Math.max(0, top - padding),
    width: Math.min(width - Math.max(0, left - padding), right - left + 1 + padding * 2),
    height: Math.min(height - Math.max(0, top - padding), bottom - top + 1 + padding * 2)
  };
}

function enhanceImageData(imageData: ImageData) {
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = sampleLuminance(data, index);
    const boosted = luminance > 168 ? 255 : Math.max(0, luminance * 0.7);
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }
  return imageData;
}

async function preprocessImage(file: File, sourceIndex: number): Promise<ProcessedImagePayload> {
  const bitmap = await loadBitmap(file);
  const source =
    "image" in bitmap ? bitmap.image : bitmap;
  const width = "image" in bitmap ? bitmap.image.naturalWidth : bitmap.width;
  const height = "image" in bitmap ? bitmap.image.naturalHeight : bitmap.height;

  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = width;
  baseCanvas.height = height;

  const baseContext = baseCanvas.getContext("2d", { willReadFrequently: true });
  if (!baseContext) {
    throw new Error("Unable to prepare uploaded image.");
  }

  baseContext.drawImage(source, 0, 0, width, height);
  const enhanced = enhanceImageData(baseContext.getImageData(0, 0, width, height));
  const bounds = findContentBounds(enhanced);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = bounds.width;
  outputCanvas.height = bounds.height;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) {
    throw new Error("Unable to preprocess uploaded image.");
  }

  outputContext.drawImage(
    baseCanvas,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  const refined = outputContext.getImageData(0, 0, bounds.width, bounds.height);
  outputContext.putImageData(enhanceImageData(refined), 0, 0);

  bitmap.close?.();

  return {
    file_name: file.name,
    mime_type: "image/png",
    image_data_url: outputCanvas.toDataURL("image/png", 0.92),
    source_index: sourceIndex
  };
}

export function WeeklyMileageUploadCard({
  drivers,
  entries,
  language,
  onSaved
}: WeeklyMileageUploadCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);
  const [previews, setPreviews] = useState<UploadPreview[]>([]);
  const [rows, setRows] = useState<MileagePreviewRow[]>([]);
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const deferredRows = useDeferredValue(rows);

  useEffect(() => {
    return () => {
      for (const preview of previews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [previews]);

  const stats = useMemo(
    () =>
      rows.reduce(
        (accumulator, row) => {
          accumulator[row.status] += 1;
          return accumulator;
        },
        { valid: 0, warning: 0, error: 0, ignored: 0 } as Record<MileagePreviewRow["status"], number>
      ),
    [rows]
  );

  const visibleRows = useMemo(() => {
    if (rowFilter === "errors") {
      return deferredRows.filter((row) => row.status === "error" || row.status === "warning");
    }
    if (rowFilter === "valid") {
      return deferredRows.filter((row) => row.status === "valid");
    }
    return deferredRows;
  }, [deferredRows, rowFilter]);

  const updateRows = (updater: (current: MileagePreviewRow[]) => MileagePreviewRow[]) => {
    setRows((current) => revalidateMileageRows(updater(current), drivers, entries));
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) =>
      ["image/jpeg", "image/jpg", "image/png"].includes(file.type)
    );

    if (!files.length) {
      setError("Upload JPG, JPEG, or PNG images only.");
      return;
    }

    setProcessing(true);
    setError(null);
    setSaveSummary(null);

    try {
      const nextPreviews = files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        url: URL.createObjectURL(file)
      }));

      setPreviews((current) => {
        for (const preview of current) {
          URL.revokeObjectURL(preview.url);
        }
        return nextPreviews;
      });

      const images: ProcessedImagePayload[] = [];
      for (const [index, file] of files.entries()) {
        images.push(await preprocessImage(file, index));
        await nextFrame();
      }

      const payload = { images };
      console.log("Calling OCR:", OCR_URL);
      console.log("Payload size:", JSON.stringify(payload).length);

      const response = await fetch(OCR_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        },
        body: JSON.stringify(payload)
      });

      console.log("Response status:", response.status);

      const rawText = await response.text();
      console.log("OCR RAW RESPONSE:", rawText);

      let data:
        | {
            rows?: ExtractedMileageRow[];
            error?: string | { message?: string };
          }
        | undefined;

      try {
        data = JSON.parse(rawText) as {
          rows?: ExtractedMileageRow[];
          error?: string | { message?: string };
        };
      } catch {
        setError(rawText || "Invalid OCR response");
        return;
      }

      if (!response.ok) {
        const apiError =
          typeof data?.error === "string" ? data.error : data?.error?.message;
        setError(apiError || rawText || "OCR failed");
        return;
      }

      if (data?.error) {
        const apiError =
          typeof data.error === "string" ? data.error : data.error.message;
        setError(apiError || rawText || "OCR failed");
        return;
      }

      const extractedRows = Array.isArray(data?.rows) ? data.rows : [];
      const nextRows = revalidateMileageRows(parseExtractedData(extractedRows), drivers, entries);
      startTransition(() => setRows(nextRows));
    } catch (error) {
      console.error("UPLOAD ERROR:", error);
      setRows([]);
      setError(buildProcessingErrorMessage(error));
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveSummary(null);

    try {
      const preferredUploadRowByKey = new Map<string, string>();
      for (const row of rows) {
        if (!row.duplicate_key) continue;
        if (!canSaveMileageRow(row)) continue;
        if (!preferredUploadRowByKey.has(row.duplicate_key)) {
          preferredUploadRowByKey.set(row.duplicate_key, row.id);
        }
        if (row.duplicate_with_upload && row.duplicate_resolution === "replace") {
          preferredUploadRowByKey.set(row.duplicate_key, row.id);
        }
      }

      let saved = 0;
      let skipped = 0;
      let errors = 0;

      for (const row of rows) {
        if (!canSaveMileageRow(row)) {
          skipped += 1;
          continue;
        }

        if (row.duplicate_key && preferredUploadRowByKey.get(row.duplicate_key) !== row.id) {
          skipped += 1;
          continue;
        }

        try {
          await saveWeeklyMileage({
            id:
              row.duplicate_with_existing && row.duplicate_resolution === "replace"
                ? row.duplicate_entry_id ?? undefined
                : undefined,
            week_ending: row.week_ending,
            driver_id: row.driver_id,
            vehicle_reg: row.vehicle_reg,
            odometer_reading: Number(row.odometer_reading)
          });
          saved += 1;
        } catch (caughtError) {
          console.error("Weekly mileage bulk save row error:", caughtError, row);
          errors += 1;
        }
      }

      setSaveSummary({ total: rows.length, saved, skipped, errors });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const exportPreview = () => {
    exportToCsv(
      rows.map((row) => ({
        "Week Ending": row.week_ending,
        Driver: row.driver_name,
        "Vehicle Reg": row.vehicle_reg,
        "Odometer Reading": row.odometer_reading,
        Status: getStatusLabel(row.status),
        Issues: row.issues.join(" | ")
      })),
      "weekly-mileage-preview"
    );
  };

  return (
    <section className="surface-card mb-4 p-5 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="section-title">Upload Weekly Mileage Sheets</h3>
          <p className="section-subtitle">
            Drag photos in, extract handwritten rows, review them, then save only the records you want.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn-secondary gap-2"
            disabled={processing}
          >
            <Upload className="h-4 w-4" />
            Choose images
          </button>
          <button
            type="button"
            onClick={exportPreview}
            className="btn-secondary gap-2"
            disabled={!rows.length}
          >
            <Download className="h-4 w-4" />
            Export to CSV
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        className="hidden"
        onChange={(event) => {
          const { files } = event.target;
          if (files?.length) {
            void processFiles(files);
          }
        }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (event.dataTransfer.files?.length) {
            void processFiles(event.dataTransfer.files);
          }
        }}
        className={`rounded-[1.75rem] border border-dashed p-6 transition ${isDragging ? "border-violet-400 bg-violet-50/70" : "border-slate-300 bg-slate-50/80"}`}
      >
        <div className="flex flex-col items-center justify-center text-center">
          <div className="mb-3 rounded-full bg-white p-3 shadow-sm">
            {processing ? (
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-600" />
            ) : (
              <FileImage className="h-6 w-6 text-violet-600" />
            )}
          </div>
          <p className="text-base font-semibold text-slate-900">
            {processing ? "Processing uploaded sheets..." : "Drop JPG, JPEG, or PNG mileage sheets here"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Multiple images are supported. Images are auto-rotated, cropped, and enhanced before OCR so the page stays responsive.
          </p>
        </div>
      </div>

      {previews.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {previews.map((preview) => (
            <div key={preview.id} className="subtle-panel overflow-hidden p-2">
              <Image
                src={preview.url}
                alt={preview.name}
                width={640}
                height={320}
                unoptimized
                className="h-40 w-full rounded-[1.25rem] object-cover"
              />
              <p className="px-2 pb-1 pt-3 text-sm font-medium text-slate-700">{preview.name}</p>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {saveSummary ? (
        <div className="mt-4 rounded-[1.4rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Total rows: {saveSummary.total} | Saved: {saveSummary.saved} | Skipped: {saveSummary.skipped} |
          Errors: {saveSummary.errors}
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="badge-muted">Valid {formatNumber(stats.valid, language)}</span>
            <span className="badge-muted">Warning {formatNumber(stats.warning, language)}</span>
            <span className="badge-muted">Error {formatNumber(stats.error, language)}</span>
            <span className="badge-muted">Ignored {formatNumber(stats.ignored, language)}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRowFilter("all")}
                className={`btn-secondary min-h-[44px] gap-2 px-4 py-2.5 ${rowFilter === "all" ? "border-violet-300 text-violet-700" : ""}`}
              >
                <Filter className="h-4 w-4" />
                All rows
              </button>
              <button
                type="button"
                onClick={() => setRowFilter("errors")}
                className={`btn-secondary min-h-[44px] px-4 py-2.5 ${rowFilter === "errors" ? "border-amber-300 text-amber-700" : ""}`}
              >
                Errors only
              </button>
              <button
                type="button"
                onClick={() => setRowFilter("valid")}
                className={`btn-secondary min-h-[44px] px-4 py-2.5 ${rowFilter === "valid" ? "border-emerald-300 text-emerald-700" : ""}`}
              >
                Valid only
              </button>
            </div>
          </div>
          <div className="mt-4 hidden md:block">
            <div className="table-shell rounded-2xl">
              <div className="table-scroll">
                <table className="w-full min-w-[1180px] text-sm">
                  <thead>
                    <tr className="bg-slate-50/70 text-slate-600">
                      <th className="table-head-cell text-left">Week Ending</th>
                      <th className="table-head-cell text-left">Driver</th>
                      <th className="table-head-cell text-left">Vehicle Reg</th>
                      <th className="table-head-cell text-left">Odometer Reading</th>
                      <th className="table-head-cell text-left">Status</th>
                      <th className="table-head-cell text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.id} className={`enterprise-table-row align-top ${getRowHighlightClasses(row.status)}`}>
                        <td className="table-body-cell">
                          <input
                            type="date"
                            value={row.week_ending}
                            onChange={(event) =>
                              updateRows((current) =>
                                current.map((item) =>
                                  item.id === row.id ? { ...item, week_ending: event.target.value } : item
                                )
                              )
                            }
                            className="form-input min-h-[48px] bg-white px-4 py-3"
                          />
                          <p className="mt-2 text-xs text-slate-400">{row.source_image_name}</p>
                        </td>
                        <td className="table-body-cell">
                          <select
                            value={row.driver_id}
                            onChange={(event) =>
                              updateRows((current) =>
                                current.map((item) =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        driver_id: event.target.value,
                                        driver_name:
                                          drivers.find((driver) => driver.id === event.target.value)?.name ?? "",
                                        matched_driver: Boolean(event.target.value)
                                      }
                                    : item
                                )
                              )
                            }
                            className="form-input min-h-[48px] bg-white px-4 py-3"
                          >
                            <option value="">Select driver</option>
                            {drivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.name}
                              </option>
                            ))}
                          </select>
                          {!row.driver_id && row.driver_name ? (
                            <p className="mt-2 text-xs text-slate-400">OCR: {row.driver_name}</p>
                          ) : null}
                        </td>
                        <td className="table-body-cell">
                          <input
                            value={row.vehicle_reg}
                            onChange={(event) =>
                              updateRows((current) =>
                                current.map((item) =>
                                  item.id === row.id
                                    ? { ...item, vehicle_reg: event.target.value.toUpperCase() }
                                    : item
                                )
                              )
                            }
                            className="form-input min-h-[48px] bg-white px-4 py-3"
                          />
                        </td>
                        <td className="table-body-cell">
                          <input
                            inputMode="numeric"
                            value={row.odometer_reading}
                            onChange={(event) =>
                              updateRows((current) =>
                                current.map((item) =>
                                  item.id === row.id
                                    ? { ...item, odometer_reading: event.target.value }
                                    : item
                                )
                              )
                            }
                            className="form-input min-h-[48px] bg-white px-4 py-3"
                          />
                        </td>
                        <td className="table-body-cell">
                          <div className={`rounded-[1.25rem] border px-3 py-3 ${getStatusClasses(row.status)}`}>
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              {row.status === "valid" ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                              )}
                              {getStatusLabel(row.status)}
                            </div>
                            {row.issues.length ? (
                              <p className="mt-2 text-xs leading-5 text-slate-600">{row.issues.join(" ")}</p>
                            ) : null}
                            {(row.duplicate_with_existing || row.duplicate_with_upload) && row.status !== "ignored" ? (
                              <select
                                value={row.duplicate_resolution}
                                onChange={(event) =>
                                  updateRows((current) =>
                                    current.map((item) =>
                                      item.id === row.id
                                        ? {
                                            ...item,
                                            duplicate_resolution: event.target.value as DuplicateResolution
                                          }
                                        : item
                                    )
                                  )
                                }
                                className="form-input mt-3 min-h-[44px] bg-white px-4 py-2.5"
                              >
                                <option value="skip">Skip duplicate</option>
                                <option value="replace">Replace existing</option>
                                <option value="keep-both">Keep both</option>
                              </select>
                            ) : null}
                          </div>
                        </td>
                        <td className="table-body-cell">
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateRows((current) =>
                                  current.map((item) =>
                                    item.id === row.id ? { ...item, ignored: !item.ignored } : item
                                  )
                                )
                              }
                              className="btn-secondary min-h-[48px]"
                            >
                              {row.ignored ? "Unignore" : "Ignore"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateRows((current) => current.filter((item) => item.id !== row.id))
                              }
                              className="btn-danger min-h-[48px] gap-2"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-3 md:hidden">
            {visibleRows.map((row) => (
              <div key={row.id} className={`subtle-panel p-4 ${getStatusClasses(row.status)}`}>
                <div className="grid gap-3">
                  <div>
                    <label className="form-label">Week Ending</label>
                    <input
                      type="date"
                      value={row.week_ending}
                      onChange={(event) =>
                        updateRows((current) =>
                          current.map((item) =>
                            item.id === row.id ? { ...item, week_ending: event.target.value } : item
                          )
                        )
                      }
                      className="form-input bg-white"
                    />
                  </div>
                  <div>
                    <label className="form-label">Driver</label>
                    <select
                      value={row.driver_id}
                      onChange={(event) =>
                        updateRows((current) =>
                          current.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  driver_id: event.target.value,
                                  driver_name: drivers.find((driver) => driver.id === event.target.value)?.name ?? "",
                                  matched_driver: Boolean(event.target.value)
                                }
                              : item
                          )
                        )
                      }
                      className="form-input bg-white"
                    >
                      <option value="">Select driver</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Vehicle Reg</label>
                    <input
                      value={row.vehicle_reg}
                      onChange={(event) =>
                        updateRows((current) =>
                          current.map((item) =>
                            item.id === row.id ? { ...item, vehicle_reg: event.target.value.toUpperCase() } : item
                          )
                        )
                      }
                      className="form-input bg-white"
                    />
                  </div>
                  <div>
                    <label className="form-label">Odometer Reading</label>
                    <input
                      inputMode="numeric"
                      value={row.odometer_reading}
                      onChange={(event) =>
                        updateRows((current) =>
                          current.map((item) =>
                            item.id === row.id ? { ...item, odometer_reading: event.target.value } : item
                          )
                        )
                      }
                      className="form-input bg-white"
                    />
                  </div>
                  {(row.duplicate_with_existing || row.duplicate_with_upload) && row.status !== "ignored" ? (
                    <div>
                      <label className="form-label">Duplicate handling</label>
                      <select
                        value={row.duplicate_resolution}
                        onChange={(event) =>
                          updateRows((current) =>
                            current.map((item) =>
                              item.id === row.id
                                ? {
                                    ...item,
                                    duplicate_resolution: event.target.value as DuplicateResolution
                                  }
                                : item
                            )
                          )
                        }
                        className="form-input bg-white"
                      >
                        <option value="skip">Skip duplicate</option>
                        <option value="replace">Replace existing</option>
                        <option value="keep-both">Keep both</option>
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Status: {getStatusLabel(row.status)}</p>
                    {row.issues.length ? (
                      <p className="mt-2 text-sm text-slate-600">{row.issues.join(" ")}</p>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateRows((current) =>
                          current.map((item) =>
                            item.id === row.id ? { ...item, ignored: !item.ignored } : item
                          )
                        )
                      }
                      className="btn-secondary"
                    >
                      {row.ignored ? "Unignore" : "Ignore"}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRows((current) => current.filter((item) => item.id !== row.id))}
                      className="btn-danger gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Showing {visibleRows.length} of {rows.length} extracted rows.
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="btn-primary w-full sm:w-auto disabled:opacity-70"
            >
              {saving ? "Saving..." : "Save Valid Rows"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
