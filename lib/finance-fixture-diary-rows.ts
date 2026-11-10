import type { DiaryBookingSeed } from "@/lib/finance-demo-centre";

/**
 * Fixture-mode only (development, no Supabase credentials, NEXT_PUBLIC_EES_FINANCE_FIXTURE=1).
 * Synthetic Booking Diary rows so the Admin Intake layout and date filters can be exercised without a login.
 * Never used with a real Supabase client; the real loader is unchanged.
 */
const ROUTES: [string, string][] = [
  ["สยามซานิทารีแวร์อินดัสทรี วรรณภูมิ", "สนามบินสุวรรณภูมิ (คลังสินค้า 3)"],
  ["BFS Cargo Terminal", "TG Cargo Complex"],
  ["สุวรรณภูมิ", "TYMPHANY Logistics Lat Krabang"],
  ["ศูนย์กระจายสินค้าบางนา กม.23", "ท่าเรือแหลมฉบัง ประตู 3"],
  ["EES Depot Lat Krabang", "นิคมอุตสาหกรรมอมตะซิตี้ ชลบุรี"]
];
const PLATES = ["3ฒน-9565", "79-2945", "71-3304", "70-8821", "3ฒก-1127", "74-6602"];
const DRIVERS = ["ธนกรณ์", "บุรี", "สมชาย ใจดี", "วิรัตน์", "อนุชา", "ประเสริฐ"];

function row(i: number, client: string, date: string, extra: Partial<DiaryBookingSeed> = {}): DiaryBookingSeed {
  const [pickup, dropoff] = ROUTES[i % ROUTES.length];
  const plate = PLATES[i % PLATES.length];
  return {
    id: `fixture-diary-${client.toLowerCase()}-${date}-${i}`,
    booking_id: `BK-FX-${String(i + 1).padStart(3, "0")}`,
    client_id: `fixture-${client.toLowerCase()}`,
    client_name: client,
    booking_date: date,
    pickup_time: `${String(7 + (i % 8)).padStart(2, "0")}:30:00`,
    pickup, dropoff,
    driver: DRIVERS[i % DRIVERS.length],
    vehicle: plate, vehicle_registration: plate,
    customer_job_number: null, job_order_number: null, notes: null, diary_status: "completed", trailer_registration: null,
    ...extra
  };
}

export function fixtureDiaryRows(): DiaryBookingSeed[] {
  const rows: DiaryBookingSeed[] = [];
  for (let i = 0; i < 11; i += 1) rows.push(row(i, "Amazing", "2026-01-19"));
  for (let i = 0; i < 6; i += 1) rows.push(row(i + 11, "MASS", "2026-01-05"));
  for (let i = 0; i < 8; i += 1) rows.push(row(i + 17, "PIONEERS", `2026-02-${String(2 + i).padStart(2, "0")}`));
  for (let i = 0; i < 30; i += 1) rows.push(row(i + 25, "OLD CUSTOMER", `2025-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`));
  return rows.sort((a, b) => b.booking_date.localeCompare(a.booking_date));
}

export function fixtureDiaryRowsBetween(dateFrom: string, dateTo: string) {
  return fixtureDiaryRows().filter((r) => (!dateFrom || r.booking_date >= dateFrom) && (!dateTo || r.booking_date <= dateTo));
}
