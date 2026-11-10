import type { supabase } from "@/lib/supabase";

type Verification = { booking_id: string; checked_at: string; checked_by: string; revision: number };
type Booking = { id: string; booking_id: string | null; booking_date: string; client_id: string | null; pickup: string | null; dropoff: string | null; vehicle_registration: string | null; vehicle: string | null; driver: string | null };
type Client = { id: string; name: string };
export type ReadyJob = Verification & { booking: Booking & { client_name: string | null } };

const PAGE_SIZE = 500;
const LOOKUP_SIZE = 100;
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

// Every query uses the caller's authenticated Supabase client and its existing RLS.
export async function loadFinanceReadyJobs(client: Pick<typeof supabase, "from">): Promise<ReadyJob[]> {
  const verifications: Verification[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from("finance_job_verifications")
      .select("booking_id,checked_at,checked_by,revision")
      .eq("handover_status", "ready").eq("status", "verified")
      .order("checked_at", { ascending: false }).order("booking_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Verification[];
    verifications.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (!verifications.length) return [];

  const bookings = new Map<string, Booking>();
  for (const ids of chunks([...new Set(verifications.map((row) => row.booking_id))], LOOKUP_SIZE)) {
    const { data, error } = await client.from("booking_diary")
      .select("id,booking_id,booking_date,client_id,pickup,dropoff,vehicle_registration,vehicle,driver")
      .in("id", ids);
    if (error) throw error;
    for (const row of (data ?? []) as Booking[]) if (ids.includes(row.id)) bookings.set(row.id, row);
  }

  const clientNames = new Map<string, string>();
  const clientIds = [...new Set([...bookings.values()].map((row) => row.client_id).filter((id): id is string => !!id))];
  for (const ids of chunks(clientIds, LOOKUP_SIZE)) {
    const { data, error } = await client.from("clients").select("id,name").in("id", ids);
    if (error) throw error;
    for (const row of (data ?? []) as Client[]) if (ids.includes(row.id)) clientNames.set(row.id, row.name);
  }

  return verifications.flatMap((row) => {
    const booking = bookings.get(row.booking_id);
    return booking ? [{ ...row, booking: { ...booking, client_name: booking.client_id ? clientNames.get(booking.client_id) ?? null : null } }] : [];
  });
}
