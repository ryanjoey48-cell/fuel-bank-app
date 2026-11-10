-- Read-only verification for Forth speed-config audit tables/policies.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('forth_speed_config_reviews', 'forth_speed_config_audit')
order by c.relname;

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('forth_speed_config_reviews', 'forth_speed_config_audit')
order by tablename, policyname;
