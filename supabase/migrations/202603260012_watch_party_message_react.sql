-- Emoji reactions on watch-party room chat

create table if not exists public.watch_party_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.watch_party_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists watch_party_message_reactions_message_idx
  on public.watch_party_message_reactions (message_id);

alter table public.watch_party_message_reactions enable row level security;

drop policy if exists "watch_party_message_reactions_select" on public.watch_party_message_reactions;
create policy "watch_party_message_reactions_select"
  on public.watch_party_message_reactions for select
  to authenticated
  using (
    exists (
      select 1
      from public.watch_party_messages m
      join public.watch_parties p on p.id = m.party_id
      where m.id = message_id
        and (p.host_id = auth.uid() or p.guest_id = auth.uid())
    )
  );

drop policy if exists "watch_party_message_reactions_insert" on public.watch_party_message_reactions;
create policy "watch_party_message_reactions_insert"
  on public.watch_party_message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.watch_party_messages m
      join public.watch_parties p on p.id = m.party_id
      where m.id = message_id
        and (p.host_id = auth.uid() or p.guest_id = auth.uid())
    )
  );

drop policy if exists "watch_party_message_reactions_delete" on public.watch_party_message_reactions;
create policy "watch_party_message_reactions_delete"
  on public.watch_party_message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

do $$
begin
  begin
    alter publication supabase_realtime add table public.watch_party_message_reactions;
  exception when duplicate_object then null;
  end;
end $$;
