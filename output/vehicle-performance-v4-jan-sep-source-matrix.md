# Vehicle Performance V4 — January–September 2026 source matrix

Read-only planning artifact. No Supabase writes, no production changes.

## Standard columns

1. Registration  
2. Salary  
3. Jobs  
4. Trip Payments  
5. Expenses  
6. Parking Fees  
7. Total Received  
8. Fuel  
9. LPG  
10. Maintenance  

## Month status

| Month | V4 preview | Legacy inventory | Available legacy categories | Missing for V4 | Exact owner ask |
|---|---|---:|---|---|---|
| 2026-01 | Source report required | 20 rows | Registration, Salary, Trip Payments, Expenses, Total Received, Fuel, LPG | Jobs, Parking Fees, Maintenance + verified salary/trip provenance | January 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-02 | Source report required | 20 rows | same | same | February 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-03 | Source report required | 21 rows | same | same | March 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-04 | Source report required | 21 rows | same | same | April 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-05 | Source report required | 21 rows | same | same | May 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-06 | Source report required | 21 rows | same | same | June 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-07 | Source report required | 21 rows | same | same | July 2026 monthly financial PDF/Excel with ten V4 columns |
| 2026-08 | Source-verified read-only | n/a | full ten-column preview | unresolved dashes remain unknown | none for structure |
| 2026-09 | Source-verified read-only; salary provisional | n/a | full ten-column preview | provisional salary + unresolved dashes | independent September payroll evidence |

## Rules preserved

- Total Received = client transport revenue  
- Salary and Trip Payments stay separate  
- Expenses excludes Parking, Fuel, LPG and Maintenance  
- Jobs is a count  
- Only ฒอ-8453 uses LPG  
- Jan–Jul: LPG included in Fuel, never deducted twice  
- Aug onwards: LPG separate from Fuel  
- Unknown amounts stay unknown  
- `3ฒล-4565` flagged for later owner/boss registration review; not renamed or duplicated  

## Local search result

No authorised January–July monthly source PDF/XLSX was found in the V4 worktree, Downloads, Documents, or EES project folders. Only August/September source PDFs and V4 preview JSON are available. Legacy `vehicle_monthly_performance` inventory is treated as a gap checklist only, not as V4 verified preview data.
