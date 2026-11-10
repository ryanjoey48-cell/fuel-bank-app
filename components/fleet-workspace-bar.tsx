"use client";

import type { ReactNode } from "react";

export type FleetVehicleOption = { id: string; label: string; ambiguous: boolean };

/**
 * V7.1: one vehicle selector shared by Daily Activity, Journeys & Jobs and Fuel Intelligence.
 * It only chooses the vehicle; it never reads evidence. Registrations that appear more than once in the EES registry
 * stay visible but cannot be chosen, so history is never attributed to the wrong vehicle.
 */
export function FleetVehicleBar({ language, options, value, onChange, summary, children }: {
  language: "en" | "th";
  options: FleetVehicleOption[] | null;
  value: string | null;
  onChange: (id: string) => void;
  summary?: ReactNode;
  children?: ReactNode;
}) {
  const t = (en: string, th: string) => language === "th" ? th : en;
  return (
    <div className="v71-vehicle-bar" role="group" aria-label={t("Vehicle", "รถ")}>
      <label className="v71-vehicle-select">
        <span>{t("Vehicle", "รถ")}</span>
        <select value={value ?? ""} disabled={!options} onChange={(event) => onChange(event.target.value)}>
          <option value="">{options ? t("Choose a vehicle…", "เลือกรถ…") : t("Loading vehicles…", "กำลังโหลดรถ…")}</option>
          {options?.map((option) => (
            <option key={option.id} value={option.id} disabled={option.ambiguous}>
              {option.label}{option.ambiguous ? ` · ${t("duplicate registration", "ทะเบียนซ้ำ")}` : ""}
            </option>
          ))}
        </select>
      </label>
      {summary ? <div className="v71-vehicle-summary">{summary}</div> : null}
      {children ? <div className="v71-vehicle-bar-actions">{children}</div> : null}
    </div>
  );
}
