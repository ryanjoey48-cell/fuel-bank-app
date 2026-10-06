import { redirect } from "next/navigation";
import { DriverHome } from "@/components/driver/driver-home";
import { bangkokDateKey, getDriverPortalSession } from "@/lib/driver-portal-server";
import { driverHomeWork } from "@/lib/driver-work-server";
import { DriverAutoRefresh } from "@/components/driver/driver-navigation";

// Driver work is always read from the current authenticated server request.
export const dynamic = "force-dynamic";

export default async function DriverHomePage() {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");
  const today = bangkokDateKey();
  const work = await driverHomeWork(session, today);
  return <><DriverAutoRefresh /><DriverHome driverId={session.driverId} driverName={session.driverName} jobs={work.map((w) => w.job)} eventsByJob={Object.fromEntries(work.map((w) => [w.job.id, w.events]))} today={today} /></>;
}
