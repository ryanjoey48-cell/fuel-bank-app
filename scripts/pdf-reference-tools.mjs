// Dev tool: render a PDF page to PNG and dump positioned text, using the repo's own pdfjs-dist + @napi-rs/canvas.
// Usage: node scripts/pdf-reference-tools.mjs <pdf> <out-prefix> [scale=3]
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";

const [pdfPath, outPrefix, scaleArg] = process.argv.slice(2);
if (!pdfPath || !outPrefix) { console.error("usage: pdf-reference-tools.mjs <pdf> <out-prefix> [scale]"); process.exit(2); }
const scale = Number(scaleArg || 3);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
const report = { pages: doc.numPages, items: [] };
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  fs.writeFileSync(`${outPrefix}-p${n}.png`, canvas.toBuffer("image/png"));
  const base = page.getViewport({ scale: 1 });
  report.size = { widthPt: base.width, heightPt: base.height };
  const text = await page.getTextContent();
  for (const it of text.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    report.items.push({ page: n, str: it.str, x: +it.transform[4].toFixed(1), y: +(base.height - it.transform[5]).toFixed(1), w: +it.width.toFixed(1), h: +it.height.toFixed(1), font: it.fontName });
  }
  const ops = await page.getOperatorList();
  report.opCount = ops.fnArray.length;
}
const meta = await doc.getMetadata().catch(() => null);
report.info = meta?.info ?? null;
fs.writeFileSync(`${outPrefix}-text.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ pages: report.pages, size: report.size, textItems: report.items.length, info: report.info }));
