-- Delete for everyone (soft) + delete for me (per-user hide)

alter table public.friend_messages
  add column if not exists deleted_at timestamptz;

-- Allow empty body only when soft-deleted for everyone
do $$
begin
  alter table public.friend_messages
    drop constraint if exists friend_messages_body_check;
exception when undefined_object then null;
end $$;

-- Recreate check: either deleted, or non-empty body
alter table public.friend_messages
  drop constraint if exists friend_messages_body_nonempty;
alter table public.friend_messages
  add constraint friend_messages_body_nonempty
  check (deleted_at is not null or char_length(trim(body)) > 0);

-- Sender can soft-delete (and clear body); existing update policy already covers sender_id = auth.uid()

create table if not exists public.friend_message_hides (
  message_id uuid not null references public.friend_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists friend_message_hides_user_idx
  on public.friend_message_hides (user_id);

alter table public.friend_message_hides enable row level security;

drop policy if exists "friend_message_hides_select_own" on public.friend_message_hides;
create policy "friend_message_hides_select_own"
  on public.friend_message_hides for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "friend_message_hides_insert_own" on public.friend_message_hides;
create policy "friend_message_hides_insert_own"
  on public.friend_message_hides for insert
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

drop policy if exists "friend_message_hides_delete_own" on public.friend_message_hides;
create policy "friend_message_hides_delete_own"
  on public.friend_message_hides for delete
  to authenticated
  using (user_id = auth.uid());
