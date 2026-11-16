// lib/mcp/ai-disruption-tools.mjs — the AI disruption tracker on the MCP.
//
// Same rules as every MCP tool: read-only, zero AI calls, no live request.
// All three read the public ai-disruption.json the daily build writes
// (lib/ai-disruption/log.mjs): facts about lab products and descriptions of
// which companies a launch targets. None scores, ranks or tests a stock.
//   get_ai_launches          the launch log, filtered by lab, capability,
//                            company, status, date or words
//   get_ai_capability_board  per capability, the best customer-capture score
//                            each lab has shipped, and who sells it
//   get_ai_exposure          one company: what it sells that the labs ship,
//                            the launches aimed at it, its defense
// The Owner review queue (ai-disruption-owner.json) is read with get_feature
// `ai-disruption` dataset `owner`; the collector's state and the Owner's
// decisions are never readable here.
import { AI_DISRUPTION_KEY } from "../ai-disruption/log.mjs";
import { CAPABILITIES, LABS } from "../ai-disruption/index.mjs";

const ANY = "any";
const CAP_IDS = CAPABILITIES.map((c) => c.id);
const LAB_IDS = LABS.map((l) => l.id);
const DATE_RE = "^\\d{4}-\\d{2}-\\d{2}$";
const SOURCE = { key: AI_DISRUPTION_KEY, page: "/?tab=ai-disruption" };
const LIMITS = [
  "Launches come from the labs' own release notes and news, read once a trading day; the 88 launches before 2026-11-16 were entered by hand.",
  "status auto = tagged by keyword rules and not yet checked by the site owner; confirmed = checked (edited = the tags were fixed by hand).",
  "The customer-capture score (0-100) describes a product's readiness to take customers from traditional software. It is not a view on any stock.",
];

const wordsOf = (q) => String(q || "").toLowerCase().split(/[^a-z0-9.+-]+/).filter((w) => w.length >= 2).slice(0, 8);

function launchRow(l, capName, { full = false } = {}) {
  return {
    id: l.id, date: l.date, lab: l.lab, product: l.product, title: l.title,
    capabilities: (l.capabilities || []).map((c) => ({ id: c, name: capName[c] || c })),
    how: l.how, plans: l.plans, availability: l.availability, autonomy: l.autonomy, coverage_0_5: l.coverage,
    capture_score: l.score, status: l.status, ...(l.edited ? { edited: true } : {}),
    targets: (l.targets || []).slice(0, full ? 40 : 8).map((t) => ({ company: t.company, name: t.name, covered: t.coverage === "covered", role: t.role, capability: t.capability, outcome: t.outcome })),
    ...((l.targets || []).length > (full ? 40 : 8) ? { more_targets: l.targets.length - (full ? 40 : 8) } : {}),
    source: l.link || l.source,
  };
}

function common(pub) {
  const warnings = [];
  if (pub.stale) warnings.push("STALE: the lab sources were not read on the last build; this is the last saved log.");
  const down = (pub.sources || []).filter((s) => !s.ok);
  if (down.length) warnings.push(`SOURCES_DOWN: ${down.length} of ${(pub.sources || []).length} lab sources were not read on the last collection (${down.slice(0, 4).map((s) => `${s.lab} ${s.source}`).join(", ")}${down.length > 4 ? ", …" : ""}).`);
  return { warnings, head: { as_of: pub.builtAt, last_collected: pub.lastCollected || null, counts: pub.counts, weights_version: pub.weightsVersion } };
}

export function aiDisruptionTools({ fail, envelope, boundedJson, readKey, normSymbol }) {
  const read = async (ctx) => (await readKey(ctx, AI_DISRUPTION_KEY)).payload;
  const capNames = (pub) => Object.fromEntries((pub.capabilities || CAPABILITIES).map((c) => [c.id, c.name]));
  const companyOf = (pub, q) => {
    const raw = String(q || "").trim();
    if (!raw) return null;
    const sym = normSymbol ? (() => { try { return normSymbol(raw); } catch { return null; } })() : raw.toUpperCase();
    const list = pub.companies || [];
    return list.find((c) => c.id === sym) || list.find((c) => c.id.toLowerCase() === raw.toLowerCase() || c.name.toLowerCase() === raw.toLowerCase())
      || list.find((c) => c.name.toLowerCase().includes(raw.toLowerCase())) || null;
  };
  return [
    {
      name: "get_ai_launches",
      title: "AI lab launch log",
      audience: ANY,
      description:
        "What the frontier AI labs (OpenAI, Anthropic, Google, Microsoft, Meta, xAI) have shipped, from their own release notes: each launch's capabilities (e.g. slides, meeting notes, coding agent, customer support agent), who can use it (plans, preview/beta/GA), how much it works on its own, a 0-100 customer-capture score (readiness to take customers from traditional software) and the companies that sell the same thing with how it could reach them (obsolescence risk, business-model disruption, feature commoditization, watch). Filter by `lab`, `capability`, `company` (ticker or name), `status` (auto = rule-tagged, confirmed = checked by the owner), `since` (YYYY-MM-DD) or `query`; `id` returns one launch with every target. Newest first. Facts about products, not a view on any stock.",
      inputSchema: {
        type: "object",
        properties: {
          lab: { type: "string", enum: LAB_IDS },
          capability: { type: "string", enum: CAP_IDS },
          company: { type: "string", maxLength: 40, description: "A ticker (ADBE) or company name; only launches that target it." },
          status: { type: "string", enum: ["auto", "confirmed"] },
          since: { type: "string", pattern: DATE_RE, description: "Only launches on or after this date." },
          query: { type: "string", maxLength: 120, description: "Words that must all appear in the title or product." },
          id: { type: "string", maxLength: 120, pattern: "^\\d{4}-\\d{2}-\\d{2}-[a-z]+-[a-z0-9-]{1,80}$", description: "One launch id from an earlier result." },
          limit: { type: "integer", minimum: 1, maximum: 60, description: "Rows (default 20)." },
        },
        additionalProperties: false,
      },
      async run(ctx, args) {
        const pub = await read(ctx);
        const names = capNames(pub);
        const { warnings, head } = common(pub);
        const limit = Math.min(Number(args.limit) || 20, 60);
        let results;
        if (args.id) {
          const l = (pub.launches || []).find((x) => x.id === args.id);
          if (!l) fail("NOT_FOUND", `No launch ${args.id}. Search with lab, capability, company or query.`);
          results = { ...head, launch: launchRow(l, names, { full: true }) };
        } else {
          let list = pub.launches || [];
          if (args.lab) list = list.filter((l) => l.lab === args.lab);
          if (args.capability) list = list.filter((l) => (l.capabilities || []).includes(args.capability));
          if (args.status) list = list.filter((l) => l.status === args.status);
          if (args.since) list = list.filter((l) => l.date >= args.since);
          if (args.company) {
            const co = companyOf(pub, args.company);
            if (!co) fail("NOT_FOUND", `${args.company} is not in the AI disruption company map. get_ai_capability_board lists who sells each capability.`);
            list = list.filter((l) => (l.targets || []).some((t) => t.company === co.id));
          }
          const words = wordsOf(args.query);
          if (words.length) list = list.filter((l) => words.every((w) => `${l.title} ${l.product}`.toLowerCase().includes(w)));
          results = { ...head, launches: list.slice(0, limit).map((l) => launchRow(l, names)), more: Math.max(0, list.length - limit) };
        }
        const bounded = boundedJson(results, { maxItems: 60 });
        if (bounded.reduced) warnings.push("TRIMMED: long lists were shortened; narrow with lab, capability, company, since or limit.");
        return envelope(ctx, { tool: "get_ai_launches", source: SOURCE, payload: { builtAtIso: pub.builtAt }, owner: false, warnings, limitations: LIMITS, results: bounded.value });
      },
    },
    {
      name: "get_ai_capability_board",
      title: "AI capability board",
      audience: ANY,
      description:
        "For each capability the AI labs ship (32, e.g. slides, spreadsheets, coding agent, browser agent, CRM agent, IT service desk), the best customer-capture score each lab has reached so far with the launch that set it and the score it replaced, how many launches each lab has made there, and which companies sell that capability (as core product, add-on or adjacent). `capability` narrows to one. Sorted by the strongest lab score. Facts about products, not a view on any stock.",
      inputSchema: {
        type: "object",
        properties: { capability: { type: "string", enum: CAP_IDS } },
        additionalProperties: false,
      },
      async run(ctx, args) {
        const pub = await read(ctx);
        const { warnings, head } = common(pub);
        const byId = Object.fromEntries((pub.launches || []).map((l) => [l.id, l]));
        const sellers = {};
        for (const c of pub.companies || []) for (const e of c.exposures || []) (sellers[e.capability] ||= []).push({ company: c.id, name: c.name, covered: c.coverage === "covered", role: e.role });
        const caps = (pub.capabilities || []).filter((c) => !args.capability || c.id === args.capability);
        const rows = caps.map((c) => {
          const cells = pub.board?.[c.id] || {};
          const labs = Object.entries(cells).map(([lab, x]) => ({ lab, best_score: x.score, previous_best: x.prior, set_by: x.launch ? { id: x.launch, title: byId[x.launch]?.title || null, date: x.date } : null, launches: x.launches }))
            .sort((a, b) => b.best_score - a.best_score);
          return { id: c.id, name: c.name, does: c.does, top_score: labs[0]?.best_score ?? 0, labs, sold_by: (sellers[c.id] || []).sort((a, b) => (a.role > b.role ? 1 : -1)) };
        }).sort((a, b) => b.top_score - a.top_score);
        const bounded = boundedJson({ ...head, capabilities: rows }, { maxItems: 60 });
        if (bounded.reduced) warnings.push("TRIMMED: pass `capability` for one row in full.");
        return envelope(ctx, { tool: "get_ai_capability_board", source: SOURCE, payload: { builtAtIso: pub.builtAt }, owner: false, warnings, limitations: LIMITS, results: bounded.value });
      },
    },
    {
      name: "get_ai_exposure",
      title: "AI launches aimed at a company",
      audience: ANY,
      description:
        "One company in the AI disruption map (a covered ticker such as ADBE, CRM, NOW, or another public or private company named in launches): what it sells that the AI labs now ship (each capability with its role: core product, add-on, adjacent, and how a launch could hurt it), its defense, and the launches aimed at it in the last `days` (default 180), with how each could reach it. Descriptive only: no score, rank or forecast of the stock.",
      inputSchema: {
        type: "object",
        properties: {
          company: { type: "string", maxLength: 40, description: "Ticker or company name." },
          days: { type: "integer", minimum: 7, maximum: 1500, description: "Look-back in days (default 180)." },
        },
        required: ["company"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        const pub = await read(ctx);
        const names = capNames(pub);
        const { warnings, head } = common(pub);
        const co = companyOf(pub, args.company);
        if (!co) fail("NOT_FOUND", `${args.company} is not in the AI disruption company map.`);
        const days = Math.min(Math.max(Number(args.days) || 180, 7), 1500);
        const from = new Date(Date.parse(pub.builtAt || new Date(ctx.now()).toISOString()) - days * 86400000).toISOString().slice(0, 10);
        const hits = (pub.launches || []).filter((l) => l.date >= from && (l.targets || []).some((t) => t.company === co.id)).map((l) => {
          const t = l.targets.find((x) => x.company === co.id);
          return { id: l.id, date: l.date, lab: l.lab, title: l.title, capture_score: l.score, status: l.status, capability: t.capability, role: t.role, outcome: t.outcome };
        });
        const byOutcome = {};
        for (const h of hits) byOutcome[h.outcome] = (byOutcome[h.outcome] || 0) + 1;
        const results = {
          ...head,
          company: { id: co.id, name: co.name, coverage: co.coverage, defense: co.defense, sells: (co.exposures || []).map((e) => ({ capability: e.capability, name: names[e.capability] || e.capability, role: e.role, how_a_launch_hurts: e.how })) },
          window: { from, days }, launches: hits.length, by_outcome: byOutcome, recent: hits.slice(0, 40),
        };
        if (co.coverage !== "covered") warnings.push("MENTION_ONLY: this company is outside the site's covered stocks; it is named to explain launches and is never priced or tested.");
        const bounded = boundedJson(results, { maxItems: 60 });
        return envelope(ctx, { tool: "get_ai_exposure", source: SOURCE, payload: { builtAtIso: pub.builtAt }, owner: false, warnings, limitations: LIMITS, results: bounded.value });
      },
    },
  ];
}
