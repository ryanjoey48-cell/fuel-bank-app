-- Read-only verification for V20.2 reliability objects. Safe to run after review-only apply.
select to_regclass('public.ees_fleet_notification_outbox') as outbox_table;
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('commit_ees_fleet_event_review', 'enqueue_ees_fleet_notification_outbox')
order by routine_name;
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ees_fleet_event_review_history'
  and column_name in ('request_id', 'idempotency_key')
order by column_name;
select count(*)::integer as pending_or_disabled_intents
from public.ees_fleet_notification_outbox
where status in ('pending', 'push_disabled');
