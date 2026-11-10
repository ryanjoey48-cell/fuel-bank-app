// Dev tool: find long dark horizontal/vertical runs and big filled colour blocks in a rendered page PNG. Usage: node scripts/pdf-scan-lines.mjs <png> <scale>
import fs from "node:fs";
import { loadImage, createCanvas } from "@napi-rs/canvas";
const [png, scaleArg] = process.argv.slice(2);
const k = Number(scaleArg || 3);
const img = await loadImage(fs.readFileSync(png));
const c = createCanvas(img.width, img.height); const x = c.getContext("2d"); x.drawImage(img, 0, 0);
const { data, width, height } = x.getImageData(0, 0, img.width, img.height);
const dark = (i) => data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90 && data[i + 3] > 200;
const pt = (n) => +(n / k).toFixed(2);
const minRun = Math.round(12 * k);
const hs = []; for (let y = 0; y < height; y += 1) { let s = -1; for (let xx = 0; xx <= width; xx += 1) { const on = xx < width && dark((y * width + xx) * 4); if (on && s < 0) s = xx; if (!on && s >= 0) { if (xx - s >= minRun) hs.push([y, s, xx]); s = -1; } } }
const vs = []; for (let xx = 0; xx < width; xx += 1) { let s = -1; for (let y = 0; y <= height; y += 1) { const on = y < height && dark((y * width + xx) * 4); if (on && s < 0) s = y; if (!on && s >= 0) { if (y - s >= minRun) vs.push([xx, s, y]); s = -1; } } }
const merge = (arr) => { const out = []; for (const [a, s, e] of arr) { const m = out.find((o) => Math.abs(o.a1 - a) <= 1 && Math.abs(o.s - s) <= 2 && Math.abs(o.e - e) <= 2); if (m) m.a1 = a; else out.push({ a0: a, a1: a, s, e }); } return out; };
console.log("HORIZONTAL (y0..y1 thickness) x0->x1 [pt]");
for (const l of merge(hs)) console.log(`y ${pt(l.a0)}..${pt(l.a1 + 1)}  x ${pt(l.s)} -> ${pt(l.e)}`);
console.log("VERTICAL x0..x1  y0->y1 [pt]");
for (const l of merge(vs)) console.log(`x ${pt(l.a0)}..${pt(l.a1 + 1)}  y ${pt(l.s)} -> ${pt(l.e)}`);
const colours = new Map();
for (let y = 0; y < height; y += 4) for (let xx = 0; xx < width; xx += 4) { const i = (y * width + xx) * 4; if (data[i + 3] < 200) continue; const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`; const e = colours.get(key) ?? { n: 0, x0: 1e9, y0: 1e9, x1: 0, y1: 0, rgb: [data[i], data[i + 1], data[i + 2]] }; e.n += 1; e.x0 = Math.min(e.x0, xx); e.y0 = Math.min(e.y0, y); e.x1 = Math.max(e.x1, xx); e.y1 = Math.max(e.y1, y); colours.set(key, e); }
console.log("BLOCKS");
for (const e of [...colours.values()].filter((e) => e.n > 1500 && !(e.rgb[0] > 240 && e.rgb[1] > 240 && e.rgb[2] > 240)).sort((a, b) => b.n - a.n).slice(0, 6)) console.log(`rgb(${e.rgb}) box x ${pt(e.x0)}-${pt(e.x1)} y ${pt(e.y0)}-${pt(e.y1)} n=${e.n}`);
