# Stage 0 supervised execution runbook (REVIEW ONLY, NOT EXECUTED)

Status: **PENDING APPROVAL.** Production is **not** secured. Nothing in this runbook has been run.
Target: project `hafoaurzfgkkwpvzedvd` ("Fuel Tracker App", CONFIRMED PRODUCTION). Never `wpmnjfncaoogssgpqxek` (Development).
Change: `docs/stage0-anon-revoke-review-only.sql` Section A (revoke `anon` on 15 tables and 4 sequences). Rollback: Section B of the same file.

## 0. Approval wording required (exact)
> Run Section A of `docs/stage0-anon-revoke-review-only.sql` on project `hafoaurzfgkkwpvzedvd` (Fuel Tracker App, production), committing the transaction, at [time], with the owner present.

Without that sentence from the owner in chat, nobody runs anything. Approval of Stage 0 does not approve Stage 1, 1b, 1c or 2.

## 1. Before the window (owner + operator, 15 minutes)
| # | Check | Pass condition |
|---|---|---|
| 1 | Backups | Owner confirms in the Supabase dashboard what backup exists (production is on the free plan; automatic backups and PITR are unverified). If none, take a manual export of the 15 tables first. Stage 0 changes no data, so this is belt and braces, not a blocker the owner cannot waive. |
| 2 | Identity | SQL editor header shows project ref `hafoaurzfgkkwpvzedvd`. The script also asserts PG 17, the 15 tables, and an active admin. |
| 3 | Drift | Run `docs/stage0-environment-fingerprint-readonly.sql`; compare with the baseline in `reports/2026-11-06-stage0-preflight.md` section C. Any difference: stop and re-audit. |
| 4 | Quiet moment | Office traffic is about 08:00-20:45 Asia/Bangkok. Prefer outside that, or accept a 1-2 second lock wait. |
| 5 | People | Owner present. One office user and one administrator ready to click through (step 4). A driver account ready for the portal check. |
| 6 | Rollback ready | Section B open in a second editor tab, not run. |
| 7 | Baseline log count | Note the number of anonymous requests to the 15 tables in the last hour (Logs Explorer), for comparison afterwards. |

## 2. Execution
1. Paste Section A. Read the BEFORE assertion output: it must pass unmodified.
2. Replace the final `rollback;` with `commit;` **only after** the owner has said the approval sentence for this window.
3. Run. The script holds a 5 s lock timeout, so a blocked statement fails fast instead of stacking up behind traffic.

## 3. STOP condition (exact)
Stop immediately, do **not** commit, and run `rollback;` if ANY of these appear before the commit:
* the BEFORE assertion raises an exception (state differs from the audit),
* the identity guard raises (not PG 17, a table missing, or no active admin),
* a `lock_timeout` error occurs,
* the AFTER REVOKE assertion raises (anon still holds a privilege, or authenticated / service_role changed).

## 4. Validation immediately after commit (within 10 minutes)
| Actor | Test | Expected |
|---|---|---|
| Anonymous | `GET /rest/v1/<t>?select=id&limit=0` with the public key for each of the 15 tables | HTTP 401 / code 42501 on all 15. Controls unchanged: `booking_diary` 200, `clients` 200, `account_access` 400, `driver_accounts` 401. |
| Office staff | Fleet Tracking, six vehicle tabs, Fuel Logs (read and save), Weekly Mileage, Shipments, Safety, Maintenance oil changes | Load and save as before. |
| Administrator | the above plus HR / drivers, vehicle performance drafts, user admin, Fleet Intelligence playback | Same. |
| Driver | portal sign-in, jobs, safety check | Unchanged (service role, `driver_portal` role has no grants here). |
| Server routes | evidence routes, HR route, V4 drafts, `/api/finance-*` | No 5xx. |
| Sign-in / sign-up | sign in; open the sign-up page | Unchanged (Auth API, not these tables). |
| Logs, next hour | anonymous calls to the 15 | Only denied (401) requests. No rise in 5xx or in `authenticated` 401/403 on the 15. |

## 5. Rollback triggers (exact)
Run Section B (`grant all ... to anon` + the 4 sequence grants, then its assertion) if ANY of these occur within the first hour:
* an office or admin screen that worked before now errors on one of the 15 tables,
* any `authenticated` or `service_role` request to the 15 returns 401 / 42501,
* a legitimate anonymous caller appears in the logs (a script or integration not found in the code audit),
* the owner asks for it.
Do **not** roll back merely because an old diagnostic script (`scripts/diagnose-supabase-api-key.cjs`, `inspect-maintenance-rest.cjs`, `maintenance-upgrade-live-check.cjs`, `vehicle-performance-reconciliation-diagnostic.cjs`, `vehicle-registration-history-diagnostic.cjs`) now returns 401: that is the intended effect. Run them with the service key or a signed-in session instead.
Rollback loses nothing: Stage 0 changes no data. After rolling back, re-test the failing screen, record the cause, and re-audit before trying again.

## 6. Evidence to keep (audit trail)
Screenshots or pasted output of: the project header, the BEFORE and AFTER assertion results, the `limit=0` probes before and after (status codes only), the log counts before and after, and the time of commit. Store them with `reports/` under a dated file. No keys, emails or business rows in the evidence.

## 7. After Stage 0
* Update the security state marker `docs/security-state.json` (`stage0` from `pending` to `applied`, with date) in the same change that records the evidence. Until then the tests assert `pending`.
* Production is still exposed to **any signed-in account** until Stage 1 (open sign-up, 5 known accounts today). Plan Stage 1 next; do not treat Stage 0 as "secured".

## 8. Approval-ready summary
| | |
|---|---|
| Risk | Low. Removes one role's privileges only. No code reads the 15 tables as anon (21 files audited), no anonymous writes in 15 days of logs. |
| Reversibility | Seconds, lossless. |
| Not covered | Signed-in users (Stage 1), default privileges and anon-callable RPCs (Stage 2), backups unverified, no Development rehearsal possible (Dev project hibernated). |
| Decision | GO to request approval, with the owner accepting either a Dev rehearsal first (needs the project woken in the dashboard) or a supervised run without one. |
