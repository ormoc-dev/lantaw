-- Friends can see what you're watching right now (solo player presence).

create table if not exists public.watching_now (
  user_id uuid primary key references auth.users (id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null,
  title text not null,
  poster text,
  updated_at timestamptz not null default now()
);

create index if not exists watching_now_updated_idx
  on public.watching_now (updated_at desc);

alter table public.watching_now enable row level security;

drop policy if exists "watching_now_select_self_or_friends" on public.watching_now;
create policy "watching_now_select_self_or_friends"
  on public.watching_now for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = watching_now.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = watching_now.user_id)
        )
    )
  );

drop policy if exists "watching_now_upsert_own" on public.watching_now;
create policy "watching_now_upsert_own"
  on public.watching_now for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "watching_now_update_own" on public.watching_now;
create policy "watching_now_update_own"
  on public.watching_now for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "watching_now_delete_own" on public.watching_now;
create policy "watching_now_delete_own"
  on public.watching_now for delete
  to authenticated
  using (auth.uid() = user_id);

do $$
begin
  begin
    alter publication supabase_realtime add table public.watching_now;
  exception
    when duplicate_object then null;
  end;
end $$;
