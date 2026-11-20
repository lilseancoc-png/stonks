// Offline check for the AI disruption tracker's Phase 1 collector, tagger,
// review decisions and log files (lib/ai-disruption/). No network: every
// source is served from the made-up pages below.
//   node scripts/ai-disruption-collector-smoke.mjs
import assert from "node:assert/strict";
import { containsInvestmentAdvice } from "../lib/public-data-policy.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { OPTIONAL_BAKE_KEYS, REQUEST_TIME_EXCLUSIVE_KEYS } from "../lib/data-ownership.mjs";
import { LAUNCHES, LABS, CAPTURE_WEIGHTS, CAPTURE_WEIGHTS_DRAFT, captureScore } from "../lib/ai-disruption/index.mjs";
import { parseDateText, parseFeed, parseDatedSections, parseCards, readableSources, collectPosts } from "../lib/ai-disruption/collector.mjs";
import { tagPost, launchIdFor, sameLaunch, titleSimilarity, plansIn } from "../lib/ai-disruption/tagger.mjs";
import { readReviewDoc, applyReviewRequest, cleanFields } from "../lib/ai-disruption/review.mjs";
import {
  collectDue, foldPosts, updateDisruptionState, applyDecisions, buildDisruptionFiles, rowProblems, emptyState,
  keptDecisionIds, QUEUE_MAX, QUEUE_MAX_DAYS,
  AI_DISRUPTION_KEY, AI_DISRUPTION_OWNER_KEY, AI_DISRUPTION_STATE_KEY, AI_DISRUPTION_REVIEW_KEY,
} from "../lib/ai-disruption/log.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks += 1; };
const lab = (id) => LABS.find((l) => l.id === id);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// --- Dates ------------------------------------------------------------------
eq(parseDateText("November 12, 2026"), "2026-11-12", "long month");
eq(parseDateText("Nov 9, 2026"), "2026-11-09", "short month");
eq(parseDateText("Sept 3, 2026"), "2026-09-03", "Sept");
eq(parseDateText("Tue, 27 Oct 2026 23:05:50 -0700"), "2026-10-27", "RSS date as written, not shifted to UTC");
eq(parseDateText("2026-11-02T08:00:00Z"), "2026-11-02", "ISO");
eq(parseDateText("February 30, 2026"), null, "impossible date");
eq(parseDateText("Release notes"), null, "no date");
eq(parseDateText("2026.11.19"), "2026-11-19", "dotted date (Gemini release notes)");
eq(parseDateText("2026/11/09"), "2026-11-09", "slashed date");
eq(parseDateText("2026.13.01"), null, "impossible dotted date");
eq(parseDateText("version 2026.11"), null, "a version number is not a date");

// --- Feeds ------------------------------------------------------------------
const RSS = `<?xml version="1.0"?><rss><channel><title>Blog</title>
<item><title><![CDATA[Introducing Copilot slide decks in PowerPoint for Enterprise]]></title><link>https://www.microsoft.com/en-us/microsoft-365/blog/2026/11/10/notebooks/</link><pubDate>Tue, 10 Nov 2026 16:05:50 +0000</pubDate><description><![CDATA[<p>Copilot slide decks are now available to Microsoft 365 Copilot enterprise customers.</p>]]></description></item>
<item><title>Our quarterly results &amp; outlook</title><link>https://www.microsoft.com/en-us/microsoft-365/blog/2026/11/09/results/</link><pubDate>Mon, 09 Nov 2026 12:00:00 +0000</pubDate><description>Revenue grew.</description></item>
<item><title>No date here</title><link>https://example.com/x</link></item>
</channel></rss>`;
const rss = parseFeed(RSS, "https://www.microsoft.com/en-us/microsoft-365/blog/");
eq(rss.length, 2, "RSS: dated items only");
eq(rss[0].title, "Introducing Copilot slide decks in PowerPoint for Enterprise", "RSS: CDATA title");
eq(rss[1].title, "Our quarterly results & outlook", "RSS: entities decoded");
ok(/now available/.test(rss[0].text), "RSS: description text");
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Gemini in Google Sheets can now build dashboards</title><link rel="alternate" type="text/html" href="https://workspaceupdates.googleblog.com/2026/11/sheets.html"/><published>2026-11-11T17:00:00.000-08:00</published><content type="html">&lt;p&gt;Rolling out to Business and Enterprise customers.&lt;/p&gt;</content></entry></feed>`;
const atom = parseFeed(ATOM, "https://workspaceupdates.googleblog.com/");
eq(atom.length, 1, "Atom entry");
eq(atom[0].url, "https://workspaceupdates.googleblog.com/2026/11/sheets.html", "Atom alternate link");
eq(atom[0].date, "2026-11-11", "Atom date");

// --- Release-notes pages ------------------------------------------------------
const NOTES = `<article><h1>Release notes</h1><h2 id="m">November 2026</h2>
<h3 id="h_a">November 12, 2026</h3>
<p>Claude Meetings is rolling out in beta on Team and Enterprise plans. Claude joins a Google Meet call and takes meeting notes. See <a href="https://support.claude.com/en/articles/1-meetings">Use Claude Meetings</a>.</p>
<p> </p>
<h3 id="h_b">November 6, 2026</h3>
<p><b>Spreadsheet agent (beta)</b></p><p>Pro and Max users can now ask Claude to build spreadsheets and financial models.</p>
<p><b>Faster uploads</b></p><p>Files upload faster.</p>
<h2>October 2026</h2><h3>October 21, 2026</h3><p><strong>Claude Duet research preview</strong></p><p>A new app for Pro and Max plans.</p>
</article>`;
const notes = parseDatedSections(NOTES, "https://support.claude.com/en/articles/12138966-release-notes");
eq(notes.length, 4, "one note per titled block or untitled paragraph");
eq(notes.map((n) => n.date), ["2026-11-12", "2026-11-06", "2026-11-06", "2026-10-21"], "dates follow their headings");
eq(notes[1].title, "Spreadsheet agent (beta)", "bold paragraph is a title");
ok(/financial models/.test(notes[1].text), "text joins the title above");
eq(notes[0].url, "https://support.claude.com/en/articles/1-meetings", "a note's own link wins");
ok(notes[0].title.startsWith("Claude Meetings is rolling out"), "untitled note titled by its first sentence");
// Gemini's release notes: one <h2> per date written 2026.11.19, an <h3> per
// note (the page read no dated posts from 2026-11-16 to 2026-11-20).
const GEMINI = `<h1>Release Notes</h1><h2 class="t _size:headline-5">2026.11.19</h2><div class="_r"><h3>Get tasks done across your Mac apps and the web with Computer use</h3><div><p>What: Gemini can now use your Mac apps.</p></div></div>
<h2 class="t">2026.11.17</h2><div><h3>Checkout with Google Pay in Tasks in Gemini</h3><p>Pay at checkout without leaving the chat.</p><h3>Forward an email, get the task done</h3><p>Forward any email to Gemini.</p></div>`;
const gem = parseDatedSections(GEMINI, "https://gemini.google/us/release-notes/");
eq(gem.map((n) => n.date), ["2026-11-19", "2026-11-17", "2026-11-17"], "Gemini dotted date headings");
eq(gem[0].title, "Get tasks done across your Mac apps and the web with Computer use", "Gemini note title");
ok(/Mac apps/.test(gem[0].text), "Gemini note text");

// --- News index pages ----------------------------------------------------------
const CARDS = `<main><a href="/news/announcements">Announcements</a>
<article><header><p><a href="/news/announcements">Announcements</a></p><time>Nov 10, 2026</time></header><a href="/news/claude-for-chrome-ga"><h3>Claude in Chrome is now available to everyone</h3><p>Our browser agent is generally available on all paid plans.</p></a></article>
<ul><li><a href="/news/roadshow"><h3>Anthropic launches roadshow for proposed initial public offering</h3></a><div><time>Nov 9, 2026</time></div></li></ul>
<article><a href="/research/paper"><h3>A research paper on interpretability methods</h3></a><time>Nov 8, 2026</time></article>
<article><a href="https://other.example.com/news/x"><h3>Off-site link with a long enough title</h3></a><time>Nov 8, 2026</time></article></main>`;
const cards = parseCards(CARDS, "https://www.anthropic.com/news", "/news/");
eq(cards.map((c) => c.date), ["2026-11-10", "2026-11-09"], "cards inside the news path with a date");
eq(cards[0].url, "https://www.anthropic.com/news/claude-for-chrome-ga", "card link made absolute");
ok(!cards.some((c) => /Announcements/.test(c.title)), "category links skipped");

// --- Sources -------------------------------------------------------------------
const sources = readableSources(LABS);
eq(new Set(sources.map((s) => s.lab)).size, 6, "every lab has a readable source");
ok(sources.every((s) => /^https:\/\//.test(s.fetch)), "https fetches only");
ok(sources.every((s) => { try { return LABS.find((l) => l.id === s.lab).sources.some((x) => new URL(x.url).host === new URL(s.url).host); } catch { return false; } }), "every fetch belongs to a listed lab source");
// help.openai.com and x.ai answer 403 to the build runner (no post read since
// 2026-11-16); both are read through releases.sh's Atom feeds, listed as
// each lab's mirror source. A release-notes feed keeps the notes kind.
ok(sources.every((s) => { try { const h = new URL(s.fetch).host; return LABS.find((l) => l.id === s.lab).sources.some((x) => new URL(x.url).host === h); } catch { return false; } }), "every fetched host is a listed source of its lab");
const chatgpt = sources.find((s) => s.name === "ChatGPT release notes");
eq([chatgpt.read.parser, chatgpt.read.kind, new URL(chatgpt.fetch).host], ["feed", "notes", "releases.sh"], "ChatGPT release notes read through the mirror feed");
eq(new URL(sources.find((s) => s.lab === "xai").fetch).host, "releases.sh", "xAI news read through the mirror feed");
{
  const MIRROR = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Health expands to desktop, Android, dots, and sites</title><link rel="alternate" type="text/html" href="https://help.openai.com/en/articles/6825453-chatgpt-release-notes#health" /><updated>2026-11-19T00:00:00.000Z</updated><published>2026-11-19T00:00:00.000Z</published><content type="html"><![CDATA[Health is rolling out to Free, Go, Plus and Pro users.]]></content></entry></feed>`;
  const openai = { id: "openai", sources: [{ name: "ChatGPT release notes", url: "https://help.openai.com/x", read: chatgpt.read }] };
  const got = await collectPosts({ labs: [openai], since: "2026-11-01", fetchImpl: async (u) => (u === chatgpt.fetch ? { ok: true, status: 200, text: async () => MIRROR } : { ok: false, status: 404, text: async () => "" }) });
  eq(got.posts.map((p) => [p.date, p.kind, p.product, p.url]), [["2026-11-19", "notes", "ChatGPT", "https://help.openai.com/en/articles/6825453-chatgpt-release-notes#health"]], "mirror feed post keeps kind notes and the help-center link");
}

// --- Tagging ---------------------------------------------------------------------
const meet = tagPost({ ...notes[0], kind: "notes", product: "Claude" }, lab("anthropic"));
eq(meet.decision, "log", "a plain launch is logged");
eq(meet.fields.capabilities, ["meeting_notes"], "meeting notes tagged");
eq(meet.fields.plans, ["business", "enterprise"], "Team + Enterprise plans");
eq(meet.fields.availability, "beta", "beta read");
const sheet = tagPost({ ...notes[1], kind: "notes", product: "Claude" }, lab("anthropic"));
ok(sheet.fields.capabilities.includes("spreadsheets"), "spreadsheets from the title");
eq(sheet.fields.plans, ["consumer"], "Pro and Max read as consumer plans");
eq(tagPost({ ...notes[2], kind: "notes", product: "Claude" }, lab("anthropic")).decision, "queue", "a note naming no capability is queued");
const ipo = tagPost({ title: "Anthropic launches roadshow for proposed initial public offering", text: "", kind: "news", product: null }, lab("anthropic"));
eq(ipo.decision, "skip", "company news is skipped");
const offTopic = tagPost({ title: "New Facebook Groups features for creators", text: "Groups get new tools.", kind: "news", product: "Meta AI" }, lab("meta"));
eq(offTopic.decision, "skip", "a general newsroom post that is not about AI is skipped");
const gh = tagPost({ title: "Dependabot now groups updates", text: "", kind: "news", product: "GitHub Copilot", requires: "copilot" }, lab("microsoft"));
eq(gh.decision, "skip", "the GitHub changelog keeps Copilot posts only");
const ghc = tagPost({ title: "Copilot coding agent can now open pull requests from issues", text: "Available to Copilot Business and Enterprise.", kind: "news", product: "GitHub Copilot", requires: "copilot" }, lab("microsoft"));
eq(ghc.decision, "log", "a Copilot post is logged");
eq(ghc.fields.product, "GitHub Copilot", "the source's product wins over the bare Copilot");
ok(ghc.fields.capabilities.includes("coding_agent"), "coding agent");
eq(plansIn("Gemini 3 Pro and GPT-5 Pro arrive; o3-pro too"), [], "a versioned model name is not a plan");
eq(plansIn("Gemini 3 Pro comes to Google AI Pro and Ultra subscribers"), ["consumer"], "the plan beside it still counts");
eq(tagPost({ title: "Deep research is now available", text: "", kind: "notes", product: "Claude" }, lab("anthropic")).fields.availability, "ga", "launch wording reads as generally available");
eq(tagPost({ title: "Deep research", text: "", kind: "notes", product: "Claude" }, lab("anthropic")).fields.availability, "preview", "no wording stays a preview");
const msNb = tagPost({ ...rss[0], kind: "news", product: null }, lab("microsoft"));
eq(msNb.fields.product, "Microsoft 365 Copilot", "product found in the text");
ok(/^2026-11-12-anthropic-claude-meetings/.test(launchIdFor("2026-11-12", "anthropic", meet.fields.title)), "id format matches the registry");
ok(titleSimilarity("Claude in Chrome now available to everyone", "Claude in Chrome for all paid plans") >= 0.3, "similar titles");
ok(sameLaunch({ lab: "openai", date: "2026-11-01", title: "ChatGPT Slides", url: "u" }, { lab: "openai", date: "2026-11-09", title: "x", url: "u" }), "same link = same launch");
ok(!sameLaunch({ lab: "openai", date: "2026-11-01", title: "ChatGPT Slides" }, { lab: "google", date: "2026-11-01", title: "ChatGPT Slides" }), "different labs differ");

// The rules on the backfill's own titles (titles only; live posts add the body).
let capAgree = 0, considered = 0;
for (const l of LAUNCHES) {
  const r = tagPost({ title: l.title, text: "", kind: "notes", product: l.product }, lab(l.lab));
  if (!r.fields || !r.fields.capabilities.length) continue;
  considered += 1;
  if (r.fields.capabilities.some((c) => l.capabilities.includes(c))) capAgree += 1;
}
ok(considered >= 60 && capAgree / considered >= 0.9, `rules agree with the hand tags on ${capAgree} of ${considered} backfill titles they tag`);

// --- Collect due ------------------------------------------------------------------
const at = (iso) => Date.parse(iso);
eq(collectDue(emptyState(), { nowMs: at("2026-11-17T15:00:00Z"), decisionRun: false }).due, true, "10:00 ET bake collects");
eq(collectDue(emptyState(), { nowMs: at("2026-11-17T16:00:00Z"), decisionRun: true }).due, false, "never on a Top Picks run");
eq(collectDue(emptyState(), { nowMs: at("2026-11-17T12:00:00Z") }).due, false, "not before 09:00 ET");
eq(collectDue({ ...emptyState(), lastRunDate: "2026-11-17" }, { nowMs: at("2026-11-17T21:10:00Z") }).due, false, "once a day");

// --- Folding posts into the state -----------------------------------------------------
const posts = [
  { lab: "anthropic", source: "Claude release notes", kind: "notes", product: "Claude", ...notes[0] },
  { lab: "anthropic", source: "Claude release notes", kind: "notes", product: "Claude", ...notes[1] },
  { lab: "anthropic", source: "Claude release notes", kind: "notes", product: "Claude", ...notes[2] },
  { lab: "anthropic", source: "Anthropic news", kind: "news", product: null, ...cards[1] },
  // Already in the registry (2026-11-05 Personal Finance in Claude).
  { lab: "anthropic", source: "Claude release notes", kind: "notes", product: "Claude", date: "2026-11-05", title: "Personal Finance in Claude", text: "On Pro, Max and Ultra plans.", url: "https://support.claude.com/x" },
];
const fold1 = foldPosts(emptyState(), { posts, health: [{ lab: "anthropic", source: "Claude release notes", ok: true }], today: "2026-11-17" });
eq(fold1.counts, { posts: 5, fresh: 5, logged: 2, queued: 1, skipped: 1, duplicates: 1 }, "logged / queued / skipped / duplicate");
ok(fold1.state.rows.every((r) => !rowProblems(r).length), "logged rows are complete");
ok(fold1.state.rows.every((r) => r.status === "auto" && r.collected && r.source === "https://support.claude.com/en/articles/12138966-release-notes"), "auto rows cite the lab's listed page");
eq(fold1.state.queue[0].reasons, ["no capability named", "no plan named"], "queue item says why");
const fold2 = foldPosts(fold1.state, { posts, today: "2026-11-18" });
eq(fold2.counts.fresh, 0, "a post is read once");
eq(fold2.state.health, fold1.state.health, "health kept when a run brings none");

// --- The bake step with a stand-in fetch ------------------------------------------------
const PAGES = {
  "https://support.claude.com/en/articles/12138966-release-notes": NOTES,
  "https://www.anthropic.com/news": CARDS,
  "https://www.microsoft.com/en-us/microsoft-365/blog/feed/": RSS,
  "https://workspaceupdates.googleblog.com/feeds/posts/default": ATOM,
};
const fakeFetch = async (url) => (PAGES[url] ? { ok: true, status: 200, text: async () => PAGES[url] } : { ok: false, status: 403, text: async () => "" });
const run = await updateDisruptionState({ prior: null, nowMs: at("2026-11-17T15:05:00Z"), fetchImpl: fakeFetch });
eq(run.collected, true, "collected when due");
ok(run.state.health.filter((h) => h.ok).length === 4 && run.state.health.some((h) => h.error === "HTTP 403"), "each source fails on its own");
ok(run.state.rows.some((r) => r.lab === "microsoft" && r.product === "Microsoft 365 Copilot"), "feed launch logged");
eq(run.state.lastRunDate, "2026-11-17", "run date in ET");
const again = await updateDisruptionState({ prior: run.state, nowMs: at("2026-11-17T18:35:00Z"), fetchImpl: () => { throw new Error("must not fetch"); } });
eq(again.collected, false, "not read twice a day");

// --- Review decisions -----------------------------------------------------------------
eq(applyReviewRequest(null, { act: "nope", id: "2026-11-12-anthropic-x" }).error, "bad act", "unknown act");
eq(applyReviewRequest(null, { act: "confirm", id: "../etc" }).error, "bad id", "bad id");
eq(applyReviewRequest(null, { act: "edit", id: "2026-11-12-anthropic-x", fields: { capabilities: ["bogus"] } }).error, "capabilities must be 1-6 known ids", "unknown capability");
eq(cleanFields({ product: "Grok" }, "2026-11-12-anthropic-x").error, "unknown product for this lab", "product must be the lab's");
const regRow = LAUNCHES.find((l) => l.date === "2026-11-05" && l.lab === "anthropic");
const autoRow = run.state.rows.find((r) => r.lab === "anthropic" && r.capabilities.includes("meeting_notes"));
const queued = run.state.queue.find((q) => q.lab === "anthropic");
let doc = readReviewDoc(null);
doc = applyReviewRequest(doc, { act: "confirm", id: regRow.id }, { at: "2026-11-17T20:00:00Z", by: "owner" }).doc;
doc = applyReviewRequest(doc, { act: "edit", id: autoRow.id, fields: { coverage: 4 } }, { at: "2026-11-17T20:01:00Z" }).doc;
doc = applyReviewRequest(doc, { act: "edit", id: queued.id, fields: { capabilities: ["data_analysis"], plans: ["consumer"], availability: "preview" } }, { at: "2026-11-17T20:02:00Z" }).doc;
const rejectId = run.state.rows.find((r) => r.lab === "microsoft").id;
doc = applyReviewRequest(doc, { act: "reject", id: rejectId }, { at: "2026-11-17T20:03:00Z" }).doc;
eq(applyReviewRequest(doc, { act: "confirm", id: regRow.id }, {}).unchanged, true, "same decision twice changes nothing");
eq(Object.keys(readReviewDoc(JSON.stringify(doc)).decisions).length, 4, "decisions round-trip");
const undone = applyReviewRequest(doc, { act: "undo", id: rejectId }, { at: "2026-11-17T20:04:00Z" }).doc;
ok(!undone.decisions[rejectId] && undone.history[0].act === "undo", "undo removes a decision and is logged");

const applied = applyDecisions({ registry: LAUNCHES, rows: run.state.rows, queue: run.state.queue, review: doc });
eq(applied.launches.find((l) => l.id === regRow.id).status, "confirmed", "confirm a backfill row");
const ed = applied.launches.find((l) => l.id === autoRow.id);
ok(ed.status === "confirmed" && ed.coverage === 4 && ed.edited, "edit applies the fix");
ok(applied.launches.some((l) => l.id === queued.id && l.fromQueue && l.capabilities[0] === "data_analysis"), "a fixed queue item joins the log");
ok(!applied.launches.some((l) => l.id === rejectId) && applied.rejected.includes(rejectId), "a rejected row leaves the log");
ok(!applied.queue.some((q) => q.id === queued.id), "the queue item is gone");
const badDoc = applyReviewRequest(readReviewDoc(null), { act: "edit", id: queued.id, fields: { availability: "ga", plans: [] } }, {}).doc;
const badApplied = applyDecisions({ registry: [], rows: [], queue: run.state.queue, review: badDoc });
ok(badApplied.queue.some((q) => q.id === queued.id && q.needs.length), "an incomplete fix leaves the item in the queue with what it needs");

// A confirmed or edited queue item outlives the age trim and the cap; an open one doesn't.
eq(keptDecisionIds(doc).sort(), [regRow.id, autoRow.id, queued.id].sort(), "kept ids: confirmed and edited, not rejected");
const filler = Array.from({ length: QUEUE_MAX + 5 }, (_, i) => ({ ...queued, id: `${queued.id}-f${i}`, date: "2026-11-16" }));
const crowded = { ...run.state, queue: [...run.state.queue, ...filler] };
const later = addDays(queued.date, QUEUE_MAX_DAYS + 30);
const keptFold = foldPosts(crowded, { today: later, keepIds: keptDecisionIds(doc) });
ok(keptFold.state.queue.some((q) => q.id === queued.id), "a fixed queue item survives the age trim");
ok(keptFold.state.queue.length <= QUEUE_MAX + 1, "open items still capped");
const lostFold = foldPosts(crowded, { today: later });
ok(!lostFold.state.queue.some((q) => q.id === queued.id), "without a decision the old item is trimmed");
const keptPub = buildDisruptionFiles({ state: keptFold.state, review: doc, tickers: ["MSFT"], builtAt: "2026-11-17T21:10:00.000Z" }).pub;
ok(keptPub.launches.some((l) => l.id === queued.id), "the fixed launch stays in the public log after the trim");
const runKept = await updateDisruptionState({ prior: crowded, review: doc, force: true, nowMs: at(`${later}T15:05:00Z`), fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }) });
ok(runKept.collected && runKept.state.queue.some((q) => q.id === queued.id), "the bake step passes the decisions to the trim");
const runLost = await updateDisruptionState({ prior: crowded, force: true, nowMs: at(`${later}T15:05:00Z`), fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }) });
ok(runLost.collected && !runLost.state.queue.some((q) => q.id === queued.id), "and trims it without them");

// --- Files -----------------------------------------------------------------------------
const files = buildDisruptionFiles({ state: run.state, review: doc, tickers: ["MSFT", "ADBE", "CRM", "NOW"], builtAt: "2026-11-17T21:10:00.000Z", collected: true });
const pub = files.pub;
eq(pub.counts.launches, LAUNCHES.length + run.state.rows.length - 1 + 1, "registry + collected - rejected + fixed queue item");
ok(pub.launches[0].date >= pub.launches[pub.launches.length - 1].date, "newest first");
ok(pub.launches.every((l) => Number.isFinite(l.score) && l.score >= 0 && l.score <= 100), "every launch scored");
ok(pub.launches.some((l) => l.targets.some((t) => t.coverage === "covered")), "targets name covered companies");
const pubText = JSON.stringify(pub);
ok(!/"queue"|"skipped"|"pressure"|"decisions"/.test(pubText), "no Owner field in the public file");
ok(!/"(?:score|grade|tier|rank|rating|risk)"\s*:/.test(JSON.stringify(pub.companies)), "no stock judgment in the public company list");
ok(pub.launches.every((l) => !containsInvestmentAdvice(l.title)), "no launch title reads as advice");
ok(files.owner.queue.length >= 0 && files.owner.review.decisions === 4 && files.owner.review.rulesKept === 33, "Owner file: queue and how often the rules' tags were kept (1 of 3 kept as-is)");
ok(Object.values(files.owner.pressure).some((v) => v > 0), "launch pressure per capability");

// --- Keys --------------------------------------------------------------------------------
ok(!isPremiumKey(AI_DISRUPTION_KEY), "launch log is public");
ok(isPremiumKey(AI_DISRUPTION_OWNER_KEY) && isPremiumKey(AI_DISRUPTION_STATE_KEY) && isPremiumKey(AI_DISRUPTION_REVIEW_KEY), "queue, state and decisions are Owner-only");
ok([AI_DISRUPTION_KEY, AI_DISRUPTION_OWNER_KEY, AI_DISRUPTION_STATE_KEY].every((k) => OPTIONAL_BAKE_KEYS.includes(k)), "bake keys optional");
ok(REQUEST_TIME_EXCLUSIVE_KEYS.has(AI_DISRUPTION_REVIEW_KEY), "decisions are request-time-owned");

// --- Weights ------------------------------------------------------------------------------
const sd = (w) => { const s = LAUNCHES.map((l) => captureScore(l, null, w)); const m = s.reduce((a, b) => a + b) / s.length; return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length); };
ok(Math.abs(Object.values(CAPTURE_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9, "weights sum to 1");
ok(sd(CAPTURE_WEIGHTS) > sd(CAPTURE_WEIGHTS_DRAFT) + 1, "retuned weights spread launches more than the draft");

console.log(`ai-disruption collector smoke: ok (${checks} checks)`);
