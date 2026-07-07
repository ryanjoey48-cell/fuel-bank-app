alter table if exists support_tickets
add column if not exists admin_note text;

create or replace function public.is_support_ticket_admin()
returns boolean
language sql
stable
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) in ('admin', 'administrator')
    or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '')) in ('admin', 'administrator');
$$;

alter table support_tickets enable row level security;

drop policy if exists "Users can create support tickets" on support_tickets;
drop policy if exists "Users can read their support tickets" on support_tickets;
drop policy if exists "Admin can read support tickets" on support_tickets;
drop policy if exists "Admins can read all support tickets" on support_tickets;
drop policy if exists "Admin can update support tickets" on support_tickets;
drop policy if exists "Admins can update support tickets" on support_tickets;
drop policy if exists "Admins can delete support tickets" on support_tickets;

create policy "Users can create support tickets"
on support_tickets
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can read their support tickets"
on support_tickets
for select
to authenticated
using (auth.uid() = user_id);

create policy "Admins can read all support tickets"
on support_tickets
for select
to authenticated
using (public.is_support_ticket_admin());

create policy "Admins can update support tickets"
on support_tickets
for update
to authenticated
using (public.is_support_ticket_admin())
with check (public.is_support_ticket_admin());

create policy "Admins can delete support tickets"
on support_tickets
for delete
to authenticated
using (public.is_support_ticket_admin());
