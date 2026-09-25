"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  Fuel,
  Gauge,
  MapPinned,
  PackageSearch,
  Plus,
  Route,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  type LucideIcon
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBookingDiaryEntries,
  fetchFuelLogs,
  fetchTripJourneys,
  fetchVehicles
} from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { buildMaintenanceReminders, maintenanceToday } from "@/lib/maintenance";
import { fetchMaintenanceData } from "@/lib/maintenance-data";
import type { MaintenanceData } from "@/lib/maintenance-types";
import { useAccountAccess } from "@/lib/use-account-access";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type {
  BookingDiaryEntry,
  FuelLogWithDriver,
  TripJourneyWithFuel,
  Vehicle
} from "@/types/database";

type Shortcut = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
  tone: "orange" | "purple" | "neutral";
};

type ActivityItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  id: string;
  occurredAt: string;
  reference: string;
  title: string;
  tone: "orange" | "purple" | "blue";
};

const pad = (value: number) => String(value).padStart(2, "0");

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`
  };
}

function inRange(value: string | null | undefined, start: string, end: string) {
  return Boolean(value && value >= start && value <= end);
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatActivityTime(value: string, language: "en" | "th") {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return formatDate(value.slice(0, 10), language);
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function ShortcutCard({ shortcut, compact = false }: { shortcut: Shortcut; compact?: boolean }) {
  const tone = shortcut.tone === "orange"
    ? "border-orange-200/80 bg-orange-50/55 text-orange-700 group-hover:border-orange-300 group-hover:shadow-orange-100/70"
    : shortcut.tone === "purple"
      ? "border-violet-200/80 bg-violet-50/55 text-violet-700 group-hover:border-violet-300 group-hover:shadow-violet-100/70"
      : "border-slate-200 bg-white text-slate-700 group-hover:border-slate-300 group-hover:shadow-slate-200/70";

  return (
    <Link
      href={shortcut.href}
      className={`group flex h-full items-start gap-3 rounded-2xl border p-3.5 shadow-[0_7px_20px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${compact ? "min-h-[92px]" : "min-h-[116px]"} ${tone}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
        <shortcut.icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`${compact ? "text-sm" : "text-base"} block font-bold text-slate-950`}>{shortcut.label}</span>
        <span className="mt-1 block text-xs leading-[1.15rem] text-slate-600">{shortcut.description}</span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-current" />
    </Link>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: "orange" | "purple" | "blue" | "slate" }) {
  const accent = tone === "orange" ? "bg-orange-50 text-orange-700" : tone === "purple" ? "bg-violet-50 text-violet-700" : tone === "blue" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-700";
  return (
    <article className="h-full rounded-2xl border border-slate-300/80 bg-white p-4 shadow-[0_9px_24px_rgba(15,23,42,0.075)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-black tracking-tight text-slate-950 sm:text-[1.7rem]">{value}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

export default function DashboardPage() {
  const { language, t } = useLanguage();
  const home = t.home;
  const { can } = useAccountAccess();
  const isAdmin = can("admin:user_management");
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [trips, setTrips] = useState<TripJourneyWithFuel[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [bookingRows, fuelRows, tripRows, vehicleRows, maintenanceResult] = await Promise.all([
        fetchBookingDiaryEntries(),
        fetchFuelLogs(),
        fetchTripJourneys(),
        fetchVehicles(),
        fetchMaintenanceData().catch(() => null)
      ]);
      setBookings(bookingRows);
      setFuelLogs(fuelRows);
      setTrips(tripRows);
      setVehicles(vehicleRows);
      setMaintenance(maintenanceResult);
    } catch (caught) {
      console.error("Home data load failed", caught);
      setError(home.loadError);
    } finally {
      setLoading(false);
    }
  }, [home.loadError]);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener("fuel-bank:data-changed", reload);
    return () => window.removeEventListener("fuel-bank:data-changed", reload);
  }, [load]);

  const range = useMemo(currentMonthRange, []);
  const monthlyBookings = useMemo(() => bookings.filter((row) => inRange(row.booking_date, range.start, range.end)), [bookings, range]);
  const monthlyFuel = useMemo(() => fuelLogs.filter((row) => inRange(row.date, range.start, range.end)), [fuelLogs, range]);
  const tripBookingIds = useMemo(() => new Set(trips.flatMap((trip) => [trip.booking_diary_id, trip.booking_id]).filter(Boolean).map(String)), [trips]);
  const missingTrips = monthlyBookings.filter((booking) => !tripBookingIds.has(String(booking.id))).length;
  const uncheckedFuel = monthlyFuel.filter((row) => !row.receipt_checked).length;
  const maintenanceReview = maintenance ? buildMaintenanceReminders(maintenance, maintenanceToday()).filter((row) => row.status !== "ok").length : 0;
  const reviewCount = missingTrips + uncheckedFuel + maintenanceReview;
  const fuelSpend = monthlyFuel.reduce((sum, row) => sum + asNumber(row.total_cost), 0);
  const activeVehicles = vehicles.filter((vehicle) => vehicle.active !== false).length;

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const bookingActivity = bookings.map((booking) => ({
      id: `booking-${booking.id}`,
      title: home.activity.booking,
      reference: booking.job_order_number || booking.booking_id || booking.client?.name || home.activity.bookingReference,
      description: `${booking.pickup || "—"} → ${booking.dropoff || "—"}`,
      occurredAt: booking.created_at,
      href: "/booking-diary",
      icon: CalendarDays,
      tone: "purple" as const
    }));
    const fuelActivity = fuelLogs.map((fuel) => ({
      id: `fuel-${fuel.id}`,
      title: home.activity.fuel,
      reference: fuel.vehicle_reg || fuel.driver || home.activity.fuelReference,
      description: `${formatNumber(asNumber(fuel.litres), language, 1)} L · ${formatCurrency(asNumber(fuel.total_cost), language)}`,
      occurredAt: fuel.created_at,
      href: "/fuel-logs",
      icon: Fuel,
      tone: "orange" as const
    }));
    const maintenanceActivity = (maintenance?.records ?? []).filter((record) => !record.is_deleted).map((record) => ({
      id: `maintenance-${record.id}`,
      title: home.activity.maintenance,
      reference: maintenance?.vehicles.find((vehicle) => vehicle.id === record.vehicle_id)?.vehicle_reg || home.activity.vehicleReference,
      description: record.garage || formatCurrency(record.calculated_total, language),
      occurredAt: record.updated_at || record.created_at,
      href: "/maintenance",
      icon: Wrench,
      tone: "blue" as const
    }));
    return [...bookingActivity, ...fuelActivity, ...maintenanceActivity]
      .filter((item) => safeTimestamp(item.occurredAt) > 0)
      .sort((left, right) => safeTimestamp(right.occurredAt) - safeTimestamp(left.occurredAt))
      .slice(0, 6);
  }, [bookings, fuelLogs, home.activity, language, maintenance]);

  const primaryShortcuts: Shortcut[] = [
    { href: "/booking-diary", label: home.shortcuts.booking, description: home.shortcuts.bookingDescription, icon: CalendarDays, tone: "orange" },
    { href: "/dispatch", label: home.shortcuts.dispatch, description: home.shortcuts.dispatchDescription, icon: ClipboardCheck, tone: "purple" },
    { href: "/fuel-logs", label: home.shortcuts.fuel, description: home.shortcuts.fuelDescription, icon: Fuel, tone: "orange" },
    { href: "/trip-journey", label: home.shortcuts.trip, description: home.shortcuts.tripDescription, icon: MapPinned, tone: "purple" },
    { href: "/drivers", label: home.shortcuts.fleet, description: home.shortcuts.fleetDescription, icon: Truck, tone: "neutral" }
  ];

  const secondaryShortcuts: Shortcut[] = [
    { href: "/weekly-mileage", label: home.shortcuts.mileage, description: home.shortcuts.mileageDescription, icon: Gauge, tone: "purple" },
    { href: "/maintenance", label: home.shortcuts.maintenance, description: home.shortcuts.maintenanceDescription, icon: Wrench, tone: "orange" },
    { href: "/insurance", label: home.shortcuts.insurance, description: home.shortcuts.insuranceDescription, icon: ShieldCheck, tone: "purple" },
    { href: "/inventory", label: home.shortcuts.inventory, description: home.shortcuts.inventoryDescription, icon: PackageSearch, tone: "orange" },
    { href: "/reports", label: home.shortcuts.reports, description: home.shortcuts.reportsDescription, icon: FileBarChart, tone: "purple" },
    { href: "/booking-diary", label: home.shortcuts.insights, description: home.shortcuts.insightsDescription, icon: BarChart3, tone: "neutral" },
    ...(isAdmin ? [{ href: "/admin/users", label: home.shortcuts.admin, description: home.shortcuts.adminDescription, icon: Users, tone: "neutral" as const }] : [])
  ];

  return (
    <div className="w-full space-y-3.5 pb-4 sm:space-y-4 lg:-mx-3 lg:w-[calc(100%+1.5rem)] xl:-mx-4 xl:w-[calc(100%+2rem)]">
      <section className="overflow-hidden rounded-[1.35rem] border border-orange-100/80 shadow-[0_16px_42px_rgba(42,32,72,0.11)]">
        <div className="relative hidden aspect-[31/10] md:block">
          <h1 className="sr-only">{home.title}</h1>
          <p className="sr-only">{home.subtitle}</p>
          <Image
            src="/ees-truck.png"
            alt={home.truckAlt}
            fill
            sizes="100vw"
            className="h-full w-full object-cover object-center"
            priority
          />
        </div>
        <div className="md:hidden">
          <div className="relative overflow-hidden bg-[linear-gradient(138deg,#fff8ee_0%,#fffdf9_58%,#f7f2ff_100%)] px-5 py-7 sm:px-8">
            <span className="absolute -left-16 -top-20 h-48 w-48 rounded-full bg-orange-100/70 blur-3xl" aria-hidden="true" />
            <div className="relative">
              <Image src="/ees-logo.png" alt="EES" width={170} height={110} className="h-14 w-auto object-contain" priority />
              <h1 className="mt-5 text-3xl font-black tracking-[-0.035em]">
                <span className="text-slate-950">{home.titlePrimary}</span>{" "}
                <span className="text-orange-600">{home.titleAccent}</span>
              </h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">{home.subtitle}</p>
            </div>
          </div>
          <div className="relative min-h-[220px] overflow-hidden bg-[#f7d8a8] sm:min-h-[280px]">
            <Image src="/ees-truck.png" alt={home.truckAlt} fill sizes="100vw" className="object-cover object-right" priority />
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="mb-2.5 flex items-center justify-between"><h2 id="quick-actions-title" className="text-sm font-extrabold uppercase tracking-[0.12em] text-slate-700">{home.quickActions}</h2></div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <QuickAction href="/booking-diary" label={home.actions.booking} icon={CalendarDays} primary />
          <QuickAction href="/fuel-logs" label={home.actions.fuel} icon={Fuel} />
          <QuickAction href="/trip-journey" label={home.actions.trip} icon={Route} />
          <QuickAction href="/dispatch" label={home.actions.dispatch} icon={ClipboardCheck} />
          <QuickAction href="/insurance" label={home.actions.vehicle} icon={Plus} neutral />
          <QuickAction href="/reports" label={home.actions.reports} icon={FileBarChart} neutral />
        </div>
      </section>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <section className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <SummaryCard icon={CalendarDays} label={home.summary.bookings} value={loading ? "—" : formatNumber(monthlyBookings.length, language)} detail={home.summary.bookingsDetail} tone="purple" />
        <SummaryCard icon={Fuel} label={home.summary.fuelSpend} value={loading ? "—" : formatCurrency(fuelSpend, language)} detail={home.summary.fuelDetail} tone="orange" />
        <SummaryCard icon={Truck} label={home.summary.fleet} value={loading ? "—" : formatNumber(activeVehicles, language)} detail={home.summary.fleetDetail} tone="blue" />
        <SummaryCard icon={Activity} label={home.summary.review} value={loading ? "—" : formatNumber(reviewCount, language)} detail={home.summary.reviewDetail} tone="slate" />
      </section>

      <section aria-labelledby="operations-shortcuts-title" className="rounded-[1.35rem] border border-slate-200/90 bg-[#fbfafc] p-4 shadow-sm">
        <div className="mb-3.5">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-orange-600">{home.toolsEyebrow}</p>
          <h2 id="operations-shortcuts-title" className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">{home.operationsShortcuts}</h2>
          <p className="mt-1 text-sm text-slate-500">{home.operationsShortcutsDescription}</p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">{primaryShortcuts.map((shortcut) => <ShortcutCard key={shortcut.href} shortcut={shortcut} />)}</div>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{secondaryShortcuts.map((shortcut) => <ShortcutCard key={`${shortcut.href}-${shortcut.label}`} shortcut={shortcut} compact />)}</div>
      </section>

      <section className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.055)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div><h2 className="text-lg font-extrabold text-slate-950">{home.recentActivity}</h2><p className="mt-1 text-xs text-slate-500">{home.recentActivityDescription}</p></div>
          <Link href="/reports" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-50 hover:text-violet-900">
            <Boxes className="h-4 w-4" />{home.viewAllActivity}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {recentActivity.length ? (
          <div className="divide-y divide-slate-100">
            {recentActivity.map((item) => {
              const colour = item.tone === "orange" ? "bg-orange-50 text-orange-700" : item.tone === "purple" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700";
              return (
                <Link key={item.id} href={item.href} className="group flex items-start gap-2.5 px-4 py-2 transition hover:bg-slate-50 sm:items-center sm:px-5">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colour}`}><item.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1"><span className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2"><span className="text-sm font-bold text-slate-900">{item.title}</span><span className="truncate text-xs font-semibold text-slate-500">{item.reference}</span></span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.description}</span></span>
                  <span className="shrink-0 text-right text-[11px] font-medium tabular-nums text-slate-400 sm:w-28">{formatActivityTime(item.occurredAt, language)}</span>
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600 sm:block" />
                </Link>
              );
            })}
          </div>
        ) : <div className="px-6 py-8 text-center text-sm text-slate-500">{loading ? t.common.loading : home.noRecentActivity}</div>}
      </section>
    </div>
  );
}

function QuickAction({ href, label, icon: Icon, primary = false, neutral = false }: { href: string; label: string; icon: LucideIcon; primary?: boolean; neutral?: boolean }) {
  const style = primary
    ? "border-orange-600 bg-orange-600 text-white shadow-orange-200 hover:bg-orange-700"
    : neutral
      ? "border-slate-200 bg-white text-slate-800 shadow-slate-100 hover:border-slate-300"
      : "border-violet-200 bg-violet-50 text-violet-800 shadow-violet-100 hover:border-violet-300 hover:bg-violet-100";
  return <Link href={href} className={`flex h-full min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-center text-sm font-bold shadow-sm transition duration-200 hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${style}`}><Icon className="h-4 w-4 shrink-0" />{label}</Link>;
}
