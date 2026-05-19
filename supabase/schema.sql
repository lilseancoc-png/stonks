-- Stonks: portfolio schema.
-- Run once via the Supabase SQL editor against your project.
--
-- Stores option positions per authenticated user. RLS is the ONLY thing
-- standing between user portfolios — never disable the policies below.
--
-- pgcrypto is pre-installed on Supabase, so gen_random_uuid() is available
-- with no extension call (Supabase's SQL editor can also reject CREATE
-- EXTENSION in read-only sessions, which is the other reason it's not here).

create table if not exists public.positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  symbol        text not null,
  side          text not null check (side in ('call', 'put')),
  expiry        bigint not null,                       -- epoch seconds, matches data/<SYMBOL>.json keys
  strike        numeric not null check (strike > 0),
  quantity      integer not null check (quantity > 0),
  entry_premium numeric not null check (entry_premium >= 0),
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- For existing deployments: back-fill opened_at from created_at and add the
-- closed_at column. Idempotent — safe to re-run.
alter table public.positions add column if not exists opened_at timestamptz;
alter table public.positions add column if not exists closed_at timestamptz;
update public.positions set opened_at = created_at where opened_at is null;
alter table public.positions alter column opened_at set not null;
alter table public.positions alter column opened_at set default now();

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

-- Trade log. Every BUY (initial open) and SELL (partial or full close)
-- writes one row here. Realized P/L is computed by joining SELL rows back to
-- their position's entry_premium server-side. We never edit a trade row
-- after insertion; corrections are made by adding a compensating trade.
create table if not exists public.trades (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  position_id  uuid not null references public.positions(id) on delete cascade,
  side         text not null check (side in ('BUY', 'SELL')),
  quantity     integer not null check (quantity > 0),
  price        numeric not null check (price >= 0),
  traded_at    timestamptz not null default now()
);

create index if not exists trades_user_id_idx on public.trades (user_id);
create index if not exists trades_position_idx on public.trades (position_id);

alter table public.trades enable row level security;

drop policy if exists "trades_select_own" on public.trades;
create policy "trades_select_own"
  on public.trades for select
  using (auth.uid() = user_id);

drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own"
  on public.trades for insert
  with check (auth.uid() = user_id);

-- Daily equity snapshots, one row per user per UTC date. The portfolio
-- review endpoint upserts a snapshot every time it runs, so the equity
-- chart fills in organically as the user opens / reviews their book.
-- Writes happen through the service-role key on the server; clients can
-- only read their own rows. No update/delete policies — snapshots are
-- append-only history.
create table if not exists public.portfolio_snapshots (
  user_id         uuid not null references auth.users(id) on delete cascade,
  date            date not null,
  equity          numeric not null,
  realized_pnl    numeric not null default 0,
  unrealized_pnl  numeric not null default 0,
  open_positions  integer not null default 0,
  primary key (user_id, date)
);

create index if not exists portfolio_snapshots_user_idx on public.portfolio_snapshots (user_id, date);

alter table public.portfolio_snapshots enable row level security;

drop policy if exists "snapshots_select_own" on public.portfolio_snapshots;
create policy "snapshots_select_own"
  on public.portfolio_snapshots for select
  using (auth.uid() = user_id);
