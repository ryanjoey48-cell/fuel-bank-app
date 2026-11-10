-- REVIEW ONLY rollback for V20.2 additive reliability layer.
begin;
drop function if exists public.enqueue_ees_fleet_notification_outbox(text,text,text,text,text,text,text,text,text,boolean);
drop function if exists public.commit_ees_fleet_event_review(text,text,uuid,text,uuid,uuid,text);
drop table if exists public.ees_fleet_notification_outbox;
drop index if exists public.ees_fleet_event_review_history_idempotency_uidx;
drop index if exists public.ees_fleet_event_review_history_request_uidx;
alter table public.ees_fleet_event_review_history drop column if exists idempotency_key;
alter table public.ees_fleet_event_review_history drop column if exists request_id;
commit;
