// AI disruption tracker, Phase 1 (2026-11-16): reads the labs' official
// release-note pages and news feeds (labs.json, each source's `read` block)
// and returns dated posts. Three readers cover every source:
//
//   feed   RSS or Atom (OpenAI news, Workspace updates, the Microsoft blog,
//          the GitHub changelog, Meta's newsroom)
//   dated  a release-notes page with one heading per date and the notes under
//          it (ChatGPT, Claude and Gemini release notes)
//   cards  a news index with one card per post: a link, a headline and a date
//          (Anthropic news, xAI news)
//
// Free, keyless public reads; no AI. Every source fails on its own: a page that
// times out, refuses the request or changes its layout yields no posts and a
// health row, and the other sources carry on. Parsers are pure and exported
// for the offline smoke test.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthOf = (w) => MONTHS[String(w).slice(0, 4).toLowerCase()] ?? MONTHS[String(w).slice(0, 3).toLowerCase()];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
};

// "November 12, 2026", "Nov 9, 2026", "12 Nov 2026", "Tue, 27 Oct 2026 16:05:50
// +0000", "2026-11-12T08:00:00Z", "2026.11.19" (Gemini's release notes) or
// "2026/11/19". The calendar date as written, never shifted through a time zone.
export function parseDateText(s) {
  const t = String(s || "");
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})/) || t.match(/\b(\d{4})([./])(\d{2})\2(\d{2})\b/);
  if (m && m.length === 5) return ymd(+m[1], +m[3], +m[4]);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && monthOf(m[1])) return ymd(+m[3], monthOf(m[1]), +m[2]);
  m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m && monthOf(m[2])) return ymd(+m[3], monthOf(m[2]), +m[1]);
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
const unCdata = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
export function textOf(html) {
  return decodeEntities(String(html || "")
    .replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
function absUrl(href, base) {
  try { return new URL(decodeEntities(href), base).toString(); } catch { return null; }
}

// RSS 2.0 <item> or Atom <entry>.
export function parseFeed(xml, base) {
  const out = [];
  const src = String(xml || "");
  const blocks = src.match(/<item\b[\s\S]*?<\/item>/gi) || src.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const tag = (name) => {
      const m = b.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
      return m ? unCdata(m[1]) : "";
    };
    const title = textOf(unCdata(tag("title")));
    let link = textOf(tag("link"));
    if (!/^https?:/i.test(link)) {
      const alt = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      link = alt ? alt[1] : "";
    }
    const date = parseDateText(tag("pubDate") || tag("published") || tag("dc:date") || tag("updated"));
    const body = textOf(unCdata(tag("description") || tag("summary") || tag("content:encoded") || tag("content")));
    if (!title || !date) continue;
    out.push({ title: clip(title, 200), date, url: link ? absUrl(link, base) : null, text: clip(body, 700) });
  }
  return out;
}

const DATE_HEADING_RE = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
// A release-notes page: date headings with the notes under each. Inside a date,
// a heading or a paragraph that is all bold starts a titled note; plain
// paragraphs add text to the note above, or are notes of their own (titled by
// their first sentence) when the date has no titles.
export function parseDatedSections(html, base) {
  const src = String(html || "");
  const heads = [];
  for (const m of src.matchAll(DATE_HEADING_RE)) {
    const label = textOf(m[2]);
    const date = label.length <= 40 ? parseDateText(label) : null;
    heads.push({ at: m.index, end: m.index + m[0].length, date, label });
  }
  const dated = heads.filter((h) => h.date);
  const out = [];
  for (let i = 0; i < dated.length; i += 1) {
    const h = dated[i];
    // The section ends at the next heading that is a date or a month title.
    const next = heads.find((x) => x.at > h.at && (x.date || /^[A-Za-z]+\s+\d{4}$/.test(x.label)));
    const chunk = src.slice(h.end, next ? next.at : Math.min(src.length, h.end + 40000));
    const blocks = [];
    for (const m of chunk.matchAll(/<(h[2-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const inner = m[2];
      const text = textOf(inner);
      if (!text) continue;
      const isHead = /^h/i.test(m[1]) || /^\s*<(b|strong)\b[^>]*>[\s\S]*<\/\1>\s*$/i.test(inner);
      const link = (inner.match(/<a\b[^>]*href=["']([^"']+)["']/i) || [])[1];
      blocks.push({ text, isHead: isHead && text.length <= 140, link });
    }
    const notes = [];
    for (const b of blocks) {
      if (b.isHead) notes.push({ title: b.text, text: "", link: b.link });
      else if (notes.length && notes[notes.length - 1].titled !== false && notes[notes.length - 1].text.length < 700) {
        const n = notes[notes.length - 1];
        n.text = `${n.text} ${b.text}`.trim();
        n.link ||= b.link;
      } else {
        const first = b.text.split(/(?<=[.!?])\s/)[0];
        notes.push({ title: first, text: b.text, link: b.link, titled: false });
      }
    }
    const anchor = (src.slice(h.at, h.end).match(/\bid=["']([^"']+)["']/i) || [])[1];
    for (const n of notes) {
      out.push({
        title: clip(n.title, 200), date: h.date, text: clip(n.text, 700),
        url: n.link ? absUrl(n.link, base) : anchor ? `${base.split("#")[0]}#${anchor}` : base,
      });
    }
  }
  return out;
}

// A news index: every link into the news path whose card carries a headline
// and a date. The card is the nearest enclosing <article> or <li>.
export function parseCards(html, base, match = "/news/") {
  const src = String(html || "");
  const seen = new Map();
  const host = (() => { try { return new URL(base).host; } catch { return ""; } })();
  for (const m of src.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absUrl(m[1], base);
    if (!url) continue;
    let u;
    try { u = new URL(url); } catch { continue; }
    if (u.host !== host || !u.pathname.startsWith(match) || u.pathname.replace(/\/+$/, "") === match.replace(/\/+$/, "")) continue;
    const head = m[2].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const title = textOf(head ? head[1] : m[2]);
    if (title.length < 12 || title.split(" ").length < 3) continue;
    const before = src.lastIndexOf("<article", m.index), beforeLi = src.lastIndexOf("<li", m.index);
    const start = Math.max(before, beforeLi, m.index - 3000);
    const endA = src.indexOf("</article>", m.index), endLi = src.indexOf("</li>", m.index);
    const ends = [endA, endLi].filter((x) => x > 0);
    const end = Math.min(ends.length ? Math.min(...ends) : Infinity, m.index + 3000);
    const card = src.slice(Math.max(0, start), end);
    const t = card.match(/<time\b[^>]*datetime=["']([^"']+)["']/i) || card.match(/<time\b[^>]*>([^<]+)<\/time>/i);
    const date = parseDateText(t ? t[1] : textOf(card));
    const key = u.origin + u.pathname;
    if (!date) continue;
    if (!seen.has(key)) {
      const body = textOf((m[2].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");
      seen.set(key, { title: clip(title, 200), date, url: key, text: clip(body, 700) });
    }
  }
  return [...seen.values()];
}

export const PARSERS = Object.freeze({ feed: parseFeed, dated: parseDatedSections, cards: (html, base, read) => parseCards(html, base, read?.match || "/news/") });

// Every source with a reader, as { lab, name, url, fetch, read }.
export function readableSources(labs) {
  const out = [];
  for (const lab of labs || []) {
    for (const s of lab.sources || []) {
      if (!s.read || !PARSERS[s.read.parser]) continue;
      out.push({ lab: lab.id, name: s.name, url: s.url, fetch: s.read.fetch || s.url, read: s.read });
    }
  }
  return out;
}

const USER_AGENT = "Mozilla/5.0 (compatible; MingstreetBot/1.0; +https://mingstreet.app)";
export const SOURCE_TIMEOUT_MS = 10000;
const MAX_BYTES = 4_000_000;

async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5" },
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const text = await res.text();
    return { ok: true, status: res.status, text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === "AbortError" ? "timed out" : String(err?.message || err).split("\n")[0].slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// Reads every source (four at a time) and returns the posts dated on or after
// `since`, plus one health row per source. Never throws.
export async function collectPosts({ labs, since, fetchImpl, timeoutMs, concurrency = 4, log = () => {} } = {}) {
  const sources = readableSources(labs);
  const posts = [];
  const health = [];
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const s = sources[next++];
      const got = await fetchText(s.fetch, { fetchImpl, timeoutMs });
      let items = [];
      let error = got.ok ? null : got.error;
      if (got.ok) {
        try { items = PARSERS[s.read.parser](got.text, s.url, s.read); } catch (err) { error = `parse failed: ${String(err?.message || err).slice(0, 80)}`; }
        if (!error && !items.length) error = "no dated posts found (layout may have changed)";
      }
      const recent = items.filter((p) => !since || p.date >= since);
      for (const p of recent) {
        // A release-notes page read through a feed (read.kind "notes") is
        // still release notes: every entry is a product change.
        posts.push({ ...p, lab: s.lab, source: s.name, kind: s.read.kind || (s.read.parser === "dated" ? "notes" : "news"), product: s.read.product || null, requires: s.read.requires || null });
      }
      health.push({ lab: s.lab, source: s.name, url: s.url, ok: !error, status: got.status || 0, posts: items.length, recent: recent.length, error });
      log(`    · ${s.lab} / ${s.name}: ${error ? `failed (${error})` : `${items.length} posts, ${recent.length} recent`}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  health.sort((a, b) => (a.lab + a.source).localeCompare(b.lab + b.source));
  return { posts, health };
}
