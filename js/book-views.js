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
  mount(id, shell(id, title, `<p class="book-note">${esc(detail)}</p>`));
}

function shell(id, title, body, note) {
  const open = state.open[id] !== false;
  return `<details class="book-details" data-book-panel="${esc(id)}"${open ? " open" : ""}>` +
    `<summary class="book-summary"><span class="book-kicker">Additional view</span><span class="book-title">${esc(title)}</span></summary>` +
    `<div class="book-body">${note ? `<p class="book-note">${note}</p>` : ""}${body}</div></details>`;
}

function searchField(control, label, value, placeholder) {
  return `<label>${esc(label)} <input data-book-control="${esc(control)}" type="search" value="${esc(value || "")}" placeholder="${esc(placeholder || "Ticker")}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false"></label>`;
}

const cache = new Map();

function isOwnerKey(key) {
  return key === "link-map.json" || key === "evidence-latest.json" || key === "ai-rejections-latest.json" ||
    key.startsWith("evidence/") || key.startsWith("ai-rejections/");
}

function loadJson(key) {
  if (cache.has(key)) return cache.get(key);
  const task = (async () => {
    const urls = isOwnerKey(key)
      ? ["/api/auth/me?data=" + encodeURIComponent(key), "data/" + key]
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
  "#d9a533", "#5b9bd6", "#af8df0", "#e0a080", "#7dcea0", "#c9a27c",
  "#8fb8c9", "#d4b483", "#b0a8d6", "#a3c4bc", "#e6c3b0", "#9bb7c9",
];

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
    marks += `<circle class="${dim ? "is-dim" : "is-hit"}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${point.color}"><title>${esc(point.label)}</title></circle>`;
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
  const svg = `<svg class="book-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.aria)}" data-ch="${esc(JSON.stringify(hoverHits.length ? hoverHits : hover))}">${guides}${marks}</svg>`;
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

function gradePoints(heatmap, grades, period) {
  const rows = heatmap && Array.isArray(heatmap.tickers) ? heatmap.tickers : [];
  const book = grades && grades.grades && typeof grades.grades === "object" ? grades.grades : {};
  const sectors = [];
  const points = [];
  let missing = 0;
  for (const row of rows) {
    const symbol = String(row && row.t || "").toUpperCase();
    const grade = book[symbol];
    const x = heatmapReturn(row, period);
    const y = grade ? num(grade.total) : null;
    if (!symbol || x == null || y == null) { missing += 1; continue; }
    const sector = String(row.s || grade.sector || "Other");
    if (!sectors.includes(sector)) sectors.push(sector);
    points.push({
      symbol, x, y, sector,
      mc: num(row.mc) || 0,
      side: grade.side || "",
    });
  }
  const mcs = points.map((point) => point.mc).filter((value) => value > 0);
  const lo = mcs.length ? Math.min(...mcs) : 0;
  const hi = mcs.length ? Math.max(...mcs) : 1;
  return {
    missing,
    sectors,
    points: points.map((point) => {
      const color = SECTOR_COLORS[Math.max(0, sectors.indexOf(point.sector)) % SECTOR_COLORS.length];
      const radius = hi === lo || point.mc <= 0
        ? 4.5
        : 3.2 + 5.2 * Math.sqrt((point.mc - lo) / (hi - lo));
      const side = point.side === "call" ? "call" : point.side === "put" ? "put" : "no side";
      return {
        symbol: point.symbol,
        x: point.x,
        y: point.y,
        r: radius,
        color,
        hit: "Grade " + signed(point.y, 1) + " · " + pct(point.x, 2) + " · " + point.sector + " · " + side,
        label: point.symbol + "\nGrade total " + signed(point.y, 1) + "\n" + pct(point.x, 2) + "\n" + point.sector + " · " + side,
      };
    }),
  };
}

async function renderGrade() {
  const id = "book-grade-return";
  try {
    const [heatmap, grades] = await Promise.all([loadJson("heatmap.json"), loadJson("grades.json")]);
    const period = state.gradePeriod;
    const label = (GRADE_PERIODS.find((item) => item[0] === period) || GRADE_PERIODS[2])[1];
    const built = gradePoints(heatmap, grades, period);
    const options = GRADE_PERIODS.map(([value, text]) =>
      `<option value="${value}"${value === period ? " selected" : ""}>${text}</option>`).join("");
    const plot = scatterHtml({
      points: built.points,
      query: state.gradeQuery,
      xName: label + " stored on the heatmap",
      yName: "Stored grade total",
      xFmt: (value) => pct(value, 0),
      yFmt: (value) => signed(value, 0),
      aria: "Grade total against " + label + " for tracked names",
      legend: legendHtml(built.sectors.map((sector, index) => ({
        color: SECTOR_COLORS[index % SECTOR_COLORS.length],
        label: sector,
      }))),
    });
    mount(id, shell(
      id,
      "Grade total against the stored return",
      `<div class="book-controls"><label>Return window <select data-book-control="grade-period" aria-label="Return window for the grade plot">${options}</select></label>${searchField("grade-query", "Ticker", state.gradeQuery, "NVDA")}<span class="book-count">${built.points.length} names${built.missing ? " · " + built.missing + " missing a grade or this return" : ""}</span></div>${plot}`,
      "The vertical axis is the stored grade total. That total already includes the pillars, entry timing, IV cost, and the regime overlay. Dot size is heatmap market cap and color is the heatmap sector. Hover a dot for that name’s stored grade and return. The plot does not compute a residual or a new rank.",
    ));
  } catch (err) {
    fail(id, "Grade total against the stored return", "The grade plot could not be loaded (" + err.message + ").");
  }
}

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
      : `<p class="book-readout">${esc(found.symbol)} · percentile ${num(found.pctile) == null ? "—" : Math.round(found.pctile)} · ${esc(ivTier(found) === "other" ? "no tier" : ivTier(found))} · IV ${num(found.iv) == null ? "—" : (found.iv * 100).toFixed(1) + "%"} · 5-session ${pct(found.chg5dPct, 1)}</p>`;
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
          { color: "var(--muted-strong)", label: "Elevated" },
          { color: "var(--muted)", label: "No tier" },
        ]),
      plotted + " names use the stored IV percentile. " + (skipped ? skipped + " names have no percentile and are left out. " : "") +
        "Color is the stored tier. Elevated is used only when a name has no surging, trending, or building tier. Hover a column for its count. The ranked cards above are unchanged.",
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
            { color: "var(--muted-strong)", label: "Elevated" },
            { color: "var(--muted)", label: "No tier" },
          ]),
        }),
      "The two windows are not the same length. The horizontal axis is the stored 1-week price return. The vertical axis is the stored 5-session IV change. Hover a dot for that name. The plot does not score a divergence and does not change who is tiered.",
    ));
  } catch (err) {
    fail(id, "5-session IV change against the 1-week price return", "The IV and price plot could not be loaded (" + err.message + ").");
  }
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
    const events = data && Array.isArray(data.events) ? data.events : [];
    const start = etToday();
    const days = [];
    for (let i = 0; i < 21; i++) {
      const date = addDays(start, i);
      if (date) days.push(date);
    }
    const counts = new Map(days.map((date) => [date, { earnings: 0, report: 0, fomc: 0, catalyst: 0, macro: 0, total: 0, names: [] }]));
    for (const event of events) {
      const date = String(event && event.date || "").slice(0, 10);
      const bucket = counts.get(date);
      if (!bucket) continue;
      const key = calendarBucket(event);
      bucket[key] += 1;
      bucket.total += 1;
      const label = event.symbol || event.title || key;
      if (label && bucket.names.length < 8) bucket.names.push(String(label));
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
      "Counts use the calendar’s stored event types for the 21 days beginning " + dayLabel(start) + " ET. " + total + " events in the window. Hover a day to see the stored names. Fed speeches and FOMC share the Fed color already used by the calendar filter. No crowded-day score is added.",
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
      `<div class="book-controls">${searchField("wall-query", "Ticker", state.wallQuery, "EBAY")}<label>Sort <select data-book-control="wall-sort" aria-label="Sort wall ranges">${sorts.map(([value, text]) => `<option value="${value}"${state.wallSort === value ? " selected" : ""}>${text}</option>`).join("")}</select></label><span class="book-count">${visible.length} of ${ranked.length}</span></div>` +
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
      `<div class="book-controls"><label>Average <select data-book-control="ma-period" aria-label="Moving average for the distance histogram">${options}</select></label>${searchField("ma-lookup", "Ticker", state.maLookup, "AAOI")}<span class="book-count">${plotted} names · ${inside} inside ±5% · ${above} above · ${below} below${missing ? " · " + missing + " missing a level" : ""}</span></div>${lookupHtml}<div class="book-cols" role="img" aria-label="Distance to the ${period}-day average">${columns}</div><p class="book-hover-readout" aria-live="polite"></p>`,
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

function linkControls(map) {
  const nodes = map && map.nodes && typeof map.nodes === "object" ? map.nodes : {};
  const groups = Object.keys(nodes)
    .filter((id) => nodes[id] && nodes[id].type !== "ticker")
    .sort((a, b) => String(nodes[a].type).localeCompare(String(nodes[b].type)) || String(nodes[a].label || a).localeCompare(String(nodes[b].label || b)));
  if (!state.linkNode || !groups.includes(state.linkNode)) state.linkNode = groups[0] || "";
  const options = groups.map((id) => {
    const node = nodes[id];
    return `<option value="${esc(id)}"${id === state.linkNode ? " selected" : ""}>${esc((node.type || "group") + " · " + (node.label || id))}</option>`;
  }).join("");
  return `<div class="book-controls"><label>Stored input <select data-book-control="link-node" aria-label="Link map input">${options}</select></label><label>Ticker <input data-book-control="link-query" type="search" value="${esc(state.linkQuery)}" placeholder="Symbol" aria-label="Filter link map by ticker" autocomplete="off" spellcheck="false"></label></div>`;
}

function linkResults(map, heatmap) {
  const nodes = map && map.nodes && typeof map.nodes === "object" ? map.nodes : {};
  const edges = map && Array.isArray(map.edges) ? map.edges : [];
  const returns = new Map();
  for (const row of (heatmap && heatmap.tickers) || []) {
    const symbol = String(row && row.t || "").toUpperCase();
    if (symbol) returns.set(symbol, { d1: heatmapReturn(row, "1d"), w1: heatmapReturn(row, "1w") });
  }
  const query = state.linkQuery.trim().toUpperCase();
  const nodeId = state.linkNode;
  const wanted = new Set();
  if (query) {
    for (const [id, node] of Object.entries(nodes)) {
      if (node && node.type === "ticker" && String(node.symbol || "").toUpperCase().startsWith(query)) wanted.add(id);
    }
  } else if (nodeId) wanted.add(nodeId);
  const hits = edges.filter((edge) => wanted.has(edge.from) || wanted.has(edge.to));
  const lines = hits.slice(0, 80).map((edge) => {
    const from = nodes[edge.from] || {};
    const to = nodes[edge.to] || {};
    const ticker = from.type === "ticker" ? from : to.type === "ticker" ? to : null;
    const other = ticker && ticker === from ? to : from;
    const symbol = ticker && ticker.symbol ? ticker.symbol : "";
    const ret = returns.get(symbol) || {};
    const move = symbol
      ? "1D " + pct(ret.d1, 2) + " · 1W " + pct(ret.w1, 2)
      : "";
    return `<li><b>${esc(symbol || other.label || edge.to)}</b><span>${esc(other.label || other.type || "")}</span><small>${esc([edge.src, edge.kind, edge.asOf].filter(Boolean).join(" · "))}</small><em>${esc(move)}</em></li>`;
  }).join("");
  const hidden = hits.length > 80 ? `<p class="book-note">${hits.length - 80} more stored edges match. Narrow the ticker.</p>` : "";
  const empty = lines ? "" : `<p class="book-note">No stored edge matches this lookup.</p>`;
  return `<ul class="book-link-list">${lines}</ul>${empty}${hidden}`;
}

async function renderLink() {
  const id = "book-link";
  if (!$(id)) return;
  try {
    const [map, heatmap] = await Promise.all([loadJson("link-map.json"), loadJson("heatmap.json").catch(() => null)]);
    mount(id, shell(
      id,
      "Link map lookup",
      `${linkControls(map)}<div id="book-link-body">${linkResults(map, heatmap)}</div>`,
      "Edges are the stored joins, with the source and as-of date already stamped on each edge. Returns, when shown, are the heatmap’s stored 1D and 1W figures. The map is not a beta and is not an input to a grade.",
    ));
  } catch (err) {
    fail(id, "Link map lookup", "The link map is not available in this session (" + err.message + ").");
  }
}

function evidenceBody(record) {
  const names = record && record.names && typeof record.names === "object" ? record.names : {};
  const query = state.evidenceQuery.trim().toUpperCase();
  const symbols = Object.keys(names).filter((symbol) => !query || symbol.startsWith(query)).sort();
  const shown = symbols.slice(0, 12);
  const cards = shown.map((symbol) => {
    const pieces = Array.isArray(names[symbol]) ? names[symbol] : [];
    const rows = pieces.map((piece) => {
      const bits = [piece.dir || "neutral", "strength " + (num(piece.str) == null ? "—" : Math.round(piece.str))];
      if (num(piece.v) != null) bits.push("value " + signed(piece.v, 2).replace("+", ""));
      if (num(piece.rk) != null) bits.push("rank " + Math.round(piece.rk));
      if (piece.asOf) bits.push("as of " + piece.asOf);
      if (piece.firstSeen) bits.push("first seen " + piece.firstSeen);
      return `<li><b>${esc(piece.id || "piece")}</b><small>${esc(piece.src || "")}</small><span>${esc(bits.join(" · "))}</span></li>`;
    }).join("");
    return `<section class="book-evidence-name"><h4>${esc(symbol)}</h4><ul>${rows || "<li>No pieces stored</li>"}</ul></section>`;
  }).join("");
  const more = symbols.length > shown.length ? `<p class="book-note">${symbols.length - shown.length} more names match. Keep typing.</p>` : "";
  return `${cards || `<p class="book-note">No stored name matches.</p>`}${more}`;
}

async function renderEvidence() {
  const id = "book-evidence";
  if (!$(id)) return;
  try {
    const latest = await loadJson("evidence-latest.json");
    const key = latest && typeof latest.key === "string" ? latest.key : "";
    if (!key) {
      fail(id, "Evidence record", "The evidence pointer does not name a day file.");
      return;
    }
    const record = await loadJson(key);
    const names = record && record.names && typeof record.names === "object" ? Object.keys(record.names).length : 0;
    mount(id, shell(
      id,
      "Evidence record",
      `<div class="book-controls"><label>Ticker <input data-book-control="evidence-query" type="search" value="${esc(state.evidenceQuery)}" placeholder="Symbol" aria-label="Find a name in the evidence record" autocomplete="off" spellcheck="false"></label><span class="book-count">${names} names · record ${esc(record.date || "")}</span></div><div id="book-evidence-body">${evidenceBody(record)}</div>`,
      "Each line is a stored evidence piece: direction, strength, value, rank, as-of, and first seen. Nothing here is rescored, and nothing is sent back into a grade.",
    ));
  } catch (err) {
    fail(id, "Evidence record", "The evidence record is not available in this session (" + err.message + ").");
  }
}

async function renderRejections() {
  const id = "book-rejections";
  if (!$(id)) return;
  try {
    const latest = await loadJson("ai-rejections-latest.json");
    const key = latest && typeof latest.key === "string" ? latest.key : "";
    if (!key) {
      fail(id, "AI grader log", "The grader-log pointer does not name a day file.");
      return;
    }
    const day = await loadJson(key);
    const q = state.rejectQuery.trim().toUpperCase();
    const records = (Array.isArray(day.records) ? day.records : []).filter((item) => !q || String(item.sym || "").toUpperCase().startsWith(q));
    const passed = (Array.isArray(day.passed) ? day.passed : []).filter((item) => !q || String(item.sym || "").toUpperCase().startsWith(q));
    const row = (item, kind) => `<tr><td>${esc(item.sym || "")}</td><td>${esc(item.side || "")}</td><td>${esc(kind || item.kind || "")}</td><td>${esc(item.grade || "—")}</td><td>${esc(signed(item.total, 1))}</td><td>${esc(money(item.spot))}</td><td>${esc(item.entryReason || item.entryVerdict || "—")}</td></tr>`;
    const table = (title, list, kind) => `<h4>${esc(title)} <span>${list.length}</span></h4>` +
      (list.length ? `<div class="book-table-wrap"><table class="book-table"><thead><tr><th>Name</th><th>Side</th><th>Record</th><th>Grade</th><th>Total</th><th>Spot</th><th>Stored note</th></tr></thead><tbody>${list.map((item) => row(item, kind || item.kind)).join("")}</tbody></table></div>` : `<p class="book-note">None stored for this day.</p>`);
    mount(id, shell(
      id,
      "AI grader log",
      `<div class="book-controls">${searchField("reject-query", "Ticker", state.rejectQuery, "NVDA")}<span class="book-count">Record ${esc(day.date || latest.date || "")}</span></div>${table("Rejected or told to wait", records)}${table("Passed the grader the same day", passed, "passed")}`,
      "This is the stored day log. Grade, total, spot, and the note are the values written that day. The log is not folded back into the live grade.",
    ));
  } catch (err) {
    fail(id, "AI grader log", "The grader log is not available in this session (" + err.message + ").");
  }
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
  quant: () => Promise.all([renderLink(), renderEvidence(), renderRejections()]),
};

const started = new Set();

function whenOwnerSettled() {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const group = document.querySelector("[data-role-group='owner']");
      if (!group || group.hidden === false || Date.now() - start > 6000) resolve();
      else setTimeout(tick, 40);
    };
    tick();
  });
}

function openTab(id) {
  const run = runners[id];
  if (!run || started.has(id)) return;
  if (id === "quant") {
    started.add(id);
    whenOwnerSettled().then(() => {
      if (!$("page-pane-quant")) return;
      return run();
    }).catch(() => started.delete(id));
    return;
  }
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
  document.addEventListener("toggle", (event) => {
    const panel = event.target && event.target.getAttribute && event.target.getAttribute("data-book-panel");
    if (panel) state.open[panel] = event.target.open;
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
  });
  document.addEventListener("change", (event) => {
    const control = event.target.closest && event.target.closest("[data-book-control]");
    if (!control) return;
    const name = control.getAttribute("data-book-control");
    if (name === "grade-period") { state.gradePeriod = control.value; renderGrade(); }
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

window.BookViews = { renderLink, renderEvidence, renderRejections, openTab };
boot();
