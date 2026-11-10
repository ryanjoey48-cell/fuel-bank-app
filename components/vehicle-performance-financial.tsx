"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccountAccess } from '@/lib/use-account-access';
import { isAdminRole } from '@/lib/authorization';
import { financialCopy } from '@/lib/vehicle-performance-financial-copy';
import { COST_FIELDS, SOURCE_FIELDS, baht, satang, decimal, operationalVehicleFinancials, operationalFleetFinancials,
  normalizeFinancialInput, financialCellKey, financialCellVersion, applyFinancialCorrections,
  OWNER_REPORTING_NOTE_EN, OWNER_REPORTING_NOTE_TH,
  type FinancialReport, type FinancialVehicle, type SourceField, type FinancialChange, type FinancialCorrection } from '@/lib/vehicle-performance-financial';
import './vehicle-performance-financial.css';

type Workspace = { reports: FinancialReport[]; sources: FinancialReport[]; history: FinancialCorrection[]; revision: number; writesEnabled: boolean };
type Draft = FinancialChange & { text: string; invalid: boolean };
type Props = {
  month: number; language: 'en' | 'th'; search: string; mode: 'fleet' | 'monthly' | 'manage';
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
  focusRegistration?: string | null;
  onWorkspaceChange?: (workspace: Workspace) => void;
  onSaved?: (workspace: Workspace) => void;
};
const EDIT_FIELDS = [...SOURCE_FIELDS];
function parseEdit(field: SourceField, text: string) {
  if (text.trim().toUpperCase() === 'N/A' && COST_FIELDS.includes(field as typeof COST_FIELDS[number])) return { kind: 'not_applicable' as const, value: null };
  const value = normalizeFinancialInput(field, text);
  return { kind: value == null ? 'unknown' as const : 'amount' as const, value };
}
function editText(row: FinancialVehicle, field: SourceField) {
  const cell = row.cells[field];
  return cell.status === 'not_applicable' ? 'N/A' : cell.value == null ? '' : field === 'jobs' ? String(Number(cell.value)) : decimal(satang(cell.value));
}

export function VehiclePerformanceFinancial({ month, language, search, mode, registerLeaveGuard, focusRegistration = null, onWorkspaceChange, onSaved }: Props) {
  const c = financialCopy[language];
  const t = (en: string, th: string) => language === 'th' ? th : en;
  const { access, can } = useAccountAccess();
  const canRead = can('business:write');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [conflictKeys, setConflictKeys] = useState<string[]>([]);
  const [sort, setSort] = useState('registration');
  const [ascending, setAscending] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);
  const [legacyNotes, setLegacyNotes] = useState<unknown[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const canAdjust = !!(workspace?.writesEnabled && access && isAdminRole(access.role) && canRead);
  const changes = useMemo(() => Object.values(drafts), [drafts]);
  const dirty = changes.length > 0;
  const invalidCount = changes.filter(draft => draft.invalid).length;
  const headers = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('Sign in to view or save financial records.');
    return { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' };
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    if (!canRead) { setWorkspace(null); setLoading(false); return; }
    try {
      const response = await fetch('/api/vehicle-performance-v5', { signal, cache: 'no-store', headers: await headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load financial records.');
      if (!Array.isArray(payload.sources) || !Array.isArray(payload.history)) throw new Error('Financial storage response is incomplete.');
      if (!signal?.aborted) { setWorkspace(payload); onWorkspaceChange?.(payload); }
    } catch (caught) { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load financial records.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [canRead, headers, onWorkspaceChange]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, access?.userId]);
  useEffect(() => {
    setDrafts({}); setWorkspace(null); setMessage(''); setConflictKeys([]);
    try { const parsed = JSON.parse(localStorage.getItem(`ees:vehicle-financial-adjustments:v1:${access?.userId}`) || '{"entries":[]}'); setLegacyNotes(Array.isArray(parsed.entries) ? parsed.entries : []); }
    catch { setLegacyNotes([]); }
  }, [access?.userId]);
  const leave = useCallback(() => {
    if (inFlight.current) return false;
    if (!dirty) return true;
    if (!window.confirm(language === 'th' ? 'ละทิ้งการแก้ไขที่ยังไม่บันทึกและออกจากเดือนนี้หรือไม่?' : 'Discard unsaved financial changes and leave this month?')) return false;
    setDrafts({}); setError(''); setMessage(''); setConflictKeys([]); return true;
  }, [dirty, language]);
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const link = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.getAttribute('href')?.startsWith('#')) return;
      if (!leave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', link, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', link, true); };
  }, [dirty, saving, leave]);
  useEffect(() => { setDetail(null); }, [month]);
  useEffect(() => { if (detail && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal(); }, [detail]);

  const saved = workspace?.reports.find(report => report.month === month);
  const source = workspace?.sources.find(report => report.month === month);
  const live = useMemo(() => {
    if (!saved) return undefined;
    const preview = changes.filter(draft => !draft.invalid && draft.month === month).map(draft => ({ ...draft, id: 'unsaved', userId: '', createdAt: '', sourceSha256: saved.sourceSha256, previousValue: null, previousStatus: 'unknown' as const }));
    return applyFinancialCorrections([saved], preview)[0];
  }, [saved, changes, month]);
  const fleet = live ? operationalFleetFinancials(live) : null;
  // Keep row order steady during typing; a deliberate sort or save changes the order.
  const ordered = useMemo(() => {
    if (!saved) return [];
    return [...saved.rows].filter(row => row.registration.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => {
      if (sort === 'registration') return (ascending ? 1 : -1) * a.registration.localeCompare(b.registration, 'th');
      const x = operationalVehicleFinancials(a), y = operationalVehicleFinancials(b);
      const av = sort === 'fuel' ? a.cells.fuel.value == null ? null : satang(a.cells.fuel.value) : x[sort as 'balance' | 'revenue' | 'jobs' | 'margin'];
      const bv = sort === 'fuel' ? b.cells.fuel.value == null ? null : satang(b.cells.fuel.value) : y[sort as 'balance' | 'revenue' | 'jobs' | 'margin'];
      return av == null || bv == null ? av == null && bv == null ? a.registration.localeCompare(b.registration) : av == null ? 1 : -1 : (ascending ? av - bv : bv - av);
    });
  }, [saved, search, sort, ascending]);
  useEffect(() => {
    if (!focusRegistration || !live || loading) return;
    const rowIndex = ordered.findIndex(row => row.registration === focusRegistration);
    if (rowIndex < 0) return;
    const input = tableRef.current?.querySelector<HTMLInputElement>(`input[data-vp-row="${rowIndex}"]`);
    input?.focus(); input?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [focusRegistration, live, loading, ordered]);
  const update = (row: FinancialVehicle, field: SourceField, text: string) => {
    if (!saved || !canAdjust || saving) return;
    const key = financialCellKey(month, row.registration, field);
    let parsed: ReturnType<typeof parseEdit> = { kind: 'unknown', value: null }; let invalid = false;
    try { parsed = parseEdit(field, text); } catch { invalid = true; }
    const original = parseEdit(field, editText(row, field));
    setDrafts(current => {
      const next = { ...current };
      if (!invalid && parsed.kind === original.kind && parsed.value === original.value) delete next[key];
      else next[key] = { year: saved.year, month, registration: row.registration, field, ...parsed, text, invalid, expected: current[key]?.expected || financialCellVersion(saved, row, field) };
      return next;
    });
    setMessage('');
  };
  const save = async () => {
    if (!dirty || invalidCount || !canAdjust || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/vehicle-performance-v5', { method: 'PUT', headers: await headers(), body: JSON.stringify({ changes: changes.map(({ text: _text, invalid: _invalid, ...change }) => change) }) });
      const payload = await response.json();
      if (!response.ok) { setConflictKeys(payload.cells || []); throw new Error(payload.error || 'Save failed — retry.'); }
      if (payload.savedCount !== changes.length || !Array.isArray(payload.reports) || !Array.isArray(payload.history)) throw new Error('Save was not confirmed. Reload saved values before retrying.');
      setWorkspace(payload); setDrafts({}); setConflictKeys([]); setMessage(language === 'th' ? 'บันทึกการเปลี่ยนแปลงทั้งหมดแล้ว' : 'All changes saved');
      onWorkspaceChange?.(payload); onSaved?.(payload);
      window.dispatchEvent(new CustomEvent('fuel-bank:data-changed', { detail: { source: 'vehicle-performance-v6' } }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Save failed — retry.'); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const exportPdf = async (registration?: string) => {
    if (!saved || dirty || saving) return;
    setBusyPdf(true); setError('');
    try { const { downloadFinancialPdf } = await import('@/lib/vehicle-performance-financial-pdf'); await downloadFinancialPdf(saved, language, saved.rows.find(row => row.registration === registration)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to export PDF.'); }
    finally { setBusyPdf(false); }
  };
  if (!canRead) return <section className="surface-card p-5" role="alert" data-testid="financial-access-denied">{t('Financial reporting access is required.', 'ต้องมีสิทธิ์จัดการข้อมูลการเงิน')}</section>;
  if (!live || !fleet || !saved || !source) return <section className="surface-card p-5" role={loading ? 'status' : 'alert'}>{loading ? c.loading : error}<button className="btn-secondary ml-3" disabled={loading} onClick={() => void load()}>{c.retry}</button></section>;
  const period = new Date(saved.year, month - 1, 1).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
  const selected = detail ? live.rows.find(row => row.registration === detail) : undefined;
  const selection = selected ? operationalVehicleFinancials(selected) : null;
  const closeDetail = () => { dialogRef.current?.close(); setDetail(null); detailTrigger.current?.focus(); };
  const label = (field: SourceField) => field === 'totalReceived' ? t('Total Received', 'รายรับรวม') : field === 'parkingFees' ? t('Parking Fees', 'ค่าจอดรถ') : field === 'jobs' ? c.jobsColumn : c[field];
  return <section className="vp5 vp6" data-testid="vehicle-financial-v6" aria-label={t('Vehicle financial worksheet', 'ตารางการเงินรายรถ')}>
    <div className="vp6-toolbar">
      <div><h2>{period} <span className="vp6-count">{ordered.length} / {saved.rows.length} {t('vehicles', 'คัน')} · THB</span></h2></div>
      <div className="vp6-controls">
        <label>{c.sort}<select aria-label={c.sort} value={sort} onChange={event => setSort(event.target.value)}>{['registration', 'balance', 'revenue', 'jobs', 'fuel', 'margin'].map(key => <option key={key} value={key}>{key === 'registration' ? c.registration : c[key as 'balance' | 'revenue' | 'jobs' | 'fuel' | 'margin']}</option>)}</select></label>
        <button type="button" className="btn-secondary" onClick={() => setAscending(value => !value)} aria-label={t('Reverse sort direction', 'สลับลำดับ')}>{ascending ? '↑' : '↓'}</button>
        <button type="button" className="btn-secondary" disabled={busyPdf || dirty || saving} title={dirty ? t('Save changes before exporting.', 'บันทึกการแก้ไขก่อนส่งออก') : ''} onClick={() => void exportPdf()}>{busyPdf ? '…' : c.download}</button>
      </div>
    </div>
    <div className="vp6-savebar">
      <button type="button" className="btn-primary" disabled={!canAdjust || !dirty || saving || !!invalidCount} onClick={() => void save()}>{saving ? t('Saving…', 'กำลังบันทึก…') : t('Save Changes', 'บันทึกการเปลี่ยนแปลง')}</button>
      <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={() => { setDrafts({}); setError(''); setMessage(''); setConflictKeys([]); }}>{t('Discard Unsaved Changes', 'ละทิ้งการแก้ไขที่ยังไม่บันทึก')}</button>
      <span role="status" data-testid="financial-save-status">{saving ? t('Saving…', 'กำลังบันทึก…') : dirty ? t(`${changes.length} unsaved changes`, `ยังไม่บันทึก ${changes.length} ช่อง`) : message || t('All changes saved', 'บันทึกการเปลี่ยนแปลงทั้งหมดแล้ว')}</span>
      <span className="vp6-help" title={t('Blank = unknown. 0 = recorded zero. Type N/A for a cost that does not apply. Tab moves between cells; Enter moves down; Escape undoes a cell edit.', 'ว่าง = ไม่ทราบ · 0 = ศูนย์จริง · พิมพ์ N/A สำหรับต้นทุนที่ไม่เกี่ยวข้อง · Tab ไปช่องถัดไป · Enter ลงแถวถัดไป · Esc ยกเลิกช่อง')}>ⓘ {t('Entry help', 'วิธีกรอก')}</span>
      {!canAdjust ? <small>{t('Read only', 'อ่านอย่างเดียว')}</small> : null}
    </div>
    {invalidCount ? <p role="alert" className="vp6-error">{t(`${invalidCount} invalid cells. Use non-negative amounts with up to two decimals; Jobs requires a whole number.`, `กรอกข้อมูลให้ถูกต้อง ${invalidCount} ช่อง ยอดเงินทศนิยมไม่เกิน 2 ตำแหน่ง และจำนวนงานเป็นจำนวนเต็ม`)}</p> : null}
    {error ? <div role="alert" className="vp6-error">{error} <button className="btn-secondary" disabled={saving || loading} onClick={() => void load()}>{t('Reload saved values', 'โหลดค่าที่บันทึกใหม่')}</button></div> : null}
    <div className="vp6-summary" data-testid="financial-month-totals">
      <span>{c.revenue} <b>{baht(fleet.revenue)}</b></span><span>{c.knownCosts} <b>{baht(fleet.knownCosts)}</b></span><span>{t('Recorded balance', 'ยอดคงเหลือที่รายงาน')} <b className={fleet.balance < 0 ? 'vp5-negative' : 'vp5-positive'}>{baht(fleet.balance)}</b></span><span>{c.jobsColumn} <b>{fleet.jobs}</b></span><span>{c.margin} <b>{fleet.margin == null ? 'N/A' : fleet.margin.toFixed(2) + '%'}</b></span>
      <span className="vp6-completeness" title={language === 'th' ? OWNER_REPORTING_NOTE_TH : OWNER_REPORTING_NOTE_EN}>{fleet.reviewCount ? t(`${fleet.reviewCount} review`, `ตรวจทาน ${fleet.reviewCount}`) : t('Reported', 'รายงานแล้ว')}{fleet.adjustedCount ? ` · ${t(`${fleet.adjustedCount} adjusted`, `ปรับแล้ว ${fleet.adjustedCount}`)}` : ''}{dirty ? ` · ${t('Unsaved preview', 'ตัวอย่างยังไม่บันทึก')}` : ''}</span>
    </div>
    <div ref={tableRef} className="vp5-scroll vp6-scroll" tabIndex={0} role="region" aria-label={t('Editable vehicle finances', 'แก้ไขการเงินรายรถ')}>
      <table data-testid="financial-vehicle-table"><thead><tr><th scope="col">{c.registration}</th>{EDIT_FIELDS.map(field => <th scope="col" key={field}>{label(field)}</th>)}<th scope="col">{c.balance}</th><th scope="col">{t('Profit Margin', 'อัตรากำไร')}</th><th scope="col"><span className="sr-only">{c.details}</span></th></tr></thead>
      <tbody>{ordered.map((original, index) => {
        const row = live.rows.find(item => item.registration === original.registration)!;
        const metrics = operationalVehicleFinancials(row);
        return <tr key={row.registration} data-registration={row.registration} data-financial-state={metrics.status}>
          <th scope="row"><span title={row.identityReview ? c.identity : ''}>{row.registration}</span></th>
          {EDIT_FIELDS.map(field => {
            const key = financialCellKey(month, row.registration, field), draft = drafts[key];
            const stale = !!draft && draft.expected !== financialCellVersion(saved, original, field);
            const conflict = stale || conflictKeys.includes(key);
            const nonLpg = field === 'lpg' && row.registration !== 'ฒอ-8453';
            const title = `${label(field)} · ${row.registration}${original.cells[field].adjustmentId ? ` · ${t('Amended after import', 'แก้ไขหลังนำเข้า')}` : ''}${conflict ? ` · ${t('Latest saved', 'ค่าที่บันทึกล่าสุด')}: ${editText(original, field) || '—'}` : ''}`;
            return <td key={field} data-field={field} data-changed={!!draft} data-amended={!!original.cells[field].adjustmentId} className={conflict ? 'vp6-conflict' : ''}>
              {nonLpg ? <span className="vp6-na" title={t('LPG is not applicable to this vehicle.', 'รถคันนี้ไม่ได้ใช้ LPG')}>N/A</span> : <input type="text" inputMode={field === 'jobs' ? 'numeric' : 'decimal'} autoComplete="off" aria-label={`${label(field)} ${row.registration}`} title={title}
                aria-invalid={draft?.invalid || conflict || undefined} data-vp-row={index} data-vp-field={field} disabled={!canAdjust || saving} placeholder="—" value={draft?.text ?? editText(original, field)}
                onChange={event => update(original, field, event.target.value)}
                onBlur={() => { if (draft && !draft.invalid) setDrafts(current => current[key] ? { ...current, [key]: { ...current[key], text: draft.kind === 'not_applicable' ? 'N/A' : draft.value || '' } } : current); }}
                onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); setDrafts(current => { const next = { ...current }; delete next[key]; return next; }); }
                  if (event.key === 'Enter') { event.preventDefault(); tableRef.current?.querySelector<HTMLInputElement>(`input[data-vp-row="${index + (event.shiftKey ? -1 : 1)}"][data-vp-field="${field}"]`)?.focus(); }
                }} />}
              {conflict ? <div className="vp6-conflict-actions"><button type="button" onClick={() => { setDrafts(current => { const next = { ...current }; delete next[key]; return next; }); setConflictKeys(current => current.filter(item => item !== key)); setError(''); }}>{t('Use saved', 'ใช้ค่าที่บันทึก')}</button><button type="button" onClick={() => { setDrafts(current => ({ ...current, [key]: { ...current[key], expected: financialCellVersion(saved, original, field) } })); setConflictKeys(current => current.filter(item => item !== key)); setError(''); }}>{t('Keep edit', 'ใช้ค่าที่แก้ไข')}</button></div> : null}
            </td>;
          })}
          <td data-testid="vehicle-balance" title={metrics.reportingStatus === 'review' ? c.identity : metrics.sourceUnreportedCosts.length ? (language === 'th' ? OWNER_REPORTING_NOTE_TH : OWNER_REPORTING_NOTE_EN) : t('Recorded operating balance', 'ยอดดำเนินงานที่รายงาน')}><span className={metrics.balance < 0 ? 'vp5-negative' : 'vp5-positive'}>{baht(metrics.balance)}</span></td>
          <td data-testid="vehicle-margin">{metrics.margin == null ? 'N/A' : metrics.margin.toFixed(2) + '%'}</td>
          <td><button type="button" className="vp6-details" aria-label={`${c.details} ${row.registration}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(row.registration); }}>ⓘ</button></td>
        </tr>;
      })}</tbody>
      <tfoot><tr><th scope="row" title={language === 'th' ? OWNER_REPORTING_NOTE_TH : OWNER_REPORTING_NOTE_EN}>{t('Month total', 'รวมทั้งเดือน')}</th>{EDIT_FIELDS.map(field => <td key={field}>{field === 'jobs' ? fleet.jobs : baht(fleet.totals[field])}</td>)}<td>{baht(fleet.balance)}</td><td>{fleet.margin == null ? 'N/A' : fleet.margin.toFixed(2) + '%'}</td><td /></tr></tfoot></table>
    </div>
    <details className="vp6-audit" open={mode === 'manage' ? true : undefined}>
      <summary>{t('Source figures & correction history', 'ข้อมูลต้นฉบับและประวัติแก้ไข')}{month === 9 ? ` · ${t('Source payroll note', 'หมายเหตุเงินเดือนต้นฉบับ')}` : ''}</summary>
      <p className="vp6-audit-note">{language === 'th' ? OWNER_REPORTING_NOTE_TH : OWNER_REPORTING_NOTE_EN}</p>
      <p className="vp6-audit-note">{t('Immutable PDF source totals for audit. Operating balances above use current saved values with the owner-approved blank-cost convention.', 'ยอดต้นฉบับ PDF สำหรับตรวจสอบ ยอดดำเนินงานด้านบนใช้ค่าที่บันทึกปัจจุบันตามเกณฑ์ต้นทุนว่าง=ศูนย์')}</p>
      {month === 9 ? <p className="vp6-audit-note">{c.salaryNote}</p> : null}
      <p className="vp6-audit-note">{c.identity}: 3ฒล-4565</p>
      <p className="vp6-audit-note">{source.sourceFile}</p>
      <dl className="vp6-source-totals" data-testid="financial-source-totals">{SOURCE_FIELDS.map(field => <div key={field}><dt>{label(field)}</dt><dd>{field === 'jobs' ? source.controls[field] : baht(satang(source.controls[field]))}</dd></div>)}</dl>
      {workspace!.history.filter(entry => entry.month === month).slice().reverse().map(entry => <p key={entry.id} data-testid="financial-audit-entry">{entry.registration} · {label(entry.field)}: {entry.previousValue ?? '—'} ({entry.previousStatus}) → {entry.kind === 'not_applicable' ? 'N/A' : entry.value ?? '—'} · {entry.userId} · {new Date(entry.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok' })}</p>)}
      {legacyNotes.length ? <details><summary>{t('Earlier browser notes (not applied to saved figures)', 'หมายเหตุเดิมในเบราว์เซอร์ (ไม่รวมในยอดที่บันทึก)')}</summary><pre>{JSON.stringify(legacyNotes, null, 2)}</pre></details> : null}
    </details>
    <dialog ref={dialogRef} className="vp5-dialog" onCancel={event => { event.preventDefault(); closeDetail(); }}>
      {selected && selection ? <><div className="vp5-heading"><h2>{selected.registration} · {period}</h2><button type="button" className="btn-secondary" onClick={closeDetail}>{c.close}</button></div>
        <p>{t('Recorded balance', 'ยอดคงเหลือที่รายงาน')}: <b>{baht(selection.balance)}</b> · {selection.reportingStatus === 'adjusted' ? t('Adjusted', 'ปรับแล้ว') : selection.reportingStatus === 'review' ? t('Review', 'ตรวจทาน') : t('Reported', 'รายงานแล้ว')} · {c.margin}: {selection.margin == null ? 'N/A' : selection.margin.toFixed(2) + '%'}</p>
        {selection.sourceUnreportedCosts.length ? <p className="vp6-audit-note">{language === 'th' ? OWNER_REPORTING_NOTE_TH : OWNER_REPORTING_NOTE_EN}</p> : null}
        <table className="vp5-detail-table"><thead><tr><th>{c.field}</th><th>{t('Original source', 'ต้นฉบับ')}</th><th>{c.current}</th></tr></thead><tbody>{SOURCE_FIELDS.map(field => <tr key={field}><th>{label(field)}</th><td>{source.rows.find(row => row.registration === selected.registration)?.cells[field].value ?? '—'}</td><td>{editText(selected, field) || '—'}</td></tr>)}</tbody></table>
        <button type="button" className="btn-primary" disabled={dirty || saving || busyPdf} onClick={() => void exportPdf(selected.registration)}>{c.individual}</button></> : null}
    </dialog>
  </section>;
}
