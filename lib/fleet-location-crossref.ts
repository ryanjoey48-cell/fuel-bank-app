/**
 * V7.4 review-only cross-reference between EES Locations Directory records and Forth saved locations. Pure and read-only.
 *
 * The EES records have no coordinates and no confirmed pins, and the two sources share no id, so the only evidence is the NAME (Thai and
 * English, aliases, abbreviations) with an address overlap as extra support. A suggestion is never a link: nothing is stored or
 * changed, no coordinates are invented for the EES records, and two sites are never merged because their names look alike.
 *
 * Same name does not mean same place: Forth points that share a name but lie more than SITE_SEPARATION_M apart are different SITES.
 * A company with more than one site is reported as "multiple" so the office chooses, never auto-picked.
 */
import { metersBetween } from "./fleet-job-movement";

export type EesLocationLite = { id: string; company_name: string; thai_name?: string | null; alternative_names?: string[] | null; address?: string | null; province?: string | null; destination_type?: string | null };
export type ForthSiteLite = { id: string; name: string; groupLayer?: string | null; address?: string | null; latitude: number; longitude: number };
export type NameMatch = "exact" | "compact_equal" | "contains" | "similar";
export type CrossRefStatus = "strong" | "possible" | "multiple" | "none";
export type CrossRefCandidate = {
  forthName: string; groupLayer: string | null; nameMatch: NameMatch; addressOverlap: boolean;
  /** Distinct sites (points more than SITE_SEPARATION_M apart) and saved points carrying this name. */
  sites: number; points: number;
};
export type CrossRefResult = {
  eesId: string; eesName: string; status: CrossRefStatus; candidates: CrossRefCandidate[];
  reasons: ("exact_name" | "compact_name" | "partial_name" | "similar_name" | "address_overlap" | "several_sites" | "several_entrances" | "forth_name_shared_by_several_ees_records" | "no_similar_name")[];
};

export const SITE_SEPARATION_M = 1000;
const LEGAL = /\b(co|company|ltd|limited|inc|incorporated|corp|corporation|plc|public|thailand|thai|group|holding|holdings|logistics|logistic|transport|trading|industry|industries|international|intl)\b/g;
// NFKC rewrites Thai sara am (ำ) as two characters, so the words are normalised the same way before they are matched.
const THAI_LEGAL = new RegExp(["บริษัท", "จำกัด", "(มหาชน)", "มหาชน", "ห้างหุ้นส่วน", "หจก", "บจก", "บมจ", "ประเทศไทย", "ไทยแลนด์"].map(w => w.normalize("NFKC").replace(/[()]/g, "\\$&")).join("|"), "g");

/** Lowercase, drop punctuation, legal words and abbreviations dots; Thai and Latin both survive. */
export function normaliseCompanyName(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/&/g, " and ").replace(THAI_LEGAL, " ").replace(/[._,/\\()\-–—'"`+]/g, " ").replace(LEGAL, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
}
const compact = (normalised: string) => normalised.replace(/\s+/g, "");
const bigrams = (s: string) => { const out = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1); } return out; };
/** Sørensen–Dice on character bigrams of the compact forms: works for Thai (no spaces) and Latin. */
export function nameSimilarity(a: string, b: string): number {
  const x = compact(a), y = compact(b); if (!x || !y) return 0; if (x === y) return 1;
  const gx = bigrams(x), gy = bigrams(y); let overlap = 0, total = 0;
  for (const [g, n] of gx) { total += n; overlap += Math.min(n, gy.get(g) ?? 0); } for (const n of gy.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}
const addressTokens = (s: string | null | undefined) => new Set((s ?? "").normalize("NFKC").toLocaleLowerCase().split(/[^0-9a-z฀-๿]+/).filter(t => t.length >= 4 || /\d{2,}/.test(t)));

function compareNames(ees: readonly string[], forth: string): NameMatch | null {
  const f = normaliseCompanyName(forth); if (f.length < 2) return null; let best: NameMatch | null = null; const rank = { exact: 4, compact_equal: 3, contains: 2, similar: 1 } as const;
  const keep = (m: NameMatch) => { if (!best || rank[m] > rank[best]) best = m; };
  for (const raw of ees) {
    const e = normaliseCompanyName(raw); if (e.length < 2) continue;
    if (e === f) keep("exact"); else if (compact(e) === compact(f)) keep("compact_equal");
    else if (Math.min(compact(e).length, compact(f).length) >= 5 && (compact(e).includes(compact(f)) || compact(f).includes(compact(e)))) keep("contains");
    else if (Math.min(compact(e).length, compact(f).length) >= 4 && nameSimilarity(e, f) >= 0.82) keep("similar");
  }
  return best;
}

type Cluster = { points: ForthSiteLite[]; centre: { latitude: number; longitude: number } };
function siteClusters(points: readonly ForthSiteLite[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const p of points) {
    const home = clusters.find(c => metersBetween(c.centre, p) <= SITE_SEPARATION_M);
    if (home) home.points.push(p); else clusters.push({ points: [p], centre: { latitude: p.latitude, longitude: p.longitude } });
  }
  return clusters;
}

export function crossReferenceLocations(ees: readonly EesLocationLite[], forth: readonly ForthSiteLite[]): CrossRefResult[] {
  // Group Forth saved points by normalised name once.
  const byName = new Map<string, ForthSiteLite[]>();
  for (const f of forth) { const k = normaliseCompanyName(f.name); if (k.length < 2) continue; (byName.get(k) ?? byName.set(k, []).get(k)!).push(f); }
  const claimed = new Map<string, Set<string>>(); // forth name key -> EES ids that matched it exactly/compactly
  const raw = ees.map(e => {
    const names = [e.company_name, e.thai_name ?? "", ...(e.alternative_names ?? [])].filter(Boolean);
    const eesAddress = addressTokens(`${e.address ?? ""} ${e.province ?? ""}`);
    const candidates: (CrossRefCandidate & { key: string })[] = [];
    for (const [key, points] of byName) {
      const match = compareNames(names, points[0].name); if (!match) continue;
      const clusters = siteClusters(points);
      const forthAddress = new Set(points.flatMap(p => [...addressTokens(p.address)]));
      const overlap = [...eesAddress].filter(t => forthAddress.has(t)).length >= 2;
      candidates.push({ key, forthName: points[0].name, groupLayer: points[0].groupLayer ?? null, nameMatch: match, addressOverlap: overlap, sites: clusters.length, points: points.length });
      if (match === "exact" || match === "compact_equal") (claimed.get(key) ?? claimed.set(key, new Set()).get(key)!).add(e.id);
    }
    return { e, candidates };
  });
  const rank = { exact: 4, compact_equal: 3, contains: 2, similar: 1 } as const;
  return raw.map(({ e, candidates }) => {
    candidates.sort((a, b) => rank[b.nameMatch] - rank[a.nameMatch] || Number(b.addressOverlap) - Number(a.addressOverlap) || (a.forthName < b.forthName ? -1 : 1));
    const reasons: CrossRefResult["reasons"] = [];
    const strongPool = candidates.filter(c => c.nameMatch === "exact" || c.nameMatch === "compact_equal");
    let status: CrossRefStatus;
    if (candidates.length === 0) { status = "none"; reasons.push("no_similar_name"); }
    else {
      const top = candidates[0];
      const multipleNames = strongPool.length > 1;
      const multipleSites = top.sites > 1;
      const sharedByEes = strongPool.some(c => (claimed.get(c.key)?.size ?? 0) > 1);
      if (multipleNames || multipleSites || sharedByEes) { status = "multiple"; if (multipleSites) reasons.push("several_sites"); if (sharedByEes) reasons.push("forth_name_shared_by_several_ees_records"); }
      else if (strongPool.length === 1) status = "strong";
      else status = "possible";
      if (top.nameMatch === "exact") reasons.push("exact_name"); else if (top.nameMatch === "compact_equal") reasons.push("compact_name"); else if (top.nameMatch === "contains") reasons.push("partial_name"); else reasons.push("similar_name");
      if (top.addressOverlap) reasons.push("address_overlap");
      if (top.points > top.sites && top.sites === 1) reasons.push("several_entrances");
    }
    return { eesId: e.id, eesName: e.company_name, status, candidates: candidates.slice(0, 4).map(({ key: _key, ...c }) => c), reasons };
  });
}

type Lang = "en" | "th";
const R: Record<CrossRefResult["reasons"][number], [string, string]> = {
  exact_name: ["The names are the same after removing punctuation and company words.", "ชื่อตรงกันหลังตัดเครื่องหมายและคำว่าบริษัท"],
  compact_name: ["The names match when spacing is ignored.", "ชื่อตรงกันเมื่อไม่นับช่องว่าง"],
  partial_name: ["One name contains the other.", "ชื่อหนึ่งอยู่ในอีกชื่อหนึ่ง"],
  similar_name: ["The names are very similar but not the same.", "ชื่อคล้ายกันมากแต่ไม่เหมือนกัน"],
  address_overlap: ["The addresses share distinctive words.", "ที่อยู่มีคำสำคัญตรงกัน"],
  several_sites: ["The Forth name is used at more than one site more than 1 km apart; the office must choose.", "ชื่อใน Forth ใช้ที่หลายสถานที่ห่างกันเกิน 1 กม. สำนักงานต้องเลือกเอง"],
  several_entrances: ["Several saved points close together share the name (entrances).", "มีหลายจุดที่บันทึกใกล้กันใช้ชื่อเดียวกัน (ทางเข้า)"],
  forth_name_shared_by_several_ees_records: ["More than one EES record matches the same Forth name.", "มีหลายรายการ EES ตรงกับชื่อ Forth เดียวกัน"],
  no_similar_name: ["No similar Forth name was found.", "ไม่พบชื่อ Forth ที่คล้ายกัน"]
};
export const crossRefReason = (r: CrossRefResult["reasons"][number], language: Lang) => R[r][language === "th" ? 1 : 0];
export const crossRefStatusLabel = (s: CrossRefStatus, language: Lang) => ({ strong: ["Strong suggestion", "ข้อเสนอที่แข็งแรง"], possible: ["Possible match", "อาจตรงกัน"], multiple: ["Several competing matches", "มีหลายรายการที่แข่งกัน"], none: ["No reliable match", "ไม่พบรายการที่เชื่อถือได้"] } as const)[s][language === "th" ? 1 : 0];
