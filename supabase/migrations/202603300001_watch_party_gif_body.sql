-- Allow GIF URL messages in watch-party chat (was 280; compact Giphy URLs fit,
-- but leave headroom for tagged [gif]https://… bodies).
alter table public.watch_party_messages
  drop constraint if exists watch_party_messages_body_check;

alter table public.watch_party_messages
  add constraint watch_party_messages_body_check
  check (char_length(trim(body)) > 0 and char_length(body) <= 1000);
