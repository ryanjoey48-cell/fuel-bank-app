alter table if exists support_tickets
  add column if not exists admin_note text;

drop policy if exists "Admin can update support tickets" on support_tickets;
create policy "Admin can update support tickets"
on support_tickets
for update
to authenticated
using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'joeryan09@outlook.com')
with check (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'joeryan09@outlook.com');
