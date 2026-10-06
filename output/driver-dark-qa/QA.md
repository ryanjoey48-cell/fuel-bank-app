# Driver dark theme and route correction QA

Verified 6 October 2026 using rendered Driver Portal components with fixture data in headless Microsoft Edge. No live authentication, database writes, workflow events, or external Maps navigation were performed.

- Widths: 375, 390, 393, 430px, at 844px viewport height.
- Home hero: 136px before, 112.5px after (17.3% smaller).
- NEXT JOB: 260px before, 287px after (10.4% larger).
- Home, pickup stage, delivery stage, Thai pickup, History, expanded Profile/password fields: no horizontal overflow or white panels.
- Actual compact header and bottom navigation rendered in fixtures.
- Original logistics image preserved; truck visually inspected at 390px.
- Depot shortcuts retain origin, pickup waypoint, drop-off destination and verified place IDs.
- Pickup to delivery retains pickup origin and drop-off destination.
- My location omits origin and routes directly to the active stage destination.
- TypeScript: passed, including final non-incremental check.
- Targeted route tests: 2 passed, 0 failed.
- Four existing driver suites: 74 passed, 2 failed. The same two failures also occur on unchanged HEAD: legacy assertions expecting intent controls and a literal tel URL in source. Updated only assertions affected by the requested hero dimensions and full depot route.
- Git diff whitespace check: passed.

Screenshots and browser measurements are saved beside this report. Mobile verification uses rendered fixtures; live authenticated end-to-end behavior was not exercised.
