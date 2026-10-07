import { notFound, redirect } from "next/navigation";
import { DriverJobDetail } from "@/components/driver/driver-job-detail";
import { getDriverVisibleJob, getDriverPortalSession } from "@/lib/driver-portal-server";
import { readDriverJobEvents } from "@/lib/driver-job-events-server";
import { getEesDepot } from "@/lib/ees-depot";

export const dynamic = "force-dynamic";

export default async function DriverJobPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");
  const { bookingId } = await params;
  const job = await getDriverVisibleJob(session, bookingId);
  if (!job) notFound();
  // Resolve the full sequence only after read authorization, before rendering any workflow state.
  const initialEvents = await readDriverJobEvents(job.id);
  return <DriverJobDetail key={job.id} initialEvents={initialEvents} job={job} depot={getEesDepot()} />;
}
