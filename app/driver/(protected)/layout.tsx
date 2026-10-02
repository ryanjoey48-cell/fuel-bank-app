import { redirect } from "next/navigation";
import { DriverPortalHeader } from "@/components/driver/driver-portal-header";
import { getDriverPortalSession } from "@/lib/driver-portal-server";
import { DriverNavigation } from "@/components/driver/driver-navigation";

export default async function ProtectedDriverLayout({ children }: { children: React.ReactNode }) {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");

  return (
    <>
      <DriverPortalHeader driverName={session.driverName} />
      <DriverNavigation />
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
    </>
  );
}
