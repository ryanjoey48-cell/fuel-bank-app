import type { HRLanguage } from "./ees-hr-v7-types";
const labels:Record<string,[string,string]>={FOUR_WHEEL_TRUCK:["4 wheeler","รถ 4 ล้อ"],SIX_WHEEL_TRUCK:["6 wheeler","รถ 6 ล้อ"],SIX_PLUS_SIX_WHEELER:["6 + 6 wheeler","รถ 6+6 ล้อ"],EIGHTEEN_WHEELER:["18 wheeler","รถ 18 ล้อ"]};
export function hrVehicleType(language:HRLanguage,value:string|null|undefined){return value?labels[value]?.[language==="th"?1:0]??value:"—";}
