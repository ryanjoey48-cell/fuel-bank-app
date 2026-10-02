import { redirect } from "next/navigation";
import { getDriverPortalSession } from "@/lib/driver-portal-server";
import { driverHistoryWork } from "@/lib/driver-work-server";
import { DriverHistory } from "@/components/driver/driver-history";
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await getDriverPortalSession(); if (!session) redirect("/driver/login");
  const value = Number((await searchParams).page || 0); const page = Number.isInteger(value) && value >= 0 && value <= 10000 ? value : 0;
  return <DriverHistory {...await driverHistoryWork(session, page)} page={page} />;
}
