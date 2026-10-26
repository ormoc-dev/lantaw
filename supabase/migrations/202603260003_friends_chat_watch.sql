-- Friends, chat messages, and watch-together sessions

-- Allow signed-in users to find other profiles (for Add Friend)
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Friendships
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_pair_unique unique (requester_id, addressee_id)
);

create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);
create index if not exists friendships_status_idx on public.friendships (status);

alter table public.friendships enable row level security;

drop policy if exists "friendships_select_participant" on public.friendships;
create policy "friendships_select_participant"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

drop policy if exists "friendships_update_participant" on public.friendships;
create policy "friendships_update_participant"
  on public.friendships for update
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships_delete_participant" on public.friendships;
create policy "friendships_delete_participant"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Direct messages (1:1 via friendship)
-- ---------------------------------------------------------------------------
create table if not exists public.friend_messages (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists friend_messages_friendship_idx
  on public.friend_messages (friendship_id, created_at);

alter table public.friend_messages enable row level security;

drop policy if exists "friend_messages_select_participant" on public.friend_messages;
create policy "friend_messages_select_participant"
  on public.friend_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    )
  );

drop policy if exists "friend_messages_insert_participant" on public.friend_messages;
create policy "friend_messages_insert_participant"
  on public.friend_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Watch together
-- ---------------------------------------------------------------------------
create table if not exists public.watch_parties (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  guest_id uuid not null references auth.users (id) on delete cascade,
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  media_type text not null default 'movie' check (media_type in ('movie', 'tv')),
  tmdb_id integer not null,
  title text not null,
  poster text,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'ended', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists watch_parties_host_idx on public.watch_parties (host_id);
create index if not exists watch_parties_guest_idx on public.watch_parties (guest_id);

alter table public.watch_parties enable row level security;

drop policy if exists "watch_parties_select_participant" on public.watch_parties;
create policy "watch_parties_select_participant"
  on public.watch_parties for select
  to authenticated
  using (auth.uid() = host_id or auth.uid() = guest_id);

drop policy if exists "watch_parties_insert_host" on public.watch_parties;
create policy "watch_parties_insert_host"
  on public.watch_parties for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "watch_parties_update_participant" on public.watch_parties;
create policy "watch_parties_update_participant"
  on public.watch_parties for update
  to authenticated
  using (auth.uid() = host_id or auth.uid() = guest_id)
  with check (auth.uid() = host_id or auth.uid() = guest_id);

drop trigger if exists watch_parties_set_updated_at on public.watch_parties;
create trigger watch_parties_set_updated_at
  before update on public.watch_parties
  for each row execute function public.set_updated_at();
