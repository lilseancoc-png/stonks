// One overnight risk-on / risk-off scorer (overnight review, 2026-10-26).
//
// The Overnight tab's headline, the Top Picks market-tape "global tape" axis
// and the live browser recompute all read this module, so one session gets one
// answer. Before 2026-10-26 there were three separate rule sets (a 7-vote tab
// tone, a 4-leg regime axis and a browser port of each) that could disagree.
//
// How it works:
//   * Inputs are moves measured from the PRIOR US CASH CLOSE (16:00 ET) to the
//     read time (the pre-open call is frozen at about 09:25 ET). A market that
//     did not move in that window (a cash index still showing yesterday, an
//     Asian market on holiday, cash VIX before it reopens) is "stale" and is
//     left out with a reason instead of voting with yesterday's move.
//   * Every move is turned into a z-score with that market's own recent daily
//     volatility (sigma), so 0.4% on ES means more at VIX 12 than at VIX 30.
//   * Overlapping inputs are grouped into five buckets, each with ONE vote:
//     equities, volatility, rates, FX/carry and growth/credit. A ±3 label now
//     takes three different kinds of evidence, not one shock counted three times.
//   * Asia's move is taken net of the prior US day it mostly echoes (the
//     "residual"), using a beta fitted on recent sessions.
//   * Two separate calls: a GAP call (direction of the open versus the prior
//     close, what an overnight tape can actually predict) and a SESSION call
//     (open to close) that stays "no edge" until the saved log proves one.
//
// Thresholds are starting values. scripts/overnight-fit.mjs reads the saved log
// and reports per-bucket hit rates so they can be re-fit on real calls.
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function overnightToneFactory() {
  var VERSION = '2026-10-overnight-v2';
  // A bucket votes ±1 once its weighted z passes VOTE_Z. STRONG_Z marks a
  // strong vote (shown, and lets a 2-bucket agreement reach ±2 on the axis).
  var VOTE_Z = 0.5, STRONG_Z = 1.5;
  // Rates only vote on a shock: a yield spike is risk-off, and falling yields
  // count as risk-on only when equities are not falling (otherwise it is a
  // flight to safety, which is not a risk-on signal).
  var RATES_SHOCK_Z = 1.0;
  // Label cut-offs on the summed bucket votes (-5..+5).
  var RISK_CUT = 3, LEAN_CUT = 1;
  var MIN_BUCKETS = 3;
  // Gap call: futures average move since the prior close below this is "flat".
  var GAP_FLAT_PCT = 0.15;
  // The session call stays "no edge" until the graded log reaches this size
  // and hit rate.
  var SESSION_MIN_N = 60, SESSION_MIN_HIT = 0.55, SESSION_BASE_MARGIN = 0.03;
  // VIX / VIX3M above this is an inverted (stressed) volatility curve.
  var VIX_TERM_INVERTED = 1.0;

  var ASIA_BROAD = ['^N225', '^KS11', '^TWII', '^HSI', '^AXJO', '000300.SS'];
  var CHIP_TAPE = ['000660.KS', '005930.KS', '2330.TW', '8035.T', '6857.T', '9984.T'];
  var EUROPE = ['^STOXX50E', '^GDAXI'];
  var FUTURES = ['ES=F', 'NQ=F', 'RTY=F'];

  // Bucket specs. sign -1 means "this market up = risk-off". weight is the
  // part's share of the bucket when every part is present (renormalized over
  // the parts that are present and fresh).
  var BUCKETS = [
    { key: 'equities', label: 'Equities', parts: [
      { key: 'futures', label: 'US futures', syms: FUTURES, sign: 1, weight: 0.5 },
      { key: 'asia', label: 'Asia (net of prior US day)', syms: ASIA_BROAD, sign: 1, weight: 0.3, residual: true },
      { key: 'europe', label: 'Europe so far', syms: EUROPE, sign: 1, weight: 0.2 }
    ] },
    { key: 'volatility', label: 'Volatility', parts: [
      { key: 'vix', label: 'VIX', syms: ['^VIX'], sign: -1, weight: 1 }
    ] },
    { key: 'rates', label: 'Rates', parts: [
      { key: 'tnote', label: '10Y T-note futures', syms: ['ZN=F'], sign: 1, weight: 1 }
    ] },
    { key: 'fx', label: 'FX / carry', parts: [
      { key: 'audjpy', label: 'AUD/JPY', syms: ['AUDJPY=X'], sign: 1, weight: 0.5 },
      { key: 'cnh', label: 'USD/CNH', syms: ['CNH=X'], sign: -1, weight: 0.2 },
      { key: 'krw', label: 'USD/KRW', syms: ['KRW=X'], sign: -1, weight: 0.15 },
      { key: 'dxy', label: 'Dollar index', syms: ['DX-Y.NYB'], sign: -1, weight: 0.15 }
    ] },
    { key: 'growth', label: 'Growth / credit', parts: [
      { key: 'copper', label: 'Copper', syms: ['HG=F'], sign: 1, weight: 0.4 },
      { key: 'credit', label: 'High-yield credit (HYG pre-market)', syms: ['HYG'], sign: 1, weight: 0.2 },
      { key: 'crypto', label: 'Bitcoin + Ether', syms: ['BTC-USD', 'ETH-USD'], sign: 1, weight: 0.4 }
    ] }
  ];
  // Every overnight market and how its move is read (see lib/overnight-inputs.mjs):
  // 24h = futures/FX/commodities/crypto, asia = Asian cash sessions, europe =
  // European cash (pre-open only), usx = US cash series that print outside the
  // bell only sometimes, level = context levels that never vote.
  var SYMBOLS = {
    'ES=F': { kind: '24h', name: 'S&P 500 futures' },
    'NQ=F': { kind: '24h', name: 'Nasdaq 100 futures' },
    'RTY=F': { kind: '24h', name: 'Russell 2000 futures' },
    'ZN=F': { kind: '24h', name: '10Y T-note futures' },
    'AUDJPY=X': { kind: '24h', name: 'AUD/JPY' },
    'JPY=X': { kind: '24h', name: 'USD/JPY' },
    'CNH=X': { kind: '24h', name: 'USD/CNH' },
    'KRW=X': { kind: '24h', name: 'USD/KRW' },
    'DX-Y.NYB': { kind: '24h', name: 'Dollar index' },
    'HG=F': { kind: '24h', name: 'Copper' },
    'CL=F': { kind: '24h', name: 'WTI crude' },
    'GC=F': { kind: '24h', name: 'Gold' },
    'BTC-USD': { kind: '24h', name: 'Bitcoin' },
    'ETH-USD': { kind: '24h', name: 'Ether' },
    '^N225': { kind: 'asia', name: 'Nikkei 225' },
    '^KS11': { kind: 'asia', name: 'KOSPI' },
    '^TWII': { kind: 'asia', name: 'TAIEX' },
    '^HSI': { kind: 'asia', name: 'Hang Seng' },
    '^AXJO': { kind: 'asia', name: 'ASX 200' },
    '000300.SS': { kind: 'asia', name: 'CSI 300' },
    '000660.KS': { kind: 'asia', name: 'SK Hynix' },
    '005930.KS': { kind: 'asia', name: 'Samsung Electronics' },
    '2330.TW': { kind: 'asia', name: 'TSMC' },
    '8035.T': { kind: 'asia', name: 'Tokyo Electron' },
    '6857.T': { kind: 'asia', name: 'Advantest' },
    '9984.T': { kind: 'asia', name: 'SoftBank Group' },
    '^STOXX50E': { kind: 'europe', name: 'Euro Stoxx 50' },
    '^GDAXI': { kind: 'europe', name: 'DAX' },
    '^VIX': { kind: 'usx', name: 'VIX' },
    'HYG': { kind: 'usx', name: 'High-yield bonds (HYG)' },
    'SPY': { kind: 'usx', name: 'SPY' },
    'QQQ': { kind: 'usx', name: 'QQQ' },
    'IWM': { kind: 'usx', name: 'IWM' },
    'SMH': { kind: 'usx', name: 'SMH' },
    '^TNX': { kind: 'usx', name: 'US 10Y yield (cash)' },
    '^VIX3M': { kind: 'level', name: 'VIX 3-month' },
    '^VVIX': { kind: 'level', name: 'VVIX' },
    '^SKEW': { kind: 'level', name: 'SKEW' },
    '^MOVE': { kind: 'level', name: 'MOVE (bond vol)' }
  };
  // Shown as context only; never vote.
  var CONTEXT = ['JPY=X', '^VIX3M', '^VVIX', '^SKEW', '^MOVE', 'CL=F', 'GC=F', '^TNX'];

  function num(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function round(v, d) {
    if (v == null) return null;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  }
  function signed(v, d, unit) {
    if (v == null) return 'n/a';
    return (v > 0 ? '+' : '') + v.toFixed(d) + (unit || '');
  }
  function zOf(input) {
    if (!input) return null;
    var move = num(input.movePct), sigma = num(input.sigmaPct);
    if (move == null || sigma == null || !(sigma > 0)) return null;
    return move / sigma;
  }

  // One part's z: the average z of its fresh markets (residual for Asia).
  function partZ(part, inputs, ctx, excluded) {
    var zs = [], moves = [], used = [];
    for (var i = 0; i < part.syms.length; i++) {
      var sym = part.syms[i];
      var inp = inputs[sym];
      if (!inp) continue;
      if (inp.fresh === false) {
        excluded.push({ sym: sym, name: inp.name || sym, why: inp.staleWhy || 'no move since the prior US close' });
        continue;
      }
      var move = num(inp.movePct);
      if (move == null) continue;
      if (part.residual && ctx && ctx.asiaEcho && num(ctx.asiaEcho.beta) != null && num(ctx.priorUsPct) != null) {
        move = move - Number(ctx.asiaEcho.beta) * Number(ctx.priorUsPct);
        var rs = num(ctx.asiaEcho.residSigmaPct);
        var z = rs != null && rs > 0 ? move / rs : zOf({ movePct: move, sigmaPct: inp.sigmaPct });
        if (z == null) continue;
        zs.push(z);
      } else {
        var z2 = zOf(inp);
        if (z2 == null) continue;
        zs.push(z2);
      }
      moves.push(move);
      used.push(sym);
    }
    if (!zs.length) return null;
    var zAvg = 0, mAvg = 0;
    for (var j = 0; j < zs.length; j++) { zAvg += zs[j]; mAvg += moves[j]; }
    zAvg = zAvg / zs.length; mAvg = mAvg / moves.length;
    return { z: zAvg * part.sign, movePct: mAvg, used: used };
  }

  function bucketVote(z) {
    if (z == null) return 0;
    if (z >= VOTE_Z) return 1;
    if (z <= -VOTE_Z) return -1;
    return 0;
  }

  // inputs: { [sym]: { movePct, sigmaPct, fresh, staleWhy, name, level } }
  // ctx: { asiaEcho: { beta, residSigmaPct }, priorUsPct, events: [] }
  function scoreTone(inputs, ctx) {
    inputs = inputs || {};
    ctx = ctx || {};
    var excluded = [];
    var buckets = [];
    var equitiesZ = null;
    for (var b = 0; b < BUCKETS.length; b++) {
      var spec = BUCKETS[b];
      var parts = [], wSum = 0, zSum = 0;
      for (var p = 0; p < spec.parts.length; p++) {
        var part = spec.parts[p];
        var r = partZ(part, inputs, ctx, excluded);
        if (!r) continue;
        parts.push({ key: part.key, label: part.label, z: round(r.z, 2), movePct: round(r.movePct, 2), used: r.used });
        wSum += part.weight;
        zSum += part.weight * r.z;
      }
      var z = wSum > 0 ? zSum / wSum : null;
      // Volatility curve: an inverted VIX / VIX3M adds stress even when the
      // overnight VIX change is small (or stale).
      if (spec.key === 'volatility') {
        var vix = inputs['^VIX'], vix3m = inputs['^VIX3M'];
        var ratio = vix && vix3m && num(vix.level) != null && num(vix3m.level) > 0 ? Number(vix.level) / Number(vix3m.level) : null;
        if (ratio != null) {
          parts.push({ key: 'term', label: 'VIX / VIX3M ' + ratio.toFixed(2), z: ratio >= VIX_TERM_INVERTED ? -1 : 0, ratio: round(ratio, 3) });
          // A calm curve with no fresh VIX print is not evidence either way,
          // so the group stays absent rather than counting toward MIN_BUCKETS.
          if (ratio >= VIX_TERM_INVERTED) z = (z == null ? 0 : Math.min(z, 0)) - 1;
        }
      }
      var vote = bucketVote(z);
      if (spec.key === 'equities') equitiesZ = z;
      if (spec.key === 'rates' && z != null) {
        // Shock-only rule (see RATES_SHOCK_Z).
        if (Math.abs(z) < RATES_SHOCK_Z) vote = 0;
        else if (z > 0 && equitiesZ != null && equitiesZ < 0) vote = 0;
      }
      buckets.push({
        key: spec.key,
        label: spec.label,
        present: z != null,
        z: round(z, 2),
        vote: z == null ? 0 : vote,
        strong: z != null && Math.abs(z) >= STRONG_Z && vote !== 0,
        parts: parts
      });
    }
    var present = 0, score = 0;
    for (var k = 0; k < buckets.length; k++) {
      if (!buckets[k].present) continue;
      present++;
      score += buckets[k].vote;
    }
    var label;
    if (present < MIN_BUCKETS) label = 'insufficient';
    else if (score >= RISK_CUT) label = 'risk-on';
    else if (score <= -RISK_CUT) label = 'risk-off';
    else if (score >= LEAN_CUT) label = 'leaning risk-on';
    else if (score <= -LEAN_CUT) label = 'leaning risk-off';
    else label = 'mixed';
    var reasons = [];
    for (var m = 0; m < buckets.length; m++) {
      var bk = buckets[m];
      if (!bk.present || bk.vote === 0) continue;
      var lead = bk.parts.length ? bk.parts.slice().sort(function(a, c){ return Math.abs(c.z) - Math.abs(a.z); })[0] : null;
      reasons.push(bk.label + ' ' + (bk.vote > 0 ? 'risk-on' : 'risk-off') + (lead ? ' (' + lead.label + (lead.movePct != null ? ' ' + signed(lead.movePct, 2, '%') : '') + ', z ' + signed(lead.z, 1) + ')' : ''));
    }
    // Chip tape is context (6 of the old 10 "Asia" names were chip stocks).
    var chip = [];
    for (var c = 0; c < CHIP_TAPE.length; c++) {
      var ci = inputs[CHIP_TAPE[c]];
      if (ci && ci.fresh !== false && num(ci.movePct) != null) chip.push(Number(ci.movePct));
    }
    var chipAvg = chip.length ? chip.reduce(function(s, v){ return s + v; }, 0) / chip.length : null;
    return {
      version: VERSION,
      label: label,
      score: score,
      present: present,
      buckets: buckets,
      reasons: reasons,
      excluded: dedupeExcluded(excluded),
      chipTape: chipAvg == null ? null : { movePct: round(chipAvg, 2), n: chip.length },
      gap: gapCall(inputs)
    };
  }

  function dedupeExcluded(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i].sym]) continue;
      seen[list[i].sym] = true;
      out.push(list[i]);
    }
    return out;
  }

  // Direction of the open versus the prior close, from the futures move since
  // that close. This is what an overnight tape can predict.
  function gapCall(inputs) {
    var vals = [];
    for (var i = 0; i < FUTURES.length; i++) {
      var inp = inputs[FUTURES[i]];
      if (inp && inp.fresh !== false && num(inp.movePct) != null) vals.push(Number(inp.movePct));
    }
    if (!vals.length) return { call: 'none', movePct: null };
    var avg = vals.reduce(function(s, v){ return s + v; }, 0) / vals.length;
    var call = avg >= GAP_FLAT_PCT ? 'up' : avg <= -GAP_FLAT_PCT ? 'down' : 'flat';
    return { call: call, movePct: round(avg, 2) };
  }

  function toneDirection(label) {
    if (label === 'risk-on' || label === 'leaning risk-on') return 1;
    if (label === 'risk-off' || label === 'leaning risk-off') return -1;
    return 0;
  }

  // Session (open-to-close) call: "no edge" until the saved log shows one.
  function sessionCall(tone, stats) {
    var dir = tone ? toneDirection(tone.label) : 0;
    var s = stats && stats.toneSession ? stats.toneSession : null;
    // Proven means enough graded days, a hit rate of at least SESSION_MIN_HIT,
    // and a clear margin (SESSION_BASE_MARGIN) over simply guessing the more
    // common session direction on those days.
    var base = stats && stats.base && stats.base.sessionUp != null ? Math.max(stats.base.sessionUp, 1 - stats.base.sessionUp) : 0.5;
    var proven = !!(s && s.n >= SESSION_MIN_N && s.hitRate != null && s.hitRate >= SESSION_MIN_HIT && s.hitRate >= base + SESSION_BASE_MARGIN);
    if (!proven || dir === 0) {
      return {
        call: 'no-edge',
        proven: proven,
        note: proven
          ? 'The tape is mixed, so there is no session lean today.'
          : 'No proven edge for the open-to-close session yet (' + (s ? s.n : 0) + ' graded days, ' + SESSION_MIN_N + ' needed; hit rate ' + (s && s.hitRate != null ? Math.round(s.hitRate * 100) + '%' : 'n/a') + ' vs ' + Math.round(Math.max(SESSION_MIN_HIT, base + SESSION_BASE_MARGIN) * 100) + '% needed).'
      };
    }
    return { call: dir > 0 ? 'up' : 'down', proven: true, note: 'Session lean from ' + s.n + ' graded days at a ' + Math.round(s.hitRate * 100) + '% hit rate.' };
  }

  // Top Picks market-tape axis (-2..+2) from a tone.
  function tapeAxis(tone, opts) {
    opts = opts || {};
    if (!tone || tone.label === 'insufficient') {
      return { score: 0, label: (opts.prefix || 'Global tape') + ' — not enough fresh overnight inputs', driver: null, components: tone ? tapeComponents(tone) : [] };
    }
    var s = tone.score, strong = false;
    for (var i = 0; i < tone.buckets.length; i++) if (tone.buckets[i].strong) strong = true;
    var score = 0;
    if (s >= RISK_CUT || (strong && s >= 2)) score = 2;
    else if (s >= LEAN_CUT) score = 1;
    else if (s <= -RISK_CUT || (strong && s <= -2)) score = -2;
    else if (s <= -LEAN_CUT) score = -1;
    var word = score > 0 ? 'risk-on' : score < 0 ? 'risk-off' : 'mixed';
    var lit = [];
    for (var j = 0; j < tone.buckets.length; j++) {
      var b = tone.buckets[j];
      if (b.present && b.vote !== 0 && (score === 0 || (b.vote > 0) === (score > 0))) lit.push(b.label);
    }
    var label = (opts.prefix || 'Global tape') + ' ' + word + (score !== 0 && lit.length ? ' — ' + lit.slice(0, 3).join(', ') : ' (' + tone.present + ' of 5 groups)');
    return { score: score, label: label, driver: score <= -1 ? 'global tape ' + word : null, components: tapeComponents(tone) };
  }
  function tapeComponents(tone) {
    var out = [];
    for (var i = 0; i < tone.buckets.length; i++) {
      var b = tone.buckets[i];
      if (!b.present) continue;
      out.push({ key: b.key, label: b.label + ' z ' + signed(b.z, 1), vote: b.vote });
    }
    return out;
  }

  // ---- Grading --------------------------------------------------------------
  // bars: [{ t:'YYYY-MM-DD', o, c }] daily for SPY (or QQQ). The entry's date is
  // the US session it called.
  function outcomeFor(date, bars) {
    if (!date || !bars || !bars.length) return null;
    var idx = -1;
    for (var i = 0; i < bars.length; i++) if (bars[i] && bars[i].t === date) { idx = i; break; }
    if (idx < 1) return null;
    var prev = bars[idx - 1], cur = bars[idx];
    var pc = num(prev.c), o = num(cur.o), c = num(cur.c);
    if (!(pc > 0) || !(o > 0) || !(c > 0)) return null;
    return {
      gapPct: round((o / pc - 1) * 100, 3),
      sessionPct: round((c / o - 1) * 100, 3),
      ccPct: round((c / pc - 1) * 100, 3)
    };
  }
  function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function gradeEntry(entry, spyBars, qqqBars) {
    if (!entry || !entry.tone) return entry;
    var spy = outcomeFor(entry.date, spyBars);
    if (!spy) return entry;
    var qqq = outcomeFor(entry.date, qqqBars);
    var dir = toneDirection(entry.tone.label);
    var gap = entry.tone.gap && entry.tone.gap.call;
    var gapDir = gap === 'up' ? 1 : gap === 'down' ? -1 : 0;
    var graded = {
      spy: spy,
      qqq: qqq,
      gapCallHit: gapDir === 0 ? null : sgn(spy.gapPct) === gapDir,
      toneGapHit: dir === 0 ? null : sgn(spy.gapPct) === dir,
      toneSessionHit: dir === 0 ? null : sgn(spy.sessionPct) === dir,
      toneCcHit: dir === 0 ? null : sgn(spy.ccPct) === dir
    };
    var out = {};
    for (var k in entry) if (Object.prototype.hasOwnProperty.call(entry, k)) out[k] = entry[k];
    out.outcome = graded;
    return out;
  }
  function rate(entries, field, filter) {
    var n = 0, hit = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.outcome || (filter && !filter(e))) continue;
      var v = e.outcome[field];
      if (v == null) continue;
      n++;
      if (v) hit++;
    }
    return { n: n, hits: hit, hitRate: n ? round(hit / n, 3) : null };
  }
  function baseRates(entries) {
    var n = 0, gapUp = 0, sessUp = 0;
    for (var i = 0; i < entries.length; i++) {
      var o = entries[i] && entries[i].outcome && entries[i].outcome.spy;
      if (!o) continue;
      n++;
      if (o.gapPct > 0) gapUp++;
      if (o.sessionPct > 0) sessUp++;
    }
    return { n: n, gapUp: n ? round(gapUp / n, 3) : null, sessionUp: n ? round(sessUp / n, 3) : null };
  }
  function summarize(entries, opts) {
    entries = entries || [];
    opts = opts || {};
    var live = function(e){ return !e.reconstructed; };
    var strong = function(e){ return e.tone && (e.tone.label === 'risk-on' || e.tone.label === 'risk-off'); };
    var out = {
      gapCall: rate(entries, 'gapCallHit'),
      toneGap: rate(entries, 'toneGapHit'),
      toneSession: rate(entries, 'toneSessionHit'),
      toneCc: rate(entries, 'toneCcHit'),
      strongToneSession: rate(entries, 'toneSessionHit', strong),
      liveOnly: {
        gapCall: rate(entries, 'gapCallHit', live),
        toneSession: rate(entries, 'toneSessionHit', live)
      },
      buckets: {},
      // Base rates: a hit rate means little next to how often SPY simply
      // opened up / closed above its open over the same graded days.
      base: baseRates(entries)
    };
    // Per-bucket session and gap hit rates (for re-fitting thresholds).
    for (var b = 0; b < BUCKETS.length; b++) {
      var key = BUCKETS[b].key;
      var g = { n: 0, hits: 0 }, s = { n: 0, hits: 0 };
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.outcome || !e.outcome.spy || !e.tone || !e.tone.buckets) continue;
        var bk = null;
        for (var j = 0; j < e.tone.buckets.length; j++) if (e.tone.buckets[j].key === key) bk = e.tone.buckets[j];
        if (!bk || !bk.present || !bk.vote) continue;
        g.n++; if (sgn(e.outcome.spy.gapPct) === bk.vote) g.hits++;
        s.n++; if (sgn(e.outcome.spy.sessionPct) === bk.vote) s.hits++;
      }
      out.buckets[key] = {
        gap: { n: g.n, hitRate: g.n ? round(g.hits / g.n, 3) : null },
        session: { n: s.n, hitRate: s.n ? round(s.hits / s.n, 3) : null }
      };
    }
    return out;
  }

  // Scorer inputs from a market snapshot (correlations.json markets, optionally
  // overlaid with live quotes). Each market's move is its own last change, so
  // this is the in-between read used only BEFORE the open, when no saved
  // pre-open call exists yet. Freshness rules match the saved call:
  //   asia   counts only a session dated after the prior US session
  //   usx    counts only a quote stamped after the prior US close
  //   europe counts only before the US open
  // markets[sym]: { chPct, sigma1d, asOf, quoteTimeIso, last }
  // opts: { priorUsDate, priorUsCloseMs, preOpen }
  function inputsFromSnapshot(markets, opts) {
    markets = markets || {};
    opts = opts || {};
    var out = {};
    for (var sym in SYMBOLS) {
      if (!Object.prototype.hasOwnProperty.call(SYMBOLS, sym)) continue;
      var m = markets[sym];
      if (!m) continue;
      var meta = SYMBOLS[sym];
      var move = num(m.chPct);
      var row = { name: meta.name, kind: meta.kind, movePct: move, sigmaPct: num(m.sigma1d), level: num(m.last), fresh: move != null };
      if (meta.kind === 'asia') {
        if (opts.priorUsDate && m.asOf && String(m.asOf) <= String(opts.priorUsDate)) { row.fresh = false; row.staleWhy = 'closed since ' + m.asOf + ' (holiday or no session yet)'; }
      } else if (meta.kind === 'usx') {
        var qt = Date.parse(m.quoteTimeIso || '');
        if (!(opts.priorUsCloseMs && isFinite(qt) && qt > opts.priorUsCloseMs)) { row.fresh = false; row.staleWhy = 'no print since the prior US close'; }
      } else if (meta.kind === 'europe') {
        if (!opts.preOpen) { row.fresh = false; row.staleWhy = 'Europe trades with the US morning; counted only before the open'; }
      } else if (meta.kind === 'level') {
        row.fresh = false; row.staleWhy = 'context level';
      }
      out[sym] = row;
    }
    return out;
  }

  return {
    VERSION: VERSION,
    VOTE_Z: VOTE_Z, STRONG_Z: STRONG_Z, RATES_SHOCK_Z: RATES_SHOCK_Z,
    RISK_CUT: RISK_CUT, LEAN_CUT: LEAN_CUT, MIN_BUCKETS: MIN_BUCKETS,
    GAP_FLAT_PCT: GAP_FLAT_PCT, SESSION_MIN_N: SESSION_MIN_N, SESSION_MIN_HIT: SESSION_MIN_HIT, SESSION_BASE_MARGIN: SESSION_BASE_MARGIN,
    VIX_TERM_INVERTED: VIX_TERM_INVERTED,
    SYMBOLS: SYMBOLS, BUCKETS: BUCKETS, ASIA_BROAD: ASIA_BROAD, CHIP_TAPE: CHIP_TAPE, EUROPE: EUROPE, FUTURES: FUTURES, CONTEXT: CONTEXT,
    scoreTone: scoreTone,
    inputsFromSnapshot: inputsFromSnapshot,
    gapCall: gapCall,
    sessionCall: sessionCall,
    tapeAxis: tapeAxis,
    toneDirection: toneDirection,
    outcomeFor: outcomeFor,
    gradeEntry: gradeEntry,
    summarize: summarize
  };
}

export const OVERNIGHT_TONE = overnightToneFactory();
export const OVERNIGHT_TONE_VERSION = OVERNIGHT_TONE.VERSION;
