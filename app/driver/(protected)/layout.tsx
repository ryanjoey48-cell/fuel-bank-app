import { redirect } from "next/navigation";
import { DriverPortalHeader } from "@/components/driver/driver-portal-header";
import { getDriverPortalSession } from "@/lib/driver-portal-server";
import { DriverNavigation } from "@/components/driver/driver-navigation";

export default async function ProtectedDriverLayout({ children }: { children: React.ReactNode }) {
  const session = await getDriverPortalSession();
  if (!session) redirect("/driver/login");

  return (
    <div className="min-h-[100dvh] bg-[var(--driver-bg)] text-[var(--driver-text)]">
      <DriverPortalHeader driverName={session.driverName} />
      <DriverNavigation />
      <div className="driver-portal-content pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
    </div>
  );
}
