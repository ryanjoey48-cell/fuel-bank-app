// Dev tool: list/extract embedded raster images (e.g. the logo) from a PDF page. Usage: node scripts/pdf-extract-images.mjs <pdf> <out-prefix>
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";

const [pdfPath, outPrefix] = process.argv.slice(2);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const ops = await page.getOperatorList();
const OPS = pdfjs.OPS;
let n = 0;
for (let i = 0; i < ops.fnArray.length; i += 1) {
  const fn = ops.fnArray[i];
  if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;
  const id = ops.argsArray[i][0];
  const img = await new Promise((resolve) => {
    if (fn === OPS.paintInlineImageXObject) return resolve(ops.argsArray[i][0]);
    page.objs.get(id, resolve);
  });
  if (!img?.data) { console.log("image without data", id); continue; }
  const { width, height, data, kind } = img;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(width, height);
  const px = width * height;
  if (data.length === px * 4) out.data.set(data);
  else if (data.length === px * 3) for (let p = 0; p < px; p += 1) { out.data[p * 4] = data[p * 3]; out.data[p * 4 + 1] = data[p * 3 + 1]; out.data[p * 4 + 2] = data[p * 3 + 2]; out.data[p * 4 + 3] = 255; }
  else { console.log("unsupported layout", { width, height, len: data.length, kind }); continue; }
  ctx.putImageData(out, 0, 0);
  n += 1;
  fs.writeFileSync(`${outPrefix}-img${n}.png`, canvas.toBuffer("image/png"));
  console.log(`image ${n}: ${width}x${height} kind=${kind}`);
}
console.log(`images: ${n}`);
