-- Title comments on movie / TV detail pages

create table if not exists public.title_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  body text not null
    check (char_length(trim(body)) > 0 and char_length(body) <= 1000),
  author_name text,
  author_avatar text,
  created_at timestamptz not null default now()
);

create index if not exists title_comments_title_idx
  on public.title_comments (media_type, tmdb_id, created_at desc);

create index if not exists title_comments_user_idx
  on public.title_comments (user_id, created_at desc);

alter table public.title_comments enable row level security;

drop policy if exists "title_comments_select_all" on public.title_comments;
create policy "title_comments_select_all"
  on public.title_comments for select
  to anon, authenticated
  using (true);

drop policy if exists "title_comments_insert_own" on public.title_comments;
create policy "title_comments_insert_own"
  on public.title_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "title_comments_delete_own" on public.title_comments;
create policy "title_comments_delete_own"
  on public.title_comments for delete
  to authenticated
  using (auth.uid() = user_id);
