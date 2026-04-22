alter table public.shipments
  add column if not exists customer_name text,
  add column if not exists goods_description text;

notify pgrst, 'reload schema';
