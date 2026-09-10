import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import {
  normalizeComparisonText,
  reconcileAugustJobs,
  stableFingerprint,
  type AugustBossJobRow,
  type AugustBookingRow,
  type AugustJobStatus,
  type DriverAssignmentRow
} from "@/lib/august-job-reconciliation";

type SheetRow = Record<string, unknown>;

const BOOKING_SELECT = [
  "id",
  "booking_id",
  "booking_date",
  "pickup_time",
  "client_id",
  "client:clients(id,name,active)",
  "pickup",
  "dropoff",
  "pickup_address",
  "dropoff_address",
  "warehouse_no",
  "vehicle",
  "vehicle_registration",
  "trailer_registration",
  "driver",
  "job_order_number",
  "notes",
  "created_by",
  "created_by_user_id",
  "modified_by",
  "created_at",
  "updated_at"
].join(",");

function text(row: SheetRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function dateText(value: unknown) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(value.getTime() + 10_000));
  }
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

async function workbookRows(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<SheetRow>(firstSheet, { defval: "", raw: true });
}

function parseBossRows(rows: SheetRow[]): AugustBossJobRow[] {
  return rows.map((row, index) => ({
    sourceRowNumber: index + 2,
    date: dateText(row.Date ?? row.date),
    client: text(row, ["Client", "Client name"]),
    pickup: text(row, ["PICK UP", "Pickup", "Pickup Display Name"]),
    dropoff: text(row, ["DROP PFF", "DROP OFF", "Dropoff", "Dropoff Display Name"]),
    vehicleType: text(row, ["JOB", "Vehicle", "Vehicle Type"]),
    registrationCell: text(row, ["REG NO.", "REG NO", "Vehicle Registration"]),
    driver: text(row, ["DRIVER", "Driver"]),
    jobOrderNumber: text(row, ["JON NO.", "JON NO", "Job Order Number", "Warehouse / NO"]),
    pickupTime: text(row, ["Pickup Time"]),
    notes: text(row, ["Notes", "Notes Section"])
  })).filter((row) => row.date && row.pickup && row.dropoff);
}

function parseDriverRows(rows: SheetRow[]): DriverAssignmentRow[] {
  return rows.map((row) => ({
    name: text(row, ["Driver name", "DRIVER", "Driver"]),
    vehicleRegistration: text(row, ["Vehicle registration", "REG NO.", "Vehicle Registration"]),
    vehicleType: text(row, ["Vehicle Type", "JOB"])
  })).filter((row) => row.name);
}

async function fetchAugustBookings(admin: Awaited<ReturnType<typeof requireAdminAccess>>["admin"]) {
  const { data, error } = await admin
    .from("booking_diary")
    .select(BOOKING_SELECT)
    .gte("booking_date", "2026-08-01")
    .lte("booking_date", "2026-08-07")
    .order("booking_date", { ascending: true })
    .order("pickup_time", { ascending: true, nullsFirst: false });
  if (error) throw new AdminApiError(500, error.message || "Unable to load Booking Diary rows.");
  return (data ?? []) as unknown as AugustBookingRow[];
}

function sourceKey(fileMeta: Array<{ name: string; size: number; lastModified: number }>) {
  return `august-2026-01-07:${stableFingerprint(JSON.stringify(fileMeta))}`;
}

function statusSummary(items: Array<{ status: AugustJobStatus }>) {
  return items.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
    summary.total += 1;
    return summary;
  }, { total: 0 } as Record<string, number>);
}

export async function POST(request: Request) {
  try {
    const { admin, user, access } = await requireAdminAccess(request);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const bossFile = formData.get("bossFile");
      const bookingFile = formData.get("bookingFile");
      const driversFile = formData.get("driversFile");
      if (!(bossFile instanceof File) || !(bookingFile instanceof File) || !(driversFile instanceof File)) {
        throw new AdminApiError(400, "Boss, Booking Diary, and Drivers Excel files are required.");
      }

      const [bossRows, bookingExportRows, driverRows] = await Promise.all([
        workbookRows(bossFile),
        workbookRows(bookingFile),
        workbookRows(driversFile)
      ]);
      const bookings = await fetchAugustBookings(admin);
      const parsedBossRows = parseBossRows(bossRows);
      const parsedDrivers = parseDriverRows(driverRows);
      const reconciliation = reconcileAugustJobs({
        bossRows: parsedBossRows,
        bookingRows: bookings,
        driverRows: parsedDrivers
      });
      const files = [bossFile, bookingFile, driversFile].map((file) => ({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified
      }));
      const key = sourceKey(files);
      const fingerprint = stableFingerprint(JSON.stringify({ files, bossRows: parsedBossRows.length, bookingExportRows: bookingExportRows.length, driverRows: parsedDrivers.length }));

      const { data: batch, error: batchError } = await admin
        .from("booking_diary_import_batches")
        .upsert({
          source_key: key,
          import_name: "August Job Reconciliation 2026-08-01 to 2026-08-07",
          source_fingerprint: fingerprint,
          status: "preview",
          source_files: files,
          summary: { ...reconciliation.summary, booking_export_rows: bookingExportRows.length, live_booking_rows: bookings.length },
          created_by_user_id: user.id,
          created_by: access.displayName
        }, { onConflict: "source_key" })
        .select("id,source_key,summary,created_at")
        .single();
      if (batchError) throw new AdminApiError(503, batchError.message || "Apply the reconciliation migration before previewing.");

      const rows = reconciliation.items.map((item) => ({
        batch_id: batch.id,
        row_fingerprint: item.sourceFingerprint,
        source_row_number: item.sourceRowNumber,
        status: item.status,
        confidence: item.confidence,
        reason: item.reason,
        evidence: item.evidence,
        boss_row: item.bossRow,
        existing_booking_id: item.existingBooking?.id ?? null,
        proposed_values: item.proposedValues
      }));
      if (rows.length) {
        const { error: itemError } = await admin
          .from("booking_diary_import_items")
          .upsert(rows, { onConflict: "batch_id,row_fingerprint" });
        if (itemError) throw new AdminApiError(500, itemError.message || "Unable to store preview items.");
      }

      return NextResponse.json({
        batch,
        summary: { ...reconciliation.summary, bookingExportRows: bookingExportRows.length, liveBookingRows: bookings.length },
        items: reconciliation.items
      });
    }

    const body = await request.json().catch(() => ({})) as {
      action?: "apply";
      batchId?: string;
      approvals?: Array<{
        rowFingerprint: string;
        approved: boolean;
        mode: "update_existing" | "new_job" | "reject";
        existingBookingId?: string | null;
        vehicleRegistration?: string | null;
        trailerRegistration?: string | null;
      }>;
    };
    if (body.action !== "apply" || !body.batchId) throw new AdminApiError(400, "A batch ID and apply action are required.");

    const approvals = new Map((body.approvals ?? []).map((approval) => [approval.rowFingerprint, approval]));
    const { data: items, error: itemsError } = await admin
      .from("booking_diary_import_items")
      .select("id,row_fingerprint,status,boss_row,existing_booking_id,proposed_values,applied_booking_id")
      .eq("batch_id", body.batchId);
    if (itemsError) throw new AdminApiError(500, itemsError.message || "Unable to load import items.");

    const summary = { updated: 0, inserted: 0, skipped: 0, failed: 0, failures: [] as string[] };
    for (const item of (items ?? []) as Array<Record<string, any>>) {
      const approval = approvals.get(item.row_fingerprint);
      if (!approval?.approved || approval.mode === "reject" || item.applied_booking_id) {
        summary.skipped += 1;
        continue;
      }
      const proposed = item.proposed_values ?? {};
      const vehicleRegistration = approval.vehicleRegistration ?? proposed.vehicle_registration ?? null;
      const trailerRegistration = approval.trailerRegistration ?? proposed.trailer_registration ?? null;
      try {
        if (approval.mode === "update_existing") {
          if (!["exact_match", "probable_match"].includes(String(item.status))) throw new Error("Only reviewed matches can update existing bookings.");
          const bookingId = approval.existingBookingId || item.existing_booking_id;
          if (!bookingId) throw new Error("Existing Booking Diary row is required.");
          const { error } = await admin
            .from("booking_diary")
            .update({
              vehicle_registration: vehicleRegistration,
              trailer_registration: trailerRegistration,
              modified_by: access.displayName
            })
            .eq("id", bookingId);
          if (error) throw error;
          await admin.from("booking_diary_import_items").update({
            approval_status: "approved",
            approved_by_user_id: user.id,
            approved_by: access.displayName,
            applied_booking_id: bookingId,
            applied_at: new Date().toISOString()
          }).eq("id", item.id);
          summary.updated += 1;
        } else if (approval.mode === "new_job") {
          if (item.status !== "new_job") throw new Error("Only rows classified as new jobs can be inserted.");
          const boss = item.boss_row ?? {};
          const clientName = normalizeComparisonText(boss.client);
          const { data: clients } = await admin.from("clients").select("id,name");
          const client = (clients ?? []).find((candidate: any) => normalizeComparisonText(candidate.name) === clientName);
          if (!client?.id) throw new Error("Client must exist before adding this job.");
          const { data: inserted, error } = await admin.from("booking_diary").insert({
            client_id: client.id,
            booking_date: boss.date,
            pickup_time: boss.pickupTime || null,
            pickup: boss.pickup,
            dropoff: boss.dropoff,
            vehicle: proposed.vehicle,
            vehicle_registration: vehicleRegistration,
            trailer_registration: trailerRegistration,
            driver: proposed.driver,
            job_order_number: proposed.job_order_number,
            notes: boss.notes || null,
            created_by_user_id: user.id,
            created_by: access.displayName,
            modified_by: access.displayName
          }).select("id").single();
          if (error) throw error;
          await admin.from("booking_diary_import_items").update({
            approval_status: "approved",
            approved_by_user_id: user.id,
            approved_by: access.displayName,
            applied_booking_id: inserted.id,
            applied_at: new Date().toISOString()
          }).eq("id", item.id);
          summary.inserted += 1;
        }
      } catch (caught) {
        summary.failed += 1;
        summary.failures.push(`Row ${item.row_fingerprint}: ${caught instanceof Error ? caught.message : "failed"}`);
      }
    }
    await admin.from("booking_diary_import_batches").update({
      status: summary.failed ? "partially_applied" : "applied",
      summary,
      approved_by_user_id: user.id,
      approved_by: access.displayName,
      approved_at: new Date().toISOString()
    }).eq("id", body.batchId);

    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to reconcile August jobs." }, { status: 500 });
  }
}
