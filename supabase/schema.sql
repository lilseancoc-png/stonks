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

-- Atomic close: takes a row lock on the position, validates, inserts the
-- SELL trade, and updates quantity (or closed_at) in a single transaction.
-- Runs as the caller (security invoker) so RLS on positions/trades enforces
-- ownership via auth.uid(); the function only needs grant execute below.
create or replace function public.close_position(
  p_position_id uuid,
  p_quantity int,
  p_price numeric
) returns table (
  id uuid,
  symbol text,
  side text,
  expiry bigint,
  strike numeric,
  quantity int,
  entry_premium numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_pnl numeric
) language plpgsql security invoker as $$
declare
  pos public.positions%rowtype;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive integer' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'price must be a non-negative number' using errcode = '22023';
  end if;

  -- Row lock keeps concurrent closes from racing past validation.
  select * into pos
    from public.positions
    where positions.id = p_position_id and positions.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'position not found' using errcode = 'P0002';
  end if;
  if pos.closed_at is not null then
    raise exception 'position already closed' using errcode = 'P0001';
  end if;
  if p_quantity > pos.quantity then
    raise exception 'quantity exceeds remaining (%)', pos.quantity using errcode = '22023';
  end if;

  insert into public.trades (user_id, position_id, side, quantity, price)
    values (auth.uid(), p_position_id, 'SELL', p_quantity, p_price);

  if pos.quantity - p_quantity > 0 then
    update public.positions
       set quantity = pos.quantity - p_quantity
     where positions.id = p_position_id
     returning * into pos;
  else
    -- Leave quantity at its prior positive value to satisfy the > 0 check
    -- constraint; closed_at is the source of truth for "open" vs "closed".
    update public.positions
       set closed_at = now()
     where positions.id = p_position_id
     returning * into pos;
  end if;

  return query select
    pos.id, pos.symbol, pos.side, pos.expiry, pos.strike, pos.quantity,
    pos.entry_premium, pos.opened_at, pos.closed_at,
    (p_price - pos.entry_premium) * p_quantity * 100;
end;
$$;

grant execute on function public.close_position(uuid, int, numeric) to authenticated;
