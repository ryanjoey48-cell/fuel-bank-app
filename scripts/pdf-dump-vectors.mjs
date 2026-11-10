// Dev tool: dump vector rectangles / fills / strokes (in PDF points, top-left origin) of page 1. Usage: node scripts/pdf-dump-vectors.mjs <pdf>
import fs from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const H = page.getViewport({ scale: 1 }).height;
const ops = await page.getOperatorList();
const O = pdfjs.OPS;
const names = Object.fromEntries(Object.entries(O).map(([k, v]) => [v, k]));
let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const pt = (x, y) => [+(ctm[0] * x + ctm[2] * y + ctm[4]).toFixed(2), +(H - (ctm[1] * x + ctm[3] * y + ctm[5])).toFixed(2)];
let fill = "?", stroke = "?", lw = 1;
for (let i = 0; i < ops.fnArray.length; i += 1) {
  const fn = ops.fnArray[i], a = ops.argsArray[i];
  if (fn === O.save) stack.push([...ctm]);
  else if (fn === O.restore) ctm = stack.pop() ?? ctm;
  else if (fn === O.transform) ctm = mul(ctm, a);
  else if (fn === O.setFillRGBColor) fill = a[0];
  else if (fn === O.setStrokeRGBColor) stroke = a[0];
  else if (fn === O.setLineWidth) lw = a[0];
  else if (fn === O.constructPath) {
    const [paintOp, [coords]] = [a[0], a.slice(1)];
    const drawOps = a[0]; const data = a[1];
    const kind = names[ops.fnArray[i]];
    // pdfjs >=4: a = [op, [Float32Array], minMax]
    const painted = names[drawOps] ?? drawOps;
    const c = data?.[0] ?? coords;
    const pts = [];
    if (c) for (let k = 0; k + 1 < c.length; k += 2) pts.push(pt(c[k], c[k + 1]));
    console.log(JSON.stringify({ op: painted, fill, stroke, lw, pts: pts.slice(0, 8) }));
  }
  else if (fn === O.rectangle) console.log("rect", a.map((n) => +n.toFixed(2)), "fill", fill);
}
