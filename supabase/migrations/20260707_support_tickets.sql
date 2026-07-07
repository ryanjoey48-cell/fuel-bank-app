create sequence if not exists support_ticket_number_seq start 1001;

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique,
  user_id uuid nullable,
  user_email text not null,
  user_role text nullable,
  category text not null,
  priority text not null,
  subject text not null,
  description text not null,
  status text not null default 'Open',
  page_path text nullable,
  current_url text nullable,
  browser_info text nullable,
  screen_size text nullable,
  screenshot_url text nullable,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists support_tickets
  add column if not exists ticket_number text unique,
  add column if not exists user_id uuid nullable,
  add column if not exists user_email text,
  add column if not exists user_role text nullable,
  add column if not exists category text,
  add column if not exists priority text,
  add column if not exists subject text,
  add column if not exists description text,
  add column if not exists status text default 'Open',
  add column if not exists page_path text nullable,
  add column if not exists current_url text nullable,
  add column if not exists browser_info text nullable,
  add column if not exists screen_size text nullable,
  add column if not exists screenshot_url text nullable,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create or replace function set_support_ticket_defaults()
returns trigger as $$
begin
  if new.ticket_number is null or length(trim(new.ticket_number)) = 0 then
    new.ticket_number := 'FB-' || nextval('support_ticket_number_seq')::text;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists support_ticket_defaults_trigger on support_tickets;
create trigger support_ticket_defaults_trigger
before insert or update on support_tickets
for each row
execute function set_support_ticket_defaults();

alter table support_tickets enable row level security;

drop policy if exists "Users can create support tickets" on support_tickets;
create policy "Users can create support tickets"
on support_tickets
for insert
to authenticated
with check (auth.uid() = user_id or user_id is null);

drop policy if exists "Users can read their support tickets" on support_tickets;
create policy "Users can read their support tickets"
on support_tickets
for select
to authenticated
using (
  auth.uid() = user_id
  or lower(coalesce((auth.jwt() ->> 'email'), '')) = 'joeryan09@outlook.com'
);

drop policy if exists "Admin can update support tickets" on support_tickets;
create policy "Admin can update support tickets"
on support_tickets
for update
to authenticated
using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'joeryan09@outlook.com')
with check (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'joeryan09@outlook.com');

create index if not exists support_tickets_status_idx on support_tickets(status);
create index if not exists support_tickets_priority_idx on support_tickets(priority);
create index if not exists support_tickets_created_at_idx on support_tickets(created_at desc);
