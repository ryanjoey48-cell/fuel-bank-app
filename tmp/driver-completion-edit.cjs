const fs=require('fs');let f='components/driver/driver-job-detail.tsx',s=fs.readFileSync(f,'utf8').replace('import Link from "next/link";\n','');s=s.replace('<main className="driver-active-job mx-auto w-full max-w-3xl space-y-1 px-3 pb-4 pt-0 sm:px-6 sm:py-5">','<main className={`driver-active-job mx-auto w-full max-w-3xl space-y-1 px-3 pb-4 pt-0 sm:px-6 ${stage >= 4 ? "driver-completed-job sm:pt-3 sm:pb-4" : "sm:py-5"}`}>');s=s.replace('<Link href="/driver" className="driver-jobs-back inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--driver-text)]"><ArrowLeft className="h-4 w-4" />{labels.back}</Link>','{/* A document navigation fetches a new Home snapshot instead of a cached RSC route. */}\n      <a href="/driver" className="driver-jobs-back inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--driver-surface-soft)] px-3 text-sm font-semibold text-[var(--driver-text)]"><ArrowLeft className="h-4 w-4" />{labels.back}</a>');const a=s.indexOf('              <div className="rounded-2xl bg-[var(--driver-surface-soft)] px-3.5 py-3'),b=s.indexOf('\n            </>',a);s=s.slice(0,a)+`              <div className="driver-job-completed rounded-xl bg-[var(--driver-card)] px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--driver-accent)] text-[var(--driver-text)]"><Check aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} /></span>
                  <div className="min-w-0 flex-1">
                    <h2 id="job-next-action" className="text-xl font-bold leading-6 text-[var(--driver-text)]">{labels.completed}</h2>
                    {lastEvent ? <p className="mt-1 text-sm leading-5 text-[var(--driver-text-secondary)]"><time dateTime={lastEvent.eventTime}>{formatTimestamp(lastEvent.eventTime)}</time>{lastEvent.latitude !== null && lastEvent.longitude !== null ? " · GPS" : ""}</p> : null}
                  </div>
                </div>
                <a href="/driver" className="driver-completed-back driver-primary-action mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--driver-text)]"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{labels.back}</a>
              </div>`+s.slice(b);fs.writeFileSync(f,s);
for(const f of ['app/driver/(protected)/page.tsx','app/driver/(protected)/history/page.tsx']){let s=fs.readFileSync(f,'utf8');const i=s.indexOf('export default');s=s.slice(0,i)+'// Driver work is always read from the current authenticated server request.\nexport const dynamic = "force-dynamic";\n\n'+s.slice(i);fs.writeFileSync(f,s)}
f='public/sw.js';s=fs.readFileSync(f,'utf8').replace('  if (url.pathname.startsWith("/_next/")) {',`  // Never serve cached Driver RSC pages or job/profile API data after a write.
  // This also bypasses Driver responses stored by older versions of this worker.
  if (url.pathname === "/driver" || url.pathname.startsWith("/driver/") || url.pathname.startsWith("/api/driver/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.pathname.startsWith("/_next/")) {`);fs.writeFileSync(f,s);
