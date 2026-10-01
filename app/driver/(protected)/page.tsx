import { redirect } from "next/navigation";
import { DriverHome } from "@/components/driver/driver-home";
import { bangkokDateKey, getDriverPortalSession, listAssignedDriverJobs } from "@/lib/driver-portal-server";

export default async function DriverHomePage() {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");
  const jobs = await listAssignedDriverJobs(session);
  return <DriverHome driverName={session.driverName} jobs={jobs} today={bangkokDateKey()} />;
}
