# Oil Change Import Preview

Generated: 2026-04-22T07:06:57.585Z
Workbook: C:/Users/User/Downloads/oil change data.xlsx
Selected sheet: Sheet1
Headers: ลำดับ | Date | Vechile reg |  mileage last changed   |  mile they are suppose to change  | 4/12/26 |  น้ำมันเครื่อง 

## Summary
- totalRows: 20
- readyToImport: 4
- invalidRows: 0
- duplicatesSkipped: 0
- unmatchedVehicles: 4
- reviewRequiredRows: 12
- baselinesToUpdate: 4
- vehiclesUsingExcelExplicitInterval: 4
- vehiclesUsingVehicleTypeInterval: 0

## Database Setup
- drivers: OK
- weeklyMileage: OK
- vehicles: PGRST205 Could not find the table 'public.vehicles' in the schema cache
- serviceLogs: PGRST205 Could not find the table 'public.vehicle_service_logs' in the schema cache

## ready_to_import (4)
| Excel Row | Reg | Date | Last Odo | Due | Interval | Driver | App Reg | Type | Issues |
|---:|---|---|---:|---:|---:|---|---|---|---|
| 6 | 63-3543 | 2026-02-08 | 52390 | 82390 | 30000 | Thasoh | 63-3543 | 18 wheeler | Exact normalized vehicle registration match |
| 10 | 64-8665 | 2026-01-25 | 659877 | 689877 | 30000 | M | 64-8665 | 18 wheeler | Exact normalized vehicle registration match |
| 11 | 68-7154 | 2026-03-24 | 323049 | 353049 | 30000 | Meuan | 68-7154 | 18 wheeler | Exact normalized vehicle registration match |
| 18 | 79-5318 | 2026-02-21 | 952239 | 982239 | 30000 | Sayan | 79-5318 | 18 wheeler | Exact normalized vehicle registration match |

## matched_needs_review (12)
| Excel Row | Reg | Date | Last Odo | Due | Interval | Driver | App Reg | Type | Issues |
|---:|---|---|---:|---:|---:|---|---|---|---|
| 2 | 61-2835 | 2026-04-17 | 926453 | 956453 | 30000 | Temp Vehicle - Buri | 61-2835 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 3 | 61-6672 | 2025-09-28 | 869765 | 899765 | 30000 | Myi | 61-6672 | 6 + 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 4 | 62-1085 | 2026-03-30 | 79925 | 109925 | 30000 | Sorn | 62-1085 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 5 | 62-4337 | 2026-02-25 | 51040 | 81040 | 30000 | Thung | 62-4337 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 7 | 64-0359 | 2025-10-19 | 701662 | 731662 | 30000 | Wutt | 64-0359 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 8 | 64-5954 | 2026-02-28 | 710486 | 740486 | 30000 | Tharworn | 64-5954 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 9 | 64-5956 | 2025-11-16 | 726285 | 756285 | 30000 | Maam | 64-5956 | 6 + 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 12 | 700-4145 | 2026-02-08 | 363820 | 393820 | 30000 | Golf | 700-4145 | 6 + 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 13 | 700-6659 | 2026-01-25 | 215402 | 245402 | 30000 | Soh | 700-6659 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 15 | 74-8969 | 2026-01-25 | 308457 | 338457 | 30000 | Film | 74-8969 | 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 16 | 78-6996 | 2026-02-08 | 354866 | 384866 | 30000 | Ede | 78-6996 | 6 + 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |
| 17 | 79-2945 | 2025-03-08 | 402031 | 432031 | 30000 | Buri | 79-2945 | 6 + 6 wheeler | Interval conflict: Excel 30000, vehicle type default 10000 |

## unmatched_vehicle (4)
| Excel Row | Reg | Date | Last Odo | Due | Interval | Driver | App Reg | Type | Issues |
|---:|---|---|---:|---:|---:|---|---|---|---|
| 14 | 701-1645 | 2026-02-08 | 234288 | 264288 | 30000 |  |  |  | No confident vehicle registration match |
| 19 | ฒอ8543 | 2025-12-10 | 586501 | 596501 | 10000 |  |  |  | No confident vehicle registration match |
| 20 | 3ฒล4565 | 2026-02-16 | 138314 | 148314 | 10000 |  |  |  | No confident vehicle registration match |
| 21 | 3ฒน9565 | 2026-02-28 | 309396 | 319396 | 10000 |  |  |  | No confident vehicle registration match |

## invalid_row (0)
None

## duplicate_skipped (0)
None

## Baselines To Update
| App Reg | Driver | Type | Date | Odometer | Interval | Source |
|---|---|---|---|---:|---:|---|
| 63-3543 | Thasoh | EIGHTEEN_WHEELER | 2026-02-08 | 52390 | 30000 | excel_due_minus_last |
| 64-8665 | M | EIGHTEEN_WHEELER | 2026-01-25 | 659877 | 30000 | excel_due_minus_last |
| 68-7154 | Meuan | EIGHTEEN_WHEELER | 2026-03-24 | 323049 | 30000 | excel_due_minus_last |
| 79-5318 | Sayan | EIGHTEEN_WHEELER | 2026-02-21 | 952239 | 30000 | excel_due_minus_last |