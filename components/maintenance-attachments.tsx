"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileImage, FileText } from "lucide-react";

import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import {
  deleteMaintenanceAttachment,
  uploadMaintenanceAttachment,
  validateMaintenanceFile,
  viewMaintenanceAttachment,
} from "@/lib/maintenance-data";
import type { MaintenanceAttachment } from "@/lib/maintenance-types";

export function MaintenanceAttachmentList({
  attachments,
  onChange,
}: {
  attachments: MaintenanceAttachment[];
  onChange: () => void;
}) {
  const { t } = useLanguage();
  const c = t.maintenance;
  const { can } = useAccountAccess();

  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {c.saveError}
        </p>
      )}

      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-[#f5f3fc] p-3 text-sm shadow-sm"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold text-slate-800">
              {attachment.mime_type === "application/pdf" ? (
                <FileText className="h-6 w-6 shrink-0 text-violet-600" />
              ) : (
                <FileImage className="h-6 w-6 shrink-0 text-violet-600" />
              )}

              <span className="break-all">
                {attachment.original_filename}
              </span>
            </p>

            <p className="mt-1 break-all text-xs text-slate-500">
              {(attachment.size_bytes / 1024).toFixed(0)} KB ·{" "}
              {c.uploadedAt}:{" "}
              {new Date(attachment.uploaded_at).toLocaleString(undefined, {
                timeZone: "Asia/Bangkok",
              })}
            </p>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer py-1">{c.auditDetails}</summary>
              <p className="break-all">{c.uploadedBy}: {attachment.uploaded_by}</p>
            </details>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary min-h-10"
              disabled={busy !== null}
              onClick={async () => {
                const tab = window.open("about:blank", "_blank");

                if (tab) {
                  tab.opener = null;
                }

                setBusy(attachment.id);
                setError(false);

                try {
                  const url = await viewMaintenanceAttachment(attachment);

                  if (tab) {
                    tab.location.href = url;
                  } else {
                    window.location.assign(url);
                  }
                } catch {
                  if (tab) {
                    tab.close();
                  }

                  setError(true);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {c.viewReceipt}
            </button>

            {can("business:delete") && (
              <button
                type="button"
                className="btn-secondary min-h-10 text-slate-600"
                disabled={busy !== null}
                onClick={async () => {
                  if (!window.confirm(c.confirmAttachment)) {
                    return;
                  }

                  setBusy(attachment.id);
                  setError(false);

                  try {
                    await deleteMaintenanceAttachment(attachment);
                    onChange();
                  } catch {
                    setError(true);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {c.removeAttachment}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MaintenanceUploader({
  recordId,
  onUploaded,
  onStateChange,
}: {
  recordId: string | null;
  onUploaded: () => void;
  onStateChange?: (state: {busy: boolean; pending: number}) => void;
}) {
  const { t } = useLanguage();
  const c = t.maintenance;

  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<
    "fileError" | "uploadFailed" | null
  >(null);

  const lock = useRef(false);
  const initialRecord = useRef(recordId);

  useEffect(() => { onStateChange?.({busy: busy || selecting, pending: files.length}); }, [busy, selecting, files.length, onStateChange]);

  const select = async (list: FileList | null) => {
    if (!list) {
      return;
    }

    setError(null);
    setSelecting(true);

    try {
      const next = Array.from(list);

      for (const file of next) {
        await validateMaintenanceFile(file);
      }

      setFiles((old) => [...old, ...next]);
    } catch {
      setError("fileError");
    } finally {
      setSelecting(false);
    }
  };

  const upload = useCallback(async () => {
    if (lock.current || !recordId) {
      return;
    }

    lock.current = true;
    setBusy(true);
    setError(null);

    let remaining = [...files];

    try {
      for (const file of files) {
        setProgress(0);

        await uploadMaintenanceAttachment(
          recordId,
          file,
          setProgress
        );

        remaining = remaining.slice(1);
        setFiles(remaining);
        onUploaded();
      }
    } catch {
      setError("uploadFailed");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }, [files, recordId, onUploaded]);

  // Only the first successful record creation starts queued uploads automatically.
  // Failed files remain selected and require an explicit retry.
  useEffect(() => {
    if (recordId && initialRecord.current === null) {
      initialRecord.current = recordId;
      if (files.length) void upload();
    }
  }, [recordId, files.length, upload]);

  return (
    <div className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/30 p-4">
      <h4 className="font-semibold">{c.attachments}</h4>

      <p className="text-xs text-slate-500">{c.formats}</p>
      <p className="text-sm text-slate-600">{recordId ? c.receiptAfterSave : c.receiptBeforeSave}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          {c.chooseFiles}

          <input
            className="mt-1 block w-full text-sm"
            disabled={busy}
            type="file"
            multiple
            accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
            onChange={(event) => {
              void select(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        <label className="block text-sm">
          {c.camera}

          <input
            className="mt-1 block w-full text-sm"
            disabled={busy}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={(event) => {
              void select(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="break-all">{file.name}</span>

          <button
            type="button"
            disabled={busy}
            className="btn-secondary"
            onClick={() =>
              setFiles((current) =>
                current.filter((_, itemIndex) => itemIndex !== index)
              )
            }
          >
            {c.delete}
          </button>
        </div>
      ))}

      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {c[error]}
        </p>
      )}

      {busy && (
        <div role="status">
          <p>
            {c.uploading}: {files[0]?.name} ({progress}%)
          </p>

          <progress
            className="w-full"
            max={100}
            value={progress}
          />
        </div>
      )}

      {!recordId && files.length > 0 && <p role="status" className="text-sm text-violet-700">{c.queuedFiles}: {files.length}</p>}
      {recordId && files.length > 0 && (
        <button
          type="button"
          disabled={busy}
          className="btn-primary"
          onClick={() => void upload()}
        >
          {error ? c.retryUpload : c.upload}
        </button>
      )}
    </div>
  );
}
