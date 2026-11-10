import "server-only";
import type { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";

type Admin = ReturnType<typeof createServerSupabaseAdmin>;

function missingTable(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = String(value?.code ?? "");
  const message = String(value?.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205"
    || message.includes("does not exist") || message.includes("could not find the table");
}

export async function loadEesDirectoryForForthImport(admin: Admin) {
  const locations: Array<{
    id: string; company_name: string; thai_name: string | null; alternative_names: string[] | null;
    address: string; province: string | null; destination_type: string | null; source_info: string | null;
    google_maps_url: string | null; verification_status: string | null;
  }> = [];
  const pins: Array<{ location_id: string; latitude: number; longitude: number; pin_type: string; pin_status: string }> = [];
  let pinStorageReady = true;
  const pageSize = 500;
  for (let offset = 0; offset <= 10_000; offset += pageSize) {
    const { data, error } = await admin.from("ees_locations")
      .select("id,company_name,thai_name,alternative_names,address,province,destination_type,source_info,google_maps_url,verification_status")
      .order("company_name").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    locations.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
    if (offset === 10_000) throw new Error("Location Directory exceeds the safe request bound.");
  }
  for (let offset = 0; offset <= 10_000; offset += pageSize) {
    const { data, error } = await admin.from("ees_location_map_pins")
      .select("location_id,latitude,longitude,pin_type,pin_status")
      .eq("pin_type", "destination").eq("pin_status", "manual_confirmed")
      .order("location_id").range(offset, offset + pageSize - 1);
    if (error) {
      if (missingTable(error)) {
        pinStorageReady = false;
        break;
      }
      throw error;
    }
    pins.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
    if (offset === 10_000) throw new Error("Confirmed pin count exceeds the safe request bound.");
  }
  return { locations, pins, pinStorageReady, missingTable };
}

export { missingTable };
