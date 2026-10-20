import { EmployeeProfile } from "@/components/hr/employee-profile";
export default async function EmployeePage({params}:{params:Promise<{employeeId:string}>}) {
  const {employeeId}=await params;
  return <EmployeeProfile employeeRef={{kind:"employee",id:employeeId}}/>;
}
