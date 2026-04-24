begin;

alter table public.bank_transfers
  add column if not exists receipt_status text not null default 'pending_receipt'
    check (receipt_status in ('pending_receipt', 'matched_to_fuel_log', 'overpaid'));

create index if not exists bank_transfers_receipt_status_idx
  on public.bank_transfers (receipt_status, date desc);

commit;
