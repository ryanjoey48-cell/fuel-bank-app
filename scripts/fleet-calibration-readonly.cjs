#!/usr/bin/env node
// V5.5 calibration run. READ ONLY: GET reads of Booking Diary with the public key, and a fixed allowlist of Forth read endpoints
// (token, tracking, one log read and one parking report per vehicle-day). No database writes, no provider commands, no secrets printed,
// and no coordinates in the output (offsets, times, counts and scores only).
//   node scripts/fleet-calibration-readonly.cjs <cases.json> <out.json> <bookings.json> <cacheDir>
// Booking rows come from a file exported by a read-only SQL query (the public key cannot read the Booking Diary). Forth payloads are cached in <cacheDir>
// (outside the repository) so a repeat analysis makes no new Forth request.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(name, cache = new Map()) {
  const file = path.resolve(root, name); if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module); cache.set(file, m); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m.require = r => r === 'server-only' ? {} : r.startsWith('.') || r.startsWith('@/') ? load((r.startsWith('@/') ? r.slice(2) : path.relative(root, path.resolve(path.dirname(file), r))) + '.ts', cache) : require(r);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports;
}
function envFile() {
  const result = {}; const p = path.join(root, '.env.local'); if (!fs.existsSync(p)) return result;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line); if (!m) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); result[m[1]] = v; }
  return { ...result, ...process.env };
}
const key = s => String(s ?? '').normalize('NFKC').replace(/[\s\-‐‑‒–—]/g, '').toUpperCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hhmm = iso => iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : null;

async function main() {
  const [casesPath, outPath, bookingsPath, cacheDir] = process.argv.slice(2);
  fs.mkdirSync(cacheDir, { recursive: true });
  const allBookings = JSON.parse(fs.readFileSync(bookingsPath, 'utf8'));
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  if (!Array.isArray(cases) || cases.length > 14) throw new Error('at_most_14_vehicle_days');
  const env = envFile();
  const out = { capturedAt: new Date().toISOString(), forthRequests: [], writes: 0, cases: [] };
  let authorizedDevice = null;
  const fetcher = async (url, init) => {
    const parsed = new URL(url);
    const logAllowed = authorizedDevice && init?.method === 'GET' && new RegExp('^/trackingresource/api/log/' + authorizedDevice + '/[0-9]{14}/[0-9]{14}$').test(parsed.pathname);
    const tripsAllowed = authorizedDevice && parsed.pathname === '/trackingresource/api/vehicle/parkingTrip' && init?.method === 'POST';
    if (parsed.hostname !== 'webapi.forthtrack.com' || (!['/authorizationserver/token', '/trackingresource/api/tracking'].includes(parsed.pathname) && !logAllowed && !tripsAllowed)) throw new Error('endpoint_not_authorized');
    const response = await fetch(url, init); out.forthRequests.push({ endpoint: parsed.pathname.replace(/\/[0-9]{14}\/[0-9]{14}$/, '/<window>').replace(/log\/[^/]+/, 'log/<device>'), status: response.status }); return response;
  };
  const service = load('lib/forth-tracking-server.ts').createForthTrackingService({ environment: env, fetcher });
  const fleet = await service.getFleetData();
  out.forth = { connectionStatus: fleet.connectionStatus, records: fleet.records.length };
  const dayLib = load('lib/fleet-intelligence-day.ts'), vr = load('lib/fleet-visit-recognition.ts'), sum = load('lib/fleet-vehicle-day-summary.ts'), stopLib = load('lib/fleet-stop-intelligence.ts');
  for (const c of cases) {
    const rec = { id: c.id, day: c.day, registration: c.registration, why: c.why };
    out.cases.push(rec);
    try {
      const bookings = allBookings.filter(b => b.booking_date === c.day && b.reg === c.registration).map(({ reg, ...b }) => b);
      rec.bookingCount = bookings.length;
      const matches = fleet.records.filter(r => key(r.vehicleRegistration) === key(c.registration));
      rec.identity = { forthMatches: matches.length, uniqueDevice: matches.length === 1 && fleet.records.filter(r => r.gpsDeviceId === matches[0].gpsDeviceId).length === 1 };
      if (!rec.identity.uniqueDevice) { rec.error = 'no_unique_forth_device'; continue; }
      const deviceId = matches[0].gpsDeviceId; authorizedDevice = deviceId; const stamp = c.day.replaceAll('-', '');
      const cacheFile = path.join(cacheDir, `${stamp}_${key(c.registration)}.json`);
      let parking, log;
      if (fs.existsSync(cacheFile)) { const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); parking = cached.parking; log = cached.log; rec.forthSource = 'cache'; }
      else {
        await sleep(2500);
        parking = await service.getParkingReport({ deviceId, forthDate: stamp, language: 'en' });
        if (!parking.ok || !Array.isArray(parking.payload)) { rec.error = `parking_report_${parking.status ?? 'failed'}`; continue; }
        await sleep(2500);
        log = await service.getLogReport({ deviceId, startTime: `${stamp}000000`, endTime: `${stamp}235959` });
        fs.writeFileSync(cacheFile, JSON.stringify({ parking: { ok: parking.ok, payload: parking.payload }, log: { ok: log.ok, payload: log.payload } })); rec.forthSource = 'live';
      }
      const evidence = dayLib.buildProviderDay({ vehicleId: c.registration, registration: c.registration, deviceId, day: c.day, capturedAt: new Date().toISOString(), reportRows: parking.payload, logRows: log.ok && Array.isArray(log.payload) ? log.payload : null });
      const jobs = dayLib.suggestDayJobs(c.registration, c.registration, c.day, bookings, evidence, {});
      const ledger = evidence.journeyLedger;
      const analysis = sum.analyseDay({ day: c.day, journeyLedger: ledger, providerReconciled: evidence.provider.arithmetic.status === 'pass', providerComplete: evidence.sources.providerReported.completeness === 'complete' && !evidence.provider.segments.some(x => !x.end), providerKm: evidence.sources.providerReported.value, jobs: jobs.map(j => ({ jobId: j.jobId, workOrder: j.workOrder, pickupTime: j.pickupTime, bookingAssignment: j.bookingAssignment === 'stable_vehicle_id' ? 'stable_vehicle_id' : 'registration_only' })) });
      const obs = [...evidence.observedPoints.map(p => ({ ...p, speedKph: p.speedKph ?? null, verified: true })), ...(evidence.reportedPoints ?? []).map(p => ({ ...p, speedKph: p.speedKph ?? null, verified: false }))];
      const clusters = stopLib.detectStopClusters(obs); const visits = vr.mergeStopsIntoVisits(clusters, obs);
      rec.day = { providerKm: evidence.sources.providerReported.value, gpsKm: evidence.sources.gpsDerived.value, arithmetic: evidence.provider.arithmetic.status, positionsRecorded: evidence.gps.observations, positionsVerified: evidence.gps.verifiedObservations, positionsUsed: obs.length, usedVerified: evidence.observedPoints.length, usedUnverified: (evidence.reportedPoints ?? []).length,
        unknownCoverageMin: Math.round(evidence.gps.unknownSeconds / 60), logAvailable: evidence.logAvailable, journeys: { moving: ledger.totals.movingJourneys, stops: ledger.totals.stops, openFinal: ledger.totals.openFinal }, unallocatedKm: analysis.allocation.unallocatedKm, candidateKm: analysis.allocation.candidateKm, confirmedKm: analysis.allocation.confirmedJobKm,
        stopClusters: clusters.filter(k => k.kind === 'stop').length, slowMovement: clusters.filter(k => k.kind === 'slow_movement').length, visits: visits.length, longVisits20min: visits.filter(v => v.clusters.reduce((n, k) => n + k.dwellMs.min, 0) >= 20 * 60_000).map(v => ({ from: hhmm(v.first.firstAt), to: hhmm(v.last.lastAt), minutes: Math.round(v.clusters.reduce((n, k) => n + k.dwellMs.min, 0) / 60_000), stops: v.clusters.length, quality: v.clusters.every(k => k.sourceQuality === 'verified_gps') ? 'verified_gps' : v.clusters.every(k => k.sourceQuality === 'unverified') ? 'unverified' : 'mixed' })) };
      const claimed = new Set();
      rec.jobs = jobs.map(j => {
        const r = j.visitRecognition; const role = name => { const x = r[name]; const top = x.candidates[0]; if (top) claimed.add(top.key);
          return { summary: x.summary, zoneM: x.searchZoneM, candidates: x.candidates.length, driveBys: x.driveBys.map(d => ({ at: hhmm(d.at), kph: d.speedKph, closestM: d.closestM })), otherLongStops: x.otherLongStops.map(o => ({ from: hhmm(o.firstAt), to: hhmm(o.lastAt), minutes: o.dwellMinutes, km: Math.round(o.distanceFromPointM / 100) / 10, quality: o.sourceQuality })),
            top: top ? { zone: top.zone, distanceM: top.distanceFromPointM, arrival: [hhmm(top.arrival.earliest), hhmm(top.arrival.latest)], departure: [hhmm(top.departure.earliest), hhmm(top.departure.latest)], stayMin: [top.dwell.minMinutes, top.dwell.maxMinutes], stops: top.stops, quality: top.sourceQuality, weight: top.weight, confidence: top.confidence, reasons: top.reasons, alternatives: top.alternatives } : null,
            second: x.candidates[1] ? { distanceM: x.candidates[1].distanceFromPointM, weight: x.candidates[1].weight, arrival: [hhmm(x.candidates[1].arrival.earliest), hhmm(x.candidates[1].arrival.latest)] } : null }; };
        const pickup = role('pickup'), delivery = role('delivery');
        const sensitivity = []; for (const zone of [300, 450, 600, 800, 1000]) for (const minStay of [0, 5, 10, 20]) {
          const alt = vr.recogniseJobVisits({ observations: obs, pickup: { point: j.stopAnalysis?.pickup?.point.point ?? null, verified: j.stopAnalysis?.pickup?.point.verified ?? false, radiusM: j.stopAnalysis?.pickup?.point.radiusMeters ?? 150 }, delivery: { point: j.stopAnalysis?.delivery?.point.point ?? null, verified: j.stopAnalysis?.delivery?.point.verified ?? false, radiusM: j.stopAnalysis?.delivery?.point.radiusMeters ?? 150 }, scheduledPickupMs: j.pickupTime && /^\d\d:\d\d/.test(j.pickupTime) ? Date.parse(`${c.day}T${j.pickupTime.slice(0, 8).length === 5 ? j.pickupTime + ':00' : j.pickupTime.slice(0, 8)}+07:00`) : null, options: { searchZoneUnverifiedM: zone, minVisitMinutes: minStay } });
          sensitivity.push({ zone, minStay, pickup: [alt.pickup.summary, alt.pickup.candidates.length, alt.pickup.candidates[0]?.weight ?? null], delivery: [alt.delivery.summary, alt.delivery.candidates.length, alt.delivery.candidates[0]?.weight ?? null] });
        }
        const sched = j.pickupTime ? { scheduled: j.pickupTime.slice(0, 5), arrivalMinusScheduledMin: pickup.top ? Math.round((Date.parse(`${c.day}T${pickup.top.arrival[1]}:00+07:00`) - Date.parse(`${c.day}T${j.pickupTime.slice(0, 5)}:00+07:00`)) / 60000) : null } : null;
        return { booking: j.bookingRef, route: `${j.pickupName ?? '?'} > ${j.deliveryName ?? '?'}`, coords: { pickup: j.scheduledPickup ? 'booking_unverified' : 'missing', delivery: j.scheduledDelivery ? 'booking_unverified' : 'missing' }, workOrder: j.workOrder, vehicleIdLinked: j.bookingAssignment === 'stable_vehicle_id', schedule: sched, sequence: r.sequence, pickup, delivery, sensitivity };
      });
    } catch (error) { rec.error = String(error?.message ?? error).slice(0, 120); }
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    if (rec.forthSource === 'live') await sleep(3000);
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ cases: out.cases.map(c => ({ id: c.id, ok: !c.error, error: c.error ?? null, jobs: c.jobs?.length ?? 0 })), forthRequests: out.forthRequests.length }));
}
main().catch(e => { console.error('failed:', String(e?.message ?? e).slice(0, 200)); process.exit(1); });
