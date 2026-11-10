/**
 * EES company details used by every Finance document and app header (single source).
 * Thai registered name confirmed by the owner (Nov 2026). Address and tax ID are the values already used by the
 * existing EES invoice layout. Phone supplied by the owner (Nov 2026). No bank or payment details are recorded
 * here until supplied by EES.
 *
 * Not covered here on purpose: depot / route addresses used for Maps geocoding (lib/ees-depot.ts, Trip Journey),
 * which are matched against stored route data.
 */
export const EES_COMPANY = {
  nameTh: "บริษัท เอ็กซ์เพิร์ท เอ็กซ์เพรส เซ็นเดอร์ จำกัด",
  nameEn: "EXPERT EXPRESS SENDER CO., LTD.",
  /** Same registered name in title case, used in report headers and PDF footers. */
  nameEnTitle: "Expert Express Sender Co., Ltd.",
  addressEn: "88 Happy Place Road, Klongsampravet, Latkrabang, Bangkok 10520",
  addressTh: "88 ถนนแฮปปี้เพลซ แขวงคลองสามประเวศ เขตลาดกระบัง กรุงเทพฯ 10520",
  taxId: "0105559196532",
  phone: "094-6782416" as string | null
} as const;
