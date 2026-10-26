-- Enable Supabase Realtime for friends / chat / watch tables
-- Run in SQL Editor if friends updates don't appear live.

do $$
begin
  begin
    alter publication supabase_realtime add table public.friendships;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.friend_messages;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.watch_parties;
  exception
    when duplicate_object then null;
  end;
end $$;
