# Development database: diagnosis and safe-use plan (REVIEW ONLY)

Nothing here switches a connection, edits `.env.local` or Vercel settings, wakes, restores, resets or deletes any project, or copies production records.

## 1. Diagnosis of `wpmnjfncaoogssgpqxek` ("EES Development", ap-northeast-2, PG 17.11)
| Finding | Evidence |
|---|---|
| Blocker | The project is **hibernated / paused (free plan)**. Every connector call timed out; the database port is unreachable while the API gateway still answers. |
| Not a permissions problem | The same connector reads production instantly, so the token is valid. Timeouts occurred for `select 1`, table listing and migration listing, i.e. before any permission check. |
| Network | `output/fleet-intelligence-v48/network-diagnosis.cjs` (key-less DNS, TCP 5432, HTTPS): production DB reachable over IPv6 from this machine; Development DB not reachable; API gateway reachable for both (401 = alive). |
| Unknown until woken | Schema equivalence, RLS/grants, auth config (sign-up, email confirmation, redirect URLs), whether any real production records were ever loaded. The repo shows it was never connected to the app. |
| Who can fix | Only the owner: wake the project in the Supabase dashboard (free-plan projects pause after inactivity and have a restore window). Do not "restore" or "reset" from here. |
After it is awake: run `docs/stage0-environment-fingerprint-readonly.sql` on both projects and compare; also check its tables for non-synthetic rows with a count-only query before loading anything.

## 2. Rules for using Development safely
1. One workspace, `http://localhost:3000`, one dev server. Do not create branches, worktrees or clones.
2. Production and Development credentials live in **separate, ignored files**: `.env.local` (current production, unchanged) and `.env.staging.local` (Development; `.env.example` already says to prefer it). The owner switches by launching with the staging file, never by editing the production file.
3. Test commands that can write must call the existing guards in `lib/ees-database-environment.ts` first:
   * `assertNotConfirmedProductionForExperimentalSql(url)` for experimental SQL and seed scripts,
   * `assertApprovedStagingTarget(url, process.env.EES_APPROVED_STAGING_PROJECT_REF)` for DDL helpers (it refuses production, a missing ref, or a mismatch),
   * `assertFleetMonitorSupabaseTargetFromEnv` for Fleet Monitor tools.
   A script that does not call one of them must be read-only.
4. **Synthetic data only.** Vehicles `TEST-001..`, drivers `Test Driver n`, no real plates, names, bank details or GPS history. A seed script must carry the synthetic marker and be refused when the target is production.
5. Visible environment label: the app shows the database environment banner (project class) so a screenshot always identifies the target. A staging session must show "Development".
6. No hardcoded credentials anywhere; keys come from env only. Test accounts (admin, office_staff, read_only, unregistered, driver) are created by the owner in Development and their passwords are never written into the repo or chat.
7. Production writes from a test command are prevented by layers: the guards above, a different env file, and Stage 0/1 once approved (anon and non-office callers cannot write).

## 3. Review-only configuration examples
`.env.staging.local` (owner creates; never committed; values are placeholders):
```
NEXT_PUBLIC_SUPABASE_URL=https://wpmnjfncaoogssgpqxek.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<development publishable key>
SUPABASE_SERVICE_ROLE_KEY=<development secret key>
EES_APPROVED_STAGING_PROJECT_REF=wpmnjfncaoogssgpqxek
```
Run command (owner decision; shown for review, not executed):
```
npx dotenv -e .env.staging.local -- npm run dev
```
Vercel: leave Production and Preview pointing at production until the owner approves a separate Preview-to-Development mapping.

## 4. Order of work once Development is awake and approved
1. Fingerprint compare (section 1). 2. Apply the schema migrations the app needs (from `supabase/migrations`, in order) to Development only. 3. Create the five test accounts. 4. Load synthetic data. 5. Rehearse Stage 0, then Stage 1 group by group, running `docs/stage1-validation-harness-review-only.sql` (target `DEVELOPMENT`) after each. 6. Rehearse rollback. 7. Only then request production approval.

## 5. Approval checklist for the owner (each is a separate yes)
- [ ] Wake `wpmnjfncaoogssgpqxek` in the dashboard (owner action).
- [ ] Confirm it contains no real production records (count-only check).
- [ ] Approve creating `.env.staging.local` and running the dev server against it.
- [ ] Approve creating the five test accounts there.
- [ ] Approve loading synthetic data.
- [ ] Approve applying the schema migrations to Development.
