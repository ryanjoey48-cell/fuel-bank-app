-- REVIEW ONLY V20.2 additive reliability layer.
-- Apply only after docs/ees-fleet-operations-v20-review-only.sql.
-- Do not run without owner approval. No cron or live push is installed here.
begin;

alter table public.ees_fleet_event_review_history
  add column if not exists request_id uuid;
alter table public.ees_fleet_event_review_history
  add column if not exists idempotency_key text;
create unique index if not exists ees_fleet_event_review_history_request_uidx
  on public.ees_fleet_event_review_history (actor_user_id, request_id)
  where request_id is not null;
create unique index if not exists ees_fleet_event_review_history_idempotency_uidx
  on public.ees_fleet_event_review_history (idempotency_key)
  where idempotency_key is not null;

-- Atomic visit review + audit. Partial success is not returned as success.
create or replace function public.commit_ees_fleet_event_review(
  p_event_key text,
  p_action text,
  p_actor_user_id uuid,
  p_reason text,
  p_request_id uuid,
  p_booking_id uuid default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $fn$
declare
  v_existing public.ees_fleet_visit_events%rowtype;
  v_previous jsonb;
  v_next jsonb;
  v_history_id bigint;
  v_cached jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_event_key is null or length(p_event_key) not between 1 and 400 then raise exception 'invalid event key'; end if;
  if p_action not in ('confirm','mark_review','match_booking','reject_booking_match') then raise exception 'invalid action'; end if;
  if p_actor_user_id is null or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception 'actor and reason required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_key, 17));

  select to_jsonb(h.new_values) || jsonb_build_object('event_key', h.event_key, 'history_id', h.id, 'replayed', true)
    into v_cached
  from public.ees_fleet_event_review_history h
  where h.actor_user_id = p_actor_user_id and h.request_id = p_request_id
  order by h.id desc limit 1;
  if v_cached is not null then
    return v_cached;
  end if;

  if p_idempotency_key is not null then
    select to_jsonb(h.new_values) || jsonb_build_object('event_key', h.event_key, 'history_id', h.id, 'replayed', true)
      into v_cached
    from public.ees_fleet_event_review_history h
    where h.idempotency_key = p_idempotency_key
    order by h.id desc limit 1;
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select * into v_existing from public.ees_fleet_visit_events where event_key = p_event_key for update;
  if not found then raise exception 'event not found'; end if;

  v_previous := jsonb_build_object(
    'review_status', v_existing.review_status,
    'booking_id', v_existing.booking_id,
    'booking_match_status', v_existing.booking_match_status
  );

  if p_action = 'confirm' then
    update public.ees_fleet_visit_events
      set review_status = 'confirmed', reviewed_by = p_actor_user_id, reviewed_at = now()
      where event_key = p_event_key
      returning jsonb_build_object(
        'review_status', review_status, 'booking_id', booking_id, 'booking_match_status', booking_match_status,
        'reviewed_at', reviewed_at
      ) into v_next;
  elsif p_action = 'mark_review' then
    update public.ees_fleet_visit_events
      set review_status = 'needs_review', reviewed_by = p_actor_user_id, reviewed_at = now()
      where event_key = p_event_key
      returning jsonb_build_object(
        'review_status', review_status, 'booking_id', booking_id, 'booking_match_status', booking_match_status,
        'reviewed_at', reviewed_at
      ) into v_next;
  elsif p_action = 'match_booking' then
    if p_booking_id is null then raise exception 'booking id required'; end if;
    if not exists (select 1 from public.booking_diary b where b.id = p_booking_id) then raise exception 'booking not found'; end if;
    update public.ees_fleet_visit_events
      set booking_id = p_booking_id, booking_match_status = 'confirmed', review_status = 'confirmed',
          reviewed_by = p_actor_user_id, reviewed_at = now()
      where event_key = p_event_key
      returning jsonb_build_object(
        'review_status', review_status, 'booking_id', booking_id, 'booking_match_status', booking_match_status,
        'reviewed_at', reviewed_at
      ) into v_next;
  else
    update public.ees_fleet_visit_events
      set booking_id = null, booking_match_status = 'rejected',
          review_status = case when review_status = 'unreviewed' then 'needs_review' else review_status end,
          reviewed_by = p_actor_user_id, reviewed_at = now()
      where event_key = p_event_key
      returning jsonb_build_object(
        'review_status', review_status, 'booking_id', booking_id, 'booking_match_status', booking_match_status,
        'reviewed_at', reviewed_at
      ) into v_next;
  end if;

  insert into public.ees_fleet_event_review_history(
    event_key, action, previous_values, new_values, reason, actor_user_id, request_id, idempotency_key
  ) values (
    p_event_key, p_action, v_previous, v_next, btrim(p_reason), p_actor_user_id, p_request_id, nullif(btrim(coalesce(p_idempotency_key, '')), '')
  ) returning id into v_history_id;

  return v_next || jsonb_build_object('event_key', p_event_key, 'history_id', v_history_id, 'replayed', false);
end;
$fn$;
revoke all on function public.commit_ees_fleet_event_review(text,text,uuid,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.commit_ees_fleet_event_review(text,text,uuid,text,uuid,uuid,text) to service_role;

-- Durable notification intents. Live push remains disabled until V20.3 owner approval.
create table if not exists public.ees_fleet_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  intent_key text not null unique check (length(intent_key) between 1 and 400),
  event_key text references public.ees_fleet_visit_events(event_key) on delete restrict,
  category text not null check (category in ('arrival','departure','extended_visit','tracker_incident','gps_incident','speed_alert')),
  severity text not null check (severity in ('info','action_required','critical')),
  title_en text not null,
  title_th text not null,
  body_en text not null,
  body_th text not null,
  href text not null check (href like '/%'),
  status text not null default 'pending'
    check (status in ('pending','queued_inbox','suppressed','push_disabled','failed')),
  delivery_enabled boolean not null default false,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists ees_fleet_notification_outbox_pending_idx
  on public.ees_fleet_notification_outbox (status, created_at)
  where status = 'pending';

alter table public.ees_fleet_notification_outbox enable row level security;
-- Outbox is service-role only; office users read the inbox, not raw intents.
revoke all on public.ees_fleet_notification_outbox from public, anon, authenticated;
grant all on public.ees_fleet_notification_outbox to service_role;

create or replace function public.enqueue_ees_fleet_notification_outbox(
  p_intent_key text,
  p_event_key text,
  p_category text,
  p_severity text,
  p_title_en text,
  p_title_th text,
  p_body_en text,
  p_body_th text,
  p_href text,
  p_delivery_enabled boolean default false
) returns uuid language plpgsql security invoker set search_path = '' as $fn$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  insert into public.ees_fleet_notification_outbox(
    intent_key, event_key, category, severity, title_en, title_th, body_en, body_th, href, delivery_enabled, status
  ) values (
    p_intent_key, p_event_key, p_category, p_severity, p_title_en, p_title_th, p_body_en, p_body_th, p_href,
    coalesce(p_delivery_enabled, false),
    case when coalesce(p_delivery_enabled, false) then 'pending' else 'push_disabled' end
  )
  on conflict (intent_key) do update set intent_key = excluded.intent_key
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.enqueue_ees_fleet_notification_outbox(text,text,text,text,text,text,text,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.enqueue_ees_fleet_notification_outbox(text,text,text,text,text,text,text,text,text,boolean)
  to service_role;

comment on table public.ees_fleet_notification_outbox is
  'Idempotent notification intents for confirmed fleet events. Operational push stays off until explicitly enabled.';
comment on function public.commit_ees_fleet_event_review(text,text,uuid,text,uuid,uuid,text) is
  'Atomically updates a visit event and writes the required audit row; retries replay by request_id.';

commit;
