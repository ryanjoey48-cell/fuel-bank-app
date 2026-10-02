import { redirect } from "next/navigation";
import { getDriverPortalSession } from "@/lib/driver-portal-server";
import { DriverProfilePage } from "@/components/driver/driver-profile";
export default async function Page() {
  if (!await getDriverPortalSession()) redirect("/driver/login");
  return <DriverProfilePage />;
}
