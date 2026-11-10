-- Rollback for 20261029100000_forth_speed_config_audit.sql
begin;

drop policy if exists forth_speed_config_audit_office_insert on public.forth_speed_config_audit;
drop policy if exists forth_speed_config_audit_office_select on public.forth_speed_config_audit;
drop policy if exists forth_speed_config_reviews_office_delete on public.forth_speed_config_reviews;
drop policy if exists forth_speed_config_reviews_office_update on public.forth_speed_config_reviews;
drop policy if exists forth_speed_config_reviews_office_insert on public.forth_speed_config_reviews;
drop policy if exists forth_speed_config_reviews_office_select on public.forth_speed_config_reviews;

drop table if exists public.forth_speed_config_audit;
drop table if exists public.forth_speed_config_reviews;

commit;
