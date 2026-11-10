/**
 * Thai baht amount in words from an integer number of satang (never a float).
 * 475200 → "สี่พันเจ็ดร้อยห้าสิบสองบาทถ้วน"; 12345 → "หนึ่งร้อยยี่สิบสามบาทสี่สิบห้าสตางค์".
 */
const DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** 0 <= n < 1,000,000 */
function belowMillion(n: number, hasHigherGroup = false): string {
  const digits = String(n).split("").map(Number);
  const len = digits.length;
  let out = "";
  digits.forEach((digit, index) => {
    if (digit === 0) return;
    const place = len - index - 1;
    if (place === 1) { out += digit === 1 ? "สิบ" : digit === 2 ? "ยี่สิบ" : `${DIGITS[digit]}สิบ`; return; }
    if (place === 0 && digit === 1 && (len > 1 || hasHigherGroup)) { out += "เอ็ด"; return; }
    out += `${DIGITS[digit]}${PLACES[place]}`;
  });
  return out;
}

function integerText(n: number): string {
  if (n === 0) return DIGITS[0];
  const parts: string[] = [];
  let rest = n;
  while (rest > 0) { const group = rest % 1_000_000; rest = Math.floor(rest / 1_000_000); parts.unshift(belowMillion(group, parts.length === 0 && rest > 0)); }
  // Join groups with "ล้าน"; a group that is exactly 0 contributes nothing but keeps its ล้าน.
  return parts.map((part, index) => (index < parts.length - 1 ? `${part}ล้าน` : part)).join("");
}

export function thaiBahtText(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) throw new RangeError("thaiBahtText expects a non-negative integer number of satang");
  const baht = Math.floor(satang / 100);
  const fraction = satang % 100;
  if (baht === 0 && fraction > 0) return `${integerText(fraction)}สตางค์`;
  const bahtPart = `${integerText(baht)}บาท`;
  return fraction === 0 ? `${bahtPart}ถ้วน` : `${bahtPart}${integerText(fraction)}สตางค์`;
}
