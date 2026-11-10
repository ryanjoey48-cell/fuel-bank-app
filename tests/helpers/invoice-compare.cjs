// Shared by the fidelity test and scripts: loads the real TS invoice code, renders the INTEGRA fixture with @napi-rs/canvas
// and compares it to the owner's reference PDF render. No Finance data is read or written.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..', '..');
const cache = new Map();
function loadTs(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const req = (name) => {
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, `${base}.ts`].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (target && target.endsWith('.ts')) return loadTs(target);
      if (target) return require(target);
    }
    return require(name);
  };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
}
const lib = (name) => loadTs(path.join(root, 'lib', name));
const canvasLib = () => require('@napi-rs/canvas');

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const { GlobalFonts } = canvasLib();
  GlobalFonts.registerFromPath(path.join(root, 'public', 'fonts', 'boss-pdf-thai.ttf'), 'EESInvoiceThai');
  fontsReady = true;
}

/** The owner's example invoice as an input fixture (values from TRN invoice test.pdf; never written to Finance). */
function integraFixtureDocument() {
  const profile = lib('finance-customer-profiles.ts').findCustomerProfile('INTEGRA LOGISTICS CORPORATION CO., LTD.');
  return { doc: lib('finance-invoice-fixture.ts').integraReferenceInvoice().doc, profile };
}

async function renderFixturePng(scale, doc, variant = 'reference', banner = false) {
  registerFonts();
  const { createCanvas, loadImage } = canvasLib();
  const render = lib('finance-invoice-render.ts');
  const logo = await loadImage(fs.readFileSync(path.join(root, 'public', variant === 'modern' ? 'ees-logo.png' : 'ees-invoice-logo.png')));
  const pages = render.drawInvoice((w, h) => createCanvas(w, h), scale, doc, { images: { logo }, banner, variant });
  return pages.map((canvas) => canvas.toBuffer('image/png'));
}

async function luminance(buffer) {
  const { loadImage, createCanvas } = canvasLib();
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, img.width, img.height); ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const lum = new Uint8Array(img.width * img.height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  return { width: img.width, height: img.height, lum };
}

/** Long dark runs = rules/borders, as [{axis, pos, from, to}] in points. */
function rules(image, scale, minLen = 12) {
  const { width, height, lum } = image; const out = []; const min = Math.round(minLen * scale);
  const dark = (x, y) => lum[y * width + x] < 90;
  for (let y = 0; y < height; y += 1) { let s = -1; for (let x = 0; x <= width; x += 1) { const on = x < width && dark(x, y); if (on && s < 0) s = x; if (!on && s >= 0) { if (x - s >= min) out.push({ axis: 'h', pos: y / scale, from: s / scale, to: x / scale }); s = -1; } } }
  for (let x = 0; x < width; x += 1) { let s = -1; for (let y = 0; y <= height; y += 1) { const on = y < height && dark(x, y); if (on && s < 0) s = y; if (!on && s >= 0) { if (y - s >= min) out.push({ axis: 'v', pos: x / scale, from: s / scale, to: y / scale }); s = -1; } } }
  const merged = [];
  for (const r of out) { const m = merged.find((o) => o.axis === r.axis && Math.abs(o.last - r.pos) <= 1.5 / scale && Math.abs(o.from - r.from) < 2 && Math.abs(o.to - r.to) < 2); if (m) m.last = r.pos; else merged.push({ ...r, last: r.pos }); }
  return merged.map((m) => ({ axis: m.axis, pos: +((m.pos + m.last) / 2).toFixed(2), from: +m.from.toFixed(2), to: +m.to.toFixed(2) }));
}

/** Every reference rule needs a generated rule within `tol` points (and vice versa). */
function compareRules(reference, generated, tol = 1.2) {
  const near = (a, b) => a.axis === b.axis && Math.abs(a.pos - b.pos) <= tol && Math.abs(a.from - b.from) <= tol * 2 && Math.abs(a.to - b.to) <= tol * 2;
  const missing = reference.filter((r) => !generated.some((g) => near(r, g)));
  const extra = generated.filter((g) => !reference.some((r) => near(g, r)));
  return { referenceCount: reference.length, generatedCount: generated.length, missing, extra };
}

/** Ink overlap: share of ink pixels in each image that has ink in the other within `radius` px. */
function inkOverlap(a, b, radius) {
  const dilate = (img) => { const { width, height, lum } = img; const mask = new Uint8Array(width * height); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (lum[y * width + x] < 140) for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < width && yy < height) mask[yy * width + xx] = 1; } return mask; };
  const da = dilate(a), db = dilate(b); let inkA = 0, hitA = 0, inkB = 0, hitB = 0;
  for (let i = 0; i < a.lum.length; i += 1) { if (a.lum[i] < 140) { inkA += 1; if (db[i]) hitA += 1; } if (b.lum[i] < 140) { inkB += 1; if (da[i]) hitB += 1; } }
  return { referenceCovered: hitA / inkA, generatedCovered: hitB / inkB, referenceInk: inkA, generatedInk: inkB };
}

/** Side-by-side PNG: reference | generated | overlay (black = both, red = reference only, blue = generated only). */
async function diffImage(a, b) {
  const { createCanvas } = canvasLib();
  const w = a.width, h = a.height; const canvas = createCanvas(w * 3, h); const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(w * 3, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x; const put = (col, r, g, bl) => { const p = (y * w * 3 + col * w + x) * 4; out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = bl; out.data[p + 3] = 255; };
    put(0, a.lum[i], a.lum[i], a.lum[i]); put(1, b.lum[i], b.lum[i], b.lum[i]);
    const ia = a.lum[i] < 140, ib = b.lum[i] < 140;
    if (ia && ib) put(2, 0, 0, 0); else if (ia) put(2, 230, 30, 30); else if (ib) put(2, 30, 60, 230); else put(2, 255, 255, 255);
  }
  ctx.putImageData(out, 0, 0); return canvas.toBuffer('image/png');
}

module.exports = { root, loadTs, lib, registerFonts, integraFixtureDocument, renderFixturePng, luminance, rules, compareRules, inkOverlap, diffImage, canvasLib };
