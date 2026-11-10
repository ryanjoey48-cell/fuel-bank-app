# Finance V3 — Development schema dependency map (REVIEW ONLY)

**No SQL was executed against either Supabase project.**  
Sources: `docs/proposed/PROPOSED-migration-finance-records-shared-storage.sql`,  
`reports/2026-11-06-development-database-verification.md`,  
`docs/finance-records-shared-storage-plan.md`.

## 1. What the proposed Finance migration needs

| Dependency | Role in Finance proposal | Present on Production (`hafoaurz…`) | Present on Development (`wpmnjfn…`) as of 2026-11-06 | Finance-only fixture replacement? |
| --- | --- | --- | --- | --- |
| `auth.users` | Actor FKs on intake / approvals / events | Yes (platform) | Yes (platform) | Keep platform auth; use synthetic test users only |
| `public.clients` | Customer FK on intake / sheets | Yes | **Unknown / not in the 7 shared tables** — treat as **missing for Finance** | **Yes** — `finance_dev_clients` synthetic customers |
| `public.booking_diary` | Source booking identity / snapshot | Yes (full columns) | Partial / incomplete vs production | **Yes** — `finance_dev_bookings` synthetic diary stubs |
| `public.is_office_account()` / `public.current_account_role()` | RLS read policies | Yes (SECURITY DEFINER set) | Different / incomplete helpers | **Yes** — Finance-local `finance_dev_is_office()` stub for RLS tests |
| `public.finance_has_capability()` / `finance_role_grants` | RPC capability gates | Prepared in repo migrations; live state varies | Not equivalent | **Yes** — Finance-local capability stub table |
| `public.finance_reject_history_change()` | Immutable history trigger | Prepared in repo | May be absent | **Yes** — include in Finance-only SQL |
| Official TRN register + allocator | Issuance | Production concern | Must **not** allocate official TRNs in Dev rehearsal | **Replace** with simulated register only; official RPC raises |
| Vehicles / drivers / fuel_logs / GPS / Forth tables | Ops | Yes | N/A for Finance | **Do not copy** |
| Insurance / HR / inventory | Ops | Yes | N/A | **Do not copy** |

## 2. Minimal dependency graph

```
auth.users ──────────────────────────────────────────────┐
                                                         │
finance_dev_clients (synthetic) ──┐                      │
                                  ├─ finance_intake_records ◄── actors
finance_dev_bookings (synthetic) ─┘         │
                                            ├─ finance_billing_sheets
                                            │         │
                                            │         ├─ papers / lines / extras (satang)
                                            │         ├─ work_order_allocations (1 WO → 1 sheet)
                                            │         ├─ revisions / approvals / events (immutable)
                                            │         └─ simulated_trn_register (NOT official)
                                            │
finance_dev_capabilities ───────────────────┴─ approve / reopen RPCs (idempotent; apply disabled in tools)
finance_fuel_references / rate_mappings / billing_profiles ── pricing evidence (proposed≠verified)
```

Official `finance_trn_register` + `finance_allocate_trn` remain **specified but hard-disabled** in the development-isolated variant.

## 3. What does *not* need production parity

- The other 70+ operational tables (fleet, Forth, mileage, safety, bank transfers, …).
- Live Forth credentials / GPS imports.
- Production customer, driver, or authentication record copies.
- Full `account_access` production shape (Finance staging can use a narrow capability grant table).

## 4. Implication for rehearsal

Finance shared-storage can be proven with **Finance-specific fixtures + additive finance_* tables** on EES Development **after owner approval**, without migrating the full operational schema.  
Until then, local `.ees-local` + PGlite/unit tests remain the only safe rehearsal surfaces.
