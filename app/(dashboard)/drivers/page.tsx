"use client";

import {
  AlertTriangle,
  CarFront,
  Download,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  UserCheck,
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import {
  DRIVER_VEHICLE_TYPE_OPTIONS,
  getDriverVehicleTypeLabel
} from "@/lib/driver-vehicle-types";
import { deleteDriver, fetchDriverDirectory, saveDriver } from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { formatNumber } from "@/lib/utils";
import type { Driver, DriverVehicleType } from "@/types/database";

const initialForm = {
  id: "",
  name: "",
  vehicle_reg: "",
  vehicle_model: "",
  vehicle_type: "" as DriverVehicleType | "",
  active: true
};

type SortMode = "name-asc" | "name-desc" | "reg-asc" | "type-asc";

type MenuState = string | null;

export default function DriversPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<DriverVehicleType | "all" | "missing">("all");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [formOpen, setFormOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<MenuState>(null);

  const copy =
    language === "th"
      ? {
          eyebrow: "การจัดการคนขับ",
          title: "คนขับและรถประจำ",
          description: "จัดการคนขับ ทะเบียนรถ ประเภทรถ และสถานะจากจุดเดียว",
          active: "ใช้งาน",
          inactive: "ไม่ใช้งาน",
          assigned: "มีรถประจำ",
          unassigned: "ยังไม่กำหนดรถ",
          missingType: "ไม่มีประเภทรถ",
          search: "ค้นหาชื่อคนขับหรือทะเบียนรถ",
          allStatuses: "ทุกสถานะ",
          allTypes: "ทุกประเภทรถ",
          sortName: "ชื่อ A–Z",
          sortNameDesc: "ชื่อ Z–A",
          sortReg: "ทะเบียนรถ",
          sortType: "ประเภทรถ",
          add: "เพิ่มคนขับ",
          directory: "รายชื่อคนขับ",
          directoryHelp: "ข้อมูลนี้เป็นแหล่งอ้างอิงหลักสำหรับคนขับ รถ และประเภทรถในระบบ",
          results: "รายการ",
          clear: "ล้างตัวกรอง",
          actions: "การทำงาน",
          vehicleDetails: "รถที่กำหนด",
          number: "ลำดับ",
          registration: "ทะเบียน",
          model: "รุ่น",
          vehicleType: "ประเภทรถ",
          status: "สถานะ",
          edit: "แก้ไข",
          modalAddHelp: "เพิ่มคนขับและกำหนดรถที่ใช้งานประจำ",
          modalEditHelp: "แก้ไขข้อมูลคนขับและรถโดยไม่กระทบประวัติเดิม",
          total: "คนขับทั้งหมด",
          totalHelp: "รวมคนขับทั้งที่ใช้งานและไม่ใช้งาน",
          activeDrivers: "คนขับที่ใช้งาน",
          activeHelp: "พร้อมใช้งานในงานปัจจุบัน",
          vehicles: "รถที่กำหนด",
          vehiclesHelp: "ทะเบียนรถที่ไม่ซ้ำซึ่งผูกกับคนขับที่ใช้งาน",
          attention: "ต้องตรวจสอบ",
          attentionHelp: "ข้อมูลประเภทรถที่ยังไม่ครบ"
        }
      : {
          eyebrow: "DRIVER CONTROL",
          title: "Drivers & vehicle assignments",
          description: "Manage drivers, assigned registrations, vehicle types and status from one clean directory.",
          active: "Active",
          inactive: "Inactive",
          assigned: "Assigned vehicle",
          unassigned: "Unassigned",
          missingType: "Missing vehicle type",
          search: "Search driver name or vehicle registration",
          allStatuses: "All statuses",
          allTypes: "All vehicle types",
          sortName: "Driver A–Z",
          sortNameDesc: "Driver Z–A",
          sortReg: "Vehicle registration",
          sortType: "Vehicle type",
          add: "+ Add driver",
          directory: "Driver directory",
          directoryHelp: "The source of truth for driver, vehicle registration and vehicle type across operations.",
          results: "drivers shown",
          clear: "Clear filters",
          actions: "Actions",
          vehicleDetails: "Vehicle assignment",
          number: "No.",
          registration: "Registration",
          model: "Model",
          vehicleType: "Vehicle type",
          status: "Status",
          edit: "Edit driver",
          modalAddHelp: "Add a driver and assign the vehicle they currently operate.",
          modalEditHelp: "Update the current driver record while keeping historical operational records intact.",
          total: "Total drivers",
          totalHelp: "Active and inactive records in the directory",
          activeDrivers: "Active drivers",
          activeHelp: "Available for current operational work",
          vehicles: "Assigned vehicles",
          vehiclesHelp: "Unique registrations linked to active drivers",
          attention: "Needs attention",
          attentionHelp: "Driver records missing a vehicle type"
        };

  const actionMessages =
    language === "th"
      ? {
          saved: "บันทึกคนขับเรียบร้อยแล้ว",
          updated: "อัปเดตคนขับเรียบร้อยแล้ว",
          deleted: "ลบคนขับเรียบร้อยแล้ว"
        }
      : {
          saved: "Driver saved successfully.",
          updated: "Driver updated successfully.",
          deleted: "Driver deleted successfully."
        };

  const isEditing = Boolean(form.id);

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.active !== false).length,
    [drivers]
  );

  const uniqueVehiclesAssigned = useMemo(
    () =>
      new Set(
        drivers
          .filter((driver) => driver.active !== false)
          .map((driver) => driver.vehicle_reg.trim())
          .filter(Boolean)
      ).size,
    [drivers]
  );

  const driversMissingVehicleType = useMemo(
    () => drivers.filter((driver) => !driver.vehicle_type).length,
    [drivers]
  );

  const filteredDrivers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = drivers.filter((driver) => {
      const typeLabel = getDriverVehicleTypeLabel(driver.vehicle_type) || "";
      const matchesQuery =
        !query ||
        driver.name.toLowerCase().includes(query) ||
        driver.vehicle_reg.toLowerCase().includes(query) ||
        String((driver as Driver & { vehicle_model?: string | null }).vehicle_model || "").toLowerCase().includes(query) ||
        typeLabel.toLowerCase().includes(query);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && driver.active !== false) ||
        (statusFilter === "inactive" && driver.active === false);

      const matchesVehicleType =
        vehicleTypeFilter === "all" ||
        (vehicleTypeFilter === "missing" && !driver.vehicle_type) ||
        driver.vehicle_type === vehicleTypeFilter;

      return matchesQuery && matchesStatus && matchesVehicleType;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "name-desc") return b.name.localeCompare(a.name);
      if (sortMode === "reg-asc") return a.vehicle_reg.localeCompare(b.vehicle_reg, undefined, { numeric: true });
      if (sortMode === "type-asc") {
        return (getDriverVehicleTypeLabel(a.vehicle_type) || "zzzz").localeCompare(
          getDriverVehicleTypeLabel(b.vehicle_type) || "zzzz"
        );
      }
      return a.name.localeCompare(b.name);
    });
  }, [drivers, searchQuery, sortMode, statusFilter, vehicleTypeFilter]);

  const hasFilters =
    Boolean(searchQuery.trim()) ||
    statusFilter !== "all" ||
    vehicleTypeFilter !== "all" ||
    sortMode !== "name-asc";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setPageNotice(null);
      setDrivers(await fetchDriverDirectory({ includeInactive: true }));
    } catch (err) {
      console.error("Drivers load error:", err);
      setPageNotice(t.drivers.loadPartial);
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, [t.drivers.loadPartial]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleDataChanged = () => void load();
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [load]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  const resetForm = (clearMessages = true) => {
    setForm(initialForm);
    setError(null);
    if (clearMessages) setSuccessMessage(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    resetForm();
  };

  const openAddDriver = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditDriver = (driver: Driver) => {
    setForm({
      id: String(driver.id),
      name: driver.name,
      vehicle_reg: driver.vehicle_reg,
      vehicle_model: (driver as Driver & { vehicle_model?: string | null }).vehicle_model ?? "",
      vehicle_type: driver.vehicle_type ?? "",
      active: driver.active
    });
    setError(null);
    setSuccessMessage(null);
    setOpenMenuId(null);
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const wasEditing = Boolean(form.id);
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await saveDriver({
        id: form.id || undefined,
        name: form.name.trim(),
        vehicle_reg: form.vehicle_reg.trim(),
        vehicle_model: form.vehicle_model.trim() || null,
        vehicle_type: form.vehicle_type || null,
        active: form.active
      } as Parameters<typeof saveDriver>[0] & { vehicle_model?: string | null });

      setSuccessMessage(wasEditing ? actionMessages.updated : actionMessages.saved);
      setFormOpen(false);
      resetForm(false);
      await load();
    } catch (err) {
      console.error("Drivers submit error:", err);
      if (err instanceof Error && err.message === "DUPLICATE_DRIVER_NAME") {
        setError(t.drivers.duplicateDriverName);
      } else if (err instanceof Error && err.message === "DUPLICATE_DRIVER_VEHICLE") {
        setError(t.drivers.duplicateVehicleAssignment);
      } else if (err instanceof Error && err.message === "VALIDATION_DRIVER_VEHICLE_TYPE_REQUIRED") {
        setError(t.drivers.vehicleTypeRequired);
      } else if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError(t.drivers.unableToSaveDriver);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    applyRequiredValidationMessage(event, t.common.requiredField);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.drivers.confirmDelete)) return;

    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteDriver(id);
      if (form.id === id) resetForm();
      setSuccessMessage(actionMessages.deleted);
      setOpenMenuId(null);
      await load();
    } catch (err) {
      console.error("Drivers delete error:", err);
      setError(err instanceof Error && err.message ? err.message : t.drivers.unableToDeleteDriver);
    } finally {
      setDeletingId(null);
    }
  };

  const exportDrivers = () => {
    exportToXlsx(
      drivers.map((driver) => ({
        [t.drivers.name]: driver.name,
        [t.drivers.vehicle]: driver.vehicle_reg,
        [language === "th" ? "รุ่น" : "Model"]: (driver as Driver & { vehicle_model?: string | null }).vehicle_model || "",
        [t.drivers.vehicleType]: driver.vehicle_type ? getDriverVehicleTypeLabel(driver.vehicle_type) : "",
        [t.drivers.status]: driver.active === false ? t.drivers.inactive : t.drivers.active
      })),
      "drivers-report",
      "Drivers"
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setVehicleTypeFilter("all");
    setSortMode("name-asc");
  };

  return (
    <>
      <section className="surface-card mb-5 overflow-hidden px-6 py-6 sm:px-8 lg:px-9">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              EXPERT EXPRESS SENDER CO., LTD.
            </p>
            <h1 className="mt-2 text-[1.85rem] font-semibold tracking-[-0.035em] text-slate-950 sm:text-[2rem]">
              {copy.title}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{copy.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportDrivers}
              disabled={!drivers.length}
              className="btn-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {t.common.export}
            </button>
            <button type="button" onClick={openAddDriver} className="btn-primary gap-2 px-4">
              <Plus className="h-4 w-4" />
              {language === "th" ? "เพิ่มคนขับ" : "Add driver"}
            </button>
          </div>
        </div>
      </section>

      {successMessage ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      {pageNotice ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pageNotice}
        </div>
      ) : null}

      <section className="surface-card mb-5 overflow-hidden">
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="metric-label">{copy.total}</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {formatNumber(drivers.length, language)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{copy.totalHelp}</p>
              </div>
              <span className="rounded-2xl bg-violet-50 p-2.5 text-violet-600">
                <Users className="h-4 w-4" />
              </span>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="metric-label">{copy.activeDrivers}</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {formatNumber(activeDrivers, language)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{copy.activeHelp}</p>
              </div>
              <span className="rounded-2xl bg-emerald-50 p-2.5 text-emerald-600">
                <UserCheck className="h-4 w-4" />
              </span>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="metric-label">{copy.vehicles}</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {formatNumber(uniqueVehiclesAssigned, language)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{copy.vehiclesHelp}</p>
              </div>
              <span className="rounded-2xl bg-sky-50 p-2.5 text-sky-600">
                <CarFront className="h-4 w-4" />
              </span>
            </div>
          </div>

          <div className={`px-5 py-5 sm:px-6 ${driversMissingVehicleType ? "bg-amber-50/45" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="metric-label">{copy.attention}</p>
                <p className={`mt-2 text-3xl font-semibold tracking-[-0.04em] ${driversMissingVehicleType ? "text-amber-700" : "text-slate-950"}`}>
                  {formatNumber(driversMissingVehicleType, language)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{copy.attentionHelp}</p>
              </div>
              <span className={`rounded-2xl p-2.5 ${driversMissingVehicleType ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                <AlertTriangle className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card overflow-visible">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6 lg:px-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                {copy.eyebrow}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <h2 className="section-title">{copy.directory}</h2>
                <span className="badge-muted px-2.5 py-1 text-[11px]">
                  {formatNumber(filteredDrivers.length, language)} {copy.results}
                </span>
              </div>
              <p className="section-subtitle mt-1.5 max-w-3xl">{copy.directoryHelp}</p>
            </div>

            {hasFilters ? (
              <button type="button" onClick={clearFilters} className="text-sm font-medium text-violet-600 hover:text-violet-700">
                {copy.clear}
              </button>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.3fr)_minmax(180px,.7fr)_minmax(210px,.8fr)_minmax(210px,.8fr)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={copy.search}
                className="form-input w-full bg-white pl-10"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}
              className="form-input w-full bg-white"
            >
              <option value="all">{copy.allStatuses}</option>
              <option value="active">{copy.active}</option>
              <option value="inactive">{copy.inactive}</option>
            </select>

            <select
              value={vehicleTypeFilter}
              onChange={(event) => setVehicleTypeFilter(event.target.value as DriverVehicleType | "all" | "missing")}
              className="form-input w-full bg-white"
            >
              <option value="all">{copy.allTypes}</option>
              <option value="missing">{copy.missingType}</option>
              {DRIVER_VEHICLE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="form-input w-full bg-white"
            >
              <option value="name-asc">{copy.sortName}</option>
              <option value="name-desc">{copy.sortNameDesc}</option>
              <option value="reg-asc">{copy.sortReg}</option>
              <option value="type-asc">{copy.sortType}</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-500">{t.drivers.loadingDrivers}</p>
        ) : filteredDrivers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={drivers.length === 0 ? t.drivers.noDriversYet : t.drivers.searchDrivers}
              description={drivers.length === 0 ? t.drivers.noDriversDescription : t.drivers.noSearchResults}
            />
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4 md:hidden">
              {filteredDrivers.map((driver) => {
                const missingVehicleType = !driver.vehicle_type;
                return (
                  <article
                    key={driver.id}
                    className={`rounded-2xl border bg-white p-4 shadow-sm ${missingVehicleType ? "border-amber-200" : "border-slate-200"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-slate-950">{driver.name}</p>
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${driver.active === false ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                            {driver.active === false ? copy.inactive : copy.active}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-700">{driver.vehicle_reg || copy.unassigned}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {(driver as Driver & { vehicle_model?: string | null }).vehicle_model || (language === "th" ? "ยังไม่บันทึกรุ่นรถ" : "Model not recorded")}
                        </p>
                        <p className={`mt-1 text-xs ${missingVehicleType ? "font-medium text-amber-700" : "text-slate-500"}`}>
                          {driver.vehicle_type ? getDriverVehicleTypeLabel(driver.vehicle_type) : copy.missingType}
                        </p>
                      </div>
                      <button type="button" onClick={() => openEditDriver(driver)} className="btn-secondary px-3 py-2 text-xs">
                        {t.common.edit}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden md:block">
              <div className="table-scroll overflow-visible">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-violet-50/90 text-slate-600 backdrop-blur">
                      <th className="table-head-cell w-[72px] text-left tracking-[0.12em]">{copy.number}</th>
                      <th className="table-head-cell text-left tracking-[0.12em]">{t.drivers.name}</th>
                      <th className="table-head-cell text-left tracking-[0.12em]">{copy.registration}</th>
                      <th className="table-head-cell text-left tracking-[0.12em]">{copy.model}</th>
                      <th className="table-head-cell text-left tracking-[0.12em]">{copy.vehicleType}</th>
                      <th className="table-head-cell text-left tracking-[0.12em]">{copy.status}</th>
                      <th className="table-head-cell w-[92px] text-right tracking-[0.12em]">{copy.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrivers.map((driver, index) => {
                      const missingVehicleType = !driver.vehicle_type;
                      const id = String(driver.id);
                      const vehicleModel = (driver as Driver & { vehicle_model?: string | null }).vehicle_model?.trim();

                      return (
                        <tr key={driver.id} className={`enterprise-table-row transition-colors hover:bg-violet-50/35 ${missingVehicleType ? "bg-amber-50/25" : ""}`}>
                          <td className="table-body-cell py-3.5">
                            <span className="text-xs font-semibold tabular-nums text-slate-400">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </td>

                          <td className="table-body-cell py-3.5">
                            <p className="text-[15px] font-semibold tracking-[-0.01em] text-slate-950">{driver.name}</p>
                          </td>

                          <td className="table-body-cell py-3.5">
                            <p className="text-[15px] font-semibold tabular-nums text-slate-900">{driver.vehicle_reg || copy.unassigned}</p>
                          </td>

                          <td className="table-body-cell py-3.5">
                            <p className={`text-sm ${vehicleModel ? "font-medium text-slate-700" : "text-slate-400"}`}>
                              {vehicleModel || (language === "th" ? "ยังไม่บันทึก" : "Not recorded")}
                            </p>
                          </td>

                          <td className="table-body-cell py-3.5">
                            <p className={`text-sm ${missingVehicleType ? "font-medium text-amber-700" : "text-slate-600"}`}>
                              {driver.vehicle_type ? getDriverVehicleTypeLabel(driver.vehicle_type) : copy.missingType}
                            </p>
                          </td>

                          <td className="table-body-cell">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${driver.active === false ? "border-slate-200 bg-slate-50 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                                {driver.active === false ? copy.inactive : copy.active}
                              </span>
                              {missingVehicleType ? (
                                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                                  {copy.missingType}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="table-body-cell text-right">
                            <div className="relative inline-flex">
                              <button
                                type="button"
                                aria-label={copy.actions}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenMenuId((current) => (current === id ? null : id));
                                }}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-violet-200 hover:text-violet-700"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>

                              {openMenuId === id ? (
                                <div
                                  onClick={(event) => event.stopPropagation()}
                                  className="absolute right-0 top-11 z-30 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 text-left shadow-xl"
                                >
                                  <button
                                    type="button"
                                    onClick={() => openEditDriver(driver)}
                                    className="flex w-full items-center rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                  >
                                    {copy.edit}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDelete(id)}
                                    disabled={deletingId === driver.id}
                                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {deletingId === driver.id ? t.common.deleting : t.common.delete}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {formOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-white/60 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 sm:px-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                  {isEditing ? (language === "th" ? "แก้ไขข้อมูล" : "EDIT DRIVER") : (language === "th" ? "เพิ่มข้อมูล" : "NEW DRIVER")}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                  {isEditing ? t.drivers.editDriver : t.drivers.addDriver}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{isEditing ? copy.modalEditHelp : copy.modalAddHelp}</p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submit} className="p-6 sm:p-7">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="form-field sm:col-span-2">
                  <label className="form-label form-label-required">{t.drivers.name}</label>
                  <input
                    required
                    autoFocus
                    placeholder={t.drivers.name}
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    onInvalid={handleInvalid}
                    onInput={clearValidationMessage}
                    className="form-input w-full"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">{t.drivers.vehicle}</label>
                  <input
                    placeholder={t.drivers.vehiclePlaceholder}
                    value={form.vehicle_reg}
                    onChange={(event) => setForm((current) => ({ ...current, vehicle_reg: event.target.value }))}
                    onInput={clearValidationMessage}
                    className="form-input w-full"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">{language === "th" ? "รุ่นรถ" : "Vehicle model"}</label>
                  <input
                    placeholder={language === "th" ? "เช่น HINO 500, Hilux Revo" : "e.g. HINO 500, Hilux Revo"}
                    value={form.vehicle_model}
                    onChange={(event) => setForm((current) => ({ ...current, vehicle_model: event.target.value }))}
                    onInput={clearValidationMessage}
                    className="form-input w-full"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label form-label-required">{t.drivers.vehicleType}</label>
                  <select
                    required
                    value={form.vehicle_type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        vehicle_type: event.target.value as DriverVehicleType | ""
                      }))
                    }
                    onInvalid={handleInvalid}
                    onInput={clearValidationMessage}
                    className="form-input w-full bg-white"
                  >
                    <option value="">{t.drivers.selectVehicleType}</option>
                    {DRIVER_VEHICLE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="sm:col-span-2 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="block font-semibold text-slate-900">{t.drivers.activeDriver}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {language === "th"
                        ? "ปิดเมื่อคนขับออกจากงาน ประวัติเดิมยังคงชื่อคนขับที่บันทึกไว้"
                        : "Turn this off when a driver leaves. Historical records keep the saved driver name."}
                    </span>
                  </span>
                </label>
              </div>

              {error ? <p className="form-error mt-4">{error}</p> : null}

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeForm} className="btn-secondary sm:min-w-[110px]">
                  {t.common.cancel}
                </button>
                <button type="submit" disabled={saving} className="btn-primary sm:min-w-[150px] disabled:opacity-70">
                  {saving ? t.common.saving : isEditing ? t.drivers.updateDriver : t.drivers.saveDriver}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
