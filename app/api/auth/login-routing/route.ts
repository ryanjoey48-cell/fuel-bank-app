import { NextResponse } from "next/server";
import {
  AdminApiError,
  createServerSupabaseAdmin,
  findActiveDriverAccount,
  findDriverAccessRequest,
  requireVerifiedUser,
  resolveAccountAccess
} from "@/lib/admin-user-management-server";
import {
  DriverPortalError,
  DRIVER_SESSION_COOKIE,
  DRIVER_SESSION_MAX_AGE_SECONDS,
  createDriverPortalSessionForAuthUser
} from "@/lib/driver-portal-server";

export async function POST(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const driverAccount = await findActiveDriverAccount(admin, user.id);

    if (driverAccount) {
      const result = await createDriverPortalSessionForAuthUser(user.id);
      const response = NextResponse.json({ accountType: "driver", destination: "/driver" });
      response.cookies.set(DRIVER_SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: DRIVER_SESSION_MAX_AGE_SECONDS
      });
      return response;
    }

    const accessRequest = await findDriverAccessRequest(admin, user.id);
    if (accessRequest?.status === "pending") {
      return NextResponse.json({ accountType: "pending", destination: "/access/pending" });
    }
    if (accessRequest?.status === "rejected") {
      return NextResponse.json({ accountType: "rejected", destination: "/access/rejected" });
    }
    if (accessRequest?.status === "approved" && accessRequest.requested_account_type === "driver") {
      return NextResponse.json({ accountType: "pending", destination: "/access/pending" });
    }

    await resolveAccountAccess(admin, user);
    return NextResponse.json({ accountType: "office", destination: "/dashboard" });
  } catch (error) {
    if (error instanceof AdminApiError || error instanceof DriverPortalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to determine account access." }, { status: 500 });
  }
}
