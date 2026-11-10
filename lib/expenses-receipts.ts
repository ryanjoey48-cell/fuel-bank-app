/** Original-byte validation shared by server uploads and isolated browser fixtures. */
export function receiptMime(bytes:Uint8Array):string {
 if(!bytes.length||bytes.length>15*1024*1024)throw new Error('FILE_SIZE');
 const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
 if(ascii(0,5)==='%PDF-')return 'application/pdf';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
 if(ascii(4,8)==='ftyp'){const brands=ascii(8,Math.min(64,bytes.length));if(/heic|heix|hevc|hevx/.test(brands))return 'image/heic';if(/mif1|msf1/.test(brands)&&!/avif|avis/.test(brands))return 'image/heif';}
 throw new Error('FILE_TYPE');
}
