-- One latest message per chat, skipping "delete for me" hides.
-- Replaces pulling hundreds of message rows just to build the inbox.

create index if not exists friend_messages_friendship_created_idx
  on public.friend_messages (friendship_id, created_at desc);

create or replace function public.friend_chat_previews(ids uuid[])
returns table (
  id uuid,
  friendship_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (m.friendship_id)
    m.id,
    m.friendship_id,
    m.sender_id,
    m.body,
    m.created_at,
    m.deleted_at
  from public.friend_messages m
  where m.friendship_id = any(ids)
    and not exists (
      select 1
      from public.friend_message_hides h
      where h.message_id = m.id
        and h.user_id = auth.uid()
    )
  order by m.friendship_id, m.created_at desc;
$$;

revoke all on function public.friend_chat_previews(uuid[]) from public;
grant execute on function public.friend_chat_previews(uuid[]) to authenticated;
