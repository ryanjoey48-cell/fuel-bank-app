import { NextResponse } from "next/server";

/** V4 financial persistence needs a separate reviewed SQL and release approval. */
export function isVehicleFinancialV4WriteLocked(): boolean {
  return true;
}

export function disabledVehicleFinancialV4WriteResponse() {
  return NextResponse.json({
    error: "Vehicle Performance V4 financial writes are disabled for this preview release.",
    errorCode: "v4_financial_writes_disabled"
  }, {
    status: 403,
    headers: { "Cache-Control": "private, no-store, max-age=0" }
  });
}
