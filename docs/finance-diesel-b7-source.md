# Finance Centre — Historical Diesel B7 reference source

**The only approved source:** https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history

No other fuel-price website is used anywhere in the Finance Centre (lookup, verification, evidence links, reports or records).
The page lists *retail reference prices* by date (column **ดีเซล B7**, month and year selectable; years are Buddhist-era, 2026 = พ.ศ. 2569).
These are not filling-station transaction prices and must never be treated as EES fuel purchase expenses.

## Integration investigation (read-only findings)

| Question | Finding |
|---|---|
| Documented public API / data feed? | None found. No API documentation, terms page or open-data statement is linked from the page. |
| How does the page load a chosen month? | The first view is server-rendered. Changing the month/year runs a request from the page's own script to the site's internal backend using a key embedded in the page. That is an undocumented internal endpoint. |
| `robots.txt` | Allows general crawling for search, but sets `ai-train=no, use=reference` and explicitly **disallows AI crawlers** (e.g. ClaudeBot, GPTBot, CCBot). |
| Is automatic retrieval permitted and reliable? | Not established. Using the internal endpoint or scripted browsing would be unsupported, fragile and against the spirit of the robots rules. |

**Decision:** keep the owner-approved **manual-verification workflow**. No scraping, no scheduled fetching, no embedded keys, no browser automation in the backend.

If EES wants automation later, the proposal is: ask the site operator for written permission and a documented read-only feed (or a CSV export) for Diesel B7 by date;
only then add a server-side importer that writes entries with status **Proposed** (never Verified) so the existing owner confirmation step still applies.

## How Finance uses it (Customer Billing → Pricing & fuel)

1. The panel **EES Historical Diesel B7 — Official Reference** lists every distinct job date in the batch, with the month/year/row to look at on the site and an *Open Source* link (new tab).
2. Finance reads the Diesel B7 value for that exact date and enters it with a dated evidence note — as **Proposed** (not yet confirmed) or directly confirmed.
3. The owner presses **Confirm price** → status **Verified**, with who/when recorded. A wrong value is corrected with **Correct price…** (a reason is required; the original stays in the history) or marked **Disputed**.
4. Only a **Verified** value prices a job. One verified value per date is reused by every job on that date (three dates → three entries, not six).
5. Missing dates are never filled from today's price or a neighbouring day.
