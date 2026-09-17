# Maintenance usability and history polish

Completed locally. No deployment, production writes, database migration, RLS change, or receipt-storage policy change was performed.

## History redesign

- Compact is the default. Cards emphasize registration and total, with a quieter date, supplier and available service mileage.
- Full receipt descriptions, prices, notes, filenames and activity IDs stay inside View details. Three unique category chips are shown, followed by +N more when needed.
- Receipt attached status is compact. Single receipts have a View receipt action; multiple receipts expand the file selection area. Uploader identifiers are hidden under Record activity.
- The summary strip uses the filtered records: record count, distinct vehicles, recorded maintenance spend and average per record. An empty average is shown as a dash.
- Newest/oldest/cost/registration sorting, Compact/Detailed view, and grouping by vehicle are implemented. Vehicle groups show record count and subtotal.
- Vehicle history remains newest first by default and includes older records independently of the main reporting date filter.

## Form, reminders and analytics

- The form is grouped into Vehicle & Receipt, Maintenance Items, Receipt Attachment and Optional Details.
- Item cards use Item 1, Item 2, etc. Duplicate/remove controls are quieter; optional item notes/Thai description, reminders and downtime are collapsed.
- Receipt files can be selected before creating the record. After Save, queued files upload automatically. Remaining failed uploads stay selected for explicit retry; closing with queued files requires confirmation.
- Reminder choices are plain language, with six options, readable standard schedules, and optional next-due/advance-warning adjustments. Existing schedule fields and validation remain intact.
- The default reporting period is this year, with last-12-months and all-time presets plus manual dates.
- Status explanations are available in a collapsed help section. Upcoming reminders default to actionable/unassessed entries and show six at a time; status cards still use the existing calculation.
- Analytics adds a filtered fleet summary and explanations for missing mileage boundaries, conflicts/resets, gaps, missing fuel history and absent Maintenance entries. Existing cost-per-km safeguards are unchanged.
- English and Thai labels are included for all additions.

## Verification

- `npm run build`: PASS, using `FUEL_BANK_ISOLATED_BUILD=1` to avoid disturbing the existing port-3000 build.
- `npm test`: 240/240 PASS, including nine Maintenance regression tests.
- Standalone TypeScript check: only the four pre-existing errors in `_vehicle_performance_release/app/(dashboard)/vehicle-performance/page.tsx`; no errors in the changed Maintenance files.
- Browser fixtures: compact/expanded cards, sorting, Detailed view, vehicle grouping, opening the eleven-item edit form, multiple item entry, queued PDF/PNG/JPG uploads after save, disposable record deletion, vehicle history, empty analytics, standard-reminder UI and fifty-record rendering checked.
- Browser responsive checks at 1440, 834 and 390 pixel widths: no horizontal overflow in the tested history/form states. English and Thai rendering checked.
- Real data reviewed through GET-only reads into an isolated, read-only local snapshot: vehicles 701-1654, 61-2835 and 79-2945; 3 records, 25 items, 3 attachments. Summary: THB 48,380 total and THB 16,126.67 average. The expanded 79-2945 record retains all eleven line items.
- No console errors appeared in the final real-snapshot UI review. Production receipt metadata was read; live staff-session signed-URL permissions and actual production uploads were not retested. Receipt save/delete tests used only in-memory fixture data.

## Files changed in this polish pass

- `app/(dashboard)/maintenance/page.tsx`
- `app/(dashboard)/maintenance/analytics/page.tsx`
- `components/maintenance-record-form.tsx`
- `components/maintenance-reminder-fields.tsx` (new)
- `components/maintenance-attachments.tsx`
- `components/maintenance-history.tsx`
- `components/maintenance-record-card.tsx` (new)
- `components/maintenance-record-collection.tsx` (new)
- `components/maintenance-period-presets.tsx` (new)
- `lib/maintenance-translations.ts`
- `lib/maintenance-ux.ts` (new presentation helpers)
- `tests/maintenance.test.cjs`
- `scripts/maintenance-ui-fixture.cjs` (new isolated browser fixture)
- `scripts/read-maintenance-ui-snapshot.cjs` (new GET-only review script; credentials are never emitted)
- `.gitignore` (exclude private temporary review data and generated fixture assets)
- This report.

## Before deployment

No new SQL is required for these changes. The previously identified duplicate migration timestamp/manual migration-history reconciliation and archived-release TypeScript errors remain outside this UI pass. Production receipt upload permissions were not changed or exercised with new data. Deployment remains subject to approval.

The fresh local app is available on port 3002. The read-only snapshot preview is on port 3004; it is a review copy, not a live editing surface.
