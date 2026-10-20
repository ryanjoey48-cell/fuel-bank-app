import {bangkokToday,type DirectoryEmployee} from "./ees-hr-v7-types";
export type ComplianceDocument={employee_id:string;state:string;expiry_date:string|null};
export type ComplianceLicence={employee_id:string;issue_date:string;expiry_date:string;recorded_at:string};
export type ComplianceRow={id:string;kind:"driver"|"employee";employeeId:string|null;name:string;vehicle:string|null;licenceStatus:string|null;licenceExpiry:string|null;expiry:string|null;documentCount:number;missing:boolean;expired:boolean;expiring:boolean};
export type ComplianceList={rows:ComplianceRow[];total:number;page:number};
export function complianceRows(people:DirectoryEmployee[],documents:ComplianceDocument[],licences:ComplianceLicence[],today=bangkokToday()):ComplianceRow[]{
 const date=new Date(today);date.setUTCDate(date.getUTCDate()+30);const soon=date.toISOString().slice(0,10);
 const docMap=new Map<string,ComplianceDocument[]>(),licenceMap=new Map<string,ComplianceLicence>();
 for(const doc of documents){if(doc.state!=="ready")continue;const list=docMap.get(doc.employee_id)??[];list.push(doc);docMap.set(doc.employee_id,list);}
 for(const licence of licences){if(licence.issue_date>today)continue;const current=licenceMap.get(licence.employee_id);if(!current||licence.issue_date>current.issue_date||licence.issue_date===current.issue_date&&licence.recorded_at>current.recorded_at)licenceMap.set(licence.employee_id,licence);}
 return people.map(person=>{const docs=docMap.get(person.employeeId??"")??[],licence=person.driverId?licenceMap.get(person.employeeId??""):undefined;
  const dates=[...docs.map(doc=>doc.expiry_date),licence?.expiry_date].filter((date):date is string=>Boolean(date)).sort();
  return {id:person.id,kind:person.kind,employeeId:person.employeeId,name:person.name,vehicle:person.vehicle?.registration??null,licenceStatus:person.driverId?(person.documentStatus??"not_recorded"):null,licenceExpiry:licence?.expiry_date??null,expiry:dates[0]??null,documentCount:docs.length,
   missing:docs.length===0||Boolean(person.driverId&&!licence),expired:dates.some(date=>date<today),expiring:dates.some(date=>date>=today&&date<=soon)};
 });
}
