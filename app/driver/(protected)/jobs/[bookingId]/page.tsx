import { notFound, redirect } from "next/navigation";
import { DriverJobDetail } from "@/components/driver/driver-job-detail";
import { getAssignedDriverJob, getDriverPortalSession } from "@/lib/driver-portal-server";
import { getEesDepot } from "@/lib/ees-depot";

export default async function DriverJobPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");
  const { bookingId } = await params;
  const job = await getAssignedDriverJob(session, bookingId);
  if (!job) notFound();
  return <DriverJobDetail job={job} depot={getEesDepot()} />;
}
