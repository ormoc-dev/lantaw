-- Live comments while watching together (TikTok-style overlay)

create table if not exists public.watch_party_messages (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.watch_parties (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 280),
  created_at timestamptz not null default now()
);

create index if not exists watch_party_messages_party_idx
  on public.watch_party_messages (party_id, created_at);

alter table public.watch_party_messages enable row level security;

drop policy if exists "watch_party_messages_select" on public.watch_party_messages;
create policy "watch_party_messages_select"
  on public.watch_party_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.watch_parties p
      where p.id = party_id
        and (p.host_id = auth.uid() or p.guest_id = auth.uid())
    )
  );

drop policy if exists "watch_party_messages_insert" on public.watch_party_messages;
create policy "watch_party_messages_insert"
  on public.watch_party_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.watch_parties p
      where p.id = party_id
        and p.status in ('invited', 'active')
        and (p.host_id = auth.uid() or p.guest_id = auth.uid())
    )
  );

do $$
begin
  begin
    alter publication supabase_realtime add table public.watch_party_messages;
  exception
    when duplicate_object then null;
  end;
end $$;
