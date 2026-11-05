-- Synced chat read receipts (Messenger-style “seen” avatars)

create table if not exists public.friend_chat_reads (
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (friendship_id, user_id)
);

create index if not exists friend_chat_reads_user_idx
  on public.friend_chat_reads (user_id);

alter table public.friend_chat_reads enable row level security;

drop policy if exists "friend_chat_reads_select_participant" on public.friend_chat_reads;
create policy "friend_chat_reads_select_participant"
  on public.friend_chat_reads for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    )
  );

drop policy if exists "friend_chat_reads_upsert_own" on public.friend_chat_reads;
create policy "friend_chat_reads_insert_own"
  on public.friend_chat_reads for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    )
  );

drop policy if exists "friend_chat_reads_update_own" on public.friend_chat_reads;
create policy "friend_chat_reads_update_own"
  on public.friend_chat_reads for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists friend_chat_reads_set_updated_at on public.friend_chat_reads;
create trigger friend_chat_reads_set_updated_at
  before update on public.friend_chat_reads
  for each row execute function public.set_updated_at();

do $$
begin
  begin
    alter publication supabase_realtime add table public.friend_chat_reads;
  exception
    when duplicate_object then null;
  end;
end $$;
