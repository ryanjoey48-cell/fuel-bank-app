# Importing the historical locations workbook

The historical workbook was not present in the repository when the Locations Directory was built.

1. Place the supplied Excel file in the project root as `locations-history.xlsx` (or pass its full path to the script).
2. Run a review-only import from the project root:

   ```powershell
   node scripts/import-locations.cjs .\locations-history.xlsx
   ```

3. Open `locations-history.xlsx.locations-review.json`. Review every flagged row, correct the workbook, and rerun until the valid/flagged counts make sense. The report records worksheet and row source for each candidate. Exact repeated company-and-address pairs are blocked by default. Repeated company names or addresses are marked as possible duplicates because a company can have multiple destinations; inspect these manually. A possible-duplicate warning does not overwrite or drop a distinct record.
4. Once the report is clean, apply the migration `supabase/migrations/20261019100000_ees_locations_directory.sql` to the intended Supabase project, then rerun with `--apply`:

   ```powershell
   node scripts/import-locations.cjs .\locations-history.xlsx --apply
   ```

   The apply mode requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the process environment. It inserts rows with no validation errors, preserves alternative names and source information, and always imports rows as `Needs Check`. Possible-duplicate warnings are reported but do not block distinct records; exact company-and-address matches are blocked. If you reviewed and explicitly want to import an exact duplicate pair, pass `--include-reviewed-duplicates`. The importer never updates or deletes existing locations. Review the report generated after applying and check the inserted count before repeating an import.

Google Maps URLs must use HTTPS and a recognized Google Maps host/path. The presence of a Maps URL does not mark an address or pin as verified. The 103 historical records should be checked against the source workbook and in Google Maps before changing their status to `Verified`.
