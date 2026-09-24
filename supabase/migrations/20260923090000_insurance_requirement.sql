-- Backwards-safe classification only. This migration intentionally performs no
-- UPDATE, DELETE, document mutation, or insurer-text rewrite.
alter table public.vehicle_insurance_compliance
  add column if not exists insurance_requirement text not null default 'unknown',
  add column if not exists insurance_requirement_reason text;

alter table public.vehicle_insurance_compliance
  drop constraint if exists vehicle_insurance_compliance_insurance_requirement_check;

alter table public.vehicle_insurance_compliance
  add constraint vehicle_insurance_compliance_insurance_requirement_check
  check (insurance_requirement in ('required', 'not_required', 'unknown'));

comment on column public.vehicle_insurance_compliance.insurance_requirement is
  'Whether this asset requires insurance: required, not_required, or unknown.';

comment on column public.vehicle_insurance_compliance.insurance_requirement_reason is
  'Optional reason for the insurance requirement classification, for example Trailer.';

-- No insurer migration is required. insurer_en and insurer_th remain immutable
-- source wording; canonical display/grouping is resolved by the application.
