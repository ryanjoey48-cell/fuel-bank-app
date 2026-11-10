# Finance Centre Phase 3E local walkthrough

Run this from `C:\Projects\EES\fuel-bank-app`:

```powershell
npm.cmd run dev:finance-fixture
```

Wait for `Ready`, then open `http://127.0.0.1:3115/finance-centre`. The fixture launcher clears Supabase credentials for its child process, uses a dedicated `.next-finance-fixture` output directory, and never persists simulated actions. If 3115 is occupied, stop the older fixture process before starting this one. Do not use a database-connected EES session on port 3000 for this demonstration.

The integrated Finance Centre has four sections. Select a booking once at the top; the selected job remains in context while moving between sections. The role switch in the amber banner is a local simulation of Office, Management, Finance, and Finance Manager. Reset restores the original 15-row source fixture. The completed walkthrough button loads an already approved sample pack for printing.

Walkthrough: In **Job Reconciliation**, match each simulated green sheet and receipt, enter its physical-original location, and record documented expenses. Office compares the returned job order with source facts and verifies the job. A mismatch goes to Management for a recorded decision and then back to Office for re-verification. In **Customer Billing**, Finance confirms the source-recorded amount solely for demonstration or enters a reasoned manual price, creates a customer/week batch, selects eligible work orders, orders them, prepares an unnumbered draft, and submits it. In **Invoices & Documents**, the Finance Manager approves or rejects the submitted draft. Finance then prepares the ordered pack and opens the print view.

The 15 work orders, names, dates, routes, historical TRN references, and recorded amounts come from the separate Finance test workbook. Returned paperwork, filing locations, expenses entered in this walkthrough, decisions, customer price confirmations, approvals, and new draft IDs are simulated. The INTEGRA form informs the print layout only. No final TRN number, real invoice, customer dispatch, database write, or payment event is created.

The office expense permission migration `20261105100000_finance_reconciliation_expense_recorder.sql` is prepared for local review only. It requires an explicit `expense_recorder` grant and does not provide pricing or approval capabilities. The development database baseline is still blocked; do not apply this migration remotely.
