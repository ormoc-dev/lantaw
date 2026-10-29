-- Edit own messages + emoji reactions on friend chat

alter table public.friend_messages
  add column if not exists edited_at timestamptz;

drop policy if exists "friend_messages_update_own" on public.friend_messages;
create policy "friend_messages_update_own"
  on public.friend_messages for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create table if not exists public.friend_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.friend_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists friend_message_reactions_message_idx
  on public.friend_message_reactions (message_id);

alter table public.friend_message_reactions enable row level security;

drop policy if exists "friend_message_reactions_select" on public.friend_message_reactions;
create policy "friend_message_reactions_select"
  on public.friend_message_reactions for select
  to authenticated
  using (
    exists (
      select 1
      from public.friend_messages m
      join public.friendships f on f.id = m.friendship_id
      where m.id = message_id
        and f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    )
  );

drop policy if exists "friend_message_reactions_insert" on public.friend_message_reactions;
create policy "friend_message_reactions_insert"
  on public.friend_message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.friend_messages m
      join public.friendships f on f.id = m.friendship_id
      where m.id = message_id
        and f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    )
  );

drop policy if exists "friend_message_reactions_delete" on public.friend_message_reactions;
create policy "friend_message_reactions_delete"
  on public.friend_message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

do $$
begin
  begin
    alter publication supabase_realtime add table public.friend_message_reactions;
  exception when duplicate_object then null;
  end;
end $$;
