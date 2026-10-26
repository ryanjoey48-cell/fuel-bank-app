/** Offline Forth Console CSV parser. This is separate from the Open API contract. */
export const PARKING_CSV_COLUMNS = [
  "license plate", "Device code", "Vehicle name", "พนักงานขับ", "date", "สถานที่",
  "เวลาเริ่มต้น", "End of work time", "Total travel time", "Engine idling duration",
  "Parking duration", "Total distance (km)", "Exceeding the speed limit (times)",
  "Maximum speed (km/h)"
] as const;

export type ParkingCsvDetail = {
  source: Record<string, string>;
  travelSeconds: number;
  idlingSeconds: number;
  parkingSeconds: number;
  distanceHundredthsKm: number;
  speedExceedanceCount: number;
  maximumSpeedKph: number;
  incompleteEndTime: boolean;
};

export type ParkingCsvResult =
  | { ok: false; error: "invalid_csv" | "invalid_header" | "invalid_row" }
  | { ok: true; details: ParkingCsvDetail[]; summary: Record<string, string>; reconciled: boolean; issues: string[] };

function csvRows(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (char === "," || char === "\n") {
      row.push(field); field = ""; closed = false;
      if (char === "\n") { rows.push(row); row = []; }
    } else if (char === "\r" && text[i + 1] === "\n") continue;
    else if (char === "\r") { row.push(field); rows.push(row); row = []; field = ""; closed = false; }
    else if (closed) return null;
    else field += char;
  }
  if (quoted) return null;
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseHmsDuration(value: string): number | null {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function hundredths(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

function whole(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseForthParkingCsv(text: string): ParkingCsvResult {
  const rows = csvRows(text.replace(/^\uFEFF+/, ""));
  if (!rows || rows.length < 2) return { ok: false, error: "invalid_csv" };
  if (rows[0].length !== PARKING_CSV_COLUMNS.length ||
    rows[0].some((value, index) => value !== PARKING_CSV_COLUMNS[index])) return { ok: false, error: "invalid_header" };
  const data = rows.slice(1);
  if (data.some(row => row.length !== PARKING_CSV_COLUMNS.length)) return { ok: false, error: "invalid_row" };
  const objects = data.map(row => Object.fromEntries(row.map((value, index) => [PARKING_CSV_COLUMNS[index], value])));
  const summaries = objects.filter(row => row["license plate"] === "Total");
  if (summaries.length !== 1 || objects.at(-1) !== summaries[0]) return { ok: false, error: "invalid_row" };
  const summary = summaries[0];
  const details: ParkingCsvDetail[] = [];
  const issues: string[] = [];
  const first = objects[0];
  for (const source of objects.slice(0, -1)) {
    const travelSeconds = parseHmsDuration(source["Total travel time"]);
    const idlingSeconds = parseHmsDuration(source["Engine idling duration"]);
    const parkingSeconds = parseHmsDuration(source["Parking duration"]);
    const distanceHundredthsKm = hundredths(source["Total distance (km)"]);
    const speedExceedanceCount = whole(source["Exceeding the speed limit (times)"]);
    const maximumSpeedKph = whole(source["Maximum speed (km/h)"]);
    if (!source["license plate"] || !source["Device code"] || !source.date ||
      source["license plate"] !== first["license plate"] ||
      source["Device code"] !== first["Device code"] || source.date !== first.date ||
      travelSeconds === null || idlingSeconds === null || parkingSeconds === null ||
      distanceHundredthsKm === null || speedExceedanceCount === null || maximumSpeedKph === null) {
      return { ok: false, error: "invalid_row" };
    }
    const incompleteEndTime = source["End of work time"] === "-" || source["End of work time"] === "";
    if (incompleteEndTime) issues.push("A detail row has no end-of-work time.");
    if (distanceHundredthsKm === 0 && maximumSpeedKph > 0) issues.push("A detail row reports speed with zero distance.");
    details.push({ source, travelSeconds, idlingSeconds, parkingSeconds, distanceHundredthsKm, speedExceedanceCount, maximumSpeedKph, incompleteEndTime });
  }
  const expected = [
    parseHmsDuration(summary["Total travel time"]), parseHmsDuration(summary["Engine idling duration"]),
    parseHmsDuration(summary["Parking duration"]), hundredths(summary["Total distance (km)"]),
    whole(summary["Exceeding the speed limit (times)"]), whole(summary["Maximum speed (km/h)"])
  ];
  if (expected.some(value => value === null)) return { ok: false, error: "invalid_row" };
  const actual = [
    details.reduce((n, row) => n + row.travelSeconds, 0),
    details.reduce((n, row) => n + row.idlingSeconds, 0),
    details.reduce((n, row) => n + row.parkingSeconds, 0),
    details.reduce((n, row) => n + row.distanceHundredthsKm, 0),
    details.reduce((n, row) => n + row.speedExceedanceCount, 0),
    Math.max(0, ...details.map(row => row.maximumSpeedKph))
  ];
  const reconciled = actual.every((value, index) => value === expected[index]);
  if (!reconciled) issues.push("Detail totals do not reconcile with the export summary.");
  return { ok: true, details, summary, reconciled, issues };
}
