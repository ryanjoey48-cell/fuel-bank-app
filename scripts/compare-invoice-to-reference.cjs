// Renders the INTEGRA fixture and compares it with the owner's reference PDF render.
// Usage: node scripts/compare-invoice-to-reference.cjs [outDir]
// Needs <outDir>/ref-p1.png (node scripts/pdf-reference-tools.mjs <pdf> <outDir>/ref 3).
const fs = require('node:fs'); const path = require('node:path');
const h = require('../tests/helpers/invoice-compare.cjs');
(async () => {
  const out = path.resolve(process.argv[2] || path.join(h.root, '.ees-local', 'invoice-ref'));
  const { doc } = h.integraFixtureDocument();
  const [gen] = await h.renderFixturePng(3, doc);
  fs.writeFileSync(path.join(out, 'generated-p1.png'), gen);
  const ref = await h.luminance(fs.readFileSync(path.join(out, 'ref-p1.png'))); const g = await h.luminance(gen);
  fs.writeFileSync(path.join(out, 'compare-p1.png'), await h.diffImage(ref, g));
  const cmp = h.compareRules(h.rules(ref, 3), h.rules(g, 3));
  const ink = h.inkOverlap(ref, g, 4);
  console.log(JSON.stringify({ size: [g.width, g.height], rules: { reference: cmp.referenceCount, generated: cmp.generatedCount, missing: cmp.missing.length, extra: cmp.extra.length }, ink: { referenceCovered: +ink.referenceCovered.toFixed(3), generatedCovered: +ink.generatedCovered.toFixed(3) } }));
  if (cmp.missing.length) console.log('missing', JSON.stringify(cmp.missing));
  if (cmp.extra.length) console.log('extra', JSON.stringify(cmp.extra));
})();

// Three-up: original PDF render | reproduced original | modern proposal (same page size and resolution).
(async () => {
  const fs2 = require('node:fs'); const path2 = require('node:path');
  const { createCanvas, loadImage } = h.canvasLib();
  const out = path2.resolve(process.argv[2] || path2.join(h.root, '.ees-local', 'invoice-ref'));
  const { doc } = h.integraFixtureDocument();
  const [modern] = await h.renderFixturePng(3, doc, 'modern');
  fs2.writeFileSync(path2.join(out, 'modern-p1.png'), modern);
  const imgs = await Promise.all(['ref-p1.png', 'generated-p1.png', 'modern-p1.png'].map((f) => loadImage(fs2.readFileSync(path2.join(out, f)))));
  const c = createCanvas(imgs[0].width * 3, imgs[0].height); const x = c.getContext('2d');
  imgs.forEach((img, i) => x.drawImage(img, i * imgs[0].width, 0));
  fs2.writeFileSync(path2.join(out, 'three-up-p1.png'), c.toBuffer('image/png'));
  console.log('wrote modern-p1.png and three-up-p1.png');
})();
