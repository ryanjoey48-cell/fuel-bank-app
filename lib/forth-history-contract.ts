/** Raw, Swagger-backed Forth history contracts. Values remain source strings. */
export type ForthTripRecord = {
  boxId: string | null;
  plateNo: string | null;
  vehicleName: string | null;
  driver: string | null;
  rDate: string | null;
  arriveTime: string | null;
  source: string | null;
  departTime: string | null;
  arriveDestinationTime: string | null;
  destination: string | null;
  departDestinationTime: string | null;
  routingTime: string | null;
};

export type ForthTripDetailRecord = {
  boxId: string | null;
  plateNo: string | null;
  vehicleName: string | null;
  driver: string | null;
  rDate: string | null;
  locationName: string | null;
  arriveTime: string | null;
  departTime: string | null;
  duration: string | null;
};

export type ForthParkingTripRecord = {
  plateNo: string | null;
  boxId: string | null;
  vehicleName: string | null;
  driver: string | null;
  rDate: string | null;
  address: string | null;
  startTime: string | null;
  endTime: string | null;
  routingTime: string | null;
  parkingEngineOn: string | null;
  parkingTime: string | null;
  sumDistance: string | null;
  maxSpeedCount: string | null;
  maxSpeed: string | null;
};

export type ForthParkingEngineOverLimitRecord = {
  boxId: string | null;
  plateNo: string | null;
  vehicleName: string | null;
  driver: string | null;
  rDate: string | null;
  startParking: string | null;
  endParking: string | null;
  parkingTime: string | null;
  engineStatus: string | null;
  locationName: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
};

export type ParseRowsResult<T> =
  | { ok: true; records: T[] }
  | { ok: false; error: "invalid_response" };

type HistoryRequestResult =
  | { ok: true; deviceId: string; date: string; forthDate: string; language: "en" | "th" }
  | { ok: false; error: "invalid_request" };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRows<T>(value: unknown, fields: readonly string[]): ParseRowsResult<T> {
  if (!Array.isArray(value)) return { ok: false, error: "invalid_response" };
  const records: T[] = [];
  for (const item of value) {
    if (!isObject(item)) return { ok: false, error: "invalid_response" };
    const record: Record<string, string | null> = {};
    for (const field of fields) {
      const sourceValue = item[field];
      if (sourceValue === undefined || sourceValue === null) {
        record[field] = null;
      } else if (typeof sourceValue === "string") {
        record[field] = sourceValue;
      } else {
        // Do not coerce values whose actual format and units are unverified.
        return { ok: false, error: "invalid_response" };
      }
    }
    records.push(record as T);
  }
  return { ok: true, records };
}

const tripFields = ["boxId", "plateNo", "vehicleName", "driver", "rDate", "arriveTime", "source", "departTime", "arriveDestinationTime", "destination", "departDestinationTime", "routingTime"] as const;
const tripDetailFields = ["boxId", "plateNo", "vehicleName", "driver", "rDate", "locationName", "arriveTime", "departTime", "duration"] as const;
const parkingTripFields = ["plateNo", "boxId", "vehicleName", "driver", "rDate", "address", "startTime", "endTime", "routingTime", "parkingEngineOn", "parkingTime", "sumDistance", "maxSpeedCount", "maxSpeed"] as const;
const parkingBehaviorFields = ["boxId", "plateNo", "vehicleName", "driver", "rDate", "startParking", "endParking", "parkingTime", "engineStatus", "locationName", "address", "latitude", "longitude"] as const;

export function parseForthTripsResponse(value: unknown): ParseRowsResult<ForthTripRecord> {
  return parseRows<ForthTripRecord>(value, tripFields);
}

export function parseForthTripDetailsResponse(value: unknown): ParseRowsResult<ForthTripDetailRecord> {
  return parseRows<ForthTripDetailRecord>(value, tripDetailFields);
}

export function parseForthParkingTripsResponse(value: unknown): ParseRowsResult<ForthParkingTripRecord> {
  return parseRows<ForthParkingTripRecord>(value, parkingTripFields);
}

export function parseForthParkingEngineOverLimitResponse(value: unknown): ParseRowsResult<ForthParkingEngineOverLimitRecord> {
  return parseRows<ForthParkingEngineOverLimitRecord>(value, parkingBehaviorFields);
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= days;
}

/** Accept one device and one calendar day only; never accept caller-supplied boxIds. */
export function validateJourneyHistoryRequest(value: unknown): HistoryRequestResult {
  if (!isObject(value)) return { ok: false, error: "invalid_request" };
  if (Object.keys(value).some((key) => !["deviceId", "date", "language"].includes(key))) {
    return { ok: false, error: "invalid_request" };
  }
  if (typeof value.deviceId !== "string" || value.deviceId.length < 1 || value.deviceId.length > 80 ||
    value.deviceId.trim() !== value.deviceId || /[\p{Cc},]/u.test(value.deviceId)) {
    return { ok: false, error: "invalid_request" };
  }
  if (typeof value.date !== "string" || !isCalendarDate(value.date)) {
    return { ok: false, error: "invalid_request" };
  }
  const language = value.language === undefined ? "en" : value.language;
  if (language !== "en" && language !== "th") return { ok: false, error: "invalid_request" };
  return { ok: true, deviceId: value.deviceId, date: value.date, forthDate: value.date.replaceAll("-", ""), language };
}
