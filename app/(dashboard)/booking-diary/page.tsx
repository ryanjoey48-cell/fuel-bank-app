"use client";

import clsx from "clsx";
import {
  CalendarDays,
  Clock3,
  Download,
  Edit3,
  Filter,
  MapPin,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Truck,
  UserRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  deleteBookingDiaryEntry,
  fetchBookingDiaryEntries,
  fetchDrivers,
  fetchVehicles,
  saveBookingDiaryEntry
} from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import type { BookingDiaryEntry, Driver, Vehicle } from "@/types/database";

type BookingForm = {
  id: string;
  booking_date: string;
  amount_pallets: string;
  weight: string;
  dimensions: string;
  pickup: string;
  warehouse_no: string;
  dropoff: string;
  vehicle: string;
  driver: string;
  notes: string;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): BookingForm => ({
  id: "",
  booking_date: todayKey(),
  amount_pallets: "",
  weight: "",
  dimensions: "",
  pickup: "",
  warehouse_no: "",
  dropoff: "",
  vehicle: "",
  driver: "",
  notes: ""
});

const labels = {
  en: {
    title: "Booking Diary",
    description: "Fast daily booking capture for phone calls, dispatch handover, and live office updates.",
    addBooking: "Add booking",
    editBooking: "Edit booking",
    exportExcel: "Export Excel",
    live: "Live sync",
    entries: "bookings",
    today: "Today",
    week: "This week",
    all: "All",
    search: "Search bookings",
    searchPlaceholder: "Search pickup, dropoff, vehicle, driver, notes",
    date: "Date",
    pickup: "Pickup",
    dropoff: "Dropoff",
    vehicle: "Vehicle",
    driver: "Driver",
    allDates: "All dates",
    allPickups: "All pickups",
    allDropoffs: "All dropoffs",
    allVehicles: "All vehicles",
    allDrivers: "All drivers",
    amountPallets: "Amount / pallets",
    weight: "Weight",
    dimensions: "Dimensions",
    warehouseNo: "Warehouse / NO",
    notes: "Notes",
    modifiedBy: "Modified by",
    modifiedTime: "Modified time",
    save: "Save booking",
    update: "Update booking",
    saving: "Saving...",
    cancel: "Cancel",
    close: "Close",
    quickFilters: "Quick filters",
    loading: "Loading booking diary...",
    noBookings: "No bookings in this view",
    noBookingsDescription: "Add a booking or adjust the filters to see the office diary.",
    saved: "Booking saved.",
    updated: "Booking updated.",
    deleted: "Booking deleted.",
    loadError: "Unable to load booking diary.",
    saveError: "Unable to save booking.",
    deleteError: "Unable to delete booking.",
    required: "Date, pickup, and dropoff are required.",
    clearFilters: "Clear filters",
    totalShown: "Total shown",
    todayShown: "Today",
    weekShown: "This week",
    confirmDeleteTitle: "Delete booking",
    confirmDeleteText: "Are you sure you want to delete this booking? This action cannot be undone.",
    deleteBooking: "Delete Booking",
    tableHint: "Daily operational diary",
    lastChanged: "Last changed",
    details: "Booking details",
    tapToEdit: "Tap to edit",
    updatedLabel: "Updated"
  },
  th: {
    title: "สมุดจองงาน",
    description: "บันทึกงานจองประจำวันให้เร็ว ใช้ง่าย และอัปเดตพร้อมกันทุกเครื่อง",
    addBooking: "เพิ่มงานจอง",
    editBooking: "แก้ไขงานจอง",
    exportExcel: "Export Excel",
    live: "ซิงก์สด",
    entries: "รายการ",
    today: "วันนี้",
    week: "สัปดาห์นี้",
    all: "ทั้งหมด",
    search: "ค้นหางานจอง",
    searchPlaceholder: "ค้นหาต้นทาง ปลายทาง รถ คนขับ หมายเหตุ",
    date: "วันที่",
    pickup: "รับของ",
    dropoff: "ส่งของ",
    vehicle: "รถ",
    driver: "คนขับ",
    allDates: "ทุกวันที่",
    allPickups: "ทุกจุดรับ",
    allDropoffs: "ทุกจุดส่ง",
    allVehicles: "รถทั้งหมด",
    allDrivers: "คนขับทั้งหมด",
    amountPallets: "จำนวน / พาเลท",
    weight: "น้ำหนัก",
    dimensions: "ขนาด",
    warehouseNo: "คลัง / NO",
    notes: "หมายเหตุ",
    modifiedBy: "แก้ไขโดย",
    modifiedTime: "เวลาแก้ไข",
    save: "บันทึกงานจอง",
    update: "อัปเดตงานจอง",
    saving: "กำลังบันทึก...",
    cancel: "Cancel",
    close: "ปิด",
    quickFilters: "ตัวกรองเร็ว",
    loading: "กำลังโหลดสมุดจองงาน...",
    noBookings: "ไม่พบงานจอง",
    noBookingsDescription: "เพิ่มงานจองใหม่หรือปรับตัวกรองเพื่อดูรายการ",
    saved: "บันทึกงานจองแล้ว",
    updated: "อัปเดตงานจองแล้ว",
    deleted: "Booking deleted.",
    loadError: "โหลดสมุดจองงานไม่ได้",
    saveError: "บันทึกงานจองไม่ได้",
    deleteError: "Unable to delete booking.",
    required: "กรุณากรอกวันที่ จุดรับ และจุดส่ง",
    clearFilters: "Clear filters",
    totalShown: "Total shown",
    todayShown: "Today",
    weekShown: "This week",
    confirmDeleteTitle: "Delete booking",
    confirmDeleteText: "Are you sure you want to delete this booking? This action cannot be undone.",
    deleteBooking: "Delete Booking",
    tableHint: "สมุดงานประจำวัน",
    lastChanged: "แก้ไขล่าสุด",
    details: "รายละเอียดงานจอง",
    tapToEdit: "แตะเพื่อแก้ไข",
    updatedLabel: "อัปเดต"
  }
};

function mapBookingToForm(booking: BookingDiaryEntry): BookingForm {
  return {
    id: booking.id,
    booking_date: booking.booking_date,
    amount_pallets: booking.amount_pallets != null ? String(booking.amount_pallets) : "",
    weight: booking.weight != null ? String(booking.weight) : "",
    dimensions: booking.dimensions ?? "",
    pickup: booking.pickup,
    warehouse_no: booking.warehouse_no ?? "",
    dropoff: booking.dropoff,
    vehicle: booking.vehicle ?? "",
    driver: booking.driver ?? "",
    notes: booking.notes ?? ""
  };
}

function formatTime(value: string, language: "en" | "th") {
  if (!value) return "-";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => (value ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function isThisWeek(dateKey: string) {
  const target = new Date(`${dateKey}T00:00:00`);
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return target >= start && target <= end;
}

export default function BookingDiaryPage() {
  const { language } = useLanguage();
  const copy = labels[language === "th" ? "th" : "en"];
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState<BookingForm>(() => emptyForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<"today" | "week" | "all">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pickupFilter, setPickupFilter] = useState("");
  const [dropoffFilter, setDropoffFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookingDiaryEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (blocking = false) => {
    try {
      if (blocking) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      const [bookingRows, driverRows, vehicleRows] = await Promise.all([
        fetchBookingDiaryEntries(),
        fetchDrivers(),
        fetchVehicles()
      ]);
      setBookings(bookingRows);
      setDrivers(driverRows);
      setVehicles(vehicleRows);
    } catch (err) {
      console.error("Booking diary load error:", err);
      setError(copy.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("booking-diary-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_diary" }, () => {
        void load(false);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const timer = window.setTimeout(() => firstInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [modalOpen]);

  const pickupOptions = useMemo(() => uniqueSorted(bookings.map((booking) => booking.pickup)), [bookings]);
  const dropoffOptions = useMemo(() => uniqueSorted(bookings.map((booking) => booking.dropoff)), [bookings]);
  const vehicleOptions = useMemo(
    () => uniqueSorted([...bookings.map((booking) => booking.vehicle), ...vehicles.map((vehicle) => vehicle.vehicle_reg)]),
    [bookings, vehicles]
  );
  const driverOptions = useMemo(
    () => uniqueSorted([...bookings.map((booking) => booking.driver), ...drivers.map((driver) => driver.name)]),
    [bookings, drivers]
  );

  const filteredBookings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const today = todayKey();

    return bookings.filter((booking) => {
      const quickMatch =
        quickFilter === "all" ||
        (quickFilter === "today" && booking.booking_date === today) ||
        (quickFilter === "week" && isThisWeek(booking.booking_date));
      const queryMatch =
        !query ||
        [
          booking.pickup,
          booking.dropoff,
          booking.vehicle,
          booking.driver,
          booking.warehouse_no,
          booking.notes
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);

      return (
        quickMatch &&
        queryMatch &&
        (!dateFilter || booking.booking_date === dateFilter) &&
        (!pickupFilter || booking.pickup === pickupFilter) &&
        (!dropoffFilter || booking.dropoff === dropoffFilter) &&
        (!vehicleFilter || booking.vehicle === vehicleFilter) &&
        (!driverFilter || booking.driver === driverFilter)
      );
    });
  }, [bookings, dateFilter, driverFilter, dropoffFilter, pickupFilter, quickFilter, searchQuery, vehicleFilter]);

  const todaysBookingsCount = useMemo(
    () => filteredBookings.filter((booking) => booking.booking_date === todayKey()).length,
    [filteredBookings]
  );
  const weekBookingsCount = useMemo(
    () => filteredBookings.filter((booking) => isThisWeek(booking.booking_date)).length,
    [filteredBookings]
  );
  const filtersActive = Boolean(
    searchQuery ||
      dateFilter ||
      pickupFilter ||
      dropoffFilter ||
      vehicleFilter ||
      driverFilter ||
      quickFilter !== "today"
  );
  const lastUpdatedAt = filteredBookings[0]?.updated_at ?? "";

  const clearFilters = () => {
    setSearchQuery("");
    setDateFilter("");
    setPickupFilter("");
    setDropoffFilter("");
    setVehicleFilter("");
    setDriverFilter("");
    setQuickFilter("today");
  };

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setNotice(null);
    setModalOpen(true);
  };

  const openEdit = (booking: BookingDiaryEntry) => {
    setForm(mapBookingToForm(booking));
    setError(null);
    setNotice(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.booking_date || !form.pickup.trim() || !form.dropoff.trim()) {
      setError(copy.required);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await saveBookingDiaryEntry({
        id: form.id || undefined,
        booking_date: form.booking_date,
        amount_pallets: form.amount_pallets,
        weight: form.weight,
        dimensions: form.dimensions,
        pickup: form.pickup,
        warehouse_no: form.warehouse_no,
        dropoff: form.dropoff,
        vehicle: form.vehicle,
        driver: form.driver,
        notes: form.notes
      });
      setNotice(form.id ? copy.updated : copy.saved);
      setModalOpen(false);
      await load(false);
    } catch (err) {
      console.error("Booking diary save error:", err);
      setError(err instanceof Error && err.message ? err.message : copy.saveError);
    } finally {
      setSaving(false);
    }
  };

  const setField = (field: keyof BookingForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    const targetId = deleteTarget.id;
    try {
      setDeletingId(targetId);
      setError(null);
      setNotice(null);
      await deleteBookingDiaryEntry(targetId);
      setBookings((current) => current.filter((booking) => booking.id !== targetId));
      setDeleteTarget(null);
      setNotice(copy.deleted);
    } catch (err) {
      console.error("Booking diary delete error:", err);
      setError(err instanceof Error && err.message ? err.message : copy.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const exportFilteredBookings = () => {
    exportToXlsx(
      filteredBookings.map((booking) => ({
        Date: booking.booking_date,
        "Amount / Pallets": booking.amount_pallets,
        Weight: booking.weight,
        Dimensions: booking.dimensions,
        Pickup: booking.pickup,
        "Warehouse / NO": booking.warehouse_no,
        Dropoff: booking.dropoff,
        Vehicle: booking.vehicle,
        Driver: booking.driver,
        Notes: booking.notes,
        "Created By": booking.created_by,
        "Created At": booking.created_at,
        "Modified By": booking.modified_by,
        "Modified Time": booking.updated_at
      })),
      `booking-diary-${todayKey()}`,
      "Booking Diary"
    );
  };

  const inputClass = "booking-form-control";
  const compactInputClass = "booking-filter-control";

  return (
    <div className="booking-diary-page w-full max-w-full overflow-x-hidden">
      <div className="mb-5 hidden lg:block">
        <Header title={copy.title} description={copy.description} />
      </div>

      <section className="grid max-w-full gap-3 lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="badge-muted w-fit">{copy.live}</p>
            <h1 className="mt-3 text-[1.55rem] font-semibold text-slate-950">{copy.title}</h1>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">{copy.description}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={exportFilteredBookings}
              disabled={!filteredBookings.length}
              className="booking-icon-button btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={copy.exportExcel}
            >
              <Download className="h-4 w-4" />
            </button>
            <button type="button" onClick={openCreate} className="booking-icon-button btn-primary" aria-label={copy.addBooking}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <section className="grid max-w-full gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="booking-filter-panel surface-card-soft">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-brand-700" />
              <p className="text-sm font-semibold text-slate-800">{copy.quickFilters}</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {copy.live}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(140px,1fr))]">
            <div className="relative col-span-2 sm:col-span-3 xl:col-span-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className={`${compactInputClass} bg-white pl-10`}
                aria-label={copy.search}
              />
            </div>
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className={`${compactInputClass} bg-white`}
              aria-label={copy.date}
            />
            <select value={pickupFilter} onChange={(event) => setPickupFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
              <option value="">{copy.allPickups}</option>
              {pickupOptions.map((pickup) => <option key={pickup} value={pickup}>{pickup}</option>)}
            </select>
            <select value={dropoffFilter} onChange={(event) => setDropoffFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
              <option value="">{copy.allDropoffs}</option>
              {dropoffOptions.map((dropoff) => <option key={dropoff} value={dropoff}>{dropoff}</option>)}
            </select>
            <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
              <option value="">{copy.allVehicles}</option>
              {vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}
            </select>
            <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
              <option value="">{copy.allDrivers}</option>
              {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
            </select>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(["today", "week", "all"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setQuickFilter(filter)}
                className={clsx(
                  "booking-filter-chip",
                  quickFilter === filter
                    ? "border-brand-200 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-100 hover:text-brand-700"
                )}
              >
                {filter === "today" ? copy.today : filter === "week" ? copy.week : copy.all}
              </button>
            ))}
            {filtersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className="booking-filter-chip border-slate-200 bg-white text-slate-600 hover:border-rose-100 hover:text-rose-600"
              >
                {copy.clearFilters}
              </button>
            ) : null}
          </div>
        </div>

        <div className="hidden gap-2 lg:flex">
          <button
            type="button"
            onClick={exportFilteredBookings}
            disabled={!filteredBookings.length}
            className="booking-action-button btn-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {copy.exportExcel}
          </button>
          <button type="button" onClick={openCreate} className="booking-action-button btn-primary gap-2">
            <PackagePlus className="h-4 w-4" />
            {copy.addBooking}
          </button>
        </div>
      </section>

      {notice ? (
        <div className="rounded-[1rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {notice}
        </div>
      ) : null}

      {error && !modalOpen ? (
        <div className="rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="booking-stats-strip grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: copy.totalShown, value: filteredBookings.length },
          { label: copy.todayShown, value: todaysBookingsCount },
          { label: copy.weekShown, value: weekBookingsCount },
          { label: copy.lastChanged, value: lastUpdatedAt ? formatTime(lastUpdatedAt, language) : "-" }
        ].map((item) => (
          <div key={item.label} className="booking-stat-cell">
            <p className="booking-stat-label">{item.label}</p>
            <p className="booking-stat-value">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="surface-card min-w-0 max-w-full p-3.5 sm:p-5 lg:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="section-title text-[1.25rem] sm:text-[1.45rem]">{copy.tableHint}</h2>
              <span className="badge-muted">{filteredBookings.length} {copy.entries}</span>
            </div>
            <p className="section-subtitle">{copy.lastChanged}: {filteredBookings[0] ? formatTime(filteredBookings[0].updated_at, language) : "-"}</p>
          </div>
          <button type="button" onClick={() => void load(false)} disabled={refreshing} className="btn-secondary min-h-[44px] gap-2 rounded-[1rem] px-4 text-sm disabled:opacity-60">
            <RefreshCw className={clsx("h-4 w-4", refreshing && "animate-spin")} />
            {refreshing ? copy.loading : copy.live}
          </button>
        </div>

        {loading ? (
          <p className="loading-inline">{copy.loading}</p>
        ) : filteredBookings.length === 0 ? (
          <EmptyState title={copy.noBookings} description={copy.noBookingsDescription} />
        ) : (
          <>
            <div className="booking-ledger-list lg:hidden">
              {filteredBookings.map((booking) => (
                <article
                  key={booking.id}
                  className="booking-ledger-entry"
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(booking)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEdit(booking);
                    }
                  }}
                >
                  <div className="booking-ledger-top">
                    <p className="booking-ledger-date">
                      <CalendarDays className="booking-ledger-icon text-brand-600" />
                      {formatDate(booking.booking_date, language)}
                    </p>
                    <p className="booking-ledger-status">{copy.updatedLabel} {formatTime(booking.updated_at, language)}</p>
                  </div>

                  <div className="booking-ledger-route">
                    <span>{booking.pickup}</span>
                    <span className="booking-ledger-arrow">-&gt;</span>
                    <span>{booking.dropoff}</span>
                  </div>

                  <div className="booking-ledger-row">
                    <span><Truck className="booking-ledger-icon" />{booking.vehicle || "-"}</span>
                    <span><UserRound className="booking-ledger-icon" />{booking.driver || "-"}</span>
                  </div>

                  <div className="booking-ledger-load">
                    <span>{copy.amountPallets}: <strong>{booking.amount_pallets || "-"}</strong></span>
                    <span>{copy.weight}: <strong>{booking.weight || "-"}</strong></span>
                    <span>{copy.dimensions}: <strong>{booking.dimensions || "-"}</strong></span>
                  </div>

                  {(booking.warehouse_no || booking.notes) ? (
                    <div className="booking-ledger-extra">
                      {booking.warehouse_no ? <p>{copy.warehouseNo}: {booking.warehouse_no}</p> : null}
                      {booking.notes ? <p>{copy.notes}: {booking.notes}</p> : null}
                    </div>
                  ) : null}

                  <div className="booking-ledger-bottom">
                    <p><Clock3 className="booking-ledger-icon" />{booking.modified_by || "-"} • {formatTime(booking.updated_at, language)}</p>
                    <div className="booking-ledger-actions">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(booking);
                        }}
                        className="booking-entry-edit"
                        aria-label={copy.editBooking}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {copy.tapToEdit}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(booking);
                        }}
                        className="booking-card-delete"
                        aria-label={copy.deleteBooking}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden">
              {filteredBookings.map((booking) => (
                <article
                  key={booking.id}
                  className="booking-mobile-card booking-entry"
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(booking)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEdit(booking);
                    }
                  }}
                >
                  <div className="booking-entry-top">
                    <div className="min-w-0">
                      <p className="booking-entry-date">
                        <CalendarDays className="booking-card-icon text-brand-600" />
                        {formatDate(booking.booking_date, language)}
                      </p>
                    </div>
                    <p className="booking-entry-status">{copy.updatedLabel} {formatTime(booking.updated_at, language)}</p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(booking);
                      }}
                      className="booking-entry-edit"
                      aria-label={copy.editBooking}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      {copy.tapToEdit}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(booking);
                      }}
                      className="booking-card-delete"
                      aria-label={copy.deleteBooking}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(booking);
                    }}
                    className="booking-entry-main"
                  >
                  <div className="booking-entry-route">
                    <span>{booking.pickup}</span>
                    <span className="booking-entry-arrow">→</span>
                    <span>{booking.dropoff}</span>
                  </div>
                  <div className="booking-entry-assignment">
                    <span><Truck className="booking-card-icon" />{booking.vehicle || "-"}</span>
                    <span><UserRound className="booking-card-icon" />{booking.driver || "-"}</span>
                  </div>
                  <div className="booking-card-measurements booking-entry-load">
                    <p><span>{booking.amount_pallets || "-"}</span>{copy.amountPallets}</p>
                    <p><span>{booking.weight || "-"}</span>{copy.weight}</p>
                    <p><span>{booking.dimensions || "-"}</span>{copy.dimensions}</p>
                  </div>
                  <div className="booking-card-route booking-entry-extra">
                    <p><MapPin className="booking-card-icon text-brand-600" /> <span>{booking.pickup}</span></p>
                    <p className="booking-card-warehouse">{copy.warehouseNo}: {booking.warehouse_no || "-"}</p>
                    <p><MapPin className="booking-card-icon text-orange-500" /> <span>{booking.dropoff}</span></p>
                  </div>
                  <div className="booking-card-meta">
                    <p><Truck className="booking-card-icon" />{booking.vehicle || "-"}</p>
                    <p><UserRound className="booking-card-icon" />{booking.driver || "-"}</p>
                    {booking.notes ? <p className="col-span-2 truncate">{copy.notes}: {booking.notes}</p> : null}
                    <p className="col-span-2"><Clock3 className="booking-card-icon" />{booking.modified_by || "-"} · {formatTime(booking.updated_at, language)}</p>
                  </div>
                  </button>
                </article>
              ))}
            </div>

            <div className="table-shell hidden lg:block">
              <div className="table-scroll max-h-[68vh]">
                <table className="min-w-[1040px]">
                  <thead>
                    <tr>
                      {[copy.date, copy.amountPallets, copy.weight, copy.dimensions, copy.pickup, copy.warehouseNo, copy.dropoff, copy.vehicle, copy.driver, copy.notes, copy.modifiedBy, copy.modifiedTime, ""].map((heading) => (
                        <th key={heading || "actions"} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBookings.map((booking) => (
                      <tr key={booking.id} className="enterprise-table-row cursor-pointer" onClick={() => openEdit(booking)}>
                        <td className="px-3 py-3 align-middle text-[13px] font-semibold text-slate-950 whitespace-nowrap">{formatDate(booking.booking_date, language)}</td>
                        <td className="px-3 py-3 align-middle text-[13px]">{booking.amount_pallets || "-"}</td>
                        <td className="px-3 py-3 align-middle text-[13px]">{booking.weight || "-"}</td>
                        <td className="max-w-[120px] px-3 py-3 align-middle text-[13px]" title={booking.dimensions || ""}><span className="block truncate">{booking.dimensions || "-"}</span></td>
                        <td className="max-w-[190px] px-3 py-3 align-middle text-[13px] font-semibold text-slate-900" title={booking.pickup}><span className="block truncate">{booking.pickup}</span></td>
                        <td className="max-w-[120px] px-3 py-3 align-middle text-[13px]" title={booking.warehouse_no || ""}><span className="block truncate">{booking.warehouse_no || "-"}</span></td>
                        <td className="max-w-[190px] px-3 py-3 align-middle text-[13px] text-slate-700" title={booking.dropoff}><span className="block truncate">{booking.dropoff}</span></td>
                        <td className="px-3 py-3 align-middle text-[13px] whitespace-nowrap">{booking.vehicle || "-"}</td>
                        <td className="px-3 py-3 align-middle text-[13px] whitespace-nowrap">{booking.driver || "-"}</td>
                        <td className="max-w-[150px] px-3 py-3 align-middle text-[13px]" title={booking.notes || ""}><span className="block truncate">{booking.notes || "-"}</span></td>
                        <td className="px-3 py-3 align-middle text-[13px] whitespace-nowrap">{booking.modified_by || "-"}</td>
                        <td className="px-3 py-3 align-middle text-[13px] whitespace-nowrap">{formatTime(booking.updated_at, language)}</td>
                        <td className="px-3 py-3 align-middle text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEdit(booking);
                              }}
                              className="table-action-secondary min-h-[36px] gap-1.5 px-2.5"
                              aria-label={copy.editBooking}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteTarget(booking);
                              }}
                              className="table-action-danger min-h-[36px] gap-1.5 px-2.5"
                              aria-label={copy.deleteBooking}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {!modalOpen && !deleteTarget ? (
        <button
          type="button"
          onClick={openCreate}
          className="booking-floating-add"
          aria-label={copy.addBooking}
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : null}

      {modalOpen ? (
        <div className="booking-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,16,46,0.32)] p-0 backdrop-blur-[6px] lg:items-center lg:p-6">
          <div className="booking-sheet max-h-[100dvh] w-full overflow-hidden rounded-t-[1.6rem] border border-brand-100 bg-white shadow-[0_30px_70px_rgba(38,18,78,0.24)] lg:max-h-[96vh] lg:max-w-3xl lg:rounded-[1.6rem]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="badge-muted w-fit">{form.id ? copy.editBooking : copy.addBooking}</p>
                <h3 className="mt-2 truncate text-lg font-semibold text-slate-950">{form.id ? formatDate(form.booking_date, language) : copy.addBooking}</h3>
              </div>
              <button type="button" onClick={closeModal} className="btn-secondary min-h-[42px] w-11 rounded-[1rem] px-0" aria-label={copy.close}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submit} className="booking-sheet-form max-h-[calc(100dvh-88px)] overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 lg:max-h-[calc(96vh-88px)]">
              <div className="booking-form-grid">
                <label className="form-field lg:col-span-1">
                  <span className="form-label form-label-required">{copy.date}</span>
                  <input ref={firstInputRef} required type="date" value={form.booking_date} onChange={(event) => setField("booking_date", event.target.value)} className={inputClass} />
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label">{copy.amountPallets}</span>
                  <input inputMode="decimal" value={form.amount_pallets} onChange={(event) => setField("amount_pallets", event.target.value)} className={inputClass} placeholder="10" />
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label">{copy.weight}</span>
                  <input inputMode="decimal" value={form.weight} onChange={(event) => setField("weight", event.target.value)} className={inputClass} placeholder="1200" />
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label">{copy.dimensions}</span>
                  <input value={form.dimensions} onChange={(event) => setField("dimensions", event.target.value)} className={inputClass} placeholder="L x W x H" />
                </label>
                <label className="form-field lg:col-span-2">
                  <span className="form-label form-label-required">{copy.pickup}</span>
                  <input required value={form.pickup} onChange={(event) => setField("pickup", event.target.value)} className={inputClass} placeholder={copy.pickup} />
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label">{copy.warehouseNo}</span>
                  <input value={form.warehouse_no} onChange={(event) => setField("warehouse_no", event.target.value)} className={inputClass} placeholder="WH / NO" />
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label form-label-required">{copy.dropoff}</span>
                  <input required value={form.dropoff} onChange={(event) => setField("dropoff", event.target.value)} className={inputClass} placeholder={copy.dropoff} />
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label">{copy.vehicle}</span>
                  <input list="booking-vehicles" value={form.vehicle} onChange={(event) => setField("vehicle", event.target.value)} className={inputClass} placeholder={copy.vehicle} />
                  <datalist id="booking-vehicles">{vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle} />)}</datalist>
                </label>
                <label className="form-field lg:col-span-1">
                  <span className="form-label">{copy.driver}</span>
                  <input list="booking-drivers" value={form.driver} onChange={(event) => setField("driver", event.target.value)} className={inputClass} placeholder={copy.driver} />
                  <datalist id="booking-drivers">{driverOptions.map((driver) => <option key={driver} value={driver} />)}</datalist>
                </label>
                <label className="form-field lg:col-span-4">
                  <span className="form-label">{copy.notes}</span>
                  <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} className="form-textarea min-h-[92px] rounded-[1rem]" placeholder={copy.notes} />
                </label>
              </div>

              {error ? <p className="form-error mt-4">{error}</p> : null}

              <div className="booking-sheet-actions">
                <button type="button" onClick={closeModal} className="booking-action-button btn-secondary sm:w-auto">
                  {copy.cancel}
                </button>
                <button type="submit" disabled={saving} className="booking-action-button btn-primary gap-2 sm:w-auto disabled:opacity-70">
                  <Save className="h-4 w-4" />
                  {saving ? copy.saving : form.id ? copy.update : copy.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,16,46,0.32)] p-0 backdrop-blur-[6px] lg:items-center lg:p-6">
          <div className="w-full rounded-t-[1.35rem] border border-rose-100 bg-white p-5 shadow-[0_30px_70px_rgba(38,18,78,0.22)] lg:max-w-md lg:rounded-[1.35rem]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border border-rose-100 bg-rose-50 text-rose-600">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-950">{copy.confirmDeleteTitle}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{copy.confirmDeleteText}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingId)}
                className="btn-secondary min-h-[48px] rounded-[1rem] sm:w-auto"
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={Boolean(deletingId)}
                className="btn-danger min-h-[48px] rounded-[1rem] sm:w-auto disabled:opacity-70"
              >
                {deletingId ? copy.loading : copy.deleteBooking}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
