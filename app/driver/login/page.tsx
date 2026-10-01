import { redirect } from "next/navigation";
import { DriverLoginForm } from "@/components/driver/driver-login-form";
import { getDriverPortalSession } from "@/lib/driver-portal-server";

export default async function DriverLoginPage() {
  const session = await getDriverPortalSession();
  if (session) redirect("/driver");
  return <DriverLoginForm />;
}
