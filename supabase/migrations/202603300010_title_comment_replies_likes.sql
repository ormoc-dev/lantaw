-- Replies and likes on title comments

alter table public.title_comments
  add column if not exists parent_id uuid references public.title_comments (id) on delete cascade;

create index if not exists title_comments_parent_idx
  on public.title_comments (parent_id, created_at);

create table if not exists public.title_comment_likes (
  comment_id uuid not null references public.title_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists title_comment_likes_comment_idx
  on public.title_comment_likes (comment_id);

alter table public.title_comment_likes enable row level security;

drop policy if exists "title_comment_likes_select_all" on public.title_comment_likes;
create policy "title_comment_likes_select_all"
  on public.title_comment_likes for select
  to anon, authenticated
  using (true);

drop policy if exists "title_comment_likes_insert_own" on public.title_comment_likes;
create policy "title_comment_likes_insert_own"
  on public.title_comment_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "title_comment_likes_delete_own" on public.title_comment_likes;
create policy "title_comment_likes_delete_own"
  on public.title_comment_likes for delete
  to authenticated
  using (auth.uid() = user_id);
