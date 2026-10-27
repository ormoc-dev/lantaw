-- Allow a signed-in user to permanently delete their own auth account.
-- Cascades remove profiles / watchlist / friends data (FK on delete cascade).

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Best-effort: remove avatar objects for this user
  begin
    delete from storage.objects
    where bucket_id = 'avatars'
      and name like uid::text || '/%';
  exception
    when others then
      null;
  end;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
