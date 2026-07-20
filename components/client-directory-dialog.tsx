"use client";

import { AlertTriangle, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { normalizeClientName, normalizedClientKey } from "@/lib/clients";
import type { ClientDeleteEligibility } from "@/lib/data";
import type { Client } from "@/types/database";

type ClientDirectoryDialogProps = {
  clients: Client[];
  bookingCounts: Map<string, number>;
  deleteEligibility: Map<string, ClientDeleteEligibility>;
  eligibilityLoading: boolean;
  language: "en" | "th";
  onClose: () => void;
  onUpdate: (id: string, payload: { name?: string; active?: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const copy = {
  en: {
    title: "Manage clients",
    search: "Search clients",
    bookings: "bookings",
    active: "Active",
    inactive: "Inactive",
    rename: "Rename",
    save: "Save",
    cancel: "Cancel",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    delete: "Delete",
    deleteClient: "Delete client",
    deleteTitle: "Delete client?",
    deleteMessage: (name: string) => `Are you sure you want to permanently delete ‘${name}’? This cannot be undone.`,
    cannotDeleteBookings: "Cannot delete this client because it is used by bookings. Deactivate it instead.",
    cannotDeleteOther: "Cannot delete this client because it is used by other records. Deactivate it instead.",
    deleted: "Client deleted successfully",
    unableDelete: "Unable to delete client",
    permissionDenied: "You do not have permission to delete clients.",
    noLongerExists: "This client no longer exists.",
    cannotUndo: "This cannot be undone.",
    noResults: "No clients found.",
    confirmDeactivate: (name: string) => `Deactivate "${name}"? Existing bookings will stay linked.`,
    internalProtected: "The managed Internal / Other option cannot be deactivated."
  },
  th: {
    title: "จัดการลูกค้า",
    search: "ค้นหาลูกค้า",
    bookings: "งาน",
    active: "ใช้งาน",
    inactive: "ไม่ได้ใช้งาน",
    rename: "เปลี่ยนชื่อ",
    save: "บันทึก",
    cancel: "ยกเลิก",
    deactivate: "ปิดใช้งาน",
    reactivate: "เปิดใช้งาน",
    delete: "ลบ",
    deleteClient: "ลบลูกค้า",
    deleteTitle: "ลบลูกค้า?",
    deleteMessage: (name: string) => `คุณแน่ใจหรือไม่ว่าต้องการลบ ‘${name}’ อย่างถาวร? การดำเนินการนี้ไม่สามารถย้อนกลับได้`,
    cannotDeleteBookings: "ไม่สามารถลบลูกค้านี้ได้เนื่องจากถูกใช้ในรายการจอง โปรดปิดใช้งานแทน",
    cannotDeleteOther: "ไม่สามารถลบลูกค้านี้ได้เนื่องจากถูกใช้ในรายการอื่น โปรดปิดใช้งานแทน",
    deleted: "ลบลูกค้าสำเร็จ",
    unableDelete: "ไม่สามารถลบลูกค้าได้",
    permissionDenied: "คุณไม่มีสิทธิ์ลบลูกค้า",
    noLongerExists: "ไม่พบลูกค้านี้แล้ว",
    cannotUndo: "การดำเนินการนี้ไม่สามารถย้อนกลับได้",
    noResults: "ไม่พบลูกค้า",
    confirmDeactivate: (name: string) => `ปิดใช้งาน "${name}" หรือไม่ งานเดิมจะยังเชื่อมอยู่`,
    internalProtected: "ไม่สามารถปิดใช้งานตัวเลือก Internal / Other ได้"
  }
} as const;

export function ClientDirectoryDialog({
  clients,
  bookingCounts,
  deleteEligibility,
  eligibilityLoading,
  language,
  onClose,
  onUpdate,
  onDelete
}: ClientDirectoryDialogProps) {
  const t = copy[language];
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [savingId, setSavingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const rows = useMemo(() => {
    const key = normalizedClientKey(query);
    return clients.filter((client) => !key || normalizedClientKey(client.name).includes(key));
  }, [clients, query]);

  const update = async (client: Client, payload: { name?: string; active?: boolean }) => {
    setSavingId(client.id);
    setError("");
    setSuccess("");
    try {
      await onUpdate(client.id, payload);
      setEditingId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingId("");
    }
  };

  const deleteClient = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    setSuccess("");
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
      setSuccess(t.deleted);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (/used by bookings|booking_diary/i.test(message)) setError(t.cannotDeleteBookings);
      else if (/referenced|foreign key|other records/i.test(message)) setError(t.cannotDeleteOther);
      else if (/internal \/ other/i.test(message)) setError(t.internalProtected);
      else if (/permission|required|not authorized/i.test(message)) setError(t.permissionDenied);
      else if (/no longer exists|not found/i.test(message)) setError(t.noLongerExists);
      else setError(t.unableDelete);
    } finally {
      setDeleting(false);
    }
  };

  return <div className="client-directory-backdrop" role="dialog" aria-modal="true" aria-labelledby="client-directory-title">
    <div className="client-directory-dialog">
      <header><div><p className="badge-muted w-fit">Booking Diary</p><h3 id="client-directory-title">{t.title}</h3></div><button type="button" onClick={onClose} aria-label={t.cancel}><X className="h-4 w-4" /></button></header>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="booking-form-control pl-10" placeholder={t.search} /></div>
      {error ? <p className="form-error">{error}</p> : null}
      {success ? <p className="client-directory-success">{success}</p> : null}
      <div className="client-directory-list">
        {rows.map((client) => {
          const internal = normalizedClientKey(client.name) === "internal / other";
          const eligibility = deleteEligibility.get(client.id);
          const bookingReferences = Math.max(bookingCounts.get(client.id) ?? 0, eligibility?.bookingReferences ?? 0);
          const otherReferences = eligibility?.otherReferences ?? 0;
          const deleteBlocked = bookingReferences > 0 || otherReferences > 0;
          const deleteTooltip = bookingReferences > 0 ? t.cannotDeleteBookings : otherReferences > 0 ? t.cannotDeleteOther : "";
          const showDelete = !internal && (deleteBlocked || (!eligibilityLoading && Boolean(eligibility)));
          return <article key={client.id}>
            <div className="min-w-0">
              {editingId === client.id ? <input value={name} onChange={(event) => setName(event.target.value)} className="booking-form-control" autoFocus /> : <strong title={client.name}>{client.name}</strong>}
              <p>{bookingCounts.get(client.id) ?? 0} {t.bookings} · {client.active ? t.active : t.inactive}</p>
            </div>
            <div>
              {editingId === client.id ? <>
                <button type="button" disabled={savingId === client.id || !normalizeClientName(name)} onClick={() => void update(client, { name })}>{t.save}</button>
                <button type="button" onClick={() => setEditingId("")}>{t.cancel}</button>
              </> : <>
                <button type="button" disabled={internal} title={internal ? t.internalProtected : undefined} onClick={() => { setEditingId(client.id); setName(client.name); }}>{t.rename}</button>
                <button type="button" disabled={savingId === client.id || internal} title={internal ? t.internalProtected : undefined} onClick={() => {
                  if (client.active && !window.confirm(t.confirmDeactivate(client.name))) return;
                  void update(client, { active: !client.active });
                }}>{savingId === client.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : client.active ? t.deactivate : t.reactivate}</button>
                {showDelete ? <button
                  type="button"
                  className="client-directory-delete"
                  disabled={deleteBlocked}
                  title={deleteTooltip || undefined}
                  onClick={() => {
                    setError("");
                    setSuccess("");
                    setDeleteTarget(client);
                  }}
                ><Trash2 className="h-3.5 w-3.5" />{t.delete}</button> : null}
              </>}
            </div>
          </article>;
        })}
        {!rows.length ? <p className="booking-insights-empty-copy">{t.noResults}</p> : null}
      </div>
    </div>
    {deleteTarget ? <div className="client-delete-confirmation-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="client-delete-title">
      <div className="client-delete-confirmation">
        <div className="client-delete-confirmation-heading">
          <span><AlertTriangle className="h-5 w-5" /></span>
          <div><h4 id="client-delete-title">{t.deleteTitle}</h4><p>{t.deleteMessage(deleteTarget.name)}</p></div>
        </div>
        <small>{t.cannotUndo}</small>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="client-delete-confirmation-actions">
          <button type="button" autoFocus disabled={deleting} onClick={() => { setDeleteTarget(null); setError(""); }}>{t.cancel}</button>
          <button type="button" className="is-destructive" disabled={deleting} onClick={() => void deleteClient()}>
            {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t.deleteClient}
          </button>
        </div>
      </div>
    </div> : null}
  </div>;
}
