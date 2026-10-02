# Driver Portal mobile redesign

Only driver-facing presentation changed. No database, APIs, auth, account approval, permissions, assignment, notification, pickup-wait or event workflow changes. Office/admin screens and existing canonical avatar support remain unchanged.

## Presentation changes

- Navy current/next job card, orange contextual action, cream background and lighter completed cards.
- One responsive card/link per job, replacing duplicate mobile/desktop markup. Start/Continue/View completed labels navigate to the existing job detail; they do not create events.
- Compact driver summary, Today list and date-grouped Upcoming jobs. Existing next-job selection and sorting retained.
- Job hero includes route and status; next-action guidance precedes route/navigation. The single mobile event action remains above the fixed bottom navigation. Five existing Maps URL builders, optional GPS, sequential events and completion confirmation retained.
- Smaller History header and tappable completed rows.
- Profile summary with initials/photo, driver ID and vehicle; cleaner personal details and language controls; password form collapsed in a native keyboard-accessible disclosure.
- Shared avatar handling keeps initials visible until load, removes failed images, and retries when the canonical signed URL changes. Header and Profile share this component. Upload validation, upload endpoint, canonical response and profile-update event are unchanged.

## Files changed

- app/driver/(protected)/layout.tsx — driver-only cream background wrapper; server session guard unchanged.
- components/driver/driver-home.tsx
- components/driver/driver-job-detail.tsx
- components/driver/driver-history.tsx
- components/driver/driver-profile.tsx
- components/driver/driver-portal-header.tsx
- components/driver/driver-navigation.tsx
- components/driver/driver-ui.tsx — new display helpers and avatar fallback.
- tests/driver-operations.test.cjs — maintain next-job ordering/link coverage, expect one shared card instead of two responsive copies.
- tests/driver-ui-redesign.test.cjs — eight additional regression tests.
- docs/driver-portal-redesign.md
- tsconfig.tsbuildinfo — generated TypeScript cache; original cache content restored, with a final-newline-only difference (no runtime/source change).

## Validation

- Relevant automated suite: **123 passed, 0 failed**.
- TypeScript: **PASS**, npx tsc --noEmit.
- Lint on all changed TSX files: **PASS**, using the repository's existing ESLintRC configuration.
- Production build: **PASS**, isolated Next.js output to avoid disturbing the running dev server.
- Non-blocking tool warnings: deprecated ESLintRC configuration and stale Browserslist data. No dependencies/configuration were migrated.

Explicit checks:

| Flow | Evidence |
| --- | --- |
| Jobs/current state | EN/TH rendered component tests, single current/completed/future links and status-aware labels; fixture screenshots |
| Event buttons | Handler tests for each stage, exact event POST payload, final confirmation before completion; existing API/GPS/ownership tests |
| Navigation | Exact five Maps URLs in EN/TH, addresses and Atip contact retained |
| History | Existing ownership/completion query tests; compact History fixture inspected |
| Profile save | Actual component submit handler tested with mocked authenticated fetch; correct PATCH payload and reload |
| Avatar upload | Actual component handler tested with valid file/FormData, invalid size rejection and canonical response refresh; existing server upload tests |
| Avatar fallback | Loading image hidden; onLoad shows photo; onError removes image; initials retained; new URL keyed for retry |
| Language | EN/TH Jobs/detail rendering, Profile language callback and existing translation tests |
| Password | Existing reauthentication/session-revocation tests; actual collapsed form handler validates matching password and submits unchanged endpoint/payload |

Visual checks used **isolated design fixtures, not a live authenticated account**, at 320px, 390px and 768px. Narrow Thai Jobs/detail layouts inspected; no horizontal overflow on measured 320px Jobs view. Fixed event action and bottom nav visually separate; History/Profile inspected. Temporary viewport reset and preview server stopped.

The localhost browser was still at Driver sign in. A fresh driver login is required for final live Jobs/History/Profile checks. No real jobs were advanced, no photo/profile data was written, and no credentials were changed. Automated/mocked checks are not claimed as live end-to-end verification.

Fixture screenshot (ignored build output): .next-maintenance-qa/driver-redesign-mobile.jpg.
