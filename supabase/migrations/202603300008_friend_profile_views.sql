-- Title view history (friends can peek) + helper to list a friend's peers.

create table if not exists public.title_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null,
  title text not null,
  poster text,
  viewed_at timestamptz not null default now(),
  unique (user_id, media_type, tmdb_id)
);

create index if not exists title_views_user_viewed_idx
  on public.title_views (user_id, viewed_at desc);

alter table public.title_views enable row level security;

drop policy if exists "title_views_select_self_or_friends" on public.title_views;
create policy "title_views_select_self_or_friends"
  on public.title_views for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = title_views.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = title_views.user_id)
        )
    )
  );

drop policy if exists "title_views_upsert_own" on public.title_views;
create policy "title_views_upsert_own"
  on public.title_views for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "title_views_update_own" on public.title_views;
create policy "title_views_update_own"
  on public.title_views for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "title_views_delete_own" on public.title_views;
create policy "title_views_delete_own"
  on public.title_views for delete
  to authenticated
  using (auth.uid() = user_id);

-- Accepted friends of a friend (only if caller is friends with them).
create or replace function public.friend_profile_peers(target uuid)
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if target is null or auth.uid() is null then
    return;
  end if;

  if target <> auth.uid() and not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.addressee_id = target)
        or (f.addressee_id = auth.uid() and f.requester_id = target)
      )
  ) then
    return;
  end if;

  return query
  select
    p.id,
    p.email,
    p.display_name,
    p.avatar_url,
    p.last_seen_at
  from public.friendships f
  join public.profiles p
    on p.id = case
      when f.requester_id = target then f.addressee_id
      else f.requester_id
    end
  where f.status = 'accepted'
    and (f.requester_id = target or f.addressee_id = target)
    and p.id <> auth.uid()
    and p.id <> target
  order by lower(coalesce(p.display_name, p.email, ''))
  limit 48;
end;
$$;

revoke all on function public.friend_profile_peers(uuid) from public;
grant execute on function public.friend_profile_peers(uuid) to authenticated;
