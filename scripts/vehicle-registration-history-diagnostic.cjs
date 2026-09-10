const fs = require("node:fs");

const REGISTRATION_MAPPINGS = [
  { oldRegistration: "9565", canonicalRegistration: "3ฒน-9565" },
  { oldRegistration: "4565", canonicalRegistration: "3ฒล-4565" },
  { oldRegistration: "8453", canonicalRegistration: "ฒอ-8453" }
];

const TARGETS = [
  { table: "vehicles", column: "vehicle_reg" },
  { table: "drivers", column: "vehicle_reg" },
  { table: "fuel_logs", column: "vehicle_reg" },
  { table: "bank_transfers", column: "vehicle_reg" },
  { table: "weekly_mileage", column: "vehicle_reg" },
  { table: "vehicle_service_logs", column: "vehicle_reg" },
  { table: "vehicle_monthly_performance", column: "vehicle_registration" },
  { table: "booking_diary", column: "vehicle_registration" },
  { table: "booking_diary", column: "vehicle" },
  { table: "trip_journeys", column: "vehicle_reg" },
  { table: "shipments", column: "vehicle_reg" },
  { table: "shipments", column: "vehicle_reg_snapshot", optional: true }
];

function readEnv() {
  const env = Object.fromEntries(
    fs.readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index);
        const value = line.slice(index + 1).replace(/^"|"$/g, "");
        return [key, value];
      })
  );

  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase URL or anon key in .env.local.");
  }

  return { url, anonKey };
}

async function countRows({ url, anonKey }, table, column, value) {
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  endpoint.searchParams.set(column, `eq.${value}`);
  endpoint.searchParams.set("select", "id");

  const response = await fetch(endpoint, {
    method: "HEAD",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: "count=exact"
    }
  });

  if (!response.ok) {
    return {
      count: null,
      error: `${response.status} ${await response.text()}`
    };
  }

  const contentRange = response.headers.get("content-range") || "*/0";
  return {
    count: Number(contentRange.split("/")[1] || 0),
    error: null
  };
}

async function main() {
  const env = readEnv();
  const rows = [];

  for (const mapping of REGISTRATION_MAPPINGS) {
    for (const target of TARGETS) {
      const oldResult = await countRows(env, target.table, target.column, mapping.oldRegistration);
      const newResult = await countRows(env, target.table, target.column, mapping.canonicalRegistration);
      rows.push({
        oldRegistration: mapping.oldRegistration,
        canonicalRegistration: mapping.canonicalRegistration,
        table: target.table,
        column: target.column,
        oldRows: oldResult.count,
        canonicalRows: newResult.count,
        error: oldResult.error || newResult.error
      });
    }
  }

  console.table(rows);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
