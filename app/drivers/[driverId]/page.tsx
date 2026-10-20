import { EmployeeProfile } from "@/components/hr/employee-profile";
export default async function DriverHRProfilePage({params}:{params:Promise<{driverId:string}>}) {
  const {driverId}=await params;
  return <EmployeeProfile employeeRef={{kind:"driver",id:driverId}}/>;
}
