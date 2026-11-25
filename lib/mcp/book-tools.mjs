// lib/mcp/book-tools.mjs — the Owner book exposure read on the Mingstreet MCP
// (2026-11-25).
//
// get_book_exposure (Owner): every open Top Picks and strategy-engine trade at
// the size the Webull paper account holds, as one book: net stock exposure
// (delta $), the same in S&P 500 dollars (each stock's beta to SPY over the
// last year), gross exposure, time decay a day and a week, volatility exposure,
// a 1-in-20 bad day, exposure by engine and by stock, and "opposite bets"
// (one trade long a stock, another short it). The same math and the same
// sizing rule as the Open picks "Book risk" panel (lib/book-risk.mjs
// positionOf / bySymbol), so the two agree.
//
// Sizes: ctx.bookSizes (lib/mcp/read-only-store.mjs bookSizesReader) opens the
// Webull ledger on the server and returns only each trade's size fields; the
// ledger itself stays unreadable through the MCP. Read-only, zero AI calls, no
// fetch beyond the store. Owner Settings switch MCP_BOOK_EXPOSURE turns it off.
import { bookRiskFactory } from "../book-risk.mjs";
import { BOOK_CRASHES } from "../book-risk-crashes.mjs";
import { greeks, bsPrice, expiryCloseEpochSec } from "../greeks.mjs";
import { pickTradeId } from "../pick-trade-text.mjs";
import { ENGINES } from "../engines/config.mjs";

const OWNER = "owner";
const SKIP_WORDS = { missed: "missed at Webull", "not-bought": "not bought at Webull", closed: "already closed at Webull", shared: "held by another trade on the same contract", "no-price": "no price", "no-expiry": "no expiry", "no-contract": "no contract" };
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

export function bookTools({ fail, envelope, readKey }) {
  return [{
    name: "get_book_exposure",
    title: "Read the paper book's exposure",
    audience: OWNER,
    bookExposure: true,
    description: "The whole Webull paper book on Mingstreet (every open Top Picks and strategy-engine trade, options and shares, at the size the Webull paper account holds) as one position: net stock exposure in delta $ (the stock-equivalent position) and in S&P 500 dollars (delta $ times each stock's one-year beta to SPY, with the SPY-share equivalent), gross exposure, time decay per day and per week, gain or loss per point of implied volatility, a 1-in-20 bad day from last year's daily moves, exposure by engine (made_by), and exposure by stock with each trade's size and an `opposite_bets` tag where one trade is long the stock and another short it (which engines, how much cancels, which side the stock nets to). Same numbers as the Book risk panel on Open picks. Filter with `symbol` or `opposite_bets_only`. Owner only; read-only; sizes only from Webull (no orders, prices or account data).",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", maxLength: 12, pattern: "^\\$?[A-Za-z][A-Za-z0-9.^=-]{0,9}$", description: "Only this stock's row in by_stock (the book totals still cover every trade)." },
        opposite_bets_only: { type: "boolean", description: "Only the stocks with opposite bets in by_stock." },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
      if (ctx.env?.MCP_BOOK_EXPOSURE === "0") fail("NOT_FOUND", "The book exposure read is switched off");
      const warnings = [];
      const record = (await readKey(ctx, "picks-accuracy.json")).payload;
      let engines = null;
      try { engines = (await readKey(ctx, "engines.json")).payload; } catch { warnings.push("ENGINES_UNAVAILABLE: the engines' file could not be read; only Top Picks trades are counted."); }
      let ledger = null;
      try { ledger = ctx.bookSizes ? await ctx.bookSizes.heldSizes() : null; } catch { ledger = null; }
      if (!ledger) warnings.push("WEBULL_SIZES_UNAVAILABLE: the Webull paper ledger could not be read, so every trade uses its record's own size.");
      let days = null;
      try { days = (await readKey(ctx, "market-days.json")).payload; } catch { warnings.push("NO_MARKET_DAYS: last year's daily moves could not be read, so S&P 500 dollars, betas and the bad day are missing."); }

      // The build's own risk-free rate (the panel's RFR) and its saved spots
      // (the panel's SPOTS come from the same bake), so the two agree.
      let rate = null, spots = {};
      try { const rf = (await readKey(ctx, "rfr-history.json")).payload; if (Number.isFinite(Number(rf?.rate))) rate = Number(rf.rate); } catch { rate = null; }
      try { for (const t of (await readKey(ctx, "heatmap.json")).payload?.tickers || []) if (t?.t && Number(t.sp) > 0) spots[t.t] = Number(t.sp); } catch { spots = {}; }
      const BR = bookRiskFactory({ price: bsPrice, greeks, r: rate ?? undefined });
      const nowSec = ctx.now() / 1000;
      const env = {
        ledger,
        spot: (sym, last, entry) => Number(last) || spots[sym] || Number(entry) || 0,
        yrs: (exp) => Math.max(1e-6, (expiryCloseEpochSec(exp) - nowSec) / (365.25 * 86400)),
        tradeId: pickTradeId,
      };
      const pos = [], skipped = {};
      const add = (r) => { if (r.skip) skipped[r.skip] = (skipped[r.skip] || 0) + 1; else pos.push(r); };
      for (const o of Array.isArray(record?.open) ? record.open : []) add(BR.positionOf(o, "Top Picks", false, env));
      for (const e of Array.isArray(engines?.engines) ? engines.engines : []) {
        for (const t of Array.isArray(e?.open) ? e.open : []) if (t && t.tradeId) add(BR.positionOf(t, t.madeBy || ENGINES[t.engine]?.name || String(t.engine || "Engine"), true, env));
      }
      // A missing implied volatility: 45% (the panel uses the stock's own
      // realized volatility when it has the year of moves; flagged either way).
      const series = days ? BR.seriesFrom(days) : null;
      for (const p of pos) for (const l of p.legs) {
        if (l.iv > 0) continue;
        const x = series?.bySym?.[p.symbol];
        let v = null;
        if (x) { let s = 0, s2 = 0, n = 0; for (const r of x) if (r != null) { s += r; s2 += r * r; n++; } if (n > 30) { const m = s / n; v = Math.sqrt(Math.max(0, s2 / n - m * m) * 252) * 1.1; } }
        l.iv = v > 0.05 ? v : 0.45; p.ivEst = true;
      }
      const ivEst = pos.filter((p) => p.ivEst).length;
      const G = pos.map(BR.greeksOf);
      const covid = BOOK_CRASHES.windows.find((w) => w.id === "covid-2020");
      const A = series && pos.length ? BR.analyze(pos, series, { crisisRho: covid ? covid.corr : null }) : null;
      const betas = A?.ok ? A.betas : null;
      const BS = BR.bySymbol(pos, G, betas);
      let net = 0, gross = 0, theta = 0, vega = 0, value = 0;
      const src = {};
      pos.forEach((p, i) => {
        const g = G[i];
        net += g.deltaUsd; gross += Math.abs(g.deltaUsd); theta += g.thetaUsd; vega += g.vegaUsd; value += g.valueUsd;
        const s = src[p.src] = src[p.src] || { made_by: p.src, trades: 0, net_delta_usd: 0, sp500_usd: betas ? 0 : null, decay_per_day_usd: 0 };
        s.trades++; s.net_delta_usd += g.deltaUsd; s.decay_per_day_usd += g.thetaUsd;
        if (betas) s.sp500_usd += g.deltaUsd * (betas[p.symbol] ?? 1);
      });
      const sym = args.symbol ? String(args.symbol).replace(/^\$/, "").toUpperCase() : null;
      let rows = BS.rows;
      if (sym) rows = rows.filter((r) => r.symbol === sym);
      if (args.opposite_bets_only) rows = rows.filter((r) => r.clash);
      if (sym && !BS.rows.some((r) => r.symbol === sym)) warnings.push(`NOT_HELD: no open trade on ${sym} in the paper book.`);
      const tradeKind = (t) => (t.kind === "shares" ? "shares" : `${t.side}${t.spread ? " spread" : ""}`);
      const basisById = Object.fromEntries(pos.map((p) => [p.id, p.basis]));
      const spyRow = pos.find((p) => p.symbol === "SPY");
      const spySpot = spyRow ? spyRow.S : spots.SPY || null;
      const results = {
        book: {
          trades: pos.length,
          net_delta_usd: round(net),
          sp500_usd: A?.ok ? round(A.betaDelta) : null,
          sp500_shares_equiv: A?.ok && spySpot ? Math.round(A.betaDelta / spySpot) : null,
          gross_delta_usd: round(gross),
          decay_per_day_usd: round(theta),
          decay_per_week_usd: round(theta * 7),
          vega_per_vol_point_usd: round(vega),
          value_usd: round(value),
          bad_day_1_in_20_usd: A?.ok ? round(-A.hist.var95) : null,
          opposite_bets: BS.clashes,
          opposite_bet_symbols: BS.rows.filter((r) => r.clash).map((r) => r.symbol),
        },
        by_engine: Object.values(src).sort((a, b) => Math.abs(b.net_delta_usd) - Math.abs(a.net_delta_usd))
          .map((s) => ({ ...s, net_delta_usd: round(s.net_delta_usd), sp500_usd: round(s.sp500_usd), decay_per_day_usd: round(s.decay_per_day_usd) })),
        by_stock: rows.map((r) => ({
          symbol: r.symbol,
          net_delta_usd: round(r.deltaUsd),
          beta: r.beta == null ? null : Math.round(r.beta * 100) / 100,
          sp500_usd: round(r.betaUsd),
          decay_per_day_usd: round(r.thetaUsd),
          opposite_bets: r.clash ? { nets: r.clash.nets, long_by: r.clash.longBy, short_by: r.clash.shortBy, cancelled_usd: round(r.clash.cancelledUsd) } : null,
          trades: r.trades.map((t) => ({ trade_id: t.id, made_by: t.src, kind: tradeKind(t), size: t.qty, size_unit: t.kind === "shares" ? "shares" : "contracts", size_from: basisById[t.id] || null, delta_usd: round(t.deltaUsd) })),
        })),
        left_out: Object.fromEntries(Object.entries(skipped).map(([k, n]) => [SKIP_WORDS[k] || k, n])),
      };
      if (ivEst) warnings.push(`IV_ESTIMATED: ${ivEst} option trade(s) had no implied volatility on the record; the stock's own one-year swings (or 45%) stand in.`);
      const notSent = pos.filter((p) => p.basis === "not-sent" || p.basis === "record").length;
      if (ledger && notSent) warnings.push(`RECORD_SIZE: ${notSent} trade(s) have no Webull ledger row, so their record's own size is used.`);
      return envelope(ctx, {
        tool: "get_book_exposure",
        source: { files: ["picks-accuracy.json", "engines.json", "market-days.json", "heatmap.json", "rfr-history.json"], sizes: "Webull paper account (held quantity only)", page: "/?tab=open-picks" },
        payload: record?.builtAtIso ? { builtAtIso: record.builtAtIso } : null,
        owner: true,
        warnings,
        limitations: [
          "Prices are each trade's last saved mark from the latest build (else its entry price), not live quotes; options are priced with Black-Scholes at each trade's implied volatility at entry.",
          "size_from: held = filled at Webull, pending = order still working (size asked for), not-sent / record = the record's own size (no ledger row, or the ledger could not be read).",
          "Delta $ is the stock-equivalent position: if every stock rose 1%, the book would gain about 1% of it. Decay is per calendar day at today's prices.",
        ],
        results,
      });
    },
  }];
}
