"use client";
import { hrBilingual,hrCopy,hrStatus } from "@/lib/ees-hr-v7-copy";
import type { HRLanguage,HRMeetingV7 } from "@/lib/ees-hr-v7-types";

const esc=(value:unknown)=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export function meetingReportFields(meeting:HRMeetingV7,language:HRLanguage) {
  return [
    [hrBilingual("name"),meeting.employee_name],[hrBilingual("meetingDate"),meeting.meeting_date],
    [hrBilingual("meetingType"),hrStatus(language,meeting.category)],[hrBilingual("subject"),meeting.subject],
    [hrBilingual("attendees"),meeting.attendees],[hrBilingual("discussion"),meeting.discussion],
    [hrBilingual("response"),meeting.employee_response??"—"],[hrBilingual("agreedActions"),meeting.agreed_actions??"—"],
    [hrBilingual("acknowledgement"),hrStatus(language,meeting.acknowledgement)],[hrBilingual("followupDate"),meeting.follow_up_date??"—"],
    [hrBilingual("author"),meeting.author_name??meeting.created_by],
    [hrBilingual("recordedAt"),new Intl.DateTimeFormat(language==="th"?"th-TH":"en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(new Date(meeting.created_at))],
    ...meeting.addenda.flatMap(entry=>[[`${hrBilingual("addendum")} · ${entry.created_at}`,entry.content],[hrBilingual("reason"),entry.reason]])
  ];
}
export function printableMeetingHtml(meeting:HRMeetingV7,language:HRLanguage) {
  const c=hrCopy(language);
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>EES HR Meeting</title><style>@font-face{font-family:EESHrThai;src:url('${location.origin}/fonts/boss-pdf-thai.ttf')}*{box-sizing:border-box}body{font-family:EESHrThai,Arial,sans-serif;color:#172033;max-width:780px;margin:24px auto;padding:0 20px}header{display:flex;gap:18px;align-items:center;border-bottom:3px solid #6d28d9;padding-bottom:16px}header img{width:64px;height:64px;object-fit:contain}h1{font-size:22px;margin:0;color:#5b21b6}p,dd{white-space:pre-wrap;overflow-wrap:anywhere}dl{margin:0}section{padding:12px 0;border-bottom:1px solid #e8e2ef}dt{font-size:12px;font-weight:bold;color:#62576e}dd{margin:5px 0 0;font-size:14px;line-height:1.6}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:44px}.signature{border-top:1px solid #8892a3;padding-top:8px;font-size:12px}footer{font-size:11px;color:#64748b;margin-top:20px}@page{size:A4;margin:15mm}@media print{body{margin:0;max-width:none;padding:0}button{display:none}section{break-inside:auto}dt{break-after:avoid}header{break-inside:avoid}.signatures{break-inside:avoid}}</style></head><body><header><img src="${location.origin}/ees-logo.png" alt="EES"><div><h1>${esc(hrBilingual("meetings"))}</h1><p>${esc(c.confidential)}</p></div></header><dl>${meetingReportFields(meeting,language).map(([label,value])=>`<section><dt>${esc(label)}</dt><dd>${esc(value)}</dd></section>`).join("")}</dl><div class="signatures"><div class="signature">${esc(hrBilingual("employeeSignature"))}</div><div class="signature">${esc(hrBilingual("managementSignature"))}</div></div><footer>${esc(hrBilingual("unsigned"))}<br>${esc(c.meetingConfidential)}</footer><button onclick="window.print()">${esc(c.print)}</button></body></html>`;
}
export function printMeeting(meeting:HRMeetingV7,language:HRLanguage) {
  const win=window.open("","_blank");if(!win)throw new Error("HR_OPERATION_FAILED");win.opener=null;
  win.document.write(printableMeetingHtml(meeting,language));win.document.close();
}

/** Raster PDF uses the bundled Thai font and browser shaping; every line is paginated, never truncated. */
export async function meetingPdf(meeting:HRMeetingV7,language:HRLanguage):Promise<Blob> {
  const face=new FontFace("EESHrThai","url(/fonts/boss-pdf-thai.ttf)");await face.load();document.fonts.add(face);await document.fonts.ready;
  const width=1240,height=1754,margin=78,lineHeight=31;const pages:HTMLCanvasElement[]=[];let ctx:CanvasRenderingContext2D;let y=0;
  const start=()=>{const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;pages.push(canvas);ctx=canvas.getContext("2d")!;ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);ctx.fillStyle="#5b21b6";ctx.font="bold 32px EESHrThai";ctx.fillText("EES · "+hrBilingual("meetings"),margin,margin);y=margin+65;};start();
  const line=(text:string,bold=false)=>{if(y>height-margin-70)start();ctx.font=`${bold?"bold ":""}24px EESHrThai`;ctx.fillStyle=bold?"#5b21b6":"#172033";ctx.fillText(text,margin,y);y+=lineHeight;};
  const wrapped=(text:string,bold=false)=>{for(const paragraph of text.split(/\r?\n/)){let current="";for(const character of Array.from(paragraph)){ctx.font=`${bold?"bold ":""}24px EESHrThai`;if(ctx.measureText(current+character).width>width-margin*2){line(current,bold);current="";}current+=character;}line(current,bold);}};
  wrapped(hrCopy(language).confidential);y+=15;
  for(const [label,value]of meetingReportFields(meeting,language)){wrapped(label,true);wrapped(value);y+=16;}
  y+=30;wrapped("__________________________    __________________________");wrapped(hrBilingual("employeeSignature"));wrapped(hrBilingual("managementSignature"));wrapped(hrBilingual("unsigned"));
  const logo=await new Promise<HTMLImageElement|null>(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src="/ees-logo.png";});
  if(logo){const first=pages[0].getContext("2d")!;first.drawImage(logo,width-margin-66,22,60,60);}
  const encoder=new TextEncoder();const chunks:Uint8Array[]=[];const offsets:number[]=[0];let length=0;
  const push=(value:string|Uint8Array)=>{const bytes=typeof value==="string"?encoder.encode(value):value;chunks.push(bytes);length+=bytes.length;};
  const object=(id:number,body:string|(()=>void))=>{offsets[id]=length;push(`${id} 0 obj\n`);typeof body==="string"?push(body):body();push("\nendobj\n");};
  push("%PDF-1.4\n");object(1,"<< /Type /Catalog /Pages 2 0 R >>");object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(" ")}] >>`);
  pages.forEach((page,index)=>{const id=3+index*3;const jpeg=Uint8Array.from(atob(page.toDataURL("image/jpeg",.94).split(",")[1]),char=>char.charCodeAt(0));const commands="q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    object(id+1,()=>{push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);push(jpeg);push("\nendstream");});
    object(id+2,`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`);
  });const xref=length;push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);for(let i=1;i<offsets.length;i++)push(`${String(offsets[i]).padStart(10,"0")} 00000 n \n`);push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(chunks.map(chunk=>Uint8Array.from(chunk).buffer),{type:"application/pdf"});
}

