-- Short friend notes shown above avatars in the chats row.
-- Friends can read them; only the author can write.
-- Notes older than 24 hours are deleted by purge_expired_friend_notes().

create table if not exists public.friend_notes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 60),
  updated_at timestamptz not null default now()
);

alter table public.friend_notes enable row level security;

drop policy if exists "friend_notes_select_friends" on public.friend_notes;
create policy "friend_notes_select_friends"
  on public.friend_notes for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = friend_notes.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = friend_notes.user_id)
        )
    )
  );

drop policy if exists "friend_notes_insert_own" on public.friend_notes;
create policy "friend_notes_insert_own"
  on public.friend_notes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "friend_notes_update_own" on public.friend_notes;
create policy "friend_notes_update_own"
  on public.friend_notes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "friend_notes_delete_own" on public.friend_notes;
create policy "friend_notes_delete_own"
  on public.friend_notes for delete
  to authenticated
  using (auth.uid() = user_id);

-- Deletes every note older than 24 hours. The app calls this whenever chats open.
create or replace function public.purge_expired_friend_notes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.friend_notes
  where updated_at < now() - interval '24 hours';
$$;

grant select, insert, update, delete on table public.friend_notes to authenticated;

revoke all on function public.purge_expired_friend_notes() from public;
grant execute on function public.purge_expired_friend_notes() to authenticated;
