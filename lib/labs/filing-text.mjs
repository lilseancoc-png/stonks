// Annual report text changes (Owner-only, no AI): how much a company rewrote
// the Risk Factors section of its newest annual report against the year
// before.
//
// Companies mostly copy last year's risk factors. A year where the section is
// rewritten, grows a lot, or gains new terms is a plain, countable sign that
// something changed. The lab reads the two newest annual reports (10-K, or
// 20-F for foreign filers) from SEC EDGAR, pulls the risk section out of each,
// and compares them word for word: no AI reads or summarizes anything.
//
// The filing list comes from the Leadership collector's stored submissions
// (`sub.annual`), so this adds no submissions download; it fetches only the
// two documents, once per new annual report, a few companies per build.

import { finite, round, median } from "./stats.mjs";

export const FILING_TEXT_VERSION = 1;
const SEC_HOSTS = new Set(["www.sec.gov"]);

export function archiveUrl(cik, acc, file) {
  const c = String(Number(String(cik).replace(/\D/g, "")));
  const a = String(acc).replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${c}/${a}/${String(file).split("/").map(encodeURIComponent).join("/")}`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "-", ndash: "-", bull: " " };
// Filing HTML to plain lines: block tags end a line, everything else goes.
export function htmlToLines(html) {
  let s = String(html || "");
  s = s.replace(/<(script|style|ix:header)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|table)>|<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c === 160 ? " " : c > 31 && c < 65536 ? String.fromCharCode(c) : " "; });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => { const c = parseInt(n, 16); return c === 160 ? " " : c > 31 && c < 65536 ? String.fromCharCode(c) : " "; });
  s = s.replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? " ");
  return s.split("\n").map((l) => l.replace(/[ \t\r\f\v ]+/g, " ").trim()).filter(Boolean);
}

// The Risk Factors section as an array of lines. Annual reports name it
// "Item 1A. Risk Factors" (ending at Item 1B or Item 2); a 20-F has it under
// Item 3 as "D. Risk Factors" (ending at Item 4). The table of contents also
// matches, so the longest candidate wins.
export function riskSection(lines, form = "10-K") {
  const foreign = /^20-F/i.test(form);
  const startRe = foreign ? /^(item\s*3\.?\s*)?d\.?\s*risk\s+factors\b/i : /^item\s*1a\.?\s*[-:.]?\s*risk\s+factors\b/i;
  const endRe = foreign ? /^item\s*4\.?\s*[-:.]?\s*(information\s+on\s+the\s+company)?/i : /^item\s*(1b|1c|2)\.?\s*[-:.]?\s*(unresolved|cybersecurity|properties)/i;
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!startRe.test(lines[i]) || lines[i].length > 120) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) if (lines[j].length <= 120 && endRe.test(lines[j]) && (!foreign || /^item\s*4/i.test(lines[j]))) { end = j; break; }
    if (end < 0) end = lines.length;
    const words = lines.slice(i + 1, end).reduce((n, l) => n + l.split(" ").length, 0);
    if (!best || words > best.words) best = { from: i + 1, to: end, words };
  }
  if (!best || best.words < 800) return null;
  return lines.slice(best.from, best.to);
}

const STOP = new Set("the of and to in a our we or that for is may be on as are could by with us not which other if have these from an at any it its their such this will result can those including business also more would has future than financial operations results adversely affect affected material risks risk factors company companies products services there been were they some certain under into new due who do does should all no been was about over both each many subject ability significant materially addition well among related within additional time".split(" "));
const tokens = (text) => String(text).toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

function termCounts(lines) {
  const m = new Map();
  for (const l of lines) for (const w of tokens(l)) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [w, c] of a) { const x = 1 + Math.log(c); na += x * x; const d = b.get(w); if (d) dot += x * (1 + Math.log(d)); }
  for (const c of b.values()) { const x = 1 + Math.log(c); nb += x * x; }
  return na && nb ? dot / Math.sqrt(na * nb) : null;
}

// Compare two risk sections (arrays of lines). A paragraph counts as kept
// when an earlier paragraph shares at least half its distinct words.
export function compareSections(prev, curr) {
  const paras = (lines) => lines.filter((l) => l.split(" ").length >= 25).map((l) => ({ text: l, set: new Set(tokens(l)) }));
  const P = paras(prev), C = paras(curr);
  if (C.length < 8 || P.length < 8) return null;
  const overlap = (a, b) => { let n = 0; const [s, t] = a.size < b.size ? [a, b] : [b, a]; for (const w of s) if (t.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)); };
  const exact = new Set(P.map((p) => p.text.toLowerCase().replace(/[^a-z]/g, "")));
  const novel = (from, against, exactSet) => from.filter((p) => {
    if (exactSet && exactSet.has(p.text.toLowerCase().replace(/[^a-z]/g, ""))) return false;
    for (const q of against) if (overlap(p.set, q.set) >= 0.5) return false;
    return true;
  });
  const added = novel(C, P, exact), removed = novel(P, C, new Set(C.map((p) => p.text.toLowerCase().replace(/[^a-z]/g, ""))));
  const a = termCounts(prev), b = termCounts(curr);
  const wordsOf = (lines) => lines.reduce((n, l) => n + l.split(" ").length, 0);
  const wp = wordsOf(prev), wc = wordsOf(curr);
  const fresh = [...b.entries()].filter(([w, c]) => c >= 3 && !a.has(w) && w.length >= 5).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([w]) => w);
  const gone = [...a.entries()].filter(([w, c]) => c >= 3 && !b.has(w) && w.length >= 5).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([w]) => w);
  return {
    sim: round(cosine(a, b), 4),
    added: added.length, removed: removed.length, paragraphs: C.length,
    addedShare: round(added.length / C.length, 3),
    words: wc, wordsChg: wp ? round((wc / wp - 1) * 100, 1) : null,
    newTerms: fresh, goneTerms: gone,
    sample: added.slice().sort((x, y) => y.text.length - x.text.length).slice(0, 2).map((p) => p.text.slice(0, 280)),
  };
}

// Read a few companies' annual reports this build. `companies` is the
// Leadership collector state's `companies` map (symbol -> { cik, sub.annual }).
// Returns the updated per-symbol store; never throws.
export async function refreshFilingText({
  prior = null, companies = {}, symbols = [], fetchImpl = globalThis.fetch, userAgent = "Mingstreet research (mingstreet.app)",
  maxNames = 3, deadlineMs = 40_000, maxBytes = 30e6, gapMs = 200, nowMs = Date.now(), log = () => {},
} = {}) {
  const store = prior && typeof prior === "object" ? { ...prior } : {};
  const started = Date.now();
  const run = { at: new Date(nowMs).toISOString(), read: 0, requests: 0, errors: [] };
  for (const sym of Object.keys(store)) if (!symbols.includes(sym)) delete store[sym];
  const todo = symbols.map((sym) => ({ sym, c: companies[sym] }))
    .filter(({ sym, c }) => c?.cik && Array.isArray(c.sub?.annual) && c.sub.annual.length >= 2 && store[sym]?.acc !== c.sub.annual[0].acc
      && !(store[sym]?.failedAcc === c.sub.annual[0].acc && nowMs - Date.parse(store[sym].at || 0) < 7 * 86400000))
    .sort((a, b) => String(store[a.sym]?.at || "").localeCompare(String(store[b.sym]?.at || "")) || a.sym.localeCompare(b.sym));
  const get = async (url) => {
    const u = new URL(url);
    if (u.protocol !== "https:" || !SEC_HOSTS.has(u.hostname)) throw new Error("Source host not permitted");
    await new Promise((r) => setTimeout(r, gapMs));
    run.requests++;
    const res = await fetchImpl(url, { headers: { "user-agent": userAgent, accept: "text/html,*/*" }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > maxBytes) throw new Error("document too large");
    if (/Request Rate Threshold Exceeded|Undeclared Automated Tool/i.test(body.slice(0, 4000))) throw new Error("SEC rate page");
    return body;
  };
  for (const { sym, c } of todo) {
    if (run.read >= maxNames || Date.now() - started > deadlineMs) break;
    const [now, before] = c.sub.annual;
    try {
      const a = riskSection(htmlToLines(await get(archiveUrl(c.cik, now.acc, now.file))), now.form);
      const b = riskSection(htmlToLines(await get(archiveUrl(c.cik, before.acc, before.file))), before.form);
      const cmp = a && b ? compareSections(b, a) : null;
      if (!cmp) { store[sym] = { failedAcc: now.acc, at: run.at, why: !a || !b ? "no risk section found" : "sections too short to compare" }; }
      else store[sym] = { acc: now.acc, prevAcc: before.acc, form: now.form, filed: now.filed, prevFiled: before.filed, at: run.at, ...cmp };
      run.read++;
    } catch (err) {
      run.errors.push({ sym, message: String(err?.message || err).slice(0, 120) });
      if (/rate page/.test(String(err?.message))) break;
      store[sym] = { ...(store[sym] || {}), failedAcc: now.acc, at: run.at, why: String(err?.message || err).slice(0, 80) };
    }
  }
  log(`[quant-labs] annual report text: ${run.read} compan${run.read === 1 ? "y" : "ies"} read, ${run.requests} request(s), ${todo.length - run.read} waiting${run.errors.length ? `, ${run.errors.length} error(s)` : ""}`);
  return { store, run, waiting: Math.max(0, todo.length - run.read) };
}

// The page block.
export function buildFilingLab(store, { symbols = [], waiting = null } = {}) {
  const rows = [];
  for (const sym of symbols) {
    const r = store?.[sym];
    if (!r || !finite(r.sim)) continue;
    rows.push({ s: sym, form: r.form, filed: r.filed, prevFiled: r.prevFiled, sim: r.sim, addedShare: r.addedShare, added: r.added, removed: r.removed, words: r.words, wordsChg: r.wordsChg, newTerms: r.newTerms || [], goneTerms: r.goneTerms || [], sample: r.sample || [] });
  }
  const sims = rows.map((r) => r.sim);
  const med = sims.length ? median(sims) : null;
  // "Rewritten" = among the least similar fifth of the names read, and at
  // least a tenth of its paragraphs new.
  const cut = sims.length >= 10 ? sims.slice().sort((a, b) => a - b)[Math.floor(sims.length / 5)] : null;
  for (const r of rows) r.flag = cut != null && r.sim <= cut && r.addedShare >= 0.1 ? "rewritten" : r.addedShare <= 0.02 ? "copied" : null;
  rows.sort((a, b) => a.sim - b.sim);
  const failed = symbols.filter((s) => store?.[s]?.failedAcc && !finite(store?.[s]?.sim)).map((s) => ({ s, why: store[s].why || null }));
  return {
    v: FILING_TEXT_VERSION, status: rows.length ? "ok" : "collecting",
    rows, read: rows.length, waiting, failed: failed.slice(0, 30),
    summary: { medianSim: round(med, 3), rewritten: rows.filter((r) => r.flag === "rewritten").length, copied: rows.filter((r) => r.flag === "copied").length },
  };
}
