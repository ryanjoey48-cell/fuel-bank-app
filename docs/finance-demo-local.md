# Open the offline Finance Centre demonstration

From the isolated `codex/ees-finance-phase-1b` worktree at `C:\Users\joery\.codex\worktrees\ees-finance-phase-1b\fuel-bank-app`, run:

```powershell
npm run dev:finance-demo
```

Wait for `Ready`, then open **http://localhost:3102/finance-demo**. The launcher defaults to port **3102**. If that port is occupied, set `EES_FINANCE_DEMO_PORT` to another free port before launching and use the URL printed by the launcher.

The launcher binds to `127.0.0.1`, starts a development-only Next route, clears Supabase credentials in its child process, and suppresses only the missing-service startup warnings for that fixture process. It does not edit environment files. The shared authenticated dashboard, RLS design, and normal production configuration remain unchanged.

The route displays **15 work orders copied from the supplied test workbook**. Original source fields include customer, date, route, vehicle, driver, work order, receipt reference, historical TRN reference and recorded amounts. Every source record displays its worksheet row. The returned green orders, receipts, document matches, management decisions, finance confirmations and approvals are **DEMO simulations**. The workbook is not proof that the live Booking Diary, paper originals, payments or issued invoices were independently verified.

Nothing is saved across a page reload or sent to Supabase. Switch the `Act as` role to advance office, management, finance, and approver steps. Use `Reset demonstration` to restart. `Load completed walkthrough` opens a sample Mass week with three work orders, a ฿8,000 unnumbered draft, simulated approval and a printable 13-item sample pack. Other customers remain separate billing groups. Finance must explicitly confirm each source recorded amount or enter a reasoned manual price before allocation. The draft has no final TRN number.

The printable layout uses the verified INTEGRA sample as a structural reference. It is visibly marked **DEMONSTRATION / ตัวอย่าง** and intentionally omits the original settlement calculation: the source invoice and cover-sheet formulas disagree by ฿400. It is not a real customer invoice and must not be sent.

Production builds exclude `page.demo.tsx` from Next's page extensions. The route and its JavaScript asset are absent from the isolated production build; `/finance-demo` returns 404 there. Do not use `next start` to view the local demonstration.
