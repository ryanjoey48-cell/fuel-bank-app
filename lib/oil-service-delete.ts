import type { PostgrestClient } from "@supabase/postgrest-js";
import { normalizeVehicleRegForMatch } from "@/lib/oil-change-service";

export type OilDeleteDiagnostic = {
  projectHost: string;
  userId: string;
  databaseRole: string;
  accountRole: string | null;
  table: "vehicle_service_logs" | "oil_change_history";
  id: string;
};
export class OilServiceDeleteError extends Error {
  constructor(public code: string, message: string, public diagnostic?: OilDeleteDiagnostic) {
    super(diagnostic ? `${message} [${diagnostic.projectHost}; ${diagnostic.table}; id=${diagnostic.id}; database role=${diagnostic.databaseRole}; account role=${diagnostic.accountRole ?? "none"}; user=${diagnostic.userId}]` : message);
    this.name = "OilServiceDeleteError";
  }
}

export function assertOilDeleteAccess(role: string | null, active: boolean) {
  if (!active || !role || !["admin", "office_staff"].includes(role)) {
    throw new OilServiceDeleteError("permission_denied", "Oil-service deletion requires an active admin or office-staff account. Read-only, suspended and driver-only accounts cannot delete service records.");
  }
}

function requestError(error: { message?: string; code?: string }, status: number, diagnostic: OilDeleteDiagnostic): never {
  const message = error.message || "Supabase request failed.";
  if (status === 401 || ["PGRST301", "PGRST302"].includes(error.code ?? "")) throw new OilServiceDeleteError("authentication", `Your session was rejected. Sign in again. ${message}`, diagnostic);
  if (status === 403 || error.code === "42501") throw new OilServiceDeleteError("permission_denied", `Supabase denied table or policy permissions. ${message}`, diagnostic);
  if (status === 0 || /fetch|network|timed out|abort/i.test(message)) throw new OilServiceDeleteError("network", `Network failure: deletion is not verified. Reload history before retrying. ${message}`, diagnostic);
  throw new OilServiceDeleteError("database", `Database rejected the request (${error.code ?? status}). ${message}`, diagnostic);
}

/** Every read and DELETE uses the same verified session-bound client; never retry a mutation. */
export async function deleteVerifiedOilServiceRecord(
  client: Pick<PostgrestClient, "from">,
  diagnostic: OilDeleteDiagnostic,
  expectedRegistration: string
) {
  const { table, id } = diagnostic;
  if (table === "vehicle_service_logs" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new OilServiceDeleteError("invalid_id", "The selected service primary key is not a UUID. Reload service history; no DELETE was sent.", diagnostic);
  }
  const before = await client.from(table).select("*").eq("id", id).maybeSingle();
  if (before.error) requestError(before.error, before.status, diagnostic);
  if (!before.data) throw new OilServiceDeleteError("not_visible", "The selected primary key is absent or hidden by SELECT RLS for this session. No DELETE was sent.", diagnostic);
  const key = (value: string) => normalizeVehicleRegForMatch(value).replace(/-/g, "");
  if (String(before.data.id) !== id || key(before.data.vehicle_reg) !== key(expectedRegistration)
    || (table === "vehicle_service_logs" && before.data.service_type && before.data.service_type !== "oil_change")) {
    throw new OilServiceDeleteError("row_mismatch", "The selected record does not match this vehicle's oil-service history. No DELETE was sent.", diagnostic);
  }
  const result = await client.from(table).delete().eq("id", id).select("id");
  if (result.error) requestError(result.error, result.status, diagnostic);
  if (Array.isArray(result.data) && result.data.length === 1 && String(result.data[0]?.id) === id) return before.data;
  if (Array.isArray(result.data) && result.data.length > 0) throw new OilServiceDeleteError("unverified_delete", "Supabase returned unexpected affected-row identifiers. Deletion cannot be verified; reload history.", diagnostic);
  const after = await client.from(table).select("id").eq("id", id).maybeSingle();
  if (after.error) requestError(after.error, after.status, diagnostic);
  if (after.data) throw new OilServiceDeleteError("rls_blocked", "DELETE matched zero eligible rows: the exact primary key was visible before the request and still exists afterward. DELETE RLS (including restrictive policies) or a suppressing BEFORE DELETE trigger blocked this record. No deletion was verified.", diagnostic);
  throw new OilServiceDeleteError("unverified_delete", "DELETE returned zero rows and the record is now absent or hidden. Concurrent removal or RETURNING/SELECT visibility cannot be distinguished safely; deletion was not verified. Reload history.", diagnostic);
}
