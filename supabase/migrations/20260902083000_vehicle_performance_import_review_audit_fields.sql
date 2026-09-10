alter table public.vehicle_performance_import_reviews
  add column if not exists source_sheet text,
  add column if not exists source_row_number integer,
  add column if not exists source_row_key text,
  add column if not exists reviewed_by text;

create index if not exists vehicle_performance_import_reviews_source_row_idx
  on public.vehicle_performance_import_reviews (
    user_id,
    source_row_key
  )
  where source_row_key is not null;

comment on column public.vehicle_performance_import_reviews.source_row_key is
  'Optional uploaded workbook source row identifier. Business uniqueness remains user, year, month, and normalized vehicle registration.';

comment on column public.vehicle_performance_import_reviews.reviewed_by is
  'Human-readable reviewer identity captured from the signed-in user when available.';
