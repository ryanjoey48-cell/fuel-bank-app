"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import type { EesVehicleIdentity } from "@/lib/forth-tracking";
import { supabase } from "@/lib/supabase";
import {
  FORTH_SPEED_CONFIG_VERSION,
  forthLiveDeviceMapByRegistration,
  forthSpeedConfigGroupLabel,
  matchForthSpeedConfigsToRegistry,
  type ForthSpeedDeviceConfig
} from "@/lib/forth-speed-config";
import type { ForthSpeedConfigReviewRow } from "@/lib/forth-speed-config-server";

type Props = {
  language: "en" | "th";
  records: ForthFleetTrackingRecord[];
  eesVehicles: EesVehicleIdentity[] | null;
  onClose?: () => void;
};

type CatalogueEntry = {
  config: ForthSpeedDeviceConfig;
  officeReview: ForthSpeedConfigReviewRow | null;
};

type SpeedConfigResponse = {
  version?: string;
  canWrite?: boolean;
  migrationApplied?: boolean;
  catalogue?: CatalogueEntry[];
  audit?: Array<{
    id: string;
    registrationKey: string;
    action: string;
    reason: string;
    reviewerName: string;
    createdAt: string;
    previousValue: Record<string, unknown> | null;
    newValue: Record<string, unknown>;
  }>;
  notice?: string | null;
  error?: string;
};

const COPY = {
  en: {
    title: "Forth speed settings",
    eyebrow: "Office only · EES-maintained",
    version: "Catalogue version",
    disclaimer: "Owner-reported Forth console values stay separate from independently verified device settings. Changing reviews here does not update the physical Forth tracker. Road legal limits are not stored.",
    matched: "Matched",
    ambiguous: "Ambiguous",
    unmatched: "Unmatched",
    duplicate: "Duplicate",
    device: "Forth device",
    ees: "EES vehicle",
    threshold: "Alert",
    delay: "Delay",
    working: "Max working",
    idle: "Max idling",
    parking: "Power-save park",
    source: "Source",
    verified: "Office review",
    date: "Verified",
    unknown: "Not established",
    none: "—",
    hours: "h",
    minutes: "min",
    seconds: "s",
    close: "Close",
    filterAll: "All",
    filterIssues: "Needs review",
    ownerReported: "Owner-reported console",
    emptyRegistry: "EES vehicle registry unavailable — registration matching only.",
    confirm: "Confirm (shared)",
    markConflict: "Flag conflict",
    clearReview: "Clear review",
    localAudit: "Shared EES audit · admin/office_staff write · read_only view · Forth unchanged",
    loading: "Loading shared reviews…",
    migrationPending: "Audit migration not applied yet — catalogue is read-only until the SQL migration is deployed.",
    readOnly: "Your account can view settings but cannot approve or modify them.",
    recentAudit: "Recent audit",
    noAudit: "No shared audit entries yet.",
    independent: "Independently verified",
    notIndependent: "Not independently verified"
  },
  th: {
    title: "การตั้งค่าความเร็ว Forth",
    eyebrow: "สำนักงานเท่านั้น · ดูแลใน EES",
    version: "เวอร์ชันรายการ",
    disclaimer: "ค่าจากหน้าจอ Forth ที่เจ้าของรายงานแยกจากการตั้งค่าที่ยืนยันอิสระ การตรวจใน EES ไม่ได้อัปเดตเครื่องติดตามจริง ไม่เก็บขีดจำกัดถนน",
    matched: "จับคู่แล้ว",
    ambiguous: "คลุมเครือ",
    unmatched: "ยังไม่จับคู่",
    duplicate: "ซ้ำ",
    device: "อุปกรณ์ Forth",
    ees: "รถ EES",
    threshold: "แจ้งเตือน",
    delay: "หน่วง",
    working: "ทำงานสูงสุด",
    idle: "เดินเบาสูงสุด",
    parking: "จอดประหยัดไฟ",
    source: "แหล่งที่มา",
    verified: "การตรวจสำนักงาน",
    date: "วันที่ยืนยัน",
    unknown: "ยังไม่ทราบ",
    none: "—",
    hours: "ชม.",
    minutes: "น.",
    seconds: "วินาที",
    close: "ปิด",
    filterAll: "ทั้งหมด",
    filterIssues: "ต้องตรวจสอบ",
    ownerReported: "หน้าจอคอนโซลที่เจ้าของรายงาน",
    emptyRegistry: "ยังไม่มีทะเบียนรถ EES — จับคู่ด้วยทะเบียนเท่านั้น",
    confirm: "ยืนยัน (แชร์)",
    markConflict: "ทำเครื่องหมายขัดแย้ง",
    clearReview: "ล้างการตรวจ",
    localAudit: "บันทึกตรวจสอบ EES ร่วมกัน · admin/office_staff แก้ไขได้ · read_only ดูอย่างเดียว · ไม่เปลี่ยน Forth",
    loading: "กำลังโหลดการตรวจร่วม…",
    migrationPending: "ยังไม่ได้ใช้ migration ของบันทึกตรวจสอบ — รายการอ่านได้อย่างเดียวจนกว่าจะติดตั้ง SQL",
    readOnly: "บัญชีของคุณดูการตั้งค่าได้ แต่ไม่สามารถอนุมัติหรือแก้ไขได้",
    recentAudit: "บันทึกล่าสุด",
    noAudit: "ยังไม่มีบันทึกตรวจสอบร่วม",
    independent: "ยืนยันอิสระแล้ว",
    notIndependent: "ยังไม่ยืนยันอิสระ"
  }
};

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Authentication required.");
  return { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" };
}

export function ForthSpeedConfigPanel({ language, records, eesVehicles, onClose }: Props) {
  const copy = COPY[language];
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [migrationApplied, setMigrationApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(FORTH_SPEED_CONFIG_VERSION);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [audit, setAudit] = useState<NonNullable<SpeedConfigResponse["audit"]>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/forth-tracking/speed-config?audit=1", {
        headers,
        cache: "no-store"
      });
      const payload = await response.json() as SpeedConfigResponse;
      if (!response.ok) throw new Error(payload.error || "Unable to load speed settings.");
      setVersion(payload.version || FORTH_SPEED_CONFIG_VERSION);
      setCanWrite(Boolean(payload.canWrite));
      setMigrationApplied(Boolean(payload.migrationApplied));
      setNotice(payload.notice ?? null);
      setCatalogue(Array.isArray(payload.catalogue) ? payload.catalogue : []);
      setAudit(Array.isArray(payload.audit) ? payload.audit : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load speed settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matchRows = useMemo(() => {
    const liveMap = forthLiveDeviceMapByRegistration(records);
    return matchForthSpeedConfigsToRegistry(eesVehicles ?? [], liveMap);
  }, [eesVehicles, records]);

  const matchByKey = useMemo(() => {
    const map = new Map(matchRows.map((row) => [row.config.registrationKey, row]));
    return map;
  }, [matchRows]);

  const visible = useMemo(() => {
    return catalogue.filter((entry) => {
      const match = matchByKey.get(entry.config.registrationKey);
      const issue = match?.matchStatus !== "matched" || entry.officeReview?.reviewStatus === "conflict" || !entry.officeReview;
      return issuesOnly ? issue : true;
    });
  }, [catalogue, issuesOnly, matchByKey]);

  const issueCount = catalogue.filter((entry) => {
    const match = matchByKey.get(entry.config.registrationKey);
    return match?.matchStatus !== "matched" || entry.officeReview?.reviewStatus === "conflict" || !entry.officeReview;
  }).length;

  const saveAction = async (
    registration: string,
    action: "office_confirmed" | "conflict" | "cleared",
    note: string
  ) => {
    if (!canWrite || !migrationApplied) return;
    setSavingKey(registration);
    setError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/forth-tracking/speed-config", {
        method: "POST",
        headers,
        body: JSON.stringify({ registration, action, note, reason: note })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to save review.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save review.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section className="forth-speed-config-panel" aria-label={copy.title}>
      <header className="forth-speed-config-header">
        <div>
          <span className="forth-alert-eyebrow">{copy.eyebrow}</span>
          <h2>{copy.title}</h2>
          <p>{copy.version}: {version}</p>
        </div>
        {onClose ? (
          <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={onClose}>{copy.close}</button>
        ) : null}
      </header>
      <p className="forth-speed-config-disclaimer">{copy.disclaimer}</p>
      <p className="forth-speed-config-disclaimer">{copy.localAudit}</p>
      {!migrationApplied ? <p className="forth-speed-config-disclaimer">{copy.migrationPending}</p> : null}
      {!canWrite ? <p className="forth-speed-config-disclaimer">{copy.readOnly}</p> : null}
      {notice ? <p className="forth-speed-config-disclaimer">{notice}</p> : null}
      {error ? <p className="forth-speed-config-disclaimer" role="alert">{error}</p> : null}
      {!eesVehicles ? <p className="forth-speed-config-disclaimer">{copy.emptyRegistry}</p> : null}
      <div className="forth-speed-config-toolbar">
        <button type="button" className={!issuesOnly ? "is-active" : undefined} aria-pressed={!issuesOnly} onClick={() => setIssuesOnly(false)}>{copy.filterAll} ({catalogue.length})</button>
        <button type="button" className={issuesOnly ? "is-active" : undefined} aria-pressed={issuesOnly} onClick={() => setIssuesOnly(true)}>{copy.filterIssues} ({issueCount})</button>
      </div>
      {loading ? <p className="forth-speed-config-footer">{copy.loading}</p> : (
        <div className="forth-speed-config-table-wrap">
          <table className="forth-speed-config-table">
            <thead>
              <tr>
                <th>{language === "th" ? "ทะเบียน" : "Registration"}</th>
                <th>{copy.threshold}</th>
                <th>{copy.delay}</th>
                <th>{copy.working}</th>
                <th>{copy.idle}</th>
                <th>{copy.parking}</th>
                <th>{copy.device}</th>
                <th>{copy.ees}</th>
                <th>{copy.verified}</th>
                <th>{copy.source}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ config, officeReview }) => {
                const match = matchByKey.get(config.registrationKey);
                const matchStatus = match?.matchStatus ?? "unmatched";
                const busy = savingKey === config.registrationDisplay || savingKey === config.registrationKey;
                return (
                  <tr key={config.registrationKey} data-status={matchStatus}>
                    <td>
                      <strong>{config.registrationDisplay}</strong>
                      <small>{forthSpeedConfigGroupLabel(config.group, language)}</small>
                      {canWrite && migrationApplied ? (
                        <div className="forth-speed-config-actions">
                          <button type="button" disabled={busy} onClick={() => void saveAction(config.registrationDisplay, "office_confirmed", "Confirmed against owner-reported Forth console values.")}>{copy.confirm}</button>
                          <button type="button" disabled={busy} onClick={() => void saveAction(config.registrationDisplay, "conflict", "Office flagged a conflict for review.")}>{copy.markConflict}</button>
                          {officeReview ? <button type="button" disabled={busy} onClick={() => void saveAction(config.registrationDisplay, "cleared", "Cleared office review.")}>{copy.clearReview}</button> : null}
                        </div>
                      ) : null}
                    </td>
                    <td>{config.speedAlertKmh} km/h</td>
                    <td>{config.alertDelaySeconds}{copy.seconds}</td>
                    <td>{config.maxWorkingDurationHours == null ? copy.unknown : `${config.maxWorkingDurationHours}${copy.hours}`}</td>
                    <td>{config.maxEngineIdlingMinutes == null ? copy.unknown : `${config.maxEngineIdlingMinutes}${copy.minutes}`}</td>
                    <td>{config.powerSavingParkingHours == null ? copy.unknown : `${config.powerSavingParkingHours}${copy.hours}`}</td>
                    <td className="is-mono">{match?.forthDeviceId ?? copy.none}</td>
                    <td className="is-mono" title={match?.reason}>{match?.eesVehicleId ?? (
                      matchStatus === "matched" ? copy.matched
                        : matchStatus === "ambiguous" ? copy.ambiguous
                          : matchStatus === "duplicate_config" ? copy.duplicate
                            : copy.unmatched
                    )}</td>
                    <td>
                      <span className={`forth-speed-config-status is-${matchStatus}`}>
                        {officeReview?.reviewStatus === "office_confirmed" ? copy.confirm
                          : officeReview?.reviewStatus === "conflict" ? copy.markConflict
                            : copy.none}
                      </span>
                      <small>{officeReview ? `${officeReview.reviewedByName} · ${new Date(officeReview.reviewedAt).toLocaleString(language === "th" ? "th-TH" : "en-GB")}` : config.verificationDate}</small>
                      <small>{officeReview?.independentlyVerified ? copy.independent : copy.notIndependent}</small>
                    </td>
                    <td>{copy.ownerReported}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="forth-speed-config-audit">
        <h3>{copy.recentAudit}</h3>
        {audit.length === 0 ? <p>{copy.noAudit}</p> : (
          <ul>
            {audit.slice(0, 12).map((entry) => (
              <li key={entry.id}>
                <strong>{entry.registrationKey}</strong>
                <span> · {entry.action}</span>
                <span> · {entry.reviewerName}</span>
                <span> · {new Date(entry.createdAt).toLocaleString(language === "th" ? "th-TH" : "en-GB")}</span>
                {entry.reason ? <small>{entry.reason}</small> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="forth-speed-config-footer">{catalogue.length} vehicles · {copy.version} {version}</p>
    </section>
  );
}
