-- REVIEW ONLY. Do not run before applying 20260923090000_insurance_requirement.sql.
-- This file intentionally changes only insurance requirement classification.

-- PREVIEW: must return exactly seven rows with the expected registrations.
with approved(id, stored_registration) as (
  values
    ('c477bc1e-7dde-420a-9618-6ca079e8cd4e'::uuid, '77-5902'),
    ('db4e0e22-7267-4451-a5e6-cdd561be22eb'::uuid, 'สินค้า'),
    ('e23a10e9-2e08-4b27-88d1-393c6e3dafb3'::uuid, '64-2699'),
    ('f2b60822-708a-4b30-8822-17388b9a1037'::uuid, '64-8664'),
    ('4da3e4fe-8cb3-499a-ba66-c96d7b37075f'::uuid, '67-6204'),
    ('c321a8c0-b415-4e64-85c9-94259a143a75'::uuid, '700-4198'),
    ('39971a11-34b9-4079-8c2e-47e01da60b1b'::uuid, '77-8513')
)
select
  v.id,
  v.vehicle_registration,
  v.vehicle_make,
  v.verification_status,
  v.insurance_requirement,
  v.insurance_requirement_reason
from public.vehicle_insurance_compliance v
join approved a on a.id = v.id and a.stored_registration = v.vehicle_registration
order by v.vehicle_registration;

-- UPDATE: run only after the preview returns the exact seven approved rows.
with approved(id, stored_registration) as (
  values
    ('c477bc1e-7dde-420a-9618-6ca079e8cd4e'::uuid, '77-5902'),
    ('db4e0e22-7267-4451-a5e6-cdd561be22eb'::uuid, 'สินค้า'),
    ('e23a10e9-2e08-4b27-88d1-393c6e3dafb3'::uuid, '64-2699'),
    ('f2b60822-708a-4b30-8822-17388b9a1037'::uuid, '64-8664'),
    ('4da3e4fe-8cb3-499a-ba66-c96d7b37075f'::uuid, '67-6204'),
    ('c321a8c0-b415-4e64-85c9-94259a143a75'::uuid, '700-4198'),
    ('39971a11-34b9-4079-8c2e-47e01da60b1b'::uuid, '77-8513')
)
update public.vehicle_insurance_compliance v
set
  insurance_requirement = 'not_required',
  insurance_requirement_reason = 'Trailer'
from approved a
where v.id = a.id
  and v.vehicle_registration = a.stored_registration
  and v.insurance_requirement = 'unknown'
returning
  v.id,
  v.vehicle_registration,
  v.verification_status,
  v.insurance_requirement,
  v.insurance_requirement_reason;

-- VERIFY: must return exactly seven not_required / Trailer rows.
select
  id,
  vehicle_registration,
  verification_status,
  insurance_requirement,
  insurance_requirement_reason
from public.vehicle_insurance_compliance
where id = any (array[
  'c477bc1e-7dde-420a-9618-6ca079e8cd4e'::uuid,
  'db4e0e22-7267-4451-a5e6-cdd561be22eb'::uuid,
  'e23a10e9-2e08-4b27-88d1-393c6e3dafb3'::uuid,
  'f2b60822-708a-4b30-8822-17388b9a1037'::uuid,
  '4da3e4fe-8cb3-499a-ba66-c96d7b37075f'::uuid,
  'c321a8c0-b415-4e64-85c9-94259a143a75'::uuid,
  '39971a11-34b9-4079-8c2e-47e01da60b1b'::uuid
])
order by vehicle_registration;
