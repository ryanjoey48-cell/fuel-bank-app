import { NextResponse } from "next/server";
import {
  DRIVER_SESSION_COOKIE,
  DRIVER_SESSION_MAX_AGE_SECONDS,
  DriverPortalError,
  createDriverPortalSession,
  revokeDriverPortalSession
} from "@/lib/driver-portal-server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const result = await createDriverPortalSession(email, password);
    const response = NextResponse.json({
      ok: true,
      driver: {
        name: result.session.driverName
      }
    });

    response.cookies.set(DRIVER_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DRIVER_SESSION_MAX_AGE_SECONDS
    });
    return response;
  } catch (error) {
    const status = error instanceof DriverPortalError ? error.status : 500;
    const message = error instanceof DriverPortalError
      ? error.message
      : "Unable to sign in to the driver portal.";
    return NextResponse.json({
      error: message,
      ...(error instanceof DriverPortalError && error.destination
        ? { destination: error.destination }
        : {})
    }, { status });
  }
}

export async function DELETE(request: Request) {
  const token = request.headers.get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${DRIVER_SESSION_COOKIE}=`))
    ?.slice(DRIVER_SESSION_COOKIE.length + 1);

  await revokeDriverPortalSession(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DRIVER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}

