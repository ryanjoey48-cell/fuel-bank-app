create or replace function public.get_booking_client_delete_eligibility()
returns table (
  client_id uuid,
  booking_references bigint,
  other_references bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  client_row record;
  foreign_key_row record;
  reference_count bigint;
begin
  if auth.uid() is null or not (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
    or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
  ) then
    raise exception 'Admin permission required to manage clients.'
      using errcode = '42501';
  end if;

  for client_row in select id from public.clients loop
    client_id := client_row.id;
    booking_references := 0;
    other_references := 0;

    for foreign_key_row in
      select
        constraint_row.conrelid::regclass as reference_table,
        source_attribute.attname as reference_column
      from pg_catalog.pg_constraint constraint_row
      cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
      join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
        on target_key.position = source_key.position
      join pg_catalog.pg_attribute source_attribute
        on source_attribute.attrelid = constraint_row.conrelid
       and source_attribute.attnum = source_key.attnum
      join pg_catalog.pg_attribute target_attribute
        on target_attribute.attrelid = constraint_row.confrelid
       and target_attribute.attnum = target_key.attnum
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.clients'::regclass
        and target_attribute.attname = 'id'
    loop
      execute format(
        'select count(*) from %s where %I = $1',
        foreign_key_row.reference_table,
        foreign_key_row.reference_column
      )
      into reference_count
      using client_row.id;

      if foreign_key_row.reference_table = 'public.booking_diary'::regclass then
        booking_references := booking_references + reference_count;
      else
        other_references := other_references + reference_count;
      end if;
    end loop;

    return next;
  end loop;
end;
$$;

revoke all on function public.get_booking_client_delete_eligibility() from public;
grant execute on function public.get_booking_client_delete_eligibility() to authenticated;

create or replace function public.delete_unused_booking_client(target_client_id uuid)
returns table (
  deleted_id uuid,
  deleted_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_name text;
  current_normalized_name text;
  foreign_key_row record;
  has_reference boolean;
begin
  if auth.uid() is null or not (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
    or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
  ) then
    raise exception 'Admin permission required to manage clients.'
      using errcode = '42501';
  end if;

  select client.name, client.normalized_name
  into current_name, current_normalized_name
  from public.clients client
  where client.id = target_client_id
  for update;

  if not found then
    raise exception 'Client no longer exists.'
      using errcode = 'P0002';
  end if;

  if current_normalized_name = public.normalize_client_name('Internal / Other') then
    raise exception 'Internal / Other cannot be deleted.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.booking_diary booking
    where booking.client_id = target_client_id
  ) then
    raise exception 'Cannot delete this client because it is used by bookings. Deactivate it instead.'
      using errcode = '23503';
  end if;

  for foreign_key_row in
    select
      constraint_row.conrelid::regclass as reference_table,
      source_attribute.attname as reference_column
    from pg_catalog.pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
    join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_attribute
      on source_attribute.attrelid = constraint_row.conrelid
     and source_attribute.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_attribute
      on target_attribute.attrelid = constraint_row.confrelid
     and target_attribute.attnum = target_key.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.clients'::regclass
      and constraint_row.conrelid <> 'public.booking_diary'::regclass
      and target_attribute.attname = 'id'
  loop
    execute format(
      'select exists(select 1 from %s where %I = $1)',
      foreign_key_row.reference_table,
      foreign_key_row.reference_column
    )
    into has_reference
    using target_client_id;

    if has_reference then
      raise exception 'Cannot delete this client because it is referenced by other records. Deactivate it instead.'
        using errcode = '23503';
    end if;
  end loop;

  delete from public.clients client
  where client.id = target_client_id
  returning client.id, client.name into deleted_id, deleted_name;

  return next;
end;
$$;

revoke all on function public.delete_unused_booking_client(uuid) from public;
grant execute on function public.delete_unused_booking_client(uuid) to authenticated;

comment on function public.delete_unused_booking_client(uuid)
is 'Permanently deletes only non-system clients with no foreign-key references after an atomic admin recheck.';
