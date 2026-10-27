-- Allow host or guest to remove a watch party from their invites list

drop policy if exists "watch_parties_delete_participant" on public.watch_parties;
create policy "watch_parties_delete_participant"
  on public.watch_parties for delete
  to authenticated
  using (auth.uid() = host_id or auth.uid() = guest_id);
