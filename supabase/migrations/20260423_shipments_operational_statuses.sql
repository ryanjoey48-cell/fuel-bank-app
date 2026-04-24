alter table public.shipments
  drop constraint if exists shipments_status_check;

alter table public.shipments
  add constraint shipments_status_check
  check (status in (
    'Draft',
    'Quoted',
    'Confirmed',
    'In Progress',
    'Delivered',
    'Completed',
    'Cancelled',
    'Accepted',
    'Assigned'
  )) not valid;

update public.shipments
set status = case
  when status = 'Accepted' then 'Confirmed'
  when status = 'Assigned' then 'Confirmed'
  else coalesce(status, 'Draft')
end;

alter table public.shipments
  validate constraint shipments_status_check;

notify pgrst, 'reload schema';
