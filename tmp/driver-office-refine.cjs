const fs=require('fs');let f='components/driver/driver-navigation.tsx',s=fs.readFileSync(f,'utf8');let a=s.indexOf('return <Link key={href}'),b=s.indexOf('; })}',a);const block=s.slice(a,b);s=s.slice(0,a)+block.replace('return <Link key={href}', 'return href === "/driver/profile" ? <Link key={href}').replace('</Link>','</Link> : <a key={href} href={href} aria-current={active ? "page" : undefined} className={`driver-tab flex min-h-[48px] flex-col items-center justify-center gap-0.5 sm:min-h-14 sm:flex-row sm:gap-2 lg:min-h-16 lg:text-base ${active ? "driver-accent" : "text-[var(--driver-text-muted)] hover:text-[var(--driver-text-muted)]"}`}><Icon aria-hidden="true" className="h-5 w-5 lg:h-6 lg:w-6" /><span>{label}</span></a>')+s.slice(b);fs.writeFileSync(f,s);
f='lib/driver-operations.ts';s=fs.readFileSync(f,'utf8').replace('rows: OperationsRow[]; summary: OperationsSummary','rows: OperationsRow[]; summary: OperationsSummary; driverActivity: Record<string, { jobsToday: number; status: OperationStatus | null }>');fs.writeFileSync(f,s);
f='lib/driver-work-server.ts';s=fs.readFileSync(f,'utf8');const idx=s.indexOf('export async function driverOperations(');s=s.slice(0,idx)+`async function assignedOfficeBookings(admin: SupabaseClient, date: string, driverId?: string) {
  const bookings: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = admin.from("booking_diary").select(OFFICE_JOB_SELECT).eq("booking_date", date).not("driver_id", "is", null);
    if (driverId) query = query.eq("driver_id", driverId);
    const result = await query.order("pickup_time", { nullsFirst: false }).order("id").range(offset, offset + 499);
    if (result.error || !result.data) throw new DriverPortalError(503, "Assignments unavailable.");
    bookings.push(...(result.data as unknown as Record<string, unknown>[]).filter(liveBooking));
    if (result.data.length < 500) return bookings;
  }
}

`+s.slice(idx);a=s.indexOf('  const scheduled: Record<string, unknown>[] = [];');b=s.indexOf('  const active = await openOperationsBookings',a);s=s.slice(0,a)+'  const scheduled = await assignedOfficeBookings(admin, date);\n'+s.slice(b);s=s.replace('  return { date, fetchedAt, rows, summary: {',`  const driverActivity: OperationsResult["driverActivity"] = {};
  for (const booking of scheduled) {
    const key = String(booking.driver_id);
    const value = driverActivity[key] ?? { jobsToday: 0, status: null };
    value.jobsToday++; driverActivity[key] = value;
  }
  for (const row of rows) {
    const status = jobStatus(row.events);
    const value = driverActivity[row.driverId] ?? { jobsToday: 0, status: null };
    if (status !== "completed" && (value.status === null || value.status === "ready")) value.status = status;
    driverActivity[row.driverId] = value;
  }
  return { date, fetchedAt, rows, driverActivity, summary: {`);s=s.replace('    admin.from("booking_diary").select(OFFICE_JOB_SELECT).eq("driver_id", driverId).eq("booking_date", date).order("pickup_time", { nullsFirst: false }).order("id"),','    assignedOfficeBookings(admin, date, driverId),').replace('  if (assigned.error || !assigned.data) throw new DriverPortalError(503, "Assignments unavailable.");\n  const liveAssigned = (assigned.data as unknown as Record<string, unknown>[]).filter(liveBooking);','  const liveAssigned = assigned;');s=s.replace('  const bookings = (result.data as unknown as { driver_id:',`  if (page > 0 && result.count > 0 && !result.data.length && page * HISTORY_PAGE_SIZE >= result.count) {
    const adjusted = new URLSearchParams(params);
    adjusted.set("page", String(Math.floor((result.count - 1) / HISTORY_PAGE_SIZE)));
    return operationsHistory(admin, adjusted);
  }
  const bookings = (result.data as unknown as { driver_id:`);fs.writeFileSync(f,s);
f='components/admin/driver-operations-directory.tsx';s=fs.readFileSync(f,'utf8');a=s.indexOf('    const rows = operations.rows.filter');b=s.indexOf('\n  };',a);s=s.slice(0,a)+`    const activity = operations.driverActivity[driver.driverId];
    return { jobs: activity?.jobsToday ?? 0, status: activity?.status ? statusCopy[language][activity.status] : th ? "ไม่มีงานค้าง" : "No outstanding work" };`+s.slice(b);s=s.replace('import { jobStatus, statusCopy,','import { statusCopy,');fs.writeFileSync(f,s);
f='components/admin/driver-operations.tsx';s=fs.readFileSync(f,'utf8').replace('!Object.values(payload.summary).every(value => typeof value === "number" && Number.isFinite(value))','![payload.summary.driversToday, payload.summary.jobsToday, payload.summary.activeNow, payload.summary.attention, payload.summary.completedToday].every(value => Number.isInteger(value) && value >= 0) || !payload.driverActivity').replace('      row.driverName,','      row.driverName,\n      row.driverId,');s=s.replace('          {l.loading}\n        </div>','          {l.loading}\n          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5" aria-busy="true">{[1,2,3,4,5].map(value => <div key={value} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>\n        </div>');fs.writeFileSync(f,s);
f='app/api/admin/driver-operations/jobs/[bookingId]/route.ts';s=fs.readFileSync(f,'utf8').replace('if (!booking?.driver_id) throw new AdminApiError(404, "Job not found.");','if (!booking) throw new AdminApiError(404, "Job not found.");').replace('    const rows = await operationsRows','    if (!booking.driver_id && !completion.data) throw new AdminApiError(404, "Assigned driver not found.");\n    const rows = await operationsRows');fs.writeFileSync(f,s);
