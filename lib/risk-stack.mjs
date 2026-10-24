// Combined market-position read. Each desk keeps its own label. This does not
// average them into a new score and does not change regime position limits.
// Stance scale, used only to find gaps: -2 severe, -1 defensive, 0 neutral,
// +1 constructive, +2 strong. A desk with status other than "ready" does not vote.
export function riskStackFactory() {
  const PAIR = {
    'fear-greed|gamma': 'Fear & Greed is how scared or crowded positioning has been. Gamma is whether SPY’s listed open interest would dampen or amplify the next price move. A fearful mood and a pinning gamma book can sit together: people are hedged, and the options complex would tend to mute the next swing rather than extend it.',
    'fear-greed|heatmap': 'Fear & Greed blends momentum, breadth, options, volatility, havens, and credit into a slow mood score. The heatmap counts whether tracked stocks are up today and whether the largest names agree. Extreme fear with a neutral or green tape means sentiment is ahead of price. The score is not a crash call and not a buy until breadth and volume confirm.',
    'fear-greed|index-cal': 'The index calendar is the month’s path for the risk sleeves. Fear & Greed can sit at an extreme inside a month that is still mixed, or look calm after a month that already bled. The month is the path already traveled. The score is how crowded the mood is now.',
    'fear-greed|market': 'Market analysis re-votes from indexes, volatility, the dollar, yields, the Fed, commodities, geopolitics, and the global tape. Fear & Greed moves slower. It can stay extreme after that vote has stabilized, or lag a regime that just turned. They disagree when the clock or the evidence differs.',
    'fear-greed|overnight': 'Overnight is the last foreign session and futures into the US open. Fear & Greed does not see that session. A defensive lead with a calm composite, or extreme fear with a quiet overseas tape, is a lead-versus-mood split. The cash session decides which one sticks.',
    'fear-greed|volume': 'Volume only speaks for names that already printed unusual volume. Fear & Greed is the broad mood. Heavy fear with a mixed volume book means positioning is scared and the unusual-volume tape has not confirmed a liquidation.',
    'gamma|heatmap': 'Gamma does not contradict the tape’s direction. A weak heatmap with positive SPY gamma means stocks are down, but listed hedging would tend to dampen the next leg. A calm heatmap with negative gamma means price looks orderly and a break has more room to travel.',
    'gamma|index-cal': 'The calendar is the month already traveled. Gamma is how the next move is likely to behave. A defensive month does not say whether the next swing gets pinned or extended.',
    'gamma|market': 'The regime is the directional stress vote. SPY gamma is the mechanical bias under the next move. Severe risk-off with positive gamma means the macro stack is defensive and listed hedging would lean against a crash extension. Severe risk-off with negative gamma means the stress and the options complex agree that a down move can travel.',
    'gamma|overnight': 'Overnight sets the lead into the open. Gamma says whether that lead, if the cash session follows it, gets damped or extended. A weak overseas tape with positive gamma is a lead without much listed fuel behind it.',
    'gamma|volume': 'Volume says whether unusual participation is confirming a direction. Gamma says whether the options complex would dampen or chase that direction. Bearish volume with positive gamma is real selling without mechanical fuel to extend it. Quiet volume with negative gamma is fuel waiting for a break.',
    'heatmap|index-cal': 'The heatmap is the latest session. The calendar compounds the month. A defensive month with a neutral day is a bounce that has not repaired the path. A weak day inside a constructive month is one session, not a new regime.',
    'heatmap|market': 'Market analysis can be severe because volatility, the dollar, yields, the Fed, or commodities are stressed while most tracked stocks are flat. The heatmap does not see those axes. A severe regime with a neutral heatmap means the wind has shifted and the stock tape has not followed. Size for the regime. A flat map is not an all-clear, and the regime label is not proof a broad selloff is already underway.',
    'heatmap|overnight': 'Overnight can be risk-off into the open while the cash heatmap is neutral because the US session reversed the lead, or because cash has not broken. During US hours the heatmap is the position. Overnight is the gap risk into the next open.',
    'heatmap|volume': 'The heatmap is the whole tracked universe. Volume is only the names with unusual volume. Bearish volume inside a neutral heatmap means the names that are trading heavily are offered, while the rest of the universe is not in a broad breakdown.',
    'index-cal|market': 'The calendar is how the risk sleeves have done this month, with VIX as confirmation. The regime can flip inside a mixed month because it re-votes from live cross-asset axes. A defensive month and a neutral regime means the damage is already in the path and today’s stress vote is not coordinated. A severe regime inside a mixed month means the stress is new relative to the month’s scoreboard.',
    'index-cal|overnight': 'Overnight is the latest lead. The calendar is the month. A weak overseas tape does not rewrite a constructive month, and a calm overnight does not repair a defensive month.',
    'index-cal|volume': 'Volume is this session’s unusual participation. The calendar does not see it. A bearish volume day inside a mixed month is one session of heavy trading in the flagged names, not a change in the month’s regime.',
    'market|overnight': 'The regime already includes the global tape as one axis. It can still be severe from volatility, the dollar, yields, or the Fed when the overseas lead was quiet — or the reverse, if futures dumped and the slower axes have not followed. The stack is the position. Overnight is what can gap the next open.',
    'market|volume': 'Volume only covers names that already traded unusually, and a lean is weaker than a broad breakdown. A severe regime can sit next to volume that is quiet, mixed, or only leaning. That does not cancel the regime. It means participation has not confirmed the stress at the same strength.',
    'overnight|volume': 'Overnight is the lead into the cash session. Volume is whether unusual participation has shown up in US names. A defensive overnight read with mixed volume means the foreign lead has not turned into a heavy US tape.',
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function ready(desks) {
    return desks.filter((d) => d && d.status === 'ready' && Number.isFinite(d.stance));
  }
  function by(rows, pred) {
    return rows.filter(pred);
  }
  function names(rows) {
    const list = rows.map((d) => d.name);
    if (!list.length) return 'none';
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  }
  function coverage(all, voting) {
    const wait = all.filter((d) => d.status === 'loading').map((d) => d.name);
    const stale = all.filter((d) => d.status === 'stale').map((d) => d.name);
    const miss = all.filter((d) => d.status !== 'ready' && d.status !== 'loading' && d.status !== 'stale').map((d) => d.name);
    const parts = [`${voting.length} of ${all.length} desks have a current vote`];
    if (wait.length) parts.push(`${wait.join(', ')} ${wait.length === 1 ? 'is' : 'are'} still loading`);
    if (miss.length) parts.push(`${miss.join(', ')} ${miss.length === 1 ? 'has' : 'have'} no current read`);
    if (stale.length) parts.push(`${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} reference only and ${stale.length === 1 ? 'does' : 'do'} not vote`);
    return `${parts.join('. ')}.`;
  }
  function explain(a, b) {
    const lo = a.stance <= b.stance ? a : b;
    const hi = lo === a ? b : a;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    return {
      left: lo,
      right: hi,
      gap: Math.abs(a.stance - b.stance),
      lead: `${lo.name} — ${lo.label}. ${hi.name} — ${hi.label}.`,
      mechanism: PAIR[key] || 'These desks count different evidence on different clocks. A gap in their labels is a difference in what they can see.',
      evidence: `${lo.name}: ${lo.why || 'No detail.'} ${hi.name}: ${hi.why || 'No detail.'}`,
    };
  }
  function gammaNote(voting) {
    const g = voting.find((d) => d.id === 'gamma');
    if (!g || g.structure === 'amplify') {
      return g && g.structure === 'amplify'
        ? 'SPY gamma is negative. Under the conventional call-minus-put sign, hedging would amplify the next move rather than pin it, so a break has more room to travel. That is fuel, not proof the move has already happened.'
        : '';
    }
    if (g.structure === 'dampen') {
      return 'SPY gamma is positive. Under the conventional sign, hedging would tend to dampen and pin the next move, so listed gamma is not adding crash fuel on top of the other reads.';
    }
    return '';
  }
  function classify(voting) {
    if (voting.length < 3) return 'thin';
    const severe = by(voting, (d) => d.stance <= -2);
    const calmOrBid = by(voting, (d) => d.stance >= 0);
    const defensive = by(voting, (d) => d.stance <= -1);
    const constructive = by(voting, (d) => d.stance >= 1);
    const sessionDef = by(voting, (d) => d.layer === 'session' && d.stance <= -1);
    const backdropSevere = by(severe, (d) => d.layer === 'backdrop');
    const fearSevere = by(severe, (d) => d.id === 'fear-greed');
    const gammaSevere = by(severe, (d) => d.id === 'gamma');
    const otherBackdropDef = by(voting, (d) => d.layer === 'backdrop' && d.id !== 'fear-greed' && d.stance <= -1);
    if (severe.length && calmOrBid.length) {
      const onlyFear = severe.length === fearSevere.length && !otherBackdropDef.length && !sessionDef.length;
      const onlyGamma = severe.length === gammaSevere.length && !sessionDef.length && !backdropSevere.length;
      if (onlyFear) return 'sentiment-ahead';
      if (onlyGamma) return 'structure-stress';
      if (backdropSevere.length && !sessionDef.length) return 'defensive-unconfirmed';
      return 'split';
    }
    if (defensive.length && constructive.length) return 'split';
    const hotSentiment = by(voting, (d) => d.id === 'fear-greed' && d.stance >= 2);
    const sessionBid = by(voting, (d) => d.layer === 'session' && d.stance >= 1);
    const backdropBid = by(voting, (d) => d.layer === 'backdrop' && d.id !== 'fear-greed' && d.stance >= 1);
    if (hotSentiment.length && !sessionBid.length && !backdropBid.length) return 'sentiment-hot';
    const mean = voting.reduce((sum, d) => sum + d.stance, 0) / voting.length;
    if (mean <= -0.6 && defensive.length && !constructive.length) return 'aligned-defensive';
    if (mean >= 0.6 && constructive.length && !defensive.length) return 'aligned-constructive';
    return 'aligned-mixed';
  }
  function toneFor(position) {
    if (position === 'aligned-defensive') return 'off';
    if (position === 'aligned-constructive') return 'on';
    if (position === 'thin' || position === 'aligned-mixed') return 'neutral';
    return 'warn';
  }
  function headline(position, voting) {
    if (position === 'thin') return 'Not enough current desks to call a market position.';
    if (position === 'sentiment-ahead') return 'Sentiment is extreme. Price and the cross-asset regime have not confirmed it.';
    if (position === 'sentiment-hot') return 'Sentiment is extremely greedy. The tape has not confirmed a broad risk-on.';
    if (position === 'structure-stress') return 'SPY gamma says a down move can extend. The other desks have not called a severe tape.';
    if (position === 'defensive-unconfirmed') {
      const severe = by(voting, (d) => d.stance <= -2);
      if (severe.length && severe.every((d) => d.id === 'fear-greed')) return 'Sentiment is severe. Today’s stock tape has not confirmed it.';
      return 'The backdrop is severe. Today’s stock tape has not confirmed it.';
    }
    if (position === 'aligned-defensive') return 'These desks agree the market is defensive.';
    if (position === 'aligned-constructive') return 'These desks agree the market is constructive.';
    if (position === 'aligned-mixed') return 'These desks do not have a single directional position.';
    const severe = by(voting, (d) => d.stance <= -2);
    const calm = by(voting, (d) => d.stance === 0 && d.layer !== 'structure');
    const down = by(voting, (d) => d.stance === -1);
    const up = by(voting, (d) => d.stance >= 1);
    if (severe.length && calm.length) {
      return `${names(severe)} ${severe.length === 1 ? 'is' : 'are'} severe. ${names(calm)} ${calm.length === 1 ? 'has' : 'have'} not confirmed it.`;
    }
    if (down.length && up.length) {
      return `${names(down)} ${down.length === 1 ? 'is' : 'are'} defensive. ${names(up)} ${up.length === 1 ? 'is' : 'are'} constructive.`;
    }
    return 'The desks do not share one market position.';
  }
  function gammaRead(v) {
    if (!v || typeof v !== 'object') return null;
    if (v.posGamma) return { stance: 0, structure: 'dampen', label: 'Dampening' };
    const bear = v.dir === 'bear';
    const bull = v.dir === 'bull';
    const stance = bear ? (Number(v.volTier) >= 3 ? -2 : -1) : bull ? 1 : 0;
    const label = stance <= -2 ? 'High-vol downside'
      : bull ? 'Amplifying upside'
        : bear ? 'Amplifying downside'
          : 'Two-way';
    return { stance, structure: 'amplify', label };
  }
  function picture(position, voting, tilts) {
    const lines = [];
    const severe = by(voting, (d) => d.stance <= -2);
    const calmSession = by(voting, (d) => d.layer === 'session' && d.stance >= 0);
    if (position === 'thin') {
      lines.push('A combined position needs at least three current desks. What has already reported stays that desk’s own call until the others arrive.');
      if (severe.length) lines.push('A severe label from one desk is not the stack’s position.');
    } else if (position === 'defensive-unconfirmed') {
      const sessionNote = calmSession.length
        ? `${names(calmSession)} ${calmSession.length === 1 ? 'has' : 'have'} not confirmed a breakdown.`
        : 'No session desk has a current vote yet, so the breakdown is unconfirmed.';
      lines.push(`The severe call is ${names(severe)}. ${sessionNote} Size for the backdrop. A neutral tape is not an all-clear, and a severe label is not proof the selloff has already printed.`);
    } else if (position === 'sentiment-ahead') {
      lines.push('Fear & Greed is the severe read, and it measures washed-out positioning rather than whether prices are breaking. Extreme fear becomes a market position only after breadth and volume confirm it. Until then it is a watch, not a buy and not a crash call.');
    } else if (position === 'sentiment-hot') {
      lines.push('Extreme greed means positioning is already crowded. It can support a trend, but it is not permission to chase. Wait until breadth and volume confirm before treating the score as a risk-on tape.');
    } else if (position === 'structure-stress') {
      const g = voting.find((d) => d.id === 'gamma');
      lines.push(`${g ? g.why + ' ' : ''}The other desks have not called a severe tape. Treat the gamma proxy as a statement about how far the next move can travel, and wait for the heatmap or the regime before calling the market itself risk-off.`);
    } else if (position === 'split') {
      lines.push('The labels disagree because the desks are not looking at the same evidence. Read the pairs below before folding them into one gut call. Until they line up, the position is mixed and size stays smaller.');
    } else if (position === 'aligned-defensive') {
      const hardest = by(voting, (d) => d.stance <= -2);
      const softer = by(voting, (d) => d.stance === -1);
      if (hardest.length && softer.length) {
        lines.push(`Direction agrees. ${names(hardest)} ${hardest.length === 1 ? 'is' : 'are'} the severe end. ${names(softer)} ${softer.length === 1 ? 'is' : 'are'} risk-off rather than neutral, so the difference is degree.`);
      }
      lines.push('Size down, demand a clean break, and do not fade the tape until both the backdrop and the session ease.');
    } else if (position === 'aligned-constructive') {
      lines.push('The wind is with risk assets across these desks. That favors strength that is already confirming. It is not permission to chase a name that is extended on its own.');
    } else if (tilts.length) {
      lines.push('Where a desk is one step apart, it is a lean, not a severe conflict. The notes below say which evidence is ahead.');
    } else {
      lines.push('No desk is severe, and no desk is confirming a broad risk-on tape. Let the single-name setup lead.');
    }
    if (position !== 'structure-stress' && position !== 'thin') {
      const note = gammaNote(voting);
      if (note) lines.push(note);
    }
    return lines;
  }
  function pairs(voting) {
    const hard = [];
    const soft = [];
    for (let i = 0; i < voting.length; i++) {
      for (let j = i + 1; j < voting.length; j++) {
        const gap = Math.abs(voting[i].stance - voting[j].stance);
        if (gap >= 2) hard.push(explain(voting[i], voting[j]));
        else if (gap === 1) soft.push(explain(voting[i], voting[j]));
      }
    }
    const rank = (s) => (s.left.layer === s.right.layer ? 10 : 0) - s.gap;
    hard.sort((a, b) => rank(a) - rank(b));
    soft.sort((a, b) => rank(a) - rank(b));
    const shown = hard.slice(0, 6);
    return { hard: shown, soft: soft.slice(0, shown.length ? 2 : 4) };
  }

  function assess(input) {
    const desks = (Array.isArray(input) ? input : []).filter((d) => d && d.id && d.name);
    const voting = ready(desks);
    const position = classify(voting);
    const split = pairs(voting);
    return {
      position,
      tone: toneFor(position),
      headline: headline(position, voting),
      picture: picture(position, voting, split.soft),
      coverage: coverage(desks, voting),
      splits: split.hard,
      tilts: position === 'aligned-defensive' || position === 'aligned-constructive' ? [] : split.soft,
      voting,
      desks,
    };
  }

  function deskHtml(d) {
    const cls = d.status !== 'ready' ? 'is-wait'
      : d.stance <= -2 ? 'is-severe'
        : d.stance <= -1 ? 'is-off'
          : d.stance >= 1 ? 'is-on' : 'is-mixed';
    const status = d.status === 'loading' ? 'Loading'
      : d.status === 'stale' ? 'Reference only'
        : d.status === 'ready' ? 'Current' : 'Unavailable';
    const action = `data-risk-go="${esc(d.tab || '')}"`;
    const open = 'Open';
    const accessible = `${d.name}, ${d.label || 'No read'}. ${open}.`;
    return `<button type="button" class="risk-desk ${cls}" ${action} aria-label="${esc(accessible)}" title="${esc(d.measures || '')}">` +
      `<span class="risk-desk-kicker"><span>${esc(d.horizon || '')}</span><em>${status}</em></span>` +
      `<b>${esc(d.name)}</b><strong>${esc(d.label || 'No read')}</strong>` +
      `<p>${esc(d.why || '')}</p><span class="risk-desk-open">${open}</span></button>`;
  }
  function foldHtml(list, summary) {
    if (list.length <= 2) return list.map(splitHtml).join('');
    return list.slice(0, 2).map(splitHtml).join('') +
      `<details class="risk-more"><summary>${esc(summary)}</summary>${list.slice(2).map(splitHtml).join('')}</details>`;
  }
  function splitHtml(s) {
    return `<article class="risk-split"><h4>${esc(s.lead)}</h4><p>${esc(s.mechanism)}</p></article>`;
  }
  function campHtml(voting) {
    const groups = [
      ['Defensive', (d) => d.layer !== 'structure' && d.stance <= -1, 'is-off'],
      ['Neutral', (d) => d.layer !== 'structure' && d.stance === 0, 'is-mixed'],
      ['Constructive', (d) => d.layer !== 'structure' && d.stance >= 1, 'is-on'],
      ['Structure', (d) => d.layer === 'structure', 'is-structure'],
    ];
    return `<div class="risk-camps">${groups.map(([title, pred, cls]) => {
      const rows = voting.filter(pred);
      if (!rows.length) return '';
      return `<div class="risk-camp ${cls}"><span>${title}</span>${rows.map((d) => `<i class="risk-chip"><b>${esc(d.name)}</b><em>${esc(d.label || '')}</em></i>`).join('')}</div>`;
    }).join('')}</div>`;
  }
  function present(input) {
    const view = assess(input);
    const groups = [
      ['Backdrop', 'Slow reads: the regime, the month, and sentiment.', (d) => d.layer === 'backdrop'],
      ['Session', 'Right now: breadth, unusual participation, and the lead into the open.', (d) => d.layer === 'session'],
      ['Structure', 'How the next move behaves, not which way the market has already gone.', (d) => d.layer === 'structure'],
    ];
    const groupHtml = groups.map(([title, blurb, pred]) => {
      const rows = view.desks.filter(pred);
      if (!rows.length) return '';
      return `<section class="risk-group"><h4>${title}</h4><p>${blurb}</p><div class="risk-desks">${rows.map(deskHtml).join('')}</div></section>`;
    }).join('');
    const extraSplits = Math.max(0, view.splits.length - 2);
    const splits = view.splits.length
      ? `<section class="risk-splits"><h3>Why the labels disagree</h3><p>Each note is a different reason the labels can both be true.</p>${foldHtml(view.splits, extraSplits + ' more disagreement' + (extraSplits === 1 ? '' : 's'))}</section>`
      : '';
    const extraTilts = Math.max(0, view.tilts.length - 2);
    const tilts = view.tilts.length
      ? `<section class="risk-tilts"><h3>One-step leans</h3><p>These desks are a step apart. They are not in opposite regimes.</p>${foldHtml(view.tilts, extraTilts + ' more lean' + (extraTilts === 1 ? '' : 's'))}</section>`
      : '';
    return `<section class="risk-position risk-position-${view.tone}">` +
      `<div class="risk-position-head"><div><span class="risk-kicker">Market position</span><h3>${esc(view.headline)}</h3></div></div>` +
      campHtml(view.voting) +
      `<div class="risk-picture">${view.picture.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` +
      `<p class="risk-coverage">${esc(view.coverage)}</p></section>` +
      `<div class="risk-groups">${groupHtml}</div>${splits}${tilts}` +
      '<p class="risk-footnote">This reads the seven desks side by side. It does not average them into a new score, and it does not change the regime used for position limits.</p>';
  }

  return { assess, present, gammaRead };
}

export const riskStack = riskStackFactory();
