// Closed-trade post-mortem (2026-11-08).
//
// One deterministic read of WHY a resolved Top Picks trade won or lost, from
// the fields the record already stores: the stock's move over the hold, the
// contract's modeled result, its peak and trough, the exit rule, the frozen
// stop and target, the thesis re-score at exit and the entry context. No AI,
// no fetch. Also the Scorecard tally ("why the losses lost") and the rolling
// win-rate series the Equity sub-tab draws.
//
// ES5 factory: `app-js.mjs` pastes `tradePostMortemFactory.toString()` into
// the browser IIFE (as POST_MORTEM), and Node tests call it directly, so the
// body uses no arrow functions, template literals, let/const or spread.

export function tradePostMortemFactory() {
  // Loss causes, in display order. `flat` = the stock went nowhere and the
  // premium bled; `vehicle` = the stock moved our way but the contract lost.
  var LOSS_CAUSES = ['direction', 'flat', 'vehicle', 'unknown'];
  var WIN_CAUSES = ['direction', 'vehicle', 'premium'];
  var CAUSE_LABEL = {
    'loss:direction': 'Wrong direction',
    'loss:flat': 'Flat stock, premium bled',
    'loss:vehicle': 'Right direction, wrong vehicle',
    'loss:unknown': 'No price data',
    'win:direction': 'Direction call paid',
    'win:vehicle': 'Won without a stock move',
    'win:premium': 'Premium collected',
    'flat:any': 'Flat result',
    'none:any': 'Not counted'
  };
  var STATUS_LABEL = {
    'hit-tp-prem': 'take-profit', 'trail-stop': 'trail stop (half banked)', 'hit-stop-prem': 'premium stop',
    'hit-stop-under': 'stock stop', 'thesis-broken': 'thesis broken', 'event-review': 'event review',
    'shock-time': 'post-shock time limit', 'theta-stop': 'theta stop', 'timed-out': '14-day time stop (retired)',
    'expired': 'expired', 'pre-earnings': 'pre-earnings exit (retired)', 'dropped': 'left universe',
    'left-coverage': 'name left coverage (not counted)', 'reset': 'weekly reset close (retired)'
  };
  // The stock has to move at least this much (direction-adjusted, %) before the
  // read calls it a direction result rather than a flat one.
  var FLAT_BAND_PCT = 1;

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pct(v, signed) {
    if (v == null) return '—';
    var s = (signed !== false && v > 0 ? '+' : '') + r1(v).toFixed(1) + '%';
    return s;
  }
  function money(v) {
    if (v == null) return '—';
    return '$' + Number(v).toFixed(2);
  }
  function daysBetween(aIso, bIso) {
    var a = Date.parse(aIso), b = Date.parse(bIso);
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  // Stop distance as a fraction of the premium (records before 2026-10-22
  // stored it as a fraction, later ones as a percent).
  function stopFrac(sizing, exitPolicy) {
    var sp = num(exitPolicy && exitPolicy.stopPct);
    if (sp != null) return sp > 1 ? sp / 100 : sp;
    var r = num(sizing && sizing.riskToStopPct);
    if (r == null) return null;
    return r > 1 ? r / 100 : r;
  }

  // The read for one resolved trade. Returns null for a record without an
  // outcome; otherwise { cause, label, headline, facts[], lesson, tags[] }.
  function build(e) {
    if (!e || !e.symbol) return null;
    var outcome = e.outcome === 'win' ? 'win' : e.outcome === 'loss' ? 'loss' : e.outcome === 'left-coverage' ? 'none' : 'flat';
    var side = e.side === 'put' ? 'put' : 'call';
    var c = e.contract || {};
    var isCredit = c.structure === 'credit_vertical';
    var opt = num(e.optionPnlPct);
    var entry = num(e.entrySpot), exit = num(e.exitSpot);
    var rawMove = entry != null && entry > 0 && exit != null ? (exit / entry - 1) * 100 : null;
    var dirMove = rawMove == null ? null : (side === 'call' ? rawMove : -rawMove);
    var held = daysBetween(e.entryDate, e.exitDate);
    var iv = num(c.iv);
    // One-sigma stock move the options priced for the hold (daily IV scaled
    // by the calendar days held).
    var expMove = iv != null && iv > 0 && held != null && held > 0 ? iv * Math.sqrt(held / 365) * 100 : null;
    var moveRatio = expMove != null && expMove > 0 && rawMove != null ? Math.abs(rawMove) / expMove : null;
    var hi = num(e.optHiPct), lo = num(e.optLoPct);
    var tp = num(e.exitPolicy && e.exitPolicy.takeProfitPct);
    var sf = stopFrac(e.sizing, e.exitPolicy);
    var stopPct = sf != null ? sf * 100 : null;
    var tags = [];
    var cause;
    if (outcome === 'loss') {
      if (dirMove == null) cause = 'unknown';
      else if (dirMove <= -FLAT_BAND_PCT) cause = 'direction';
      else if (dirMove < FLAT_BAND_PCT) cause = 'flat';
      else cause = 'vehicle';
    } else if (outcome === 'win') {
      if (isCredit) cause = dirMove != null && dirMove > FLAT_BAND_PCT ? 'direction' : 'premium';
      else cause = dirMove != null && dirMove > FLAT_BAND_PCT ? 'direction' : 'vehicle';
    } else cause = 'any';
    var label = CAUSE_LABEL[outcome + ':' + cause] || CAUSE_LABEL[outcome === 'none' ? 'none:any' : 'flat:any'];

    var facts = [];
    // What the stock did, against what the options priced.
    if (rawMove != null) {
      var s = 'Stock ' + money(entry) + ' → ' + money(exit) + ' (' + pct(rawMove) + (side === 'put' ? ', a put wants down' : '') + ')';
      if (held != null) s += ' over ' + held + ' day' + (held === 1 ? '' : 's');
      if (expMove != null) s += '; the options priced about ±' + r1(expMove).toFixed(1) + '% for that span' + (moveRatio != null ? ' (' + (Math.round(moveRatio * 10) / 10).toFixed(1) + '× that)' : '');
      facts.push(s + '.');
    } else if (held != null) {
      facts.push('Held ' + held + ' day' + (held === 1 ? '' : 's') + '; no exit price was stored.');
    }
    // What the contract did.
    if (opt != null) {
      var cs = 'Contract ' + pct(opt) + ' modeled';
      if (hi != null && lo != null) cs += ' (peak ' + pct(hi) + ', trough ' + pct(lo) + ')';
      var rf = num(e.realFillPnlPct);
      if (rf != null) cs += '; ' + pct(rf) + ' at the bid/ask (spread cost ≈ ' + r1(opt - rf).toFixed(1) + ' points)';
      facts.push(cs + '.');
    }
    // Gave it back / needed room.
    if (outcome === 'loss' && hi != null && tp != null && tp > 0 && hi >= tp * 0.5) {
      tags.push('gave-back');
      facts.push('It was up ' + pct(hi) + ' at best, ' + Math.round(hi / tp * 100) + '% of the way to the +' + r1(tp).toFixed(0) + '% target, before the exit.');
    }
    if (outcome === 'win' && lo != null && stopPct != null && stopPct > 0 && lo <= -stopPct * 0.5) {
      tags.push('needed-room');
      facts.push('It first dipped to ' + pct(lo) + ', ' + Math.round(-lo / stopPct * 100) + '% of the way to the −' + r1(stopPct).toFixed(0) + '% stop.');
    }
    // Premium stop fired while the stock never reached its own stop.
    var cut = num(e.cut);
    var mae = num(e.maePct);
    if (e.status === 'hit-stop-prem' && cut != null && entry != null && entry > 0 && mae != null) {
      var stopDist = Math.abs(cut / entry - 1) * 100;
      if (Math.abs(mae) < stopDist) {
        tags.push('premium-stop-first');
        facts.push('The premium stop fired while the stock stayed inside its ' + money(cut) + ' stop (worst ' + pct(-Math.abs(mae), false) + ' against, ' + r1(stopDist).toFixed(1) + '% allowed).');
      }
    }
    // Exit rule.
    var statusLabel = STATUS_LABEL[e.status] || e.status || null;
    if (statusLabel) facts.push('Exit: ' + statusLabel + '.');
    // Thesis at exit.
    var ts = e.thesisStatus;
    if (ts && ts.verdict) {
      var t = 'Thesis at exit: ' + ts.verdict;
      if (ts.driversTotal != null && ts.driversTotal > 0) t += ', ' + (ts.driversActive == null ? '?' : ts.driversActive) + ' of ' + ts.driversTotal + ' supporting drivers still firing';
      if (ts.gradeFlip) t += ', the grade flipped sides';
      if (ts.stopBreached) t += ', the stock stop was breached';
      facts.push(t + '.');
    }
    // Entry context.
    var score = num(e.score);
    var ctx = [];
    if (score != null) ctx.push('grade ' + (score > 0 ? '+' : '') + r1(score).toFixed(1));
    if (e.entryRegime) ctx.push(e.entryRegime + ' tape');
    if (e.entrySignal) ctx.push(String(e.entrySignal).replace(/-/g, ' ') + ' entry');
    if (e.thesis && e.thesis.aiGrade) ctx.push('AI grade ' + e.thesis.aiGrade + (e.thesis.aiConfidence ? ' (' + e.thesis.aiConfidence + ')' : ''));
    if (e.eventPlay && e.eventPlay.kind) ctx.push('event play: ' + e.eventPlay.kind);
    if (ctx.length) facts.push('Entered on ' + ctx.join(', ') + '.');

    var lesson;
    if (outcome === 'loss') {
      if (cause === 'direction') lesson = 'The direction call was wrong; count it against the grade, not the exits.';
      else if (cause === 'flat') lesson = 'Time, not direction, took this one: a longer-dated or cheaper structure bleeds less while a stock waits.';
      else if (cause === 'vehicle') lesson = 'The stock did what the grade said and the contract still lost: check the IV paid at entry and the strike.';
      else lesson = 'No exit price was stored, so the cause cannot be read.';
      if (tags.indexOf('gave-back') >= 0) lesson += ' A partial profit near the peak would have kept part of it.';
      if (tags.indexOf('premium-stop-first') >= 0) lesson += ' The premium stop is tighter than the stock stop on this name.';
    } else if (outcome === 'win') {
      if (cause === 'direction') lesson = 'Worked as planned.';
      else if (cause === 'premium') lesson = 'The spread collected its premium while the stock stayed put; not a direction result.';
      else lesson = 'The stock barely moved yet the contract gained: volatility or a quick swing paid, not direction; do not count it as direction skill.';
      if (tags.indexOf('needed-room') >= 0) lesson += ' It needed room first; the stop gave it.';
    } else if (outcome === 'none') lesson = 'The name left coverage; the record does not score it.';
    else lesson = 'Closed near flat.';

    var headline = label;
    if (outcome === 'loss' && dirMove != null && cause !== 'unknown') headline += ': stock ' + pct(dirMove) + ' for the trade, contract ' + pct(opt);
    else if (outcome === 'win' && dirMove != null) headline += ': stock ' + pct(dirMove) + ' for the trade, contract ' + pct(opt);

    return {
      outcome: outcome, cause: cause, label: label, headline: headline,
      facts: facts, lesson: lesson, tags: tags,
      dirMovePct: dirMove == null ? null : r1(dirMove),
      expectedMovePct: expMove == null ? null : r1(expMove),
      moveRatio: moveRatio == null ? null : Math.round(moveRatio * 10) / 10,
      heldDays: held
    };
  }

  // Scorecard tally over a closed list: how many losses were a wrong
  // direction, a flat stock or the wrong vehicle; how the wins came; how often
  // a loss had been well on its way to the target first.
  function tally(closed) {
    var out = { n: 0, losses: { n: 0 }, wins: { n: 0 }, gaveBack: 0, premiumStopFirst: 0, neededRoom: 0 };
    var i, k;
    for (i = 0; i < LOSS_CAUSES.length; i++) out.losses[LOSS_CAUSES[i]] = 0;
    for (i = 0; i < WIN_CAUSES.length; i++) out.wins[WIN_CAUSES[i]] = 0;
    var list = Array.isArray(closed) ? closed : [];
    for (i = 0; i < list.length; i++) {
      var r = build(list[i]);
      if (!r || (r.outcome !== 'win' && r.outcome !== 'loss')) continue;
      out.n++;
      var bucket = r.outcome === 'win' ? out.wins : out.losses;
      bucket.n++;
      if (bucket[r.cause] != null) bucket[r.cause]++;
      for (k = 0; k < r.tags.length; k++) {
        if (r.tags[k] === 'gave-back') out.gaveBack++;
        else if (r.tags[k] === 'premium-stop-first') out.premiumStopFirst++;
        else if (r.tags[k] === 'needed-room') out.neededRoom++;
      }
    }
    return out;
  }

  // Rolling win rate by close date, oldest first. Each row is the win rate of
  // the last `window` decided trades (an expanding window until there are that
  // many, flagged partial). Rows start at the fifth decided trade.
  function rollingWinRate(decided, window) {
    var w = window || 20;
    var list = (Array.isArray(decided) ? decided : []).filter(function (e) {
      return e && (e.outcome === 'win' || e.outcome === 'loss') && e.exitDate;
    }).slice().sort(function (a, b) {
      var ta = Date.parse(a.exitDate), tb = Date.parse(b.exitDate);
      return (isFinite(ta) ? ta : 0) - (isFinite(tb) ? tb : 0);
    });
    var out = [];
    var wins = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].outcome === 'win') wins++;
      if (i >= w) { if (list[i - w].outcome === 'win') wins--; }
      var n = Math.min(i + 1, w);
      if (i + 1 < 5) continue;
      out.push({ date: String(list[i].exitDate).slice(0, 10), rate: Math.round(wins / n * 1000) / 10, n: n, partial: n < w, i: i + 1 });
    }
    return out;
  }

  return { build: build, tally: tally, rollingWinRate: rollingWinRate, CAUSE_LABEL: CAUSE_LABEL, LOSS_CAUSES: LOSS_CAUSES, WIN_CAUSES: WIN_CAUSES, FLAT_BAND_PCT: FLAT_BAND_PCT };
}

export const TRADE_POSTMORTEM = tradePostMortemFactory();
