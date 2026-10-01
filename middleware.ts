import { NextRequest, NextResponse } from "next/server";

const DRIVER_SESSION_COOKIE = "ees_driver_session";

export function middleware(request: NextRequest) {
  if (!request.cookies.has(DRIVER_SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL("/driver", request.url));
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/booking-diary/:path*",
    "/dispatch/:path*",
    "/shipments/:path*",
    "/trip-journey/:path*",
    "/drivers/:path*",
    "/fleet/:path*",
    "/weekly-mileage/:path*",
    "/maintenance/:path*",
    "/grease-maintenance/:path*",
    "/insurance/:path*",
    "/inventory/:path*",
    "/fuel/:path*",
    "/fuel-logs/:path*",
    "/fuel-spend-report/:path*",
    "/vehicle-performance/:path*",
    "/reports/:path*",
    "/transfers/:path*",
    "/profile/:path*",
    "/support/:path*",
    "/admin/:path*"
  ]
};
