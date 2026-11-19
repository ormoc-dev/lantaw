-- Home activity strip: let everyone see watching + recent views (comments already public).

drop policy if exists "watching_now_select_self_or_friends" on public.watching_now;
drop policy if exists "watching_now_select_all" on public.watching_now;
create policy "watching_now_select_all"
  on public.watching_now for select
  using (true);

drop policy if exists "title_views_select_self_or_friends" on public.title_views;
drop policy if exists "title_views_select_all" on public.title_views;
create policy "title_views_select_all"
  on public.title_views for select
  using (true);
