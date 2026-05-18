-- Stonks: portfolio schema.
-- Run once via the Supabase SQL editor against your project.
--
-- Stores option positions per authenticated user. RLS is the ONLY thing
-- standing between user portfolios — never disable the policies below.

create extension if not exists "pgcrypto";

create table if not exists public.positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  symbol        text not null,
  side          text not null check (side in ('call', 'put')),
  expiry        bigint not null,                       -- epoch seconds, matches data/<SYMBOL>.json keys
  strike        numeric not null check (strike > 0),
  quantity      integer not null check (quantity > 0),
  entry_premium numeric not null check (entry_premium >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists positions_user_id_idx on public.positions (user_id);
create index if not exists positions_user_expiry_idx on public.positions (user_id, expiry);

alter table public.positions enable row level security;

drop policy if exists "positions_select_own" on public.positions;
create policy "positions_select_own"
  on public.positions for select
  using (auth.uid() = user_id);

drop policy if exists "positions_insert_own" on public.positions;
create policy "positions_insert_own"
  on public.positions for insert
  with check (auth.uid() = user_id);

drop policy if exists "positions_update_own" on public.positions;
create policy "positions_update_own"
  on public.positions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "positions_delete_own" on public.positions;
create policy "positions_delete_own"
  on public.positions for delete
  using (auth.uid() = user_id);
