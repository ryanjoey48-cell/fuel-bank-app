import { NextResponse } from "next/server";

/**
 * V4 financial persistence stays locked by default.
 * An authorised import window may set VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED=true
 * only after migration apply + separate owner approval. Default remains locked.
 */
export function isVehicleFinancialV4WriteLocked(): boolean {
  return process.env.VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED !== "true";
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
