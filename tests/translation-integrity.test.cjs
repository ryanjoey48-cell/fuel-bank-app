const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const BAD_TRANSLATION_MARKERS = [
  "เธ",
  "เน€",
  "โ€”",
  "โ€",
  "๏ฟฝ",
  "�",
  "□"
];

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function routeCopyBlock(source) {
  const keys = [
    "fastestRoute",
    "trafficAwareEstimate",
    "googleRecommendedRoute",
    "trafficDataUnavailable",
    "currentTrafficEstimate",
    "plannedTrafficEstimate",
    "fallbackRouteUsed",
    "routeNeedsRefresh",
    "standardDriveWarning",
    "calculated"
  ];
  return source
    .split(/\r?\n/)
    .filter((line) => keys.some((key) => line.includes(`${key}:`)))
    .join("\n");
}

test("Thai route status copy is readable UTF-8 and does not fall back to English", () => {
  for (const file of [
    "app/(dashboard)/booking-diary/page.tsx",
    "app/(dashboard)/trip-journey/page.tsx"
  ]) {
    const block = routeCopyBlock(read(file));
    for (const marker of BAD_TRANSLATION_MARKERS) {
      assert.equal(block.includes(marker), false, `${file} contains corrupted marker ${marker}`);
    }
    assert.match(block, /fallbackRouteUsed:\s*"Google ไม่พบเส้นทางที่ต้องการ ระบบจึงเลือกเส้นทางที่ใช้งานได้ดีที่สุดแทน"/);
  }
});

test("shared translation files do not contain replacement characters or corrupted punctuation markers", () => {
  for (const file of ["lib/translations.ts", "lib/shipment-translations.ts"]) {
    const source = read(file);
    for (const marker of ["๏ฟฝ", "�", "□", "โ€”", "โ€"]) {
      assert.equal(source.includes(marker), false, `${file} contains corrupted marker ${marker}`);
    }
  }
});
