-- Last activity for “Offline · 5m ago” style labels in Friends.
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc nulls last);

-- Owners already can update their own profile (profiles_update_own).
-- Backfill from updated_at so existing accounts aren’t blank.
update public.profiles
set last_seen_at = coalesce(last_seen_at, updated_at, created_at)
where last_seen_at is null;
