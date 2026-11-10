/**
 * V7.8.4 review reasons for a vehicle-day, as codes plus their English and Thai wording. Pure and dependency-free on purpose: the operating
 * summary imports only this file, so it does not pull the whole chronology model into every component that shows the reasons.
 */
export type ReviewItem =
  | { code: "provider_withheld" } | { code: "cross_midnight" }
  | { code: "sources_disagree_in_visits"; count: number } | { code: "long_unobserved"; count: number } | { code: "ambiguous_segments"; count: number };

export function reviewItemText(item: ReviewItem, language: "en" | "th"): string {
  const th = language === "th";
  switch (item.code) {
    case "provider_withheld": return th ? "ยอดรวมรายวันของ Forth ถูกระงับ: รายงานกระทบยอดไม่ได้" : "Forth day total is withheld: the report does not reconcile.";
    case "cross_midnight": return th ? "GPS แสดงการเคลื่อนที่ข้ามเที่ยงคืนซึ่งไม่อยู่ในรายงานรายวันของ Forth" : "GPS movement crosses midnight and is not in Forth's daily report.";
    case "sources_disagree_in_visits": return th ? `${item.count} การเข้าเยี่ยมมีการเคลื่อนที่ที่จุดจอด GPS ไม่แสดง` : `${item.count} visit(s) contain movement the GPS stop does not show.`;
    case "long_unobserved": return th ? `${item.count} ช่วงที่ไม่ได้สังเกตนานเกิน 10 นาที` : `${item.count} unobserved period(s) longer than 10 minutes.`;
    case "ambiguous_segments": return th ? `${item.count} ช่วงของผู้ให้บริการที่ไม่ชัดเจน` : `${item.count} ambiguous provider segment(s).`;
  }
}
