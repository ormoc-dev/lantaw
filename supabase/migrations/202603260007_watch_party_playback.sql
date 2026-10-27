-- Shared play/pause sync for watch-together (both clients follow one start signal)

alter table public.watch_parties
  add column if not exists playback_state text not null default 'idle'
    check (playback_state in ('idle', 'playing', 'paused'));

alter table public.watch_parties
  add column if not exists playback_position_sec double precision not null default 0;

alter table public.watch_parties
  add column if not exists playback_started_at timestamptz;

alter table public.watch_parties
  add column if not exists playback_sync_token bigint not null default 0;

alter table public.watch_parties
  add column if not exists playback_season integer;

alter table public.watch_parties
  add column if not exists playback_episode integer;

alter table public.watch_parties
  add column if not exists playback_by uuid references auth.users (id) on delete set null;

comment on column public.watch_parties.playback_sync_token is
  'Bumps whenever play/sync is pressed so both clients reload the stream together.';
