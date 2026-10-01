import { redirect } from "next/navigation";
import { DriverPortalHeader } from "@/components/driver/driver-portal-header";
import { getDriverPortalSession } from "@/lib/driver-portal-server";

export default async function ProtectedDriverLayout({ children }: { children: React.ReactNode }) {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");

  return (
    <>
      <DriverPortalHeader driverName={session.driverName} />
      {children}
    </>
  );
}
