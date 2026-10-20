import { buildOilChangeAlertRows, oilMileageStatus, type OilChangeStatus } from "@/lib/operations";
import { normalizeVehicleRegForMatch as normalizedRegistration } from "@/lib/oil-change-service";
import type { Driver, OilChangeBaseline, Vehicle, VehicleServiceLog, WeeklyMileageEntry } from "@/types/database";

import { maintenanceToday, reliableMaintenanceMileage } from './maintenance';
import { evaluateSchedule } from './preventative-maintenance';

const normalizeVehicleRegForMatch = (value: string | null | undefined) => normalizedRegistration(value).replace(/-/g, "");

export function serviceOdometer(log: VehicleServiceLog) {
  const raw = log.oil_change_odometer ?? log.odometer ?? log.service_odometer;
  return raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
}

function validServiceDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return false;
  return new Date(date).toISOString().slice(0, 10) === date;
}

export function recordedServiceDate(timestamp: string | null | undefined) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const part = (name: string) => parts.find(item => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function latestValidService(logs: VehicleServiceLog[]) {
  return [...logs].filter(log => serviceOdometer(log) != null && validServiceDate(log.service_date) && log.service_date<=maintenanceToday())
    .sort((a, b) => b.service_date.localeCompare(a.service_date) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || b.id.localeCompare(a.id))[0] ?? null;
}

export function historyDistanceSinceService(log: VehicleServiceLog, entries: WeeklyMileageEntry[]) {
  const key = normalizeVehicleRegForMatch(log.vehicle_reg);
  const latest = entries.filter(entry => normalizeVehicleRegForMatch(entry.vehicle_reg) === key
    && validServiceDate(entry.week_ending) && entry.week_ending<=maintenanceToday() && (entry.odometer_reading ?? entry.mileage) != null
    && Number.isFinite(Number(entry.odometer_reading ?? entry.mileage)) && Number(entry.odometer_reading ?? entry.mileage) >= 0)
    .sort((a, b) => b.week_ending.localeCompare(a.week_ending) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
  const odometer = serviceOdometer(log);
  if (!latest || odometer == null || latest.week_ending < log.service_date) return null;
  return Number(latest.odometer_reading ?? latest.mileage) - odometer;
}

export function buildOilServiceSnapshot({ vehicles, baselines, logs, mileage, drivers }: {
  vehicles: Vehicle[]; baselines: OilChangeBaseline[]; logs: VehicleServiceLog[];
  mileage: WeeklyMileageEntry[]; drivers: Driver[];
}) {
  mileage=mileage.filter(e=>validServiceDate(e.week_ending)&&e.week_ending<=maintenanceToday());
  const groups = new Map<string, VehicleServiceLog[]>();
  for (const log of logs) {
    const key = normalizeVehicleRegForMatch(log.vehicle_reg);
    const group = groups.get(key) ?? [];
    group.push(log);
    groups.set(key, group);
  }
  const hasReal701Mileage = mileage.some(entry => normalizeVehicleRegForMatch(entry.vehicle_reg) === "7015145");
  const merged = vehicles.filter(vehicle => !(hasReal701Mileage && normalizeVehicleRegForMatch(vehicle.vehicle_reg || vehicle.registration) === "12345")).map(original => {
    const baseline = baselines.find(item => normalizeVehicleRegForMatch(item.vehicle_reg) === normalizeVehicleRegForMatch(original.vehicle_reg || original.registration));
    const vehicle = baseline ? { ...original, last_oil_change_date: baseline.last_oil_change_date,
      last_oil_change_odometer: baseline.last_odometer, oil_change_interval_km: baseline.interval_km } : original;
    const readings=mileage.filter(e=>e.vehicle_id===vehicle.id||(!e.vehicle_id&&normalizeVehicleRegForMatch(e.vehicle_reg)===normalizeVehicleRegForMatch(vehicle.vehicle_reg)));
    let log = latestValidService((groups.get(normalizeVehicleRegForMatch(vehicle.vehicle_reg || vehicle.registration)) ?? []).filter(l=>!l.vehicle_id||l.vehicle_id===vehicle.id).filter(l=>!readings.some(e=>e.week_ending>=l.service_date&&e.week_ending<=maintenanceToday()&&Number(e.odometer_reading??e.mileage)<Number(serviceOdometer(l)))));
    if(vehicle.maintenance_oil_schedule?.frequency_months){
      const dateOnly=(groups.get(normalizeVehicleRegForMatch(vehicle.vehicle_reg))??[]).filter(l=>l.maintenance_record_id&&l.odometer==null&&l.oil_change_odometer==null&&l.vehicle_id===vehicle.id&&validServiceDate(l.service_date)&&l.service_date<=maintenanceToday()).sort((a,b)=>b.service_date.localeCompare(a.service_date))[0];
      if(dateOnly&&(!log||dateOnly.service_date>log.service_date))log=dateOnly;
    }
    return log ? { ...vehicle, last_oil_change_date: log.service_date, last_oil_change_odometer: serviceOdometer(log),
      oil_change_interval_km: log.interval_km ?? vehicle.oil_change_interval_km,
      vehicle_type: vehicle.vehicle_type || log.vehicle_type_snapshot } : vehicle;
  });
  return buildOilChangeAlertRows({ vehicles: merged, weeklyMileage: mileage, drivers }).map(row => {
    const vehicle=vehicles.find(v=>v.id===row.vehicleId),schedule=vehicle?.maintenance_oil_schedule;
    const history = groups.get(normalizeVehicleRegForMatch(row.registration)) ?? [];
    const ordered = history.filter(log => serviceOdometer(log) != null).sort((a, b) => a.service_date.localeCompare(b.service_date));
    const reasons = [...row.reviewReasons];
    const readings = mileage.filter(entry => normalizeVehicleRegForMatch(entry.vehicle_reg) === normalizeVehicleRegForMatch(row.registration)
      && (entry.odometer_reading ?? entry.mileage) != null && Number.isFinite(Number(entry.odometer_reading ?? entry.mileage)))
      .sort((a, b) => a.week_ending.localeCompare(b.week_ending) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    if (readings.some((entry, index) => Number(entry.odometer_reading ?? entry.mileage) < 0 || (index > 0 && !entry.is_odometer_baseline
      && (entry.week_ending === readings[index - 1].week_ending
        ? Number(entry.odometer_reading ?? entry.mileage) !== Number(readings[index - 1].odometer_reading ?? readings[index - 1].mileage)
        : Number(entry.odometer_reading ?? entry.mileage) < Number(readings[index - 1].odometer_reading ?? readings[index - 1].mileage))))) reasons.push("Weekly mileage contains conflicting or decreasing readings. Review the odometer history.");
    if (history.some(log => (serviceOdometer(log) == null && !(log.maintenance_record_id&&schedule?.frequency_months)) || !validServiceDate(log.service_date))) reasons.push("Invalid service date or odometer. Review service history.");
    if (ordered.some((log, index) => index > 0 && log.service_date !== ordered[index - 1].service_date
      && serviceOdometer(log)! <= serviceOdometer(ordered[index - 1])!)) reasons.push("Service dates have repeated or decreasing odometers. Review service history; records have not been changed.");
    // Historical anomalies are advisory and must not overwrite a reliable
    // mileage-based oil-service status (OK / Due Soon / Urgent / Overdue).
    // buildOilChangeAlertRows already marks genuinely unusable current
    // service data as Review Required. Keep the historical reasons visible
    // in the expanded details, without changing service priority or totals.
    if(row.status==='not_set' && history.some(l=>l.service_date<=maintenanceToday()) && !(schedule?.frequency_months&&!schedule.mileage_interval&&row.lastOilChangeDate)) row={...row,status:'review_required',sortRank:4};
    // Historical mileage anomalies remain in reviewReasons, but must not by
    // themselves override a valid current oil-service status. The specific
    // post-service odometer contradiction below still requires review.
    const latestRecorded = history.filter(log => validServiceDate(log.service_date) && log.service_date <= maintenanceToday())
      .sort((a,b) => b.service_date.localeCompare(a.service_date))[0];
    if (latestRecorded && serviceOdometer(latestRecorded) !== null && readings.some(reading => reading.week_ending >= latestRecorded.service_date
      && Number(reading.odometer_reading ?? reading.mileage) < serviceOdometer(latestRecorded)!)) {
      reasons.push('Latest saved oil-service odometer exceeds a subsequent weekly reading. Review required; history has not been changed.');
      row={...row,status:'review_required',sortRank:3};
    }
    let result=reasons.length ? { ...row, reviewReasons: Array.from(new Set(reasons)) } : row;

    if(schedule){
      const readings=mileage.filter(e=>e.vehicle_id===vehicle!.id||(!e.vehicle_id&&normalizeVehicleRegForMatch(e.vehicle_reg)===normalizeVehicleRegForMatch(row.registration))).map(e=>({...e,vehicle_id:vehicle!.id}));
      const current=reliableMaintenanceMileage(readings,vehicle!.id);
      const baseline=row.lastOilChangeDate?{date:row.lastOilChangeDate,odometer:row.lastOilChangeOdometer,recordId:null,itemId:null}:null;
      const state=evaluateSchedule(schedule,baseline,current.date&&baseline&&current.date>=baseline.date?current.value:null);
      // Oil retains its approved distance thresholds, including Urgent and zero km.
      // Optional calendar settings add a due warning without erasing data-review errors.
      let status:OilChangeStatus=state.status==='notApplicable'?'not_applicable':state.status==='condition'?'condition_based'
        : state.days!==null&&state.days<=0?'overdue':state.km!==null?oilMileageStatus(state.km)
        :state.status==='ok'?'ok':state.status==='unknown'?'no_odometer':'not_set';
      if(status==='ok'&&state.days!==null&&state.days<=schedule.warning_days)status='due_soon';
      if(schedule.applicability_status!=='not_applicable'&&result.status==='review_required')status='review_required';
      result={...result,status,oilChangeIntervalKm:schedule.mileage_interval,nextOilChangeDueOdometer:state.dueKm,kmRemaining:state.km,overdueKm:state.km!==null&&state.km<0?-state.km:null,sortRank:status==='overdue'?0:status==='urgent'?1:status==='due_soon'?2:status==='ok'?6:3};
    }
    return result;
  });
}
