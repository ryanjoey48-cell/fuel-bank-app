-- Verification queries for 20260723_admin_user_management.sql.
-- Run manually after the migration in a non-production review session first.

select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('account_access', 'account_access_audit')
order by table_name;

select policyname, tablename, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('account_access', 'account_access_audit', 'clients')
order by tablename, policyname;

select routine_name, routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'current_account_role',
    'is_account_active',
    'is_account_admin',
    'is_support_ticket_admin',
    'get_booking_client_delete_eligibility',
    'delete_unused_booking_client'
  )
order by routine_name;

select users.email, access.role, access.status
from auth.users users
join public.account_access access on access.user_id = users.id
where lower(users.email) = 'joeryan09@outlook.com';

select count(*) as bank_transfer_rows_preserved
from public.bank_transfers;

select count(*) as account_access_rows
from public.account_access;

select count(*) as suspended_accounts
from public.account_access
where status = 'suspended';
