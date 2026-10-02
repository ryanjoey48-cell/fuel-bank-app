import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { ManagedDriverAccountResult } from "@/lib/account-management";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";

export const dynamic = "force-dynamic";

type DriverRow = { id: number; name: string; vehicle_reg: string | null; vehicle_type: string | null; active: boolean };
type AccountRow = { id: string; auth_user_id: string; driver_id: number; active: boolean; created_at: string };

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    // Page through both tables so the Supabase row cap cannot silently omit drivers.
    async function readAll<T>(table: "drivers" | "driver_accounts", columns: string) {
      const rows: T[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await admin.from(table).select(columns).order("id").range(offset, offset + 499).returns<T[]>();
        if (error || !Array.isArray(data)) throw new AdminApiError(503, "Unable to load driver accounts. Refresh to try again.");
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    }
    const [drivers, accounts] = await Promise.all([
      readAll<DriverRow>("drivers", "id,name,vehicle_reg,vehicle_type,active"),
      readAll<AccountRow>("driver_accounts", "id,auth_user_id,driver_id,active,created_at")
    ]);
    const accountsByDriver = new Map(accounts.map((row) => [String(row.driver_id), row]));
    const authIds = [...new Set(accounts.map((row) => String(row.auth_user_id)))];
    const authUsers = new Map<string, User>();
    // Bound Auth API concurrency without a sequential lookup waterfall.
    for (let offset = 0; offset < authIds.length; offset += 10) {
      await Promise.all(authIds.slice(offset, offset + 10).map(async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error || !data.user) throw new AdminApiError(503, "Unable to load driver login details. Refresh to try again.");
        authUsers.set(id, data.user);
      }));
    }
    const result: ManagedDriverAccountResult = {
      drivers: drivers.map((driver) => {
        const account = accountsByDriver.get(String(driver.id));
        const user = account ? authUsers.get(String(account.auth_user_id)) : undefined;
        return {
          driverId: String(driver.id), name: String(driver.name ?? ""),
          vehicleRegistration: driver.vehicle_reg ?? null, vehicleType: driver.vehicle_type ?? null,
          driverActive: driver.active === true,
          accountId: account ? String(account.id) : null,
          authUserId: account ? String(account.auth_user_id) : null,
          accountActive: account ? account.active === true : null,
          email: user?.email ?? null, emailConfirmedAt: user?.email_confirmed_at ?? null,
          lastSignInAt: user?.last_sign_in_at ?? null, accountCreatedAt: account?.created_at ?? null
        };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      summary: { total: 0, activeDrivers: 0, withAccount: 0, withoutAccount: 0, activeAccounts: 0 }
    };
    result.summary = {
      total: result.drivers.length,
      activeDrivers: result.drivers.filter((row) => row.driverActive).length,
      withAccount: result.drivers.filter((row) => row.accountId !== null).length,
      withoutAccount: result.drivers.filter((row) => row.accountId === null).length,
      activeAccounts: result.drivers.filter((row) => row.accountActive === true && row.driverActive).length
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to load driver accounts." }, { status: 500 });
  }
}
