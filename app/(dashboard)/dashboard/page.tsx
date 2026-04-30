"use client";

import { ArrowRightLeft, ClipboardCheck, Droplet, Fuel, PackageCheck, TrendingDown, TrendingUp, Truck, Wallet } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchDrivers, fetchFuelLogs, fetchShipments, fetchTransfers, fetchVehicles, fetchWeeklyMileage } from "@/lib/data";
import { getTransferTypeLabel } from "@/lib/localized-values";
import { useLanguage } from "@/lib/language-provider";
import { buildOilChangeAlertRows, buildWeeklyMileageSummary } from "@/lib/operations";
import { normalizeShipment } from "@/lib/shipment-normalization";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type {
  BankTransferWithDriver,
  Driver,
  FuelLogWithDriver,
  ShipmentWithDriver,
  Vehicle,
  WeeklyMileageEntry
} from "@/types/database";

function isWithinRange(value: string, startDate: string, endDate: string) {
  if (!value) return false;
  if (startDate && value < startDate) return false;
  if (endDate && value > endDate) return false;
  return true;
}

function getMonthKey(value = new Date()) {
  return value.toISOString().slice(0, 7);
}

function startOfWeekKey(value = new Date(), offsetWeeks = 0) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset + offsetWeeks * 7);
  return date.toISOString().slice(0, 10);
}

function endOfWeekKey(value = new Date(), offsetWeeks = 0) {
  const start = new Date(`${startOfWeekKey(value, offsetWeeks)}T00:00:00`);
  start.setDate(start.getDate() + 6);
  return start.toISOString().slice(0, 10);
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function normalizeDuplicateKey(log: FuelLogWithDriver) {
  return [
    log.date,
    String(log.driver_id || ""),
    Number(log.litres || 0).toFixed(2),
    Number(log.total_cost || 0).toFixed(2)
  ].join("::");
}

const KpiCard = memo(function KpiCard({
  label,
  value,
  helper,
  icon: Icon
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof Wallet;
}) {
  return (
    <article className="surface-card-soft card-metric-shell">
      <div className="card-metric-header">
        <div className="min-w-0 flex-1">
          <p className="metric-label">{label}</p>
          <p className="metric-value text-slate-950">{value}</p>
        </div>
        <div className="card-metric-icon">
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <p className="metric-helper">{helper}</p>
    </article>
  );
});

export default function DashboardPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [shipments, setShipments] = useState<ShipmentWithDriver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (showBlockingLoader = false) => {
      try {
        if (showBlockingLoader) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);

        const [driverRows, vehicleRows, fuelRows, transferRows, mileageRows, shipmentRows] = await Promise.all([
          fetchDrivers(),
          fetchVehicles(),
          fetchFuelLogs(),
          fetchTransfers(),
          fetchWeeklyMileage(),
          fetchShipments()
        ]);

        console.log("Dashboard load success", {
          drivers: driverRows.length,
          vehicles: vehicleRows.length,
          fuelLogs: fuelRows.length,
          transfers: transferRows.length,
          weeklyMileage: mileageRows.length,
          shipments: shipmentRows.length
        });

        setDrivers(driverRows);
        setVehicles(vehicleRows);
        setFuelLogs(fuelRows);
        setTransfers(transferRows);
        setWeeklyMileage(mileageRows);
        setShipments(shipmentRows);
      } catch (error) {
        console.error("Dashboard load error:", error);
        setError(t.dashboard.loadDashboardError);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t.dashboard.loadDashboardError]
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => {
      void loadData(false);
    };

    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [loadData]);

  const filteredFuelLogs = useMemo(
    () =>
      fuelLogs.filter((log) => {
        const driverMatch =
          !selectedDriverId || String(log.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(log.date, startDate, endDate);
      }),
    [endDate, fuelLogs, selectedDriverId, startDate]
  );

  const filteredTransfers = useMemo(
    () =>
      transfers.filter((transfer) => {
        const driverMatch =
          !selectedDriverId || String(transfer.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(transfer.date, startDate, endDate);
      }),
    [endDate, selectedDriverId, startDate, transfers]
  );

  const filteredWeeklyMileage = useMemo(
    () =>
      weeklyMileage.filter((entry) => {
        const driverMatch =
          !selectedDriverId || String(entry.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(entry.week_ending, startDate, endDate);
      }),
    [endDate, selectedDriverId, startDate, weeklyMileage]
  );

  const filteredShipments = useMemo(
    () =>
      shipments.filter((shipment) => {
        const driverMatch =
          !selectedDriverId || String(shipment.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(shipment.shipment_date, startDate, endDate);
      }),
    [endDate, selectedDriverId, shipments, startDate]
  );

  const weeklySummaryRows = useMemo(
    () => buildWeeklyMileageSummary(filteredWeeklyMileage),
    [filteredWeeklyMileage]
  );
  const latestWeekRow = weeklySummaryRows[0] ?? null;
  const totalFuelSpend = filteredFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const totalFuelLitres = filteredFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const totalTransfers = filteredTransfers.reduce(
    (sum, transfer) => sum + Number(transfer.amount || 0),
    0
  );
  const averagePricePerLitre = totalFuelLitres > 0 ? totalFuelSpend / totalFuelLitres : null;
  const currentWeeklyDistance = latestWeekRow?.weeklyDistance ?? 0;

  const latestFuelLogs = useMemo(
    () =>
      [...filteredFuelLogs]
        .sort(
          (left, right) =>
            right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id))
        )
        .slice(0, 5),
    [filteredFuelLogs]
  );

  const latestTransfers = useMemo(
    () =>
      [...filteredTransfers]
        .sort(
          (left, right) =>
            right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id))
        )
        .slice(0, 5),
    [filteredTransfers]
  );

  const oilChangeRows = useMemo(
    () => buildOilChangeAlertRows({ vehicles, weeklyMileage, drivers }),
    [drivers, vehicles, weeklyMileage]
  );
  const oilDueSoonRows = oilChangeRows.filter((row) => row.status === "due_soon");
  const oilUrgentRows = oilChangeRows.filter((row) => row.status === "urgent");
  const oilOverdueRows = oilChangeRows.filter((row) => row.status === "overdue");
  const oilReviewRows = oilChangeRows.filter((row) => row.status === "review_required");
  const oilActionRows = oilChangeRows
    .filter((row) => row.status === "overdue" || row.status === "urgent" || row.status === "due_soon" || row.status === "review_required")
    .slice(0, 4);

  const completedServiceThisMonth = useMemo(() => {
    const currentMonth = getMonthKey();
    return vehicles.filter((vehicle) => vehicle.last_oil_change_date?.startsWith(currentMonth)).length;
  }, [vehicles]);

  const duplicateSuspicionCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of filteredFuelLogs) {
      const key = normalizeDuplicateKey(log);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.values()).filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  }, [filteredFuelLogs]);

  const uncheckedFuelLogs = filteredFuelLogs.filter((log) => !log.receipt_checked);
  const highValueThreshold =
    filteredFuelLogs.length > 0
      ? totalFuelSpend / filteredFuelLogs.length * 1.6
      : Number.POSITIVE_INFINITY;
  const missingReceiptReviewAlerts = uncheckedFuelLogs.filter((log) => Number(log.total_cost || 0) >= highValueThreshold).length;

  const normalizedShipments = useMemo(
    () => filteredShipments.map((shipment) => normalizeShipment(shipment)),
    [filteredShipments]
  );
  const currentMonth = getMonthKey();
  const shipmentsThisMonth = normalizedShipments.filter((shipment) => shipment.shipmentDate.startsWith(currentMonth));
  const totalEstimatedProfit = shipmentsThisMonth.reduce((sum, shipment) => sum + Number(shipment.profit ?? 0), 0);
  const highestProfitShipment = [...shipmentsThisMonth]
    .filter((shipment) => shipment.profit != null)
    .sort((left, right) => Number(right.profit) - Number(left.profit))[0] ?? null;
  const lowestMarginShipment = [...shipmentsThisMonth]
    .filter((shipment) => shipment.marginPercent != null)
    .sort((left, right) => Number(left.marginPercent) - Number(right.marginPercent))[0] ?? null;
  const jobsPendingQuotation = normalizedShipments.filter((shipment) => shipment.status === "Draft" || shipment.quotePrice == null).length;

  const currentWeekStart = startOfWeekKey();
  const currentWeekEnd = endOfWeekKey();
  const previousWeekStart = startOfWeekKey(new Date(), -1);
  const previousWeekEnd = endOfWeekKey(new Date(), -1);
  const currentWeekFuel = filteredFuelLogs
    .filter((log) => log.date >= currentWeekStart && log.date <= currentWeekEnd)
    .reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const previousWeekFuel = filteredFuelLogs
    .filter((log) => log.date >= previousWeekStart && log.date <= previousWeekEnd)
    .reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const currentWeekTransfers = filteredTransfers
    .filter((transfer) => transfer.date >= currentWeekStart && transfer.date <= currentWeekEnd)
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const previousWeekTransfers = filteredTransfers
    .filter((transfer) => transfer.date >= previousWeekStart && transfer.date <= previousWeekEnd)
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const previousWeekRow = weeklySummaryRows[1] ?? null;

  const executiveCopy = {
    en: {
      receiptReconciliation: "Receipt Reconciliation Summary",
      shipmentProfit: "Shipment Profit Snapshot",
      serviceManagement: "Service Management Summary",
      weeklyComparison: "This Week vs Last Week",
      totalFuelLogs: "Total fuel logs",
      checkedReceipts: "Checked receipts",
      uncheckedReceipts: "Unchecked receipts",
      duplicateSuspicion: "Duplicate suspicion",
      missingReceiptAlerts: "Missing receipt review alerts",
      jobsThisMonth: "Jobs this month",
      totalProfit: "Total estimated profit",
      highestProfit: "Highest profit shipment",
      lowestMargin: "Lowest margin shipment",
      pendingQuote: "Jobs pending quotation",
      overdue: "Overdue oil changes",
      urgent: "Urgent upcoming services",
      dueSoon: "Vehicles due soon",
      completedMonth: "Service completed this month",
      fuelSpendChange: "Fuel spend change",
      mileageChange: "Mileage change",
      transferChange: "Transfer cost change",
      noData: "No data yet"
    },
    th: {
      receiptReconciliation: "สรุปตรวจใบเสร็จ",
      shipmentProfit: "ภาพรวมกำไรงานขนส่ง",
      serviceManagement: "สรุปงานบริการ",
      weeklyComparison: "สัปดาห์นี้เทียบสัปดาห์ก่อน",
      totalFuelLogs: "รายการน้ำมันทั้งหมด",
      checkedReceipts: "ใบเสร็จตรวจแล้ว",
      uncheckedReceipts: "ใบเสร็จยังไม่ตรวจ",
      duplicateSuspicion: "รายการที่อาจซ้ำ",
      missingReceiptAlerts: "เตือนตรวจใบเสร็จ",
      jobsThisMonth: "งานเดือนนี้",
      totalProfit: "กำไรประมาณการรวม",
      highestProfit: "งานกำไรสูงสุด",
      lowestMargin: "งานมาร์จิ้นต่ำสุด",
      pendingQuote: "งานรอเสนอราคา",
      overdue: "เปลี่ยนน้ำมันเกินกำหนด",
      urgent: "งานบริการเร่งด่วน",
      dueSoon: "รถใกล้ถึงกำหนด",
      completedMonth: "บริการเสร็จในเดือนนี้",
      fuelSpendChange: "การเปลี่ยนแปลงค่าน้ำมัน",
      mileageChange: "การเปลี่ยนแปลงระยะทาง",
      transferChange: "การเปลี่ยนแปลงเงินโอน",
      noData: "ยังไม่มีข้อมูล"
    }
  }[language];

  const kpiCards = [
    {
      label: t.dashboard.totalFuelSpend,
      value: formatCurrency(totalFuelSpend, language),
      helper: `${formatNumber(filteredFuelLogs.length, language)} ${t.dashboard.fuelHelper}`,
      icon: Wallet
    },
    {
      label: t.dashboard.averagePricePerLitre,
      value: averagePricePerLitre != null ? formatCurrency(averagePricePerLitre, language) : "-",
      helper: t.dashboard.basedOnFilteredFuelEntries,
      icon: Fuel
    },
    {
      label: t.dashboard.weeklyDistance,
      value: formatNumber(currentWeeklyDistance, language),
      helper: latestWeekRow ? formatDate(latestWeekRow.weekEnding, language) : t.dashboard.noMileageDataDescription,
      icon: Truck
    },
    {
      label: t.dashboard.totalTransfers,
      value: formatCurrency(totalTransfers, language),
      helper: `${formatNumber(filteredTransfers.length, language)} ${t.dashboard.transferHelper}`,
      icon: ArrowRightLeft
    }
  ];

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.dashboard.title} description={t.dashboard.description} />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{t.dashboard.filtersTitle}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.dashboard.filtersDescription}</p>
          </div>
          <div className="flex items-center gap-3">
            {refreshing ? <span className="loading-inline">{t.common.loading}</span> : null}
            <button
              type="button"
              onClick={() => {
                setSelectedDriverId("");
                setStartDate("");
                setEndDate("");
              }}
              className="btn-secondary w-full sm:w-auto"
            >
              {t.dashboard.resetFilters}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="form-label">{t.dashboard.driverFilter}</label>
            <select value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)}>
              <option value="">{t.dashboard.allDrivers}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={String(driver.id)}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="form-label">{t.dashboard.startDate}</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="form-label">{t.dashboard.endDate}</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {loading ? (
        <EmptyState title={t.common.loading} description={t.dashboard.loadingData} />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="surface-card p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="section-title">{executiveCopy.receiptReconciliation}</h3>
                  <p className="section-subtitle">{executiveCopy.missingReceiptAlerts}</p>
                </div>
                <ClipboardCheck className="h-5 w-5 text-brand-700" />
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {[
                  [executiveCopy.totalFuelLogs, filteredFuelLogs.length, "text-slate-950"],
                  [executiveCopy.checkedReceipts, filteredFuelLogs.filter((log) => log.receipt_checked).length, "text-emerald-700"],
                  [executiveCopy.uncheckedReceipts, uncheckedFuelLogs.length, "text-amber-700"],
                  [executiveCopy.duplicateSuspicion, duplicateSuspicionCount, "text-rose-700"],
                  [executiveCopy.missingReceiptAlerts, missingReceiptReviewAlerts, "text-orange-700"]
                ].map(([label, value, className]) => (
                  <div key={String(label)} className="subtle-panel p-3.5">
                    <p className="metric-label">{label}</p>
                    <p className={`mt-2 text-2xl font-semibold ${className}`}>{formatNumber(Number(value), language)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-card p-4 sm:p-5">
              <div className="mb-4">
                <h3 className="section-title">{executiveCopy.weeklyComparison}</h3>
                <p className="section-subtitle">{formatDate(currentWeekStart, language)} - {formatDate(currentWeekEnd, language)}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: executiveCopy.fuelSpendChange, current: currentWeekFuel, previous: previousWeekFuel, money: true },
                  { label: executiveCopy.mileageChange, current: latestWeekRow?.weeklyDistance ?? 0, previous: previousWeekRow?.weeklyDistance ?? 0, money: false },
                  { label: executiveCopy.transferChange, current: currentWeekTransfers, previous: previousWeekTransfers, money: true }
                ].map((item) => {
                  const change = percentChange(item.current, item.previous);
                  const improving = change <= 0;
                  return (
                    <div key={item.label} className="subtle-panel p-3.5">
                      <p className="metric-label">{item.label}</p>
                      <p className="mt-2 whitespace-nowrap text-xl font-semibold text-slate-950">
                        {item.money ? formatCurrency(item.current, language) : formatNumber(item.current, language)}
                      </p>
                      <p className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${improving ? "text-emerald-700" : "text-rose-700"}`}>
                        {improving ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                        {formatNumber(Math.abs(change), language, 1)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          </section>

          <section className="surface-card p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="section-title">{executiveCopy.shipmentProfit}</h3>
                  <p className="section-subtitle">{executiveCopy.jobsThisMonth}</p>
                </div>
                <PackageCheck className="h-5 w-5 text-brand-700" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label={executiveCopy.jobsThisMonth} value={formatNumber(shipmentsThisMonth.length, language)} helper={executiveCopy.pendingQuote} icon={PackageCheck} />
                <KpiCard label={executiveCopy.totalProfit} value={formatCurrency(totalEstimatedProfit, language)} helper={executiveCopy.shipmentProfit} icon={Wallet} />
                <div className="subtle-panel p-3.5">
                  <p className="metric-label">{executiveCopy.highestProfit}</p>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-950">{highestProfitShipment?.jobReference ?? "-"}</p>
                  <p className="mt-1 whitespace-nowrap text-sm text-emerald-700">{highestProfitShipment?.profit != null ? formatCurrency(highestProfitShipment.profit, language) : "-"}</p>
                </div>
                <div className="subtle-panel p-3.5">
                  <p className="metric-label">{executiveCopy.lowestMargin}</p>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-950">{lowestMarginShipment?.jobReference ?? "-"}</p>
                  <p className="mt-1 whitespace-nowrap text-sm text-rose-700">{lowestMarginShipment?.marginPercent != null ? `${formatNumber(lowestMarginShipment.marginPercent, language, 1)}%` : "-"}</p>
                </div>
                <div className="subtle-panel p-3.5">
                  <p className="metric-label">{executiveCopy.pendingQuote}</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-700">{formatNumber(jobsPendingQuotation, language)}</p>
                </div>
              </div>
          </section>

          <section className="surface-card overflow-hidden p-0">
            <div className="border-b border-slate-100 bg-slate-950 px-5 py-4 text-white sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">{executiveCopy.serviceManagement}</p>
                  <h3 className="mt-1 text-lg font-semibold">{t.weeklyMileage.oil.title}</h3>
                </div>
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-100">
                  <Droplet className="h-4 w-4" />
                  {language === "th" ? "รอบบริการตามประเภทรถ" : "Type-based intervals"}
                </div>
              </div>
            </div>

            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-3 lg:grid-cols-6 md:border-b-0 md:border-r">
                <div className="p-4 sm:p-5">
                  <p className="metric-label">{language === "th" ? "ทั้งหมด" : "Total"}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{formatNumber(oilChangeRows.length, language)}</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="metric-label">{executiveCopy.urgent}</p>
                  <p className="mt-2 text-2xl font-semibold text-orange-700">{formatNumber(oilUrgentRows.length, language)}</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="metric-label">{executiveCopy.dueSoon}</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-700">{formatNumber(oilDueSoonRows.length, language)}</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="metric-label">{language === "th" ? "ตรวจสอบ" : "Review"}</p>
                  <p className="mt-2 text-2xl font-semibold text-sky-700">{formatNumber(oilReviewRows.length, language)}</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="metric-label">{executiveCopy.overdue}</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-700">{formatNumber(oilOverdueRows.length, language)}</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="metric-label">{executiveCopy.completedMonth}</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-700">{formatNumber(completedServiceThisMonth, language)}</p>
                </div>
              </div>

              <div className="p-4 sm:p-5">
                {oilActionRows.length === 0 ? (
                  <div className="flex min-h-[96px] items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 text-sm font-medium text-emerald-700">
                    {language === "th" ? "ไม่มีรถที่ใกล้ถึงกำหนดหรือเกินกำหนดในมุมมองนี้" : "No vehicles are due soon or overdue in this view."}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {oilActionRows.map((row) => (
                      <div key={row.registration} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">{row.registration}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.status === "review_required"
                              ? row.reviewReasons.join("; ") || (language === "th" ? "ต้องตรวจสอบ" : "Review required")
                              : row.status === "overdue"
                              ? `${formatNumber(row.overdueKm ?? 0, language)} KM ${language === "th" ? "เกินกำหนด" : "overdue"}`
                              : `${formatNumber(row.kmRemaining ?? 0, language)} KM ${language === "th" ? "คงเหลือ" : "remaining"}`}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${row.status === "overdue" ? "border-rose-200 bg-rose-50 text-rose-700" : row.status === "urgent" ? "border-orange-200 bg-orange-50 text-orange-800" : row.status === "review_required" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                          {row.status === "overdue" ? executiveCopy.overdue : row.status === "urgent" ? executiveCopy.urgent : row.status === "review_required" ? (language === "th" ? "ตรวจสอบ" : "Review") : executiveCopy.dueSoon}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="surface-card p-5 sm:p-6">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="section-title">{t.dashboard.weeklySummaryTitle}</h3>
                  <p className="section-subtitle">{t.dashboard.weeklySummaryDescription}</p>
                </div>
                {latestWeekRow ? (
                  <span className="badge-muted">{formatDate(latestWeekRow.weekEnding, language)}</span>
                ) : null}
              </div>

              {latestWeekRow ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{t.dashboard.weeklyDistance}</p>
                    <p className="mt-2 text-[2rem] font-semibold tracking-[-0.05em] text-slate-950">
                      {formatNumber(latestWeekRow.weeklyDistance, language)}
                    </p>
                  </div>
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{t.dashboard.highestOdometer}</p>
                    <p className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {latestWeekRow.highestOdometer != null
                        ? formatNumber(latestWeekRow.highestOdometer, language)
                        : "-"}
                    </p>
                  </div>
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{t.dashboard.lowestOdometer}</p>
                    <p className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {latestWeekRow.lowestOdometer != null
                        ? formatNumber(latestWeekRow.lowestOdometer, language)
                        : "-"}
                    </p>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={t.dashboard.noMileageDataTitle}
                  description={t.dashboard.noMileageDataDescription}
                />
              )}

              {weeklySummaryRows.length > 0 ? (
                <div className="mt-4 table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.weekEnding}</th>
                          <th className="table-head-cell text-right">{t.dashboard.highestOdometer}</th>
                          <th className="table-head-cell text-right">{t.dashboard.lowestOdometer}</th>
                          <th className="table-head-cell text-right">{t.dashboard.weeklyDistance}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklySummaryRows.slice(0, 4).map((row) => (
                          <tr key={row.weekEnding} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">
                              {formatDate(row.weekEnding, language)}
                            </td>
                            <td className="table-body-cell text-right">
                              {row.highestOdometer != null ? formatNumber(row.highestOdometer, language) : "-"}
                            </td>
                            <td className="table-body-cell text-right">
                              {row.lowestOdometer != null ? formatNumber(row.lowestOdometer, language) : "-"}
                            </td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatNumber(row.weeklyDistance, language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="surface-card p-5 sm:p-6">
              <div className="mb-4">
                <h3 className="section-title">{t.dashboard.latestFuelActivity}</h3>
                <p className="section-subtitle">{t.dashboard.latestFuelDescription}</p>
              </div>

              {latestFuelLogs.length === 0 ? (
                <EmptyState title={t.dashboard.noFuelTitle} description={t.dashboard.noFuelDescription} />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.date}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell">{t.dashboard.table.vehicle}</th>
                          <th className="table-head-cell text-right">{t.dashboard.table.cost}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestFuelLogs.map((log) => (
                          <tr key={log.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">{formatDate(log.date, language)}</td>
                            <td className="table-body-cell table-driver-name">{log.driver || "-"}</td>
                            <td className="table-body-cell">{log.vehicle_reg || "-"}</td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatCurrency(Number(log.total_cost || 0), language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="surface-card p-5 sm:p-6">
              <div className="mb-4">
                <h3 className="section-title">{t.dashboard.latestTransfers}</h3>
                <p className="section-subtitle">{t.dashboard.latestTransferDescription}</p>
              </div>

              {latestTransfers.length === 0 ? (
                <EmptyState title={t.dashboard.noTransferTitle} description={t.dashboard.noTransferDescription} />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.date}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell">{t.dashboard.table.type}</th>
                          <th className="table-head-cell text-right">{t.dashboard.table.amount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestTransfers.map((transfer) => (
                          <tr key={transfer.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">
                              {formatDate(transfer.date, language)}
                            </td>
                            <td className="table-body-cell table-driver-name">{transfer.driver || "-"}</td>
                            <td className="table-body-cell">{getTransferTypeLabel(t, transfer.transfer_type)}</td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatCurrency(Number(transfer.amount || 0), language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </section>
        </>
      )}
    </>
  );
}
