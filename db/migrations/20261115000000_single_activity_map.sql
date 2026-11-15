-- A paused activity still occupies its map. Only unlinking releases the slot.
-- Fail before changing any rows if existing associations need an owner's choice.
lock table public.activity_placement in share row exclusive mode;
do $$
declare conflicts jsonb;
begin
  select jsonb_agg(to_jsonb(c)) into conflicts from (
    select activity_id, array_agg(workspace_id order by workspace_id) as workspace_ids
    from public.activity_placement where status <> 'archived'
    group by activity_id having count(*) > 1
  ) c;
  if conflicts is not null then
    raise exception 'Activities linked to multiple maps must be unlinked before migration'
      using detail = conflicts::text,
            hint = 'Choose the map to retain and unlink the other placements; participation records are preserved.';
  end if;
end $$;

update public.activity_placement set status = 'paused', lock_version = lock_version + 1, updated_at = now()
where status = 'draft';
alter table public.activity_placement alter column status set default 'paused';
alter table public.activity_placement drop constraint activity_placement_status_check;
alter table public.activity_placement add constraint activity_placement_status_check
  check (status in ('active', 'paused', 'archived'));
create unique index activity_placement_single_map_unique on public.activity_placement(activity_id)
  where status <> 'archived';
