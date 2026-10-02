# Mobile UX polish — implementation and verification

Status: UI implementation is in place. Full authenticated visual QA is pending.
No production deployment was performed.

## Improvements

- Driver header: 56px phone content height instead of 68px; mobile touch targets
  and top safe-area padding. Desktop remains 68px.
- Driver navigation: 52px phone targets, safe-area footer, existing page padding.
- Jobs: one compact summary, strongest Next/Current job, whole-card phone links,
  shorter green completed rows, and compact date-grouped upcoming work. Desktop
  cards remain available at the existing breakpoint. Each job is visible once.
- Detail: compact hero and route; complete addresses retained; primary Maps route
  plus four two-column controls with shorter bilingual labels and full accessible
  names. All five generated URLs remain identical.
- Progress: connected completed/current/future steps, server event timestamps and
  GPS indicators. One existing next-action button above navigation. Completed
  jobs have no fixed CTA and no excessive reserved action-bar space.
- Details: translated vehicle-type display mapping and compact key/value rows;
  Atip's name, number and telephone link unchanged.
- History/Profile: targeted phone density changes; avatar upload, profile saves,
  preference and password handlers unchanged.
- Admin: compact phone heading/updated metadata, horizontal five-metric strip,
  filters, quiet completed cards, shared avatars and server-derived waiting labels.
- Admin sheets: near-full-height dynamic-viewport panels, safe-area padding,
  compact route/timeline/profile rows, named dialog semantics and body scroll lock
  that restores the previous overflow style on close.
- Admin History: search plus two date columns, Apply/Search and Clear, compact
  results, actual page number. No invented total pages: the API only supplies
  `hasMore`, so pagination shows `Page X`, not a fabricated `Page X of Y`.
- Directory: compact rows/chips; no Last login placeholder row for unlinked
  drivers. Linked profiles retain their existing drawer.
- Notifications: viewport-bounded internal scrolling and improved phone targets;
  polling, recipient authorization, mark-read, resolution and deduplication unchanged.
- Office Home: smaller phone header; redundant in-hero logo hidden on phones;
  compact title/subtitle plus 144px truck banner. Desktop hero unchanged. Exactly
  four existing Quick Actions and routes remain. Compact two-column KPI tiles with
  accessible loading placeholders. No sections or analytics added/removed.

## Functional scope

Only presentation changes and UI support: translated vehicle labels, History's
clear-filter control, and modal scroll locking. No API, auth, security, schema,
approval, linking, assignment, Maps/GPS, event sequencing or notification business
logic changes. No database writes or real job events were performed for QA.

## Verification

- Relevant tests: **115 passed, 0 failed** (driver accounts, portal, job workflow,
  onboarding security, operations, self-registration, upgrade, mobile UI and
  translation integrity). This is the relevant subset, not the full app suite.
- TypeScript: **PASS**, `npx tsc --noEmit`, run separately because the existing
  build configuration skips type validation.
- Targeted lint: **PASS** using the repository's existing ESLintRC compatibility
  mode (`ESLINT_USE_FLAT_CONFIG=false`). No rule changes or suppressions added.
- Production build: **PASS**, including final refinements. Isolated output
  protects the dev server. Existing config skips type/lint validation during the
  build; both were run independently and passed.
- New tests cover every supported vehicle enum, EN/TH detail rendering, all five
  exact Maps URLs, complete addresses/Atip, connected stages and GPS indicators,
  no completed-job sticky CTA, safe-area offsets and scroll-lock cleanup.
- Existing rendering test updated only for two mutually exclusive responsive
  presentations, retaining next-job ordering and explicit duplicate-link checks.
- Actual 390px Jobs screenshot inspected: compact summary, next job and completed
  cards visible; navigation/footer fit. It also exposed profile API failure due
  to a missing generated development chunk, not avatar business logic.
- Restarted the local dev server after preserving the broken generated cache at
  `.next-maintenance-qa/.dev-cache-mobile-20261002`. The clean browser now shows
  Driver sign in and needs the user's fresh verified login before continuing.

### Still to verify live

375/390/430/768/1024/desktop screenshots across driver detail/Maps/timeline/footer,
History and Profile; EN/TH wrapping and avatar persistence. Then a real admin
session for Operations/Attention/Completed, drawers, History, Directory, bell,
and office Home/Quick Actions. Real iPhone safe-area/keyboard behavior cannot be
proven by browser width alone. Password changes are user-owned; no credentials
will be changed by this polish task. Live 30-minute alert behavior requires a
disposable authorized job and real elapsed server time; events will not be
fabricated or backdated. Existing automated notification safeguards pass.

## Exact source/test/document files changed

- app/(dashboard)/dashboard/page.tsx
- app/globals.css
- components/account-menu.tsx
- components/top-navigation.tsx
- components/admin/driver-notifications.tsx
- components/admin/driver-operations-history.tsx
- components/admin/driver-operations.tsx
- components/admin/driver-profile-browser.tsx
- components/driver/driver-history.tsx
- components/driver/driver-home.tsx
- components/driver/driver-job-detail.tsx
- components/driver/driver-navigation.tsx
- components/driver/driver-portal-header.tsx
- components/driver/driver-profile.tsx
- lib/driver-vehicle-types.ts
- lib/use-modal-scroll-lock.ts (new)
- tests/driver-operations.test.cjs
- tests/mobile-driver-ux.test.cjs (new)
- docs/mobile-ux-polish.md (new)

Generated validation artifact: tsconfig.tsbuildinfo. Generated build-output
references in tsconfig.json/next-env.d.ts are restored after validation.
