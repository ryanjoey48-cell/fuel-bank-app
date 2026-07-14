alter table if exists public.booking_diary
  add column if not exists job_order_number text;

comment on column public.booking_diary.job_order_number is 'Optional job order number added after completion for invoicing support.';
