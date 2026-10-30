// Additional views of data the desks already store.
// Nothing here writes a score, changes a formula, or calls a model.
// Each panel is a sibling under the existing card and stays hidden until its tab opens.

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function signed(value, digits) {
  const n = num(value);
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(digits);
}

function pct(value, digits) {
  const text = signed(value, digits);
  return text === "—" ? text : text + "%";
}

function money(value) {
  const n = num(value);
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dayLabel(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return match[0];
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function etToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function etDateFromIso(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

function addDays(iso, delta) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function mount(id, html) {
  const el = $(id);
  if (!el) return null;
  const panel = el.querySelector("[data-book-panel]");
  if (panel) state.open[id] = panel.open;
  const active = document.activeElement;
  const control = active && active.getAttribute && active.closest && active.closest("#" + id)
    ? active.getAttribute("data-book-control") : "";
  const caret = active && control ? active.selectionStart : null;
  el.hidden = false;
  el.innerHTML = html;
  if (control) {
    const next = el.querySelector('[data-book-control="' + control + '"]');
    if (next) {
      next.focus();
      if (caret != null && next.setSelectionRange) {
        try { next.setSelectionRange(caret, caret); } catch (_) {}
      }
    }
  }
  return el;
}

function fail(id, title, detail) {
  mount(id, shell(id, title, `<p class="book-note">${esc(detail)}</p>${["book-evidence","book-link","book-rejections"].includes(id) ? `<button type="button" class="book-more" data-owner-record-retry="${esc(id)}">Retry this record</button>` : ""}`));
}

function shell(id, title, body, note) {
  const open = id.startsWith('book-') && ['book-link','book-evidence','book-rejections'].includes(id) ? state.open[id] === true : state.open[id] !== false;
  return `<details class="book-details" data-book-panel="${esc(id)}"${open ? " open" : ""}>` +
    `<summary class="book-summary"><span class="book-kicker">Additional view</span><span class="book-title">${esc(title)}</span></summary>` +
    `<div class="book-body">${note ? `<p class="book-note">${note}</p>` : ""}${body}</div></details>`;
}

function searchField(control, label, value, placeholder) {
  return `<label>${esc(label)} <input data-book-control="${esc(control)}" type="search" value="${esc(value || "")}" placeholder="${esc(placeholder || "Ticker")}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false"></label>`;
}

const cache = new Map();

function isOwnerKey(key) {
  return key === "grades.json" || key === "grades-daily.json" || key === "link-map.json" || key === "evidence-latest.json" || key === "ai-rejections-latest.json" ||
    key.startsWith("evidence/") || key.startsWith("ai-rejections/");
}

function loadJson(key) {
  if (cache.has(key)) return cache.get(key);
  const task = (async () => {
    const urls = window.STONKS_OWNER_ACCESS === true || isOwnerKey(key)
      ? ["/api/auth/me?owner=1&data=" + encodeURIComponent(key)]
      : ["data/" + key];
    let last = "unavailable";
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
        if (!response.ok) { last = "HTTP " + response.status; continue; }
        return await response.json();
      } catch (err) {
        last = err && err.message ? err.message : "request failed";
      }
    }
    throw new Error(last);
  })();
  cache.set(key, task);
  task.catch(() => cache.delete(key));
  return task;
}

const state = {
  open: {},
  gradePeriod: "1m",
  gradeQuery: "",
  gradeSide: "all",
  gradeSector: "all",
  gradeBand: "all",
  gradeSort: "x",
  gradeSortDir: "desc",
  gradeScale: "spread",
  maPeriod: "50",
  maLookup: "",
  wallsAll: false,
  wallQuery: "",
  wallSort: "score",
  linkNode: "",
  linkQuery: "",
  evidenceQuery: "",
  ivQuery: "",
  ivLookup: "",
  streakQuery: "",
  earnQuery: "",
  narrQuery: "",
  spillQuery: "",
  breadthQuery: "",
  rejectQuery: "",
};

const GRADE_PERIODS = [
  ["1d", "1D return"],
  ["1w", "1W return"],
  ["1m", "1M return"],
  ["3m", "3M return"],
  ["ytd", "YTD return"],
  ["1y", "1Y return"],
];

const SECTOR_COLORS = [
  "#e0b15a", "#6cb6ff", "#c9a0ff", "#ff9b73", "#7dcea0", "#f0d08a",
  "#8fd0e8", "#f2a3c7", "#b7d48a", "#f0c36a", "#9bb6ff", "#e89b9b",
  "#7ec8c3", "#e6c27a", "#d4a0e0", "#a8d08d", "#f0b429", "#80c4e8",
  "#e8a87c", "#b0e0c8", "#d9c4a0", "#a3b8f0", "#f2c1b0", "#8fd4a8",
  "#e0d080", "#c8b4f0", "#f0a0b4", "#90d0b0", "#e8d0a0", "#a0c8e8",
  "#d8b890", "#c0e0a0",
];
const GRADE_SIDES = [
  ["all", "All recommendations"],
  ["call", "Calls"],
  ["put", "Puts"],
  ["none", "No recommendation"],
];
const GRADE_SORTS = [
  ["x", "Return"],
  ["y", "Average"],
  ["today", "Today"],
  ["symbol", "Ticker"],
  ["sector", "Sector"],
  ["side", "Recommendation"],
  ["days", "Days"],
  ["callDays", "Call days"],
];
const SIDE_RANK = { call: 0, put: 1, none: 2 };

const IV_TIER_COLOR = {
  surging: "var(--violet)",
  trending: "var(--info)",
  building: "var(--accent)",
  elevated: "var(--muted-strong)",
  other: "var(--muted)",
};

const LIFECYCLE = [
  ["catalysts", "Catalysts"],
  ["amplification", "Amplification"],
  ["validation", "Validation"],
  ["peak", "Peak"],
  ["challenges", "Challenges"],
  ["collapse", "Collapse"],
];

const CAL_BUCKETS = [
  ["earnings", "Earnings", "var(--accent)"],
  ["report", "Reports", "var(--info)"],
  ["fomc", "Fed", "var(--warn)"],
  ["catalyst", "Catalysts", "var(--violet)"],
  ["macro", "Macro", "var(--muted-strong)"],
];

function heatmapReturn(row, period) {
  if (!row) return null;
  if (period === "1d") return num(row.ch);
  return row.perf ? num(row.perf[period]) : null;
}

function padRange(min, max) {
  if (min == null || max == null) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.08 : 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

function axisTicks(min, max, extras) {
  const raw = [max, (min + max) / 2, min].concat(extras || []);
  const span = Math.max(max - min, 1e-9);
  const kept = [];
  raw.sort((a, b) => b - a);
  for (const tick of raw) {
    if (tick < min - span * 0.001 || tick > max + span * 0.001) continue;
    if (kept.some((keptTick) => Math.abs(keptTick - tick) < span * 0.12)) continue;
    kept.push(tick);
  }
  return kept;
}

function scatterHtml(opts) {
  const points = opts.points.filter((point) => point.x != null && point.y != null);
  if (points.length < 2) {
    return `<p class="book-note">Fewer than two names have both stored values, so the plot stays empty.</p>`;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [x0, x1] = padRange(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = padRange(Math.min(...ys), Math.max(...ys));
  const W = 640;
  const H = 280;
  const xAt = (value) => ((value - x0) / (x1 - x0)) * W;
  const yAt = (value) => (1 - (value - y0) / (y1 - y0)) * H;
  const query = String(opts.query || "").trim().toUpperCase();
  const hover = [];
  let marks = "";
  const ordered = points.slice().sort((a, b) => (b.r || 0) - (a.r || 0));
  for (const point of ordered) {
    const x = xAt(point.x);
    const y = yAt(point.y);
    const r = Math.max(4.5, point.r || 4.5);
    const dim = query && !(point.symbol && point.symbol.startsWith(query));
    // This svg stretches to its box (preserveAspectRatio="none"), which turned
    // circles into ovals. A zero-length round-capped line with a non-scaling
    // stroke stays a true circle of radius r at any box size.
    const cx = x.toFixed(1), cy = y.toFixed(1);
    marks += `<g class="book-dot ${dim ? "is-dim" : "is-hit"}" style="--dot:${(2 * r).toFixed(1)}px"><title>${esc(point.label)}</title>` +
      (dim ? "" : `<line class="book-dot-ring" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy}" />`) +
      `<line class="book-dot-fill" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy}" stroke="${point.color}" /></g>`;
    hover.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, point.label]);
  }
  let guides = "";
  if (x0 < 0 && x1 > 0) {
    const x = xAt(0);
    guides += `<line class="book-zero" x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H}" />`;
  }
  if (y0 < 0 && y1 > 0) {
    const y = yAt(0);
    guides += `<line class="book-zero" x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" />`;
  }
  for (const guide of opts.guides || []) {
    if (guide.axis === "x" && guide.value > x0 && guide.value < x1) {
      const x = xAt(guide.value);
      guides += `<line class="book-guide" x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H}" />`;
    }
    if (guide.axis === "y" && guide.value > y0 && guide.value < y1) {
      const y = yAt(guide.value);
      guides += `<line class="book-guide" x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" />`;
    }
  }
  const yTicks = axisTicks(y0, y1, y0 < 0 && y1 > 0 ? [0] : []);
  const yLabels = yTicks.map((tick) => {
    const top = (yAt(tick) / H) * 100;
    return `<span style="top:${top.toFixed(2)}%">${esc(opts.yFmt(tick))}</span>`;
  }).join("");
  const xLabels = axisTicks(x0, x1, x0 < 0 && x1 > 0 ? [0] : []).slice().reverse();
  const hoverHits = query ? hover.filter((row) => String(row[2] || "").toUpperCase().startsWith(query)) : hover;
  const svg = `<svg class="book-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.aria)}" data-ch-xy="1" data-ch="${esc(JSON.stringify(hoverHits.length ? hoverHits : hover))}">${guides}${marks}</svg>`;
  const hits = query ? points.filter((point) => point.symbol && point.symbol.startsWith(query)) : [];
  const hitHtml = !query ? "" : hits.length
    ? `<ul class="book-hits">${hits.slice(0, 8).map((point) => `<li><b>${esc(point.symbol)}</b><span>${esc(point.hit || "")}</span></li>`).join("")}</ul>` +
      (hits.length > 8 ? `<p class="book-note">${hits.length - 8} more matches. Keep typing.</p>` : "")
    : `<p class="book-note">No plotted name starts with ${esc(query)}.</p>`;
  return `<div class="book-plot"><div class="book-y" aria-hidden="true">${yLabels}</div><div class="book-plot-main">${svg}<div class="book-x">${xLabels.map((tick) => `<span>${esc(opts.xFmt(tick))}</span>`).join("")}</div><div class="book-axis-caption"><span>${esc(opts.xName)}</span><span>${esc(opts.yName)}</span></div></div></div>` +
    hitHtml + (opts.legend || "");
}

function legendHtml(items) {
  if (!items.length) return "";
  return `<div class="book-legend">${items.map((item) =>
    `<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join("")}</div>`;
}

function selectControl(control, label, value, options) {
  const choices = options.map(([optionValue, text]) =>
    `<option value="${esc(optionValue)}"${optionValue === value ? " selected" : ""}>${esc(text)}</option>`).join("");
  return `<label>${esc(label)} <select data-book-control="${esc(control)}" aria-label="${esc(label)}">${choices}</select></label>`;
}

function rankValues(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && order[j].value === order[i].value) j += 1;
    const average = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks[order[k].index] = average;
    i = j;
  }
  return ranks;
}

function rankAgreement(xs, ys) {
  const pairs = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (xs[i] == null || ys[i] == null) continue;
    pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return null;
  const rx = rankValues(pairs.map((pair) => pair[0]));
  const ry = rankValues(pairs.map((pair) => pair[1]));
  const n = pairs.length;
  const mean = (ranks) => ranks.reduce((sum, value) => sum + value, 0) / n;
  const mx = mean(rx);
  const my = mean(ry);
  let covariance = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    covariance += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return covariance / Math.sqrt(dx * dy);
}

function windowGradeSamples(days, symbol, period, start, asOf, todayTotal, bar) {
  const saved = [];
  for (const day of Array.isArray(days) ? days : []) {
    if (!day || !day.totals || typeof day.totals !== "object") continue;
    const date = String(day.date || "").slice(0, 10);
    const total = num(day.totals[symbol]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || total == null) continue;
    saved.push({ date, total });
  }
  saved.sort((a, b) => a.date.localeCompare(b.date));
  const fileStart = saved.length ? saved[0].date : null;
  const fileEnd = saved.length ? saved[saved.length - 1].date : null;
  const history = saved.length > 0;
  let samples;
  if (period === "1d" || !history || !start) {
    samples = todayTotal == null ? [] : [{ date: asOf || fileEnd || "", total: todayTotal }];
  } else {
    samples = saved.filter((row) => (!asOf || row.date <= asOf) && row.date > start);
    if (asOf && todayTotal != null && asOf > start) {
      const todayIndex = samples.findIndex((row) => row.date === asOf);
      const todayRow = { date: asOf, total: todayTotal };
      if (todayIndex >= 0) samples[todayIndex] = todayRow;
      else samples = samples.concat([todayRow]);
    }
    if (!samples.length && todayTotal != null) samples = [{ date: asOf || "", total: todayTotal }];
  }
  const totals = samples.map((row) => row.total);
  const dates = samples.map((row) => row.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const average = totals.length
    ? Math.round((totals.reduce((sum, total) => sum + total, 0) / totals.length) * 10) / 10
    : null;
  const savedInWindow = history && period !== "1d"
    ? saved.filter((row) => (!asOf || row.date <= asOf) && (!start || row.date > start)).length
    : 0;
  return {
    average,
    days: period === "1d" || !history ? (todayTotal == null ? 0 : 1) : totals.length,
    callDays: totals.filter((total) => total >= bar).length,
    putDays: totals.filter((total) => total <= -bar).length,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null,
    series: samples,
    history,
    fileStart,
    fileEnd,
    partial: !!(history && period !== "1d" && start && fileStart && fileStart > start),
    todayOnly: !history || period === "1d" || !start || savedInWindow === 0,
  };
}

function sideName(side) {
  if (side === "call") return "Call";
  if (side === "put") return "Put";
  return "No recommendation";
}

function pillarOf(grade, key) {
  const pillar = grade && grade.pillars && grade.pillars[key];
  return pillar ? num(pillar.score) : null;
}

function toneClass(value) {
  const n = num(value);
  if (n == null || n === 0) return "";
  return n > 0 ? "is-pos" : "is-neg";
}

async function renderBreadth() {
  const id = "book-breadth";
  try {
    const data = await loadJson("heatmap.json");
    const days = data && data.sectorRotation && Array.isArray(data.sectorRotation.days)
      ? data.sectorRotation.days.filter((day) => day && day.date)
      : [];
    if (!days.length) {
      fail(id, "Closing breadth log", "This heatmap has no stored sector-breadth days yet.");
      return;
    }
    const names = [];
    const seen = new Set();
    for (let i = days.length - 1; i >= 0; i--) {
      const sectors = days[i].sectors || {};
      for (const name of Object.keys(sectors)) {
        if (!seen.has(name)) { seen.add(name); names.push(name); }
      }
    }
    names.sort((a, b) => a.localeCompare(b));
    const latest = days[days.length - 1];
    const q = state.breadthQuery.trim().toLowerCase();
    const visibleNames = q ? names.filter((name) => name.toLowerCase().includes(q)) : names;
    const rows = visibleNames.map((name) => {
      const cells = days.map((day) => {
        const cell = day.sectors && day.sectors[name];
        if (!cell || (cell.d !== "g" && cell.d !== "r") || num(cell.p) == null) {
          const blankTip = dayLabel(day.date) + " · under 70% either way";
          return `<i class="book-cell is-blank" data-book-tip="${esc(blankTip)}" title="${esc(blankTip)}"></i>`;
        }
        const share = Math.round(num(cell.p) * 100);
        const way = cell.d === "g" ? "advancing" : "declining";
        const countText = num(cell.n) == null ? "" : " · " + Math.round(cell.n) + " names";
        const fade = 0.55 + 0.45 * Math.max(0, Math.min(1, (num(cell.p) - 0.7) / 0.3));
        const tip = dayLabel(day.date) + " · " + share + "% " + way + countText;
        return `<i class="book-cell is-${cell.d}" style="opacity:${fade.toFixed(2)}" data-book-tip="${esc(tip)}" title="${esc(tip)}"></i>`;
      }).join("");
      const now = latest.sectors && latest.sectors[name];
      const latestText = now && num(now.p) != null
        ? Math.round(now.p * 100) + "% " + (now.d === "g" ? "advancing" : "declining")
        : "under 70% on the latest close";
      return `<div class="book-breadth-row"><div class="book-breadth-name"><b>${esc(name)}</b><small>${esc(latestText)}</small></div><div class="book-cells" role="img" aria-label="${esc(name + " " + latestText)}">${cells}</div></div>`;
    }).join("");
    const span = dayLabel(days[0].date) + " – " + dayLabel(days[days.length - 1].date);
    mount(id, shell(
      id,
      "Closing breadth log",
      `<div class="book-controls">${searchField("breadth-query", "Group", state.breadthQuery, "Sector")}<span class="book-count">${visibleNames.length} of ${names.length} groups</span></div>` +
        `<div class="book-breadth-scale"><span></span><span><b>${esc(span)}</b><b>${days.length} closes</b></span></div>` +
        (rows || `<p class="book-note">No stored group matches ${esc(state.breadthQuery)}.</p>`) +
        `<p class="book-hover-readout" aria-live="polite"></p>` +
        legendHtml([
          { color: "var(--pos)", label: "≥70% advancing" },
          { color: "var(--neg)", label: "≥70% declining" },
          { color: "var(--hairline)", label: "Under 70% either way" },
        ]),
      "Each cell is a stored close from the heatmap breadth log. A sector is written down only when at least 70% of its names closed the same way. A blank day means that bar was not met. The streak chips above still use the two-session rule.",
    ));
  } catch (err) {
    fail(id, "Closing breadth log", "The breadth log could not be loaded (" + err.message + ").");
  }
}

function gradePoints(heatmap, grades, daily, period, bar) {
  const rows = heatmap && Array.isArray(heatmap.tickers) ? heatmap.tickers : [];
  const book = grades && grades.grades && typeof grades.grades === "object" ? grades.grades : {};
  const days = daily && Array.isArray(daily.days) ? daily.days : [];
  const asOf = etDateFromIso(heatmap && heatmap.builtAtIso) || etToday();
  const sectors = [];
  const points = [];
  let missing = 0;
  let partial = 0;
  let fileStart = null;
  let fileEnd = null;
  let sampleFirst = null;
  let sampleLast = null;
  let returnStart = null;
  let sampleDays = 0;
  for (const row of rows) {
    const symbol = String(row && row.t || "").toUpperCase();
    const grade = book[symbol];
    const x = heatmapReturn(row, period);
    const today = grade ? num(grade.total) : null;
    if (!symbol || x == null || today == null) { missing += 1; continue; }
    const sector = String(row.s || grade.sector || "Other");
    if (!sectors.includes(sector)) sectors.push(sector);
    const side = grade.side === "call" || grade.side === "put" ? grade.side : "none";
    const start = period === "1d" ? null : (row.perfStart && row.perfStart[period]) || null;
    const sample = windowGradeSamples(days, symbol, period, start, asOf, today, bar);
    if (sample.fileStart && (!fileStart || sample.fileStart < fileStart)) fileStart = sample.fileStart;
    if (sample.fileEnd && (!fileEnd || sample.fileEnd > fileEnd)) fileEnd = sample.fileEnd;
    if (start && (!returnStart || start < returnStart)) returnStart = start;
    if (!sample.todayOnly && sample.first && (!sampleFirst || sample.first < sampleFirst)) sampleFirst = sample.first;
    if (!sample.todayOnly && sample.last && (!sampleLast || sample.last > sampleLast)) sampleLast = sample.last;
    if (!sample.todayOnly && sample.days > sampleDays) sampleDays = sample.days;
    if (sample.partial) partial += 1;
    const y = sample.average == null ? today : sample.average;
    const drivers = Array.isArray(grade.drivers) ? grade.drivers.slice(0, 4) : [];
    points.push({
      symbol, x, y, today, sector, side,
      days: sample.days,
      callDays: sample.callDays,
      putDays: sample.putDays,
      first: sample.first,
      last: sample.last,
      series: sample.series,
      todayOnly: sample.todayOnly,
      partial: sample.partial,
      returnStart: start,
      mc: num(row.mc) || 0,
      fund: pillarOf(grade, "fundamentals"),
      tech: pillarOf(grade, "technicals"),
      mech: pillarOf(grade, "mechanicals"),
      narr: pillarOf(grade, "narrative"),
      iv: pillarOf(grade, "ivCost"),
      drivers: drivers.map((driver) => (driver.label || driver.key || "Signal") + " " + signed(driver.score, 1)).join(" · "),
    });
  }
  sectors.sort((a, b) => a.localeCompare(b));
  const colorOf = {};
  sectors.forEach((sector, index) => { colorOf[sector] = SECTOR_COLORS[index % SECTOR_COLORS.length]; });
  const mcs = points.map((point) => point.mc).filter((value) => value > 0);
  const lo = mcs.length ? Math.min(...mcs) : 0;
  const hi = mcs.length ? Math.max(...mcs) : 1;
  const history = days.length > 0;
  return {
    missing,
    sectors,
    asOf,
    history,
    fileStart,
    fileEnd,
    sampleFirst,
    sampleLast,
    sampleDays,
    returnStart,
    partial,
    points: points.map((point) => {
      const radius = hi === lo || point.mc <= 0
        ? 5
        : 3.4 + 6.4 * Math.sqrt((point.mc - lo) / (hi - lo));
      const pillars = ["Fund " + signed(point.fund, 1), "Tech " + signed(point.tech, 1), "Mech " + signed(point.mech, 1), "Story " + signed(point.narr, 1), "IV " + signed(point.iv, 1)].join(" · ");
      const windowLine = point.todayOnly
        ? "Window uses today's grade"
        : "Window avg " + signed(point.y, 1) + " · " + point.days + " days · " + point.callDays + " calls · " + point.putDays + " puts";
      return {
        ...point,
        r: radius,
        color: colorOf[point.sector],
        shape: point.side === "call" ? "circle" : point.side === "put" ? "square" : "diamond",
        hit: windowLine + " · today " + signed(point.today, 1) + " · " + pct(point.x, 2),
        label: point.symbol + "\n" + windowLine + "\nToday " + signed(point.today, 1) + " · " + sideName(point.side) + "\n" + pct(point.x, 2) + " · " + point.sector + "\n" + pillars + (point.drivers ? "\n" + point.drivers : ""),
      };
    }),
  };
}

function gradeSpark(series) {
  const rows = (Array.isArray(series) ? series : []).map((row) => {
    if (row && typeof row === "object") return { date: String(row.date || ""), value: num(row.total ?? row.value) };
    return { date: "", value: num(row) };
  }).filter((row) => row.value != null);
  if (rows.length < 2) return "";
  const values = rows.map((row) => row.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = 84;
  const h = 22;
  const coords = rows.map((row, index) => {
    const x = (index / (rows.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((row.value - lo) / (hi - lo || 1)) * (h - 4);
    const back = rows.length - 1 - index;
    const when = row.date || (back === 0 ? "Latest" : back + " sessions back");
    return { x, y, label: when + "\nGrade " + signed(row.value, 1) };
  });
  const points = coords.map((point) => point.x.toFixed(1) + "," + point.y.toFixed(1)).join(" ");
  const hover = coords.map((point) => [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10, point.label]);
  const tone = values[values.length - 1] >= values[0] ? "is-pos" : "is-neg";
  return `<svg class="book-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily grade path" data-ch="${esc(JSON.stringify(hover))}"><polyline class="${tone}" points="${points}" /></svg>`;
}

function gradePasses(point, bar) {
  if (state.gradeSide !== "all" && point.side !== state.gradeSide) return false;
  if (state.gradeSector !== "all" && point.sector !== state.gradeSector) return false;
  const magnitude = Math.abs(point.y);
  if (state.gradeBand === "bar" && magnitude < bar) return false;
  if (state.gradeBand === "strong" && magnitude < 7) return false;
  if (state.gradeBand === "below" && magnitude >= bar) return false;
  return true;
}

function compareGradePoints(a, b, key) {
  if (key === "symbol" || key === "sector") return String(a[key] || "").localeCompare(String(b[key] || ""));
  if (key === "side") return (SIDE_RANK[a.side] - SIDE_RANK[b.side]) || a.symbol.localeCompare(b.symbol);
  const av = num(a[key]);
  const bv = num(b[key]);
  if (av == null && bv == null) return a.symbol.localeCompare(b.symbol);
  if (av == null) return 1;
  if (bv == null) return -1;
  return av - bv || a.symbol.localeCompare(b.symbol);
}

function gradeMark(point, x, y, dim) {
  const cls = (dim ? "is-dim" : "is-hit") + (point.focus ? " is-focus" : "");
  const pick = ` data-book-action="grade-focus" data-symbol="${esc(point.symbol)}"`;
  const title = `<title>${esc(point.label)}</title>`;
  const r = point.r;
  if (point.shape === "square") {
    const size = r * 1.7;
    return `<rect class="${cls}"${pick} x="${(x - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="1.5" fill="${point.color}">${title}</rect>`;
  }
  if (point.shape === "diamond") {
    const size = r * 1.45;
    const points = [
      [x, y - size],
      [x + size, y],
      [x, y + size],
      [x - size, y],
    ].map((pair) => pair[0].toFixed(1) + "," + pair[1].toFixed(1)).join(" ");
    return `<polygon class="${cls}"${pick} points="${points}" fill="${point.color}">${title}</polygon>`;
  }
  return `<circle class="${cls}"${pick} cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${point.color}">${title}</circle>`;
}

function gradeScatterHtml(opts) {
  const points = opts.points.filter((point) => point.x != null && point.y != null);
  if (points.length < 2) {
    return `<p class="book-note">Fewer than two names match these filters.</p>`;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [x0, x1] = padRange(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = padRange(Math.min(...ys), Math.max(...ys));
  // Phones get a smaller drawing: the 920-wide one shrank to ~350px there,
  // leaving 6px ticks and 4px guide labels.
  const narrow = typeof window !== "undefined" && (window.innerWidth || 1000) <= 600;
  const W = narrow ? 460 : 920;
  const H = narrow ? 400 : 520;
  const pad = narrow ? { l: 46, r: 80, t: 16, b: 34 } : { l: 58, r: 86, t: 22, b: 42 };
  const rScale = narrow ? 0.7 : 1;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const xUnit = opts.scale === "linear"
    ? (value) => linearWait(value, x0, x1)
    : (value) => asinhWait(value, x0, x1);
  const xAt = (value) => pad.l + xUnit(value) * innerW;
  const yAt = (value) => pad.t + (1 - (value - y0) / (y1 - y0 || 1)) * innerH;
  const query = String(opts.query || "").trim().toUpperCase();
  const ordered = points.slice().sort((a, b) => (b.r || 0) - (a.r || 0));
  const hover = [];
  let guides = `<rect class="book-plot-bg" x="0" y="0" width="${W}" height="${H}" /><rect class="book-frame" x="${pad.l}" y="${pad.t}" width="${innerW}" height="${innerH}" />`;
  if (x0 < 0 && x1 > 0) {
    const x = xAt(0);
    guides += `<line class="book-zero" x1="${x.toFixed(1)}" y1="${pad.t}" x2="${x.toFixed(1)}" y2="${pad.t + innerH}" />`;
  }
  if (y0 < 0 && y1 > 0) {
    const y = yAt(0);
    guides += `<line class="book-zero" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + innerW}" y2="${y.toFixed(1)}" />`;
  }
  let tickText = "";
  const guideName = { 7: "Strong call", 4: "Call", "-4": "Put", "-7": "Strong put" };
  for (const guide of [-7, -4, 4, 7]) {
    if (guide <= y0 || guide >= y1) continue;
    const y = yAt(guide);
    guides += `<line class="book-guide" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + innerW}" y2="${y.toFixed(1)}" />`;
    tickText += `<text class="book-guide-label" x="${(pad.l + innerW + 6).toFixed(1)}" y="${y.toFixed(1)}" dominant-baseline="middle">${esc(guideName[guide])}</text>`;
  }
  const yTicks = spacedTicks(axisTicks(y0, y1, [-7, -4, 0, 4, 7]), yAt, 22);
  for (const tick of yTicks) {
    const y = yAt(tick);
    const bar = [-7, -4, 4, 7].some((guide) => Math.abs(guide - tick) < 0.05);
    if (Math.abs(tick) > 0.05 && !bar) {
      guides += `<line class="book-grid" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + innerW}" y2="${y.toFixed(1)}" />`;
    }
    tickText += `<text class="book-tick" x="${(pad.l - 8).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${esc(opts.yFmt(tick))}</text>`;
  }
  const xCandidates = opts.scale === "linear"
    ? axisTicks(x0, x1, x0 < 0 && x1 > 0 ? [0] : [])
    : returnTicks(x0, x1);
  const xTicks = spacedTicks(xCandidates, xAt, 52);
  for (const tick of xTicks) {
    tickText += `<text class="book-tick" x="${xAt(tick).toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle">${esc(opts.xFmt(tick))}</text>`;
  }
  let marks = "";
  for (const point of ordered) {
    const x = xAt(point.x);
    const y = yAt(point.y);
    const dim = query && !(point.symbol && point.symbol.startsWith(query));
    marks += gradeMark(rScale === 1 ? point : { ...point, r: point.r * rScale }, x, y, dim);
    hover.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, point.label]);
  }
  const labeled = [];
  // Labels appear only for a ticker the reader searched or clicked. Every
  // other name stays on the point until hover.
  const named = query ? ordered.filter((point) => point.symbol && point.symbol.startsWith(query)) : [];
  let labels = "";
  for (const point of named) {
    const x = xAt(point.x);
    const y = yAt(point.y);
    const placeLeft = x > pad.l + innerW - 72;
    const anchorX = x + (placeLeft ? -point.r - 5 : point.r + 5);
    let placed = null;
    for (const shift of [0, -18, 18, -36, 36]) {
      const ly = Math.max(pad.t + 12, Math.min(pad.t + innerH - 6, y + shift));
      if (labeled.some((item) => Math.abs(item.x - anchorX) < 72 && Math.abs(item.y - ly) < 16)) continue;
      placed = ly;
      break;
    }
    if (placed == null) continue;
    labeled.push({ x: anchorX, y: placed });
    const width = Math.max(36, point.symbol.length * 8.2 + 12);
    const tagX = placeLeft ? anchorX - width : anchorX;
    labels += `<g class="book-tag"><rect x="${tagX.toFixed(1)}" y="${(placed - 12).toFixed(1)}" width="${width.toFixed(1)}" height="16" rx="3"></rect><text x="${(tagX + 6).toFixed(1)}" y="${(placed - 1).toFixed(1)}">${esc(point.symbol)}</text></g>`;
    if (labeled.length >= 8) break;
  }
  const svg = `<svg class="book-svg is-fit${narrow ? " is-narrow" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria)}" data-ch-xy="1" data-ch="${esc(JSON.stringify(hover.length ? hover : [[0, 0, ""]]))}">${guides}${marks}${labels}${tickText}</svg>`;
  return `<div class="book-grade-chart"><div class="book-grade-ylab">${esc(opts.yName)}</div><div class="book-plot-main">${svg}<div class="book-axis-caption"><span>${esc(opts.xName)}</span></div></div></div>`;
}

function linearWait(value, min, max) {
  return (value - min) / (max - min || 1);
}

function asinhWait(value, min, max) {
  const start = Math.asinh(min);
  const end = Math.asinh(max);
  return (Math.asinh(value) - start) / (end - start || 1);
}

function returnTicks(min, max) {
  const candidates = [-400, -200, -100, -50, -25, 0, 25, 50, 100, 200, 400, 800];
  const kept = candidates.filter((tick) => tick >= min && tick <= max);
  if (min < 0 && max > 0 && !kept.includes(0)) kept.push(0);
  const outer = candidates.filter((tick) => tick >= min && tick <= max);
  if (outer.length) {
    const high = outer[outer.length - 1];
    const low = outer[0];
    if (!kept.includes(high)) kept.push(high);
    if (!kept.includes(low)) kept.push(low);
  }
  kept.sort((a, b) => a - b);
  return kept;
}

function spacedTicks(candidates, at, minGap) {
  const unique = [];
  for (const tick of candidates) {
    if (!unique.some((other) => Math.abs(other - tick) < 1e-6)) unique.push(tick);
  }
  unique.sort((a, b) => a - b);
  if (!unique.length) return unique;
  const preferred = [unique[0], unique[unique.length - 1]];
  if (unique.includes(0)) preferred.push(0);
  const kept = [];
  for (const tick of preferred.concat(unique)) {
    if (kept.some((other) => Math.abs(at(other) - at(tick)) < minGap)) continue;
    kept.push(tick);
  }
  kept.sort((a, b) => a - b);
  return kept;
}

function gradeTable(rows) {
  const headers = [
    ["symbol", "Ticker", ""],
    ["side", "Recommendation", ""],
    ["today", "Today", "num"],
    ["y", "Average", "num"],
    ["days", "Days", "num"],
    ["callDays", "Call days", "num"],
    ["putDays", "Put days", "num"],
    ["x", "Return", "num"],
    ["series", "Path", ""],
    ["sector", "Sector", ""],
    ["fund", "Fund", "num"],
    ["tech", "Tech", "num"],
    ["mech", "Mech", "num"],
    ["narr", "Story", "num"],
    ["iv", "IV", "num"],
  ];
  const headerTip = {
    today: "Grade from the latest bake",
    y: "Average of the daily grades in this return window",
    days: "Saved days included in the average",
    callDays: "Days in the window with a grade of +4 or higher",
    putDays: "Days in the window with a grade of -4 or lower",
    series: "Daily grade across the window, oldest to newest",
  };
  const head = headers.map(([key, text, kind]) => {
    const tip = headerTip[key] ? ` title="${esc(headerTip[key])}"` : "";
    if (key === "series") return `<th${tip}>${esc(text)}</th>`;
    const active = state.gradeSort === key;
    const mark = active ? (state.gradeSortDir === "asc" ? " ↑" : " ↓") : "";
    return `<th class="${kind === "num" ? "book-num" : ""}"${tip}><button type="button" class="${active ? "is-sort" : ""}" data-book-action="grade-sort" data-grade-sort="${esc(key)}">${esc(text + mark)}</button></th>`;
  }).join("");
  const body = rows.map((point) => {
    const focus = state.gradeQuery && point.symbol.startsWith(state.gradeQuery.trim().toUpperCase()) ? " is-focus" : "";
    const cell = (value, digits, percent) => {
      const text = percent ? pct(value, digits) : signed(value, digits);
      return `<td class="book-num ${toneClass(value)}">${esc(text)}</td>`;
    };
    const count = (value) => `<td class="book-num">${esc(String(value))}</td>`;
    return `<tr class="${focus.trim()}"><td><button type="button" data-book-action="grade-focus" data-symbol="${esc(point.symbol)}" title="${esc(point.drivers || point.label)}">${esc(point.symbol)}</button></td>` +
      `<td class="is-${esc(point.side)}">${esc(sideName(point.side))}</td>` +
      cell(point.today, 1, false) + cell(point.y, 1, false) +
      count(point.days) + count(point.callDays) + count(point.putDays) +
      cell(point.x, 1, true) +
      `<td>${gradeSpark(point.series)}</td>` +
      `<td>${esc(point.sector)}</td>` +
      cell(point.fund, 1, false) + cell(point.tech, 1, false) + cell(point.mech, 1, false) + cell(point.narr, 1, false) + cell(point.iv, 1, false) +
      `</tr>`;
  }).join("");
  return `<div class="book-table-wrap book-grade-table"><table class="book-table book-grade-grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sectorButtons(sectors) {
  const items = [["all", "All sectors"]].concat(sectors.map((sector) => [sector, sector]));
  return `<div class="book-legend" role="group" aria-label="Sectors">${items.map(([value, text]) => {
    const on = state.gradeSector === value;
    const color = value === "all" ? "var(--text-strong)" : SECTOR_COLORS[sectors.indexOf(value) % SECTOR_COLORS.length];
    return `<button type="button" class="${on ? "is-on" : ""}" data-book-action="grade-sector" data-grade-sector="${esc(value)}" aria-pressed="${on ? "true" : "false"}"><i style="background:${color}"></i>${esc(text)}</button>`;
  }).join("")}</div>`;
}

function gradeMetric(label, value, detail) {
  return `<div><small>${esc(label)}</small><b>${esc(value)}</b>${detail ? `<em>${esc(detail)}</em>` : ""}</div>`;
}

async function renderGrade() {
  const id = "book-grade-return";
  if (window.STONKS_OWNER_ACCESS !== true) return;
  try {
    const [heatmap, grades, daily] = await Promise.all([
      loadJson("heatmap.json"),
      loadJson("grades.json"),
      loadJson("grades-daily.json").catch(() => null),
    ]);
    if (window.STONKS_OWNER_ACCESS !== true) return;
    const period = state.gradePeriod;
    const label = (GRADE_PERIODS.find((item) => item[0] === period) || GRADE_PERIODS[2])[1];
    const bar = num(grades && grades.minConviction) || 4;
    const built = gradePoints(heatmap, grades, daily, period, bar);
    if (state.gradeSector !== "all" && !built.sectors.includes(state.gradeSector)) state.gradeSector = "all";
    const visible = built.points.filter((point) => gradePasses(point, bar));
    const query = state.gradeQuery.trim().toUpperCase();
    const sorted = visible.slice().sort((a, b) => {
      const delta = compareGradePoints(a, b, state.gradeSort);
      return state.gradeSortDir === "asc" ? delta : -delta;
    });
    const tableRows = query ? sorted.filter((point) => point.symbol.startsWith(query)) : sorted;
    const agreement = rankAgreement(built.points.map((point) => point.y), built.points.map((point) => point.x));
    const agreementRounded = agreement == null ? null : Math.round(agreement * 100) / 100;
    const agreementText = agreementRounded == null ? "—" : (agreementRounded > 0 ? "+" : "") + agreementRounded.toFixed(2);
    const calls = visible.filter((point) => point.side === "call").length;
    const puts = visible.filter((point) => point.side === "put").length;
    const none = visible.filter((point) => point.side === "none").length;
    const plottedWord = period === "1d" ? "grade" : "average";
    const bands = [
      ["all", "Any " + plottedWord],
      ["strong", "Strong either way, 7 or more"],
      ["bar", "Actionable either way, " + bar + " or more"],
      ["below", "Under " + bar + " either way"],
    ];
    const windowName = period === "1d" ? "Today's grade" : "Daily average";
    const plot = gradeScatterHtml({
      points: visible.map((point) => ({ ...point, focus: query && point.symbol.startsWith(query) })),
      query,
      scale: state.gradeScale,
      xName: label,
      yName: windowName,
      xFmt: (value) => pct(value, 0),
      yFmt: (value) => signed(value, 0),
      aria: windowName + " against " + label + " for tracked names",
    });
    const span = built.sampleFirst && built.sampleLast
      ? dayLabel(built.sampleFirst) + " – " + dayLabel(built.sampleLast)
      : "Today";
    const sampleValue = period === "1d" || !built.history ? "Today" : (built.sampleDays ? built.sampleDays + " days" : "Today");
    const sampleDetail = period === "1d" || !built.history ? (built.asOf ? dayLabel(built.asOf) : "Latest bake") : span;
    const shortHistory = built.history && period !== "1d" && built.returnStart && built.fileStart && built.fileStart > built.returnStart;
    const coverage = period === "1d"
      ? "This window plots today's grade. The average column matches it."
      : !built.history
        ? "No daily grades are saved yet, so this window still plots today's grade."
        : shortHistory
          ? "Saved grades begin " + dayLabel(built.fileStart) + ", after this return starts. The average uses " + span + " only."
          : "The average uses each saved grade from " + span + ".";
    const metrics = `<div class="book-metrics">` +
      gradeMetric("Vertical axis", windowName, label) +
      gradeMetric("Grades used", sampleValue, sampleDetail) +
      gradeMetric("Lines up with return", agreementText, "0 means no relationship") +
      gradeMetric("Names shown", String(visible.length), calls + " calls · " + puts + " puts · " + none + " no recommendation") +
      `</div>`;
    mount(id, shell(
      id,
      "Grade against the stored return",
      `<div class="book-grade">` +
        `<div class="book-controls">` +
        selectControl("grade-period", "Return window", period, GRADE_PERIODS) +
        selectControl("grade-side", "Recommendation", state.gradeSide, GRADE_SIDES) +
        selectControl("grade-sector", "Sector", state.gradeSector, [["all", "All sectors"]].concat(built.sectors.map((sector) => [sector, sector]))) +
        selectControl("grade-band", "Plotted grade", state.gradeBand, bands) +
        selectControl("grade-sort", "Sort", state.gradeSort, GRADE_SORTS) +
        selectControl("grade-scale", "Scale", state.gradeScale, [["spread", "Spread"], ["linear", "Linear"]]) +
        searchField("grade-query", "Ticker", state.gradeQuery, "NVDA") +
        `</div>${metrics}<p class="book-count">${esc(coverage + (built.missing ? " " + built.missing + " names are missing a grade or this return." : ""))}</p>` +
        `<div class="book-side-key"><span><i class="is-call"></i>Call now</span><span><i class="is-put"></i>Put now</span><span><i class="is-none"></i>No recommendation now</span><span class="book-size-key">Size is market cap</span></div>` +
        plot +
        sectorButtons(built.sectors) +
        (tableRows.length ? gradeTable(tableRows) : `<p class="book-note">No name matches these filters${query ? " and " + query : ""}.</p>`) +
        `</div>`,
      "One day plots today's grade. A longer window plots the average of the daily grades saved after that return begins. A call day is +" + bar + " or higher, a put day is -" + bar + " or lower, and the dashed lines mark those bars plus the strong bars at +7 and -7.",
    ));
  } catch (err) {
    fail(id, "Grade against the stored return", "The grade plot could not be loaded (" + err.message + ").");
  }
}

const IV_TIER_LABEL = { surging: "surging", trending: "trending", building: "building", elevated: "rich", other: "no tier" };

function ivTier(row) {
  if (row && row.tier && IV_TIER_COLOR[row.tier]) return row.tier;
  if (row && row.elevated) return "elevated";
  return "other";
}

async function renderIvHist() {
  const id = "book-iv-hist";
  try {
    const data = await loadJson("iv-trending.json");
    const rows = data && Array.isArray(data.tickers) ? data.tickers : [];
    const bins = Array.from({ length: 10 }, () => ({ surging: 0, trending: 0, building: 0, elevated: 0, other: 0, total: 0 }));
    let skipped = 0;
    for (const row of rows) {
      const pctile = num(row && row.pctile);
      if (pctile == null) { skipped += 1; continue; }
      const index = Math.max(0, Math.min(9, Math.floor((pctile >= 100 ? 99 : pctile) / 10)));
      const tier = ivTier(row);
      bins[index][tier] += 1;
      bins[index].total += 1;
    }
    const peak = Math.max(1, ...bins.map((bin) => bin.total));
    const barPx = 120;
    const tiers = ["surging", "trending", "building", "elevated", "other"];
    const columns = bins.map((bin, index) => {
      const stack = tiers.map((tier) => {
        if (!bin[tier]) return "";
        const height = Math.max(2, (bin[tier] / peak) * barPx);
        return `<i class="book-stack is-${tier}" style="height:${height.toFixed(1)}px" title="${esc(tier + " " + bin[tier])}"></i>`;
      }).join("");
      const from = index * 10;
      const to = index === 9 ? 100 : from + 10;
      const tip = from + "–" + to + " percentile · " + bin.total + " names";
      return `<div class="book-col" data-book-tip="${esc(tip)}"><b>${bin.total}</b><div class="book-col-bar" aria-label="${esc(tip)}">${stack}</div><small>${from}–${to}</small></div>`;
    }).join("");
    const plotted = bins.reduce((sum, bin) => sum + bin.total, 0);
    const lookup = state.ivLookup.trim().toUpperCase();
    const found = lookup ? rows.find((row) => String(row.symbol || "").toUpperCase() === lookup) : null;
    const lookupHtml = !lookup ? "" : !found
      ? `<p class="book-note">No stored IV row for ${esc(lookup)}.</p>`
      : `<p class="book-readout">${esc(found.symbol)} · percentile ${num(found.pctile) == null ? "—" : Math.round(found.pctile)} · ${esc(IV_TIER_LABEL[ivTier(found)] || "no tier")} · IV ${num(found.iv) == null ? "—" : (found.iv * 100).toFixed(1) + "%"} · 5-session ${pct(found.chg5dPct, 1)}</p>`;
    mount(id, shell(
      id,
      "IV percentile across the book",
      `<div class="book-controls">${searchField("iv-lookup", "Ticker", state.ivLookup, "SBUX")}<span class="book-count">${plotted} names</span></div>` +
        lookupHtml +
        `<div class="book-cols" role="img" aria-label="IV percentile histogram">${columns}</div>` +
        `<p class="book-hover-readout" aria-live="polite"></p>` +
        legendHtml([
          { color: "var(--violet)", label: "Surging" },
          { color: "var(--info)", label: "Trending" },
          { color: "var(--accent)", label: "Building" },
          { color: "var(--muted-strong)", label: "Rich" },
          { color: "var(--muted)", label: "No tier" },
        ]),
      plotted + " names use the stored IV percentile. " + (skipped ? skipped + " names have no percentile and are left out. " : "") +
        "Color is the stored tier. Rich is used only when a name has no surging, trending, or building tier. Hover a column for its count. The ranked cards above are unchanged.",
    ));
  } catch (err) {
    fail(id, "IV percentile across the book", "The IV histogram could not be loaded (" + err.message + ").");
  }
}

async function renderIvPrice() {
  const id = "book-iv-price";
  try {
    const [iv, heatmap] = await Promise.all([loadJson("iv-trending.json"), loadJson("heatmap.json")]);
    const price = new Map();
    for (const row of (heatmap && heatmap.tickers) || []) {
      const symbol = String(row && row.t || "").toUpperCase();
      const week = heatmapReturn(row, "1w");
      if (symbol && week != null) price.set(symbol, week);
    }
    const points = [];
    let missing = 0;
    for (const row of (iv && iv.tickers) || []) {
      const symbol = String(row && row.symbol || "").toUpperCase();
      const y = num(row && row.chg5dPct);
      const x = price.get(symbol);
      if (!symbol || y == null || x == null) { missing += 1; continue; }
      const tier = ivTier(row);
      points.push({
        symbol,
        x, y, r: 5, color: IV_TIER_COLOR[tier],
        hit: "1W price " + pct(x, 2) + " · 5-session IV " + pct(y, 1) + " · " + tier,
        label: symbol + "\n1W price " + pct(x, 2) + "\n5-session IV " + pct(y, 1) + "\n" + tier,
      });
    }
    mount(id, shell(
      id,
      "5-session IV change against the 1-week price return",
      `<div class="book-controls">${searchField("iv-query", "Ticker", state.ivQuery, "SBUX")}<span class="book-count">${points.length} names${missing ? " · " + missing + " missing one of the two stored series" : ""}</span></div>` +
        scatterHtml({
          points,
          query: state.ivQuery,
          xName: "1-week price return, heatmap",
          yName: "5-session IV change, Trending IV",
          xFmt: (value) => pct(value, 0),
          yFmt: (value) => pct(value, 0),
          aria: "Five-session IV change against one-week price return",
          legend: legendHtml([
            { color: "var(--violet)", label: "Surging" },
            { color: "var(--info)", label: "Trending" },
            { color: "var(--accent)", label: "Building" },
            { color: "var(--muted-strong)", label: "Rich" },
            { color: "var(--muted)", label: "No tier" },
          ]),
        }),
      "The two windows are not the same length. The horizontal axis is the stored 1-week price return. The vertical axis is the stored 5-session IV change. Hover a dot for that name. The plot does not score a divergence and does not change who is tiered.",
    ));
  } catch (err) {
    fail(id, "5-session IV change against the 1-week price return", "The IV and price plot could not be loaded (" + err.message + ").");
  }
}

function calendarCoveredDays(event) {
  const start = Date.parse(String(event?.date || '') + 'T00:00:00Z');
  let end = Date.parse(String(event?.endDate || event?.date || '') + 'T00:00:00Z');
  if (!Number.isFinite(start)) return [];
  if (!Number.isFinite(end) || end < start) end = start;
  const days = [];
  for(let ms=start;ms<=end && days.length<31;ms+=86400000) days.push(new Date(ms).toISOString().slice(0,10));
  return days;
}

function calendarBucket(event) {
  const type = event && event.type;
  if (type === "fed" || type === "fomc") return "fomc";
  if (type === "earnings" || type === "report" || type === "catalyst") return type;
  return "macro";
}

async function renderCalendar() {
  const id = "book-cal-density";
  try {
    const data = await loadJson("calendar.json");
    const tracked = new Set(window.STONKS_MANIFEST?.symbols || []);
    const events = (data && Array.isArray(data.events) ? data.events : []).filter(e => e && (!e.symbol || tracked.has(e.symbol)));
    const start = etToday();
    const days = [];
    for (let i = 0; i < 21; i++) {
      const date = addDays(start, i);
      if (date) days.push(date);
    }
    const counts = new Map(days.map((date) => [date, { earnings: 0, report: 0, fomc: 0, catalyst: 0, macro: 0, total: 0, names: [] }]));
    for (const event of events) {
      for(const date of calendarCoveredDays(event)) {
        const bucket = counts.get(date);
        if (!bucket) continue;
        const key = calendarBucket(event);
        bucket[key] += 1;
        bucket.total += 1;
        const label = event.symbol || event.title || key;
        if (label && bucket.names.length < 8) bucket.names.push(String(label));
      }
    }
    const peak = Math.max(1, ...[...counts.values()].map((row) => row.total));
    const barPx = 120;
    const total = [...counts.values()].reduce((sum, row) => sum + row.total, 0);
    if (!total) {
      fail(id, "Events by day", "No stored calendar events fall in the next 21 days from " + dayLabel(start) + ".");
      return;
    }
    const columns = days.map((date) => {
      const row = counts.get(date);
      const stack = CAL_BUCKETS.map(([key, label, color]) => {
        if (!row[key]) return "";
        const height = Math.max(2, (row[key] / peak) * barPx);
        return `<i style="height:${height.toFixed(1)}px;background:${color}" title="${esc(label + " " + row[key])}"></i>`;
      }).join("");
      const extra = row.total > row.names.length ? " · +" + (row.total - row.names.length) + " more" : "";
      const tip = dayLabel(date) + " · " + row.total + " event" + (row.total === 1 ? "" : "s") +
        (row.names.length ? " · " + row.names.join(", ") + extra : "");
      return `<div class="book-col" data-book-tip="${esc(tip)}"><b>${row.total}</b><div class="book-col-bar" aria-label="${esc(tip)}">${stack}</div><small>${esc(dayLabel(date).replace(" ", "\u00a0"))}</small></div>`;
    }).join("");
    mount(id, shell(
      id,
      "Events by day",
      `<div class="book-cols book-cols-dense" role="img" aria-label="Calendar events over the next 21 days">${columns}</div>` +
        `<p class="book-hover-readout" aria-live="polite"></p>` +
        legendHtml(CAL_BUCKETS.map(([key, label, color]) => ({ color, label }))),
      "Counts use the calendar’s stored event types for the 21 days beginning " + dayLabel(start) + " ET. " + total + " event appearances in the window, counting every day of multi-day events. Hover a day to see the stored names. Fed speeches and FOMC share the Fed color already used by the calendar filter. No crowded-day score is added.",
    ));
  } catch (err) {
    fail(id, "Events by day", "The calendar counts could not be loaded (" + err.message + ").");
  }
}

async function renderNarratives() {
  const id = "book-narr-board";
  try {
    const data = await loadJson("trends.json");
    const rows = data && Array.isArray(data.narratives) ? data.narratives : [];
    if (!rows.length) {
      fail(id, "Narrative stages", "No stored narratives are available for the stage board.");
      return;
    }
    const q = state.narrQuery.trim().toLowerCase();
    const source = q ? rows.filter((row) => String(row && row.name || "").toLowerCase().includes(q)) : rows;
    const groups = new Map(LIFECYCLE.map(([key]) => [key, []]));
    const other = [];
    for (const row of source) {
      const stage = String(row && row.lifecycleStage || "").toLowerCase();
      if (groups.has(stage)) groups.get(stage).push(row);
      else other.push(row);
    }
    const card = (row) => {
      const hype = row && row.hype && typeof row.hype === "object" ? row.hype : null;
      const hypeScore = hype ? num(hype.score) : null;
      const strength = num(row && row.strength);
      const days = num(row && row.daysRunning);
      const bits = [];
      if (hypeScore != null) bits.push("Hype " + Math.round(hypeScore) + (hype.label ? " · " + hype.label : ""));
      if (strength != null) bits.push("Strength " + Math.round(strength));
      if (days != null) bits.push(Math.round(days) + "d running");
      return `<article class="book-story"><b>${esc(row.name || "Untitled")}</b><small>${esc(bits.join(" · ") || "No hype score stored")}</small></article>`;
    };
    const sortRows = (list) => list.slice().sort((a, b) => {
      const ah = a && a.hype ? num(a.hype.score) : null;
      const bh = b && b.hype ? num(b.hype.score) : null;
      if (ah == null && bh == null) return String(a.name || "").localeCompare(String(b.name || ""));
      if (ah == null) return 1;
      if (bh == null) return -1;
      return bh - ah || String(a.name || "").localeCompare(String(b.name || ""));
    });
    const columns = LIFECYCLE.map(([key, label]) => {
      const list = sortRows(groups.get(key));
      return `<section class="book-stage"><header><span>${esc(label)}</span><b>${list.length}</b></header>${list.length ? list.map(card).join("") : `<p>None</p>`}</section>`;
    }).join("");
    const extra = other.length
      ? `<section class="book-stage"><header><span>Unstaged</span><b>${other.length}</b></header>${sortRows(other).map(card).join("")}</section>`
      : "";
    mount(id, shell(
      id,
      "Narrative stages",
      `<div class="book-controls">${searchField("narr-query", "Story", state.narrQuery, "AI")}<span class="book-count">${source.length} of ${rows.length}</span></div><div class="book-board">${columns}${extra}</div>`,
      "Stories stay in the stage already stored on each card, ordered inside a stage by the stored hype score. Search matches the stored story name. The sector tabs and story cards above are unchanged.",
    ));
  } catch (err) {
    fail(id, "Narrative stages", "The stage board could not be loaded (" + err.message + ").");
  }
}

function strikeText(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function wallRow(row) {
  const spot = num(row.spot);
  const call = row.callWall ? num(row.callWall.strike) : null;
  const put = row.putWall ? num(row.putWall.strike) : null;
  if (spot == null || (call == null && put == null)) return null;
  const marks = [{ kind: "spot", value: spot, text: "Spot " + money(spot) }];
  if (put != null) marks.push({ kind: "put", value: put, text: "Put " + strikeText(put) });
  if (call != null) marks.push({ kind: "call", value: call, text: "Call " + strikeText(call) });
  const values = marks.map((mark) => mark.value);
  const [lo, hi] = padRange(Math.min(...values), Math.max(...values));
  const dots = marks.map((mark) => {
    const left = ((mark.value - lo) / (hi - lo)) * 100;
    return `<i class="book-wall-dot is-${mark.kind}" style="left:${left.toFixed(2)}%" title="${esc(mark.text)}"></i>`;
  }).join("");
  const ordered = marks.slice().sort((a, b) => a.value - b.value);
  const bits = ordered.map((mark) => mark.text);
  if (put != null && spot) bits.push(pct(((put - spot) / spot) * 100, 1) + " to put");
  if (call != null && spot) bits.push(pct(((call - spot) / spot) * 100, 1) + " to call");
  const score = num(row.score);
  return `<div class="book-wall"><div class="book-wall-name"><b>${esc(row.symbol || "")}</b><small>${score == null ? "no score" : "score " + signed(score, 0).replace("+", "")}</small></div><div class="book-wall-track">${dots}</div><small class="book-wall-read">${esc(bits.join(" · "))}</small></div>`;
}

function wallNear(row) {
  const spot = num(row.spot);
  if (!spot) return 99;
  const dists = [];
  if (row.putWall && num(row.putWall.strike) != null) dists.push(Math.abs(num(row.putWall.strike) - spot) / spot);
  if (row.callWall && num(row.callWall.strike) != null) dists.push(Math.abs(num(row.callWall.strike) - spot) / spot);
  return dists.length ? Math.min(...dists) : 99;
}

async function renderWalls() {
  const id = "book-walls";
  try {
    const data = await loadJson("oi-tracker.json");
    const query = state.wallQuery.trim().toUpperCase();
    const ranked = (data && Array.isArray(data.tickers) ? data.tickers : [])
      .filter((row) => wallRow(row))
      .filter((row) => !query || String(row.symbol || "").toUpperCase().startsWith(query))
      .sort((a, b) => {
        if (state.wallSort === "symbol") return String(a.symbol).localeCompare(String(b.symbol));
        if (state.wallSort === "near") return wallNear(a) - wallNear(b) || String(a.symbol).localeCompare(String(b.symbol));
        const as = num(a.score);
        const bs = num(b.score);
        if (as == null && bs == null) return String(a.symbol).localeCompare(String(b.symbol));
        if (as == null) return 1;
        if (bs == null) return -1;
        return bs - as || String(a.symbol).localeCompare(String(b.symbol));
      });
    const visible = query || state.wallsAll ? ranked : ranked.slice(0, 16);
    const html = visible.map((row) => wallRow(row)).join("");
    const more = !query && ranked.length > 16
      ? `<button type="button" class="book-more" data-book-action="walls-all">${state.wallsAll ? "Show the first 16" : "Show all " + ranked.length}</button>`
      : "";
    const sorts = [["score", "Gamma score"], ["near", "Nearest wall"], ["symbol", "A to Z"]];
    mount(id, shell(
      id,
      "Spot between the stored walls",
      `<div class="book-controls">${searchField("wall-query", "Ticker", state.wallQuery, "AMD")}<label>Sort <select data-book-control="wall-sort" aria-label="Sort wall ranges">${sorts.map(([value, text]) => `<option value="${value}"${state.wallSort === value ? " selected" : ""}>${text}</option>`).join("")}</select></label><span class="book-count">${visible.length} of ${ranked.length}</span></div>` +
        (html || `<p class="book-note">No stored wall row starts with ${esc(query)}.</p>`) + more,
      "Each row uses the stored spot, put-wall strike, and call-wall strike. Marks are placed by strike, and the text reads in that same left-to-right order. Nearest-wall sort uses the smaller absolute distance from spot to a stored wall. The ladders and gamma score above are unchanged.",
    ));
  } catch (err) {
    fail(id, "Spot between the stored walls", "The wall ranges could not be loaded (" + err.message + ").");
  }
}

async function renderStreaks() {
  const id = "book-streaks";
  try {
    const data = await loadJson("streaks.json");
    const rows = data && Array.isArray(data.tickers) ? data.tickers : [];
    const points = [];
    let missing = 0;
    for (const row of rows) {
      const current = row && row.current;
      const days = current ? num(current.days) : null;
      const move = current ? num(current.cumulativePct) : null;
      if (days == null || move == null || days < 1) { missing += 1; continue; }
      const green = current.color === "green";
      const symbol = String(row.symbol || "").toUpperCase();
      points.push({
        symbol,
        x: days,
        y: move,
        r: 5,
        color: green ? "var(--pos)" : current.color === "red" ? "var(--neg)" : "var(--muted)",
        hit: Math.round(days) + "d " + (current.color || "") + " · " + pct(move, 1) + " cumulative",
        label: symbol + "\n" + Math.round(days) + "d " + (current.color || "") + "\n" + pct(move, 1) + " cumulative",
      });
    }
    mount(id, shell(
      id,
      "Streak length against cumulative move",
      `<div class="book-controls">${searchField("streak-query", "Ticker", state.streakQuery, "NVDA")}<span class="book-count">${points.length} names with a current streak${missing ? " · " + missing + " without a current length and move" : ""}</span></div>` +
      scatterHtml({
        points,
        query: state.streakQuery,
        xName: "Stored streak length, days",
        yName: "Stored cumulative move",
        xFmt: (value) => String(Math.round(value)),
        yFmt: (value) => pct(value, 0),
        aria: "Streak length against cumulative move",
        legend: legendHtml([
          { color: "var(--pos)", label: "Green streak" },
          { color: "var(--neg)", label: "Red streak" },
        ]),
      }),
      "Both axes are the stored current streak. Green and red are the stored streak color. Hover a dot for the exact stored length and cumulative move. The columns and filters above are unchanged.",
    ));
  } catch (err) {
    fail(id, "Streak length against cumulative move", "The streak plot could not be loaded (" + err.message + ").");
  }
}

function spillBars(event, limit) {
  const followers = Array.isArray(event.followers) ? event.followers : [];
  const shown = followers.slice(0, limit || 8);
  if (!shown.length) return "";
  const values = [];
  for (const follower of shown) {
    for (const key of ["expA", "expB", "pricedMovePct"]) {
      const value = num(follower[key]);
      if (value != null) values.push(Math.abs(value));
    }
  }
  const peak = Math.max(1, ...values);
  const series = [
    ["expA", "Sector model"],
    ["expB", "Pair model"],
    ["pricedMovePct", "Priced move"],
  ];
  const body = shown.map((follower) => {
    const lines = series.map(([key, label]) => {
      const value = num(follower[key]);
      const width = value == null ? 0 : (Math.abs(value) / peak) * 100;
      return `<div class="book-bar-line"><span>${label}</span><i style="width:${width.toFixed(2)}%"></i><b>${value == null ? "—" : "±" + Math.abs(value).toFixed(2) + "%"}</b></div>`;
    }).join("");
    const qualified = follower.pairQualified ? "qualified" : "unqualified";
    return `<div class="book-follower"><header><b>${esc(follower.follower || "")}</b><small>${qualified}${num(follower.pairN) == null ? "" : " · n=" + Math.round(follower.pairN)}</small></header>${lines}</div>`;
  }).join("");
  const hidden = followers.length - shown.length;
  const when = [event.driver, event.date ? dayLabel(event.date) : "", event.session || ""].filter(Boolean).join(" · ");
  return `<section class="book-spill-event"><h4>${esc(when)}</h4>${body}${hidden ? `<p class="book-note">${hidden} more follower${hidden === 1 ? "" : "s"} stay in the table above.</p>` : ""}</section>`;
}

async function renderSpill() {
  const id = "book-spill";
  try {
    const data = await loadJson("spillover-pairs.json");
    const upcoming = (data && Array.isArray(data.upcoming) ? data.upcoming : [])
      .slice()
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.driver || "").localeCompare(String(b.driver || "")));
    const query = state.spillQuery.trim().toUpperCase();
    const matched = (event) => {
      const followers = Array.isArray(event.followers) ? event.followers : [];
      if (!query) return followers;
      if (String(event.driver || "").toUpperCase().startsWith(query)) return followers;
      return followers.filter((follower) => String(follower.follower || "").toUpperCase().startsWith(query));
    };
    const pool = upcoming
      .map((event) => Object.assign({}, event, { followers: matched(event) }))
      .filter((event) => event.followers.length);
    const blocks = (query ? pool : pool.slice(0, 6));
    if (!blocks.length) {
      fail(id, "Follower ranges for upcoming prints", query
        ? "No upcoming driver or follower starts with " + query + "."
        : "No upcoming driver in the spillover file has stored followers.");
      return;
    }
    mount(id, shell(
      id,
      "Follower ranges for upcoming prints",
      `<div class="book-controls">${searchField("spill-query", "Ticker", state.spillQuery, "NVDA")}<span class="book-count">${blocks.length} print${blocks.length === 1 ? "" : "s"}</span></div>` +
        blocks.map((event) => spillBars(event, query ? 12 : 8)).join(""),
      "Sector model, pair model, and priced move stay as three stored series. Bar length is the absolute stored percent for that print. Search shows the driver or the followers that start with that ticker. Qualification is the stored pair flag. The matrix above is unchanged.",
    ));
  } catch (err) {
    fail(id, "Follower ranges for upcoming prints", "The follower bars could not be loaded (" + err.message + ").");
  }
}

function maDistance(row, period) {
  const spot = num(row && row.spot);
  const level = row && row.levels ? num(row.levels[period]) : null;
  if (spot == null || level == null || level === 0) return null;
  return ((spot - level) / level) * 100;
}

async function renderMa() {
  const id = "book-ma-dist";
  try {
    const data = await loadJson("ma-tracker.json");
    const rows = data && Array.isArray(data.tickers) ? data.tickers : [];
    const period = state.maPeriod;
    const edges = [-30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30];
    const bins = edges.slice(0, -1).map((from, index) => ({ from, to: edges[index + 1], count: 0 }));
    let below = 0;
    let inside = 0;
    let above = 0;
    let missing = 0;
    let furthest = 0;
    for (const row of rows) {
      const distance = maDistance(row, period);
      if (distance == null) { missing += 1; continue; }
      if (Math.abs(distance) <= 5) inside += 1;
      else if (distance > 5) above += 1;
      else below += 1;
      furthest = Math.max(furthest, Math.abs(distance));
      const bin = bins.find((item, index) => distance >= item.from && (distance < item.to || (index === bins.length - 1 && distance <= item.to)));
      if (bin) bin.count += 1;
      else if (distance < edges[0]) bins[0].count += 1;
      else bins[bins.length - 1].count += 1;
    }
    const peak = Math.max(1, ...bins.map((bin) => bin.count));
    const barPx = 120;
    const columns = bins.map((bin, index) => {
      const height = bin.count ? Math.max(2, (bin.count / peak) * barPx) : 0;
      const band = bin.to <= -5 || bin.from >= 5 ? "is-out" : "is-in";
      const label = (bin.from > 0 ? "+" : "") + bin.from + "% to " + (bin.to > 0 ? "+" : "") + bin.to + "%" +
        (index === 0 ? ", and anything further below" : index === bins.length - 1 ? ", and anything further above" : "");
      const tick = String(bin.from);
      return `<div class="book-col" data-book-tip="${esc(label + ", " + bin.count + " names")}"><b>${bin.count}</b><div class="book-col-bar"><i class="book-stack ${band}" style="height:${height.toFixed(1)}px" title="${esc(label + ", " + bin.count + " names")}"></i></div><small>${esc(tick)}</small></div>`;
    }).join("");
    const options = ["20", "50", "100", "200"].map((value) =>
      `<option value="${value}"${value === period ? " selected" : ""}>${value}-day</option>`).join("");
    const plotted = below + inside + above;
    const lookup = state.maLookup.trim().toUpperCase();
    const found = lookup ? rows.find((row) => String(row.symbol || "").toUpperCase() === lookup) : null;
    const distance = found ? maDistance(found, period) : null;
    const level = found && found.levels ? num(found.levels[period]) : null;
    const lookupHtml = !lookup ? "" : !found || distance == null
      ? `<p class="book-note">${esc(lookup)} has no stored ${period}-day level.</p>`
      : `<p class="book-readout">${esc(found.symbol)} · spot ${money(found.spot)} · ${period}-day ${level == null ? "—" : level.toLocaleString("en-US", { maximumFractionDigits: 2 })} · ${pct(distance, 1)} from that average</p>`;
    mount(id, shell(
      id,
      "Distance from spot to the stored average",
      `<div class="book-controls"><label>Average <select data-book-control="ma-period" aria-label="Moving average for the distance histogram">${options}</select></label>${searchField("ma-lookup", "Ticker", state.maLookup, "MU")}<span class="book-count">${plotted} names · ${inside} inside ±5% · ${above} above · ${below} below${missing ? " · " + missing + " missing a level" : ""}</span></div>${lookupHtml}<div class="book-cols" role="img" aria-label="Distance to the ${period}-day average">${columns}</div><p class="book-hover-readout" aria-live="polite"></p>`,
      "Distance is (spot − level) / level, using the spot and " + period + "-day level already stored for each name. The shaded ±5% band is the same band the crossover table uses. Names outside that band stay out of the table above. Hover a column for its count. This histogram does not change the priority score.",
    ));
  } catch (err) {
    fail(id, "Distance from spot to the stored average", "The distance histogram could not be loaded (" + err.message + ").");
  }
}

function earningsClass(row) {
  const surprise = num(row.surprisePct);
  const move = num(row.movePct);
  const eps = row.eps || (surprise == null ? "" : Math.abs(surprise) <= 1 ? "inline" : surprise > 0 ? "beat" : "miss");
  if (eps === "beat" && move != null && move < 0) return ["beat-fell", "Beat, then fell"];
  if (eps === "miss" && move != null && move > 0) return ["miss-rose", "Missed, then rose"];
  if (eps === "inline") return ["inline", "In line"];
  if (eps === "beat") return ["beat", "Beat, then rose"];
  if (eps === "miss") return ["miss", "Missed, then fell"];
  return ["none", "No EPS read"];
}

const EARNINGS_COLOR = {
  beat: "var(--pos)",
  "beat-fell": "var(--warn)",
  inline: "var(--muted-strong)",
  miss: "var(--neg)",
  "miss-rose": "var(--info)",
  none: "var(--muted)",
};

let earningsGen = 0;

async function renderEarnings() {
  const id = "book-earnings";
  const gen = ++earningsGen;
  try {
    const data = await loadJson("earnings-tracker.json");
    const seasons = data && Array.isArray(data.seasons) ? data.seasons : [];
    if (!seasons.length) {
      fail(id, "Surprise against the report-day move", "No stored earnings season is available.");
      return;
    }
    const active = document.querySelector("#earnings-root .ers-pill.is-active");
    const key = active && active.getAttribute("data-ers-season");
    const season = seasons.find((item) => item.key === key) || seasons[0];
    const rows = Array.isArray(season.rows) ? season.rows : [];
    const points = [];
    let missing = 0;
    for (const row of rows) {
      const surprise = num(row.surprisePct);
      const move = num(row.movePct);
      if (surprise == null || move == null) { missing += 1; continue; }
      const [klass, label] = earningsClass(row);
      const symbol = String(row.sym || "").toUpperCase();
      points.push({
        symbol,
        x: surprise,
        y: move * 100,
        r: 5,
        color: EARNINGS_COLOR[klass] || EARNINGS_COLOR.none,
        hit: label + " · surprise " + pct(surprise, 1) + " · report-day " + pct(move * 100, 1),
        label: symbol + "\n" + label + "\nSurprise " + pct(surprise, 1) + "\nReport-day " + pct(move * 100, 1),
      });
    }
    if (gen !== earningsGen) return;
    mount(id, shell(
      id,
      "Surprise against the report-day move",
      `<div class="book-controls">${searchField("earn-query", "Ticker", state.earnQuery, "ACN")}<span class="book-count">${esc(season.fiscal || season.key || "Season")} · ${points.length} prints${missing ? " · " + missing + " missing a surprise or a move" : ""}</span></div>` +
        scatterHtml({
          points,
          query: state.earnQuery,
          xName: "EPS surprise, stored percent",
          yName: "Report-day move",
          xFmt: (value) => pct(value, 0),
          yFmt: (value) => pct(value, 0),
          aria: "EPS surprise against report-day move for " + (season.fiscal || "the season"),
          guides: [{ axis: "x", value: -1 }, { axis: "x", value: 1 }],
          legend: legendHtml([
            { color: EARNINGS_COLOR.beat, label: "Beat, then rose" },
            { color: EARNINGS_COLOR["beat-fell"], label: "Beat, then fell" },
            { color: EARNINGS_COLOR.inline, label: "In line, ±1% surprise" },
            { color: EARNINGS_COLOR.miss, label: "Missed, then fell" },
            { color: EARNINGS_COLOR["miss-rose"], label: "Missed, then rose" },
          ]),
        }),
      "Vertical guides sit at the tracker’s existing ±1% in-line band. Dot color uses the stored EPS read and the stored report-day move, the same beat-but-fell and missed-but-rose split as the scoreboard. This plot follows the season selected above.",
    ));
  } catch (err) {
    fail(id, "Surprise against the report-day move", "The earnings plot could not be loaded (" + err.message + ").");
  }
}

const EVIDENCE_LABELS = {
  'sr-pos': ['Position within support and resistance', '% of range', 'grade', '0 is support; 100 is resistance. Values outside that range have broken the range.'],
  'sma-gap': ['Distance from the 20-day average', '%', 'grade', 'Positive means above the average; negative means below.'],
  'earn-pre': ['Price move before upcoming earnings', '%', 'earnings', 'The stored ten-session move before the next report.'],
  'earn-eps': ['Reported earnings surprise', '%', 'earnings', 'Reported EPS relative to the analyst estimate.'],
  'earn-run': ['Price run-up before a past report', '%', 'earnings', 'The stored fifteen-session price move before the report.'],
  'earn-tone': ['Management tone', 'tone', 'calls', '1 means optimistic/confident, 0 neutral or unclassified, and -1 cautious/defensive.'],
  'iv-z': ['Implied-volatility level', 'standard deviations', 'iv-trend', 'Current option volatility versus this company’s usual level. Direction also considers its recent change.'],
  'iv-5d': ['Five-session implied-volatility change', '%', 'iv-trend', 'How much option volatility changed over five sessions.'],
  flow: ['Flagged options buying balance', '$ net call minus put premium', 'flow', 'Positive means more flagged call-buying premium; negative means more put-buying premium.'],
  volume: ['Trading volume with price direction', '× usual volume', 'volume', 'The volume multiple takes the sign of the price move.'],
  gamma: ['Call/put open-interest ratio', '×', 'oi', 'This is an open-interest ratio, not gamma exposure.'],
  short: ['Change in reported short interest', '%', 'f13', 'A rise in short interest is not automatically a bullish reading.'],
  ats: ['Off-exchange share of trading', '%', 'f13', 'Share of trading reported through the alternative-trading-system source.'],
  insider: ['Open-market insider buying minus selling', '$', 'f13', 'Net value of qualifying transactions filed on the record date.'],
  inst: ['Reported institutional position change', '$', 'f13', 'Stored filing-based position-value change, which can be older than the daily record.'],
  attention: ['Social sentiment balance', 'percentage points', 'grade', 'Bullish minus bearish share of classified Stocktwits posts.'],
  news: ['News sentiment', 'tone', 'grade', '1 means bullish, 0 neutral, and -1 bearish in the stored news summary.'],
  narrative: ['Narrative membership balance', 'weighted score', 'narratives', 'Stored long membership minus short membership, weighted by narrative strength.'],
  rotation: ['Sector Rotation phase', 'phase code', 'rotation', '2 confirmed, 1 first thrust, 0 other phase, -1 late.'],
  peers: ['Overnight peer read-through', '%', 'overnight', 'Average beta-weighted peer move from the existing overnight model.'],
  inputs: ['Largest linked commodity move', '%', 'commodities', 'The strongest available daily or monthly move among linked commodity inputs.'],
  macro: ['Market stress', 'stress score', 'market', 'A rise means more market stress, not a bullish company signal.'],
  structure: ['Legacy price-structure reading', 'legacy units', 'grade', 'Older records mixed range position and distance from an average. Compare with care.'],
  earnings: ['Legacy earnings reading', 'legacy units', 'earnings', 'Older records mixed price moves, EPS surprise and management tone. They are excluded from the new metric histories.'],
  iv: ['Legacy volatility reading', 'legacy units', 'iv-trend', 'Older records mixed volatility z-scores and five-session percentage changes.'],
};

function sourceLink(tab, label, symbol) {
  const href = tab === 'grade' && symbol ? '?s=' + encodeURIComponent(symbol) : '?tab=' + encodeURIComponent(tab);
  return `<a class="book-source-link" href="${href}">${esc(label || 'Open source research')}</a>`;
}

function recordStamp(date) {
  if (!date) return 'Snapshot date unavailable';
  const day = String(date).slice(0, 10), today = etToday();
  return `Snapshot ${esc(date)}${day < today ? ' · earlier date' : day > today ? ' · future date' : ''}`;
}

function relationshipLabel(value) {
  const known = { hbm_gpu: 'HBM memory and GPUs', arm_ip: 'Arm architecture', gpu_rent: 'GPU rent' };
  return known[value] || String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function linkControls(map) {
  const nodes = map && map.nodes || {};
  const groups = Object.keys(nodes).filter((id) => nodes[id] && nodes[id].type !== 'ticker')
    .sort((a, b) => String(nodes[a].label || a).localeCompare(String(nodes[b].label || b)));
  if (state.linkNode && !groups.includes(state.linkNode)) state.linkNode = '';
  return `<div class="book-controls"><label>Company <input data-book-control="link-query" type="search" value="${esc(state.linkQuery)}" placeholder="e.g. NVDA" aria-label="Find company relationships" autocomplete="off" spellcheck="false"></label><label>Or explore a group <select data-book-control="link-node" aria-label="Relationship group"><option value="">Choose a group</option>${groups.map((id) => `<option value="${esc(id)}"${id === state.linkNode ? ' selected' : ''}>${esc(relationshipLabel(nodes[id].label || id))}</option>`).join('')}</select></label></div>`;
}

function linkResults(map, heatmap, selection = { query: state.linkQuery, node: state.linkNode }) {
  const nodes = map && map.nodes || {};
  const edges = map && Array.isArray(map.edges) ? map.edges : [];
  const query = String(selection.query || '').trim().toUpperCase();
  if (!query && !selection.node) return '<p class="book-note">Choose a company or group to see its stored relationships.</p>';
  const matches = (id) => { const symbol = String(nodes[id].symbol || '').toUpperCase(); return selection.exact ? symbol === query : symbol.startsWith(query); };
  const wanted = new Set(query ? Object.keys(nodes).filter((id) => nodes[id].type === 'ticker' && matches(id)) : [selection.node]);
  const returns = new Map(((heatmap && heatmap.tickers) || []).map((row) => [row.t, row]));
  const descriptions = {
    sector: ['Sector membership', 'tickers'], industry: ['Industry membership', 'tickers'], 'industry-sector': ['Industry group', 'tickers'],
    'spillover-group': ['Earnings read-through group', 'spillover'], 'spillover-etf': ['Sector reference ETF', 'spillover'],
    'overnight-member': ['Overnight peer group', 'overnight'], 'overnight-peer': ['Overnight market peer', 'overnight'], 'overnight-lead': ['Overnight reference market', 'overnight'],
    'narrative-long': ['Long membership in a narrative', 'narratives'], 'narrative-short': ['Short membership in a narrative', 'narratives'],
  };
  const hits = edges.filter((edge) => wanted.has(edge.from) || wanted.has(edge.to));
  const lines = hits.slice(0, 80).map((edge) => {
    const from = nodes[edge.from] || {}, to = nodes[edge.to] || {};
    const ticker = query ? (wanted.has(edge.from) ? from : to) : from.type === 'ticker' ? from : to.type === 'ticker' ? to : null;
    const subject = ticker || (wanted.has(edge.from) ? from : to);
    const other = subject === from ? to : from;
    const symbol = ticker ? ticker.symbol || ticker.label || '' : '';
    const title = symbol || relationshipLabel(subject.label || subject.type);
    const inputTab = { 'ai-capex':'ai-capex', 'ram-prices':'ram-prices', 'accelerator-prices':'accelerator-prices', commodities:'commodities' }[edge.src];
    const description = descriptions[edge.kind] || [edge.kind === 'input' ? 'Linked research input' : 'Stored membership', inputTab || 'tickers'];
    const row = returns.get(symbol);
    const d1 = row && row.ch != null ? pct(row.ch, 2) : '—';
    const w1 = row && row.perf && row.perf['1w'] != null ? pct(row.perf['1w'], 2) : '—';
    const returnsHtml = ticker ? `<em>Company return<br>1D ${esc(d1)} · 1W ${esc(w1)}</em>` : '';
    return `<li><b>${esc(title)}</b><span>${esc(relationshipLabel(other.label || other.symbol || other.type))}<small>${esc(description[0])}</small></span><small>As of ${esc(edge.asOf || 'unknown')} · ${sourceLink(inputTab || description[1], 'Explore research')}<details><summary>Source details</summary>${esc(edge.src || '')} · ${esc(edge.kind || '')}</details></small>${returnsHtml}</li>`;
  }).join('');
  return `<ul class="book-link-list">${lines}</ul>${!lines ? '<p class="book-note">No stored relationship matches this lookup.</p>' : ''}${hits.length > 80 ? `<p class="book-note">${hits.length - 80} more relationships match. Narrow the company search.</p>` : ''}`;
}

async function renderLink() {
  const id = 'book-link';
  try {
    const [map, heatmap] = await Promise.all([loadJson('link-map.json'), loadJson('heatmap.json').catch(() => null)]);
    mount(id, shell(id, 'Company relationships', `<p class="book-count">${recordStamp(map.bakeDate || map.asOf)}</p>${linkControls(map)}<div id="book-link-body">${linkResults(map, heatmap)}</div>`, 'Explore the sectors, peers, narratives and research inputs connected to a company. Membership alone does not measure impact or cause a price move. Company returns come from the stored heatmap; they are not relationship strength.'));
  } catch (err) { fail(id, 'Company relationships', 'Relationships could not be loaded (' + err.message + ').'); }
}

function evidenceBody(record, queryValue = state.evidenceQuery, exact = false) {
  const names = record && record.names || {};
  const query = String(queryValue || '').trim().toUpperCase();
  if (!query) return '<p class="book-note">Choose one company to inspect its evidence. The full archive is not expanded by default.</p>';
  const symbols = Object.keys(names).filter((symbol) => exact ? symbol === query : symbol.startsWith(query)).sort();
  const symbol = symbols.includes(query) ? query : symbols[0];
  if (!symbol) return '<p class="book-note">No stored company matches. Try a tracked symbol.</p>';
  const pieces = Array.isArray(names[symbol]) ? names[symbol] : [];
  const earlier = pieces.filter((piece) => piece.asOf && piece.asOf < record.date).length;
  const rows = pieces.map((piece) => {
    const definition = EVIDENCE_LABELS[piece.id] || [relationshipLabel(piece.id), 'stored units', 'grade', 'The source has not supplied a more detailed definition.'];
    const legacy = ['structure','earnings','iv'].includes(piece.id);
    const pending = piece.dir === 'pending';
    const baselineKnown = Number(record.version) >= 2;
    const direct = piece.id === 'earn-tone' || piece.id === 'iv-z' || piece.id === 'iv-5d';
    const read = pending ? 'Collecting history' : legacy ? 'Legacy metric' : !baselineKnown && piece.dir === 'neutral' ? 'Baseline status unavailable' : direct ? (piece.dir === 'up' ? 'Positive or rising reading' : piece.dir === 'down' ? 'Cautious or falling reading' : 'Neutral, mixed or unclassified') : piece.dir === 'up' ? 'Measure above its usual level' : piece.dir === 'down' ? 'Measure below its usual level' : 'No unusual deviation recorded';
    let value = piece.v == null ? 'Unavailable' : `${signed(piece.v, 2)} ${definition[1]}`;
    if (piece.v != null && piece.id === 'news') value = Number(piece.v) > 0 ? 'Bullish news tone' : Number(piece.v) < 0 ? 'Bearish news tone' : 'Neutral news tone';
    if (piece.v != null && piece.id === 'earn-tone') value = Number(piece.v) > 0 ? 'Confident or optimistic' : Number(piece.v) < 0 ? 'Cautious or defensive' : 'Neutral or unclassified';
    if (piece.v != null && piece.id === 'rotation') value = ({2:'Confirmed',1:'First thrust',0:'Other phase','-1':'Late'})[piece.v] || 'Unclassified phase';
    const explanation = pending ? 'Needs at least 20 prior observations of this same metric in the existing 60-day window.' : !baselineKnown && piece.dir === 'neutral' ? 'This older record did not distinguish missing history from a measured neutral result.' : definition[3];
    return `<article class="owner-evidence-piece"><div><h5>${esc(definition[0])}</h5><b>${esc(value)}</b><p>${esc(definition[3])}</p></div><div><strong>${esc(read)}</strong><p>${esc(explanation)}</p><small>Source date ${esc(piece.asOf || 'unavailable')}${piece.asOf && piece.asOf < record.date ? ' · older source' : ''}</small><br>${sourceLink(definition[2], null, symbol)}</div><details><summary>Stored fields</summary><p>${esc(piece.id)} · ${esc(piece.src)} · direction ${esc(piece.dir)} · strength ${esc(piece.str)} / 3${piece.rk != null ? ' · cross-company percentile '+esc(piece.rk) : ''} · first recorded ${esc(piece.firstSeen || 'unknown')}</p></details></article>`;
  }).join('');
  return `<section class="book-evidence-name"><h4>${esc(symbol)}</h4><p class="book-note">${pieces.length} recorded measurements${earlier ? ' · '+earlier+(earlier === 1 ? ' uses' : ' use')+' an older source date' : ''}. Direction describes the measurement, not necessarily the stock price. First recorded is the archive date, not necessarily the event date.</p>${rows || '<p class="book-note">No measurements were stored for this company.</p>'}</section>`;
}

async function renderEvidence() {
  const id = 'book-evidence';
  try {
    const latest = await loadJson('evidence-latest.json');
    if (!latest || typeof latest.key !== 'string') throw new Error('The record pointer is missing');
    const record = await loadJson(latest.key);
    const symbols = Object.keys(record.names || {}).sort();
    mount(id, shell(id, 'Evidence record', `<p class="book-count">${recordStamp(record.date)} · ${symbols.length} companies</p><div class="book-controls"><label>Company <input data-book-control="evidence-query" type="search" list="owner-evidence-symbols" value="${esc(state.evidenceQuery)}" placeholder="Choose a symbol" aria-label="Find a name in the evidence record" autocomplete="off" spellcheck="false"><datalist id="owner-evidence-symbols">${symbols.map((symbol) => `<option value="${esc(symbol)}"></option>`).join('')}</datalist></label></div><div id="book-evidence-body">${evidenceBody(record)}</div>`, 'Inspect what was measured, its source date and whether the history supports a comparison. No new analysis or model call runs when you open this record.'));
  } catch (err) { fail(id, 'Evidence record', 'The evidence record could not be loaded (' + err.message + ').'); }
}

// One row per grader observation for the day, optionally narrowed to a ticker
// prefix (the Diagnostics search) or one exact ticker (the company record).
function rejectionRecords(day, queryValue, exact = false) {
  const query = String(queryValue || '').trim().toUpperCase();
  const entries = new Map();
  // Each bucket keeps its first observation of the day. Only a matching
  // timestamp proves that a pass and timing record describe the same run.
  const keyFor = (item, bucket) => [item.sym, item.side, item.asOf || 'undated-' + bucket].join(':');
  for (const item of Array.isArray(day.passed) ? day.passed : []) entries.set(keyFor(item, 'pass'), { ...item, thesisPassed: true });
  for (const item of Array.isArray(day.records) ? day.records : []) {
    const key = keyFor(item, 'decision');
    entries.set(key, { ...(entries.get(key) || {}), ...item });
  }
  return [...entries.values()].filter((item) => { const sym = String(item.sym || '').toUpperCase(); return !query || (exact ? sym === query : sym.startsWith(query)); }).sort((a, b) => String(a.sym).localeCompare(String(b.sym)) || String(a.side).localeCompare(String(b.side)) || String(a.asOf || '').localeCompare(String(b.asOf || '')));
}

function rejectionTable(records) {
  const rows = records.map((item) => {
    const thesis = item.kind === 'reject' ? 'Rejected' : item.thesisPassed || ['strong','moderate','weak'].includes(item.grade) ? 'Passed' : 'Not recorded';
    const entry = item.kind === 'reject' ? 'Blocked' : item.kind === 'wait-heldback' ? 'Wait · held back' : item.kind === 'wait' || item.entryVerdict === 'wait' ? 'Wait for entry' : item.entryVerdict === 'buy-now' ? 'Entry cleared' : 'Not recorded';
    const stamp = new Date(item.asOf || '');
    const recordedAt = Number.isFinite(stamp.getTime()) ? stamp.toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}) : 'Time not recorded';
    return `<tr><td>${esc(item.sym)}</td><td>${esc(item.side)}</td><td>${esc(recordedAt)}</td><td>${esc(thesis)}</td><td>${esc(item.grade || '—')}</td><td>${esc(entry)}</td><td>${item.total == null ? '—' : esc(signed(item.total, 1))}</td><td>${item.spot == null ? '—' : esc(money(item.spot))}</td><td>${esc(item.entryReason || 'No explanatory note stored.')}</td></tr>`;
  }).join('');
  return rows ? `<div class="book-table-wrap"><table class="book-table"><thead><tr><th>Company</th><th>Side</th><th>Recorded at</th><th>Thesis result</th><th>Thesis quality</th><th>Entry timing</th><th>Total</th><th>Recorded spot</th><th>Explanation</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="book-note">No grader decisions match this view.</p>';
}

async function renderRejections() {
  const id = 'book-rejections';
  try {
    const latest = await loadJson('ai-rejections-latest.json');
    if (!latest || typeof latest.key !== 'string') throw new Error('The grader-log pointer is missing');
    const day = await loadJson(latest.key);
    const records = rejectionRecords(day, state.rejectQuery);
    const table = rejectionTable(records);
    mount(id, shell(id, 'AI grader log', `<p class="book-count">${recordStamp(day.date || latest.date)} · ${records.length} recorded observation${records.length === 1 ? '' : 's'}</p><div class="book-controls">${searchField('reject-query', 'Ticker', state.rejectQuery, 'NVDA')}</div>${table}<details><summary>Original daily log</summary><pre class="owner-raw-record">${esc(JSON.stringify(day, null, 2))}</pre></details>`, 'Thesis quality and entry timing are separate decisions. A thesis can pass while entry timing still says wait. Different recorded times stay separate, including a rejection followed by a later pass. These are historical decisions, not a new live assessment.'));
  } catch (err) { fail(id, 'AI grader log', 'The grader log could not be loaded (' + err.message + ').'); }
}

// The Unified Signal Engine's "Company record" view: the three stored records
// above for one exact ticker, each loading (or failing) on its own. Uses the
// same Owner-only reads and cache as Diagnostics; no new data or model call.
async function companyRecord(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const part = async (title, note, run) => {
    let body;
    try { body = await run(); } catch (err) { body = `<p class="book-note">${esc(title)} could not be loaded (${esc(err && err.message || 'request failed')}).</p>`; }
    return `<section class="use-record-part"><h4>${esc(title)}</h4><p class="use-muted">${esc(note)}</p>${body}</section>`;
  };
  const parts = await Promise.all([
    part('Stored evidence record', 'What was measured for this company, its source date and whether the history supports a comparison.', async () => {
      const latest = await loadJson('evidence-latest.json');
      if (!latest || typeof latest.key !== 'string') throw new Error('The record pointer is missing');
      const record = await loadJson(latest.key);
      return `<p class="book-count">${recordStamp(record.date)}</p>${evidenceBody(record, sym, true)}`;
    }),
    part('Company relationships', 'Sectors, peers, narratives and research inputs linked to this company. Membership alone does not measure impact.', async () => {
      const [map, heatmap] = await Promise.all([loadJson('link-map.json'), loadJson('heatmap.json').catch(() => null)]);
      return `<p class="book-count">${recordStamp(map.bakeDate || map.asOf)}</p>${linkResults(map, heatmap, { query: sym, node: '', exact: true })}`;
    }),
    part('AI grader log', 'Thesis quality and entry timing are separate decisions. These are historical decisions, not a new live assessment.', async () => {
      const latest = await loadJson('ai-rejections-latest.json');
      if (!latest || typeof latest.key !== 'string') throw new Error('The grader-log pointer is missing');
      const day = await loadJson(latest.key);
      const records = rejectionRecords(day, sym, true);
      return `<p class="book-count">${recordStamp(day.date || latest.date)} · ${records.length} recorded observation${records.length === 1 ? '' : 's'}</p>${records.length ? rejectionTable(records) : '<p class="book-note">The grader did not review this company in the latest daily log.</p>'}`;
    }),
  ]);
  return parts.join('');
}

const ownerRecords = {
  'book-evidence': { title: 'Evidence record', run: renderEvidence, owns: key => key === 'evidence-latest.json' || key.startsWith('evidence/') },
  'book-link': { title: 'Company relationships', run: renderLink, owns: key => key === 'link-map.json' || key === 'heatmap.json' },
  'book-rejections': { title: 'AI grader log', run: renderRejections, owns: key => key === 'ai-rejections-latest.json' || key.startsWith('ai-rejections/') },
};
const ownerLoaded = new Set();
const ownerPending = new Set();
let ownerRefreshing = false;
function updateOwnerRefreshButton() {
  const button = document.querySelector('[data-owner-diagnostics-refresh]');
  if (button) button.disabled = ownerRefreshing || ownerPending.size > 0;
}
async function loadOwnerRecord(id) {
  if (ownerPending.has(id)) return;
  ownerPending.add(id);
  updateOwnerRefreshButton();
  try { await ownerRecords[id].run(); }
  finally { ownerPending.delete(id); updateOwnerRefreshButton(); }
}
function prepareOwnerRecords() {
  for (const [id, record] of Object.entries(ownerRecords)) {
    if ($(id) && !$(id).querySelector('[data-book-panel]')) mount(id, shell(id, record.title, '<p class="book-note">Open to load this stored record.</p>'));
  }
}
async function refreshOwnerRecords(onlyId) {
  if (ownerRefreshing || ownerPending.size) return;
  const ids = Object.keys(ownerRecords).filter((id) => onlyId ? id === onlyId : $(id) && $(id).querySelector('[data-book-panel]')?.open);
  const status = $('owner-diagnostics-status');
  if (!ids.length) { if (status) status.textContent = 'Open a record first. Closed records are not fetched.'; return; }
  ownerRefreshing = true;
  updateOwnerRefreshButton();
  if (status) status.textContent = 'Refreshing the opened records…';
  for (const key of cache.keys()) if (ids.some(id => ownerRecords[id].owns(key))) cache.delete(key);
  try {
    await Promise.all(ids.map((id) => { ownerLoaded.add(id); return loadOwnerRecord(id); }));
    if (status) status.textContent = 'Refresh finished. Check the snapshot dates and any load errors below. Records stay on this snapshot until you refresh again.';
  } finally { ownerRefreshing = false; updateOwnerRefreshButton(); }
}

const runners = {
  heatmap: () => Promise.all([renderBreadth(), renderGrade()]),
  calendar: renderCalendar,
  narratives: renderNarratives,
  "iv-trend": () => Promise.all([renderIvHist(), renderIvPrice()]),
  oi: renderWalls,
  streaks: renderStreaks,
  spillover: renderSpill,
  "ma-tracker": renderMa,
  earnings: renderEarnings,
  quant: prepareOwnerRecords,
};

const started = new Set();

function openTab(id) {
  const run = runners[id];
  if (!run) return;
  if (id === 'quant') {
    const panel = $('owner-panel-diagnostics');
    if (!panel || panel.hidden) return;
    prepareOwnerRecords();
    return;
  }
  if (started.has(id)) return;
  const pane = $("page-pane-" + id);
  if (!pane || pane.hidden) return;
  started.add(id);
  Promise.resolve(run()).catch(() => started.delete(id));
}

function activeTab() {
  const params = new URLSearchParams(window.location.search);
  return params.get("tab") || "home";
}

function boot() {
  const go = () => openTab(activeTab());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
  document.addEventListener("stonks-owner-ready", () => { started.clear(); setTimeout(go, 0); });
  document.addEventListener("toggle", (event) => {
    const panel = event.target && event.target.getAttribute && event.target.getAttribute("data-book-panel");
    if (panel) state.open[panel] = event.target.open;
    if (panel && ownerRecords[panel] && event.target.open && !ownerLoaded.has(panel)) {
      ownerLoaded.add(panel); loadOwnerRecord(panel);
    }
  }, true);
  document.addEventListener("pointerover", (event) => {
    const tip = event.target.closest && event.target.closest("[data-book-tip]");
    const panel = event.target.closest && event.target.closest(".book-details");
    if (!panel) return;
    const readout = panel.querySelector(".book-hover-readout");
    if (!readout) return;
    readout.textContent = tip ? (tip.getAttribute("data-book-tip") || "") : "";
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-owner-diagnostics-refresh]')) { refreshOwnerRecords(); return; }
    const retry = event.target.closest('[data-owner-record-retry]');
    if (retry) { refreshOwnerRecords(retry.getAttribute('data-owner-record-retry')); return; }
    const tab = event.target.closest && event.target.closest("[data-page-tab]");
    if (tab) {
      const id = tab.getAttribute("data-page-tab");
      const show = () => openTab(id);
      setTimeout(show, 0);
      setTimeout(show, 80);
    }
    if (event.target.closest && event.target.closest("[data-ers-season]")) {
      started.delete("earnings");
      setTimeout(() => openTab("earnings"), 60);
    }
    const action = event.target.closest && event.target.closest("[data-book-action]");
    if (action && action.getAttribute("data-book-action") === "walls-all") {
      state.wallsAll = !state.wallsAll;
      renderWalls();
    }
    if (action && action.getAttribute("data-book-action") === "grade-sector") {
      const sector = action.getAttribute("data-grade-sector") || "all";
      state.gradeSector = state.gradeSector === sector && sector !== "all" ? "all" : sector;
      renderGrade();
    }
    if (action && action.getAttribute("data-book-action") === "grade-sort") {
      const key = action.getAttribute("data-grade-sort") || "x";
      if (state.gradeSort === key) state.gradeSortDir = state.gradeSortDir === "asc" ? "desc" : "asc";
      else {
        state.gradeSort = key;
        state.gradeSortDir = key === "symbol" || key === "sector" || key === "side" ? "asc" : "desc";
      }
      renderGrade();
    }
    if (action && action.getAttribute("data-book-action") === "grade-focus") {
      const symbol = action.getAttribute("data-symbol") || "";
      state.gradeQuery = state.gradeQuery === symbol ? "" : symbol;
      renderGrade();
    }
  });
  document.addEventListener("change", (event) => {
    const control = event.target.closest && event.target.closest("[data-book-control]");
    if (!control) return;
    const name = control.getAttribute("data-book-control");
    if (name === "grade-period") { state.gradePeriod = control.value; renderGrade(); }
    if (name === "grade-side") { state.gradeSide = control.value; renderGrade(); }
    if (name === "grade-sector") { state.gradeSector = control.value; renderGrade(); }
    if (name === "grade-band") { state.gradeBand = control.value; renderGrade(); }
    if (name === "grade-scale") { state.gradeScale = control.value; renderGrade(); }
    if (name === "grade-sort") {
      state.gradeSort = control.value;
      state.gradeSortDir = control.value === "symbol" || control.value === "sector" || control.value === "side" ? "asc" : "desc";
      renderGrade();
    }
    if (name === "ma-period") { state.maPeriod = control.value; renderMa(); }
    if (name === "wall-sort") { state.wallSort = control.value; renderWalls(); }
    if (name === "link-node") {
      state.linkNode = control.value;
      state.linkQuery = "";
      const field = document.querySelector("[data-book-control='link-query']");
      if (field) field.value = "";
      refreshLink();
    }
  });
  document.addEventListener("input", (event) => {
    const control = event.target.closest && event.target.closest("[data-book-control]");
    if (!control) return;
    const name = control.getAttribute("data-book-control");
    if (name === "link-query") { state.linkQuery = control.value; refreshLink(); }
    if (name === "evidence-query") { state.evidenceQuery = control.value; refreshEvidence(); }
    if (name === "grade-query") { state.gradeQuery = control.value; renderGrade(); }
    if (name === "iv-query") { state.ivQuery = control.value; renderIvPrice(); }
    if (name === "iv-lookup") { state.ivLookup = control.value; renderIvHist(); }
    if (name === "streak-query") { state.streakQuery = control.value; renderStreaks(); }
    if (name === "earn-query") { state.earnQuery = control.value; renderEarnings(); }
    if (name === "narr-query") { state.narrQuery = control.value; renderNarratives(); }
    if (name === "spill-query") { state.spillQuery = control.value; renderSpill(); }
    if (name === "breadth-query") { state.breadthQuery = control.value; renderBreadth(); }
    if (name === "wall-query") { state.wallQuery = control.value; renderWalls(); }
    if (name === "ma-lookup") { state.maLookup = control.value; renderMa(); }
    if (name === "reject-query") { state.rejectQuery = control.value; renderRejections(); }
  });
}

async function refreshLink() {
  const body = $("book-link-body");
  if (!body) return;
  try {
    const [map, heatmap] = await Promise.all([loadJson("link-map.json"), loadJson("heatmap.json").catch(() => null)]);
    body.innerHTML = linkResults(map, heatmap);
  } catch (err) {
    body.innerHTML = `<p class="book-note">${esc(err.message)}</p>`;
  }
}

async function refreshEvidence() {
  const body = $("book-evidence-body");
  if (!body) return;
  try {
    const latest = await loadJson("evidence-latest.json");
    const record = await loadJson(latest.key);
    body.innerHTML = evidenceBody(record);
  } catch (err) {
    body.innerHTML = `<p class="book-note">${esc(err.message)}</p>`;
  }
}

if (typeof document !== "undefined") {
  window.BookViews = { renderLink, renderEvidence, renderRejections, openTab, companyRecord };
  boot();
}

export { calendarCoveredDays, windowGradeSamples, gradeSpark, evidenceBody, linkResults, rejectionRecords, EVIDENCE_LABELS };
