-- Daily login monitor: store IP (+ optional user agent) per sign-in

create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  ip_address text,
  user_agent text,
  logged_in_at timestamptz not null default now(),
  login_date date not null default ((timezone('utc', now()))::date)
);

create index if not exists login_events_user_id_idx
  on public.login_events (user_id);

create index if not exists login_events_login_date_idx
  on public.login_events (login_date desc);

create index if not exists login_events_user_date_idx
  on public.login_events (user_id, login_date desc);

create index if not exists login_events_ip_idx
  on public.login_events (ip_address);

alter table public.login_events enable row level security;

-- Users can see their own login history
drop policy if exists "login_events_select_own" on public.login_events;
create policy "login_events_select_own"
  on public.login_events for select
  to authenticated
  using (auth.uid() = user_id);

-- Users can insert their own login rows (IP usually filled by Edge Function / trigger later)
drop policy if exists "login_events_insert_own" on public.login_events;
create policy "login_events_insert_own"
  on public.login_events for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select, insert on table public.login_events to authenticated;

comment on table public.login_events is
  'Tracks who logged in each day (IP address + optional user agent).';
