/**
 * V7.8.4 shared Fleet Tracking context in the URL: the vehicle registration is already there (?view=daily&vehicle=…); this adds the Bangkok date
 * range (?from=YYYY-MM-DD&to=YYYY-MM-DD) so a reload, a back/forward step or a shared link opens the same vehicle AND period.
 * Dates only. Never coordinates, positions, drivers or tokens. Reading these parameters only seeds the date inputs: it starts no request.
 */
export const SCOPE_MAX_DAYS = 62;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export type UrlScope = { from: string; to: string; day: string };

export const bangkokToday = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const real = (d: string) => DAY.test(d) && new Date(dayMs(d)).toISOString().slice(0, 10) === d;

/** A valid scope, or null. Rejects bad shapes, impossible dates, reversed ranges, the future and ranges over 62 days. */
export function parseScopeParams(params: URLSearchParams, today = bangkokToday()): UrlScope | null {
  const from = params.get("from") ?? "", to = params.get("to") ?? "";
  if (!real(from) || !real(to) || from > to || to > today) return null;
  if ((dayMs(to) - dayMs(from)) / 86_400_000 + 1 > SCOPE_MAX_DAYS) return null;
  return { from, to, day: to };
}

/** Writes the scope into a URL's query (or removes it when there is none). Everything else in the query is left alone. */
export function withScopeParams(url: URL, scope: { from: string; to: string } | null): URL {
  const next = new URL(url.toString());
  if (scope && real(scope.from) && real(scope.to)) { next.searchParams.set("from", scope.from); next.searchParams.set("to", scope.to); }
  else { next.searchParams.delete("from"); next.searchParams.delete("to"); }
  return next;
}
