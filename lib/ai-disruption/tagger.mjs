// AI disruption tracker, Phase 1 (2026-11-16): rules-only tagging of a lab
// post. Owner decision 2026-11-16: no AI call. A post the rules can read
// plainly becomes an "auto" launch row; anything unclear goes to the Owner
// review queue with the rules' best guess filled in, never into the log.
//
// Pure functions. No network, no AI, no file writes. Spec: docs/ai-disruption.md.

// One regex per capability. Title words count first; the body is read only
// when the title names nothing (news bodies mention far more than they ship).
export const CAPABILITY_RULES = Object.freeze({
  tutoring: /\b(?:tutor\w*|homework|interactive learning|learning for|study (?:mode|guides?|notes?|hub|plans?)|quiz(?:zes|ze[sd])?|quiz|flashcards?|learning mode|guided learning|exam prep|lessons? plans?|students?)\b/i,
  language_learning: /\b(?:language learning|learn (?:a )?(?:new )?languages?|language (?:practice|lessons?|tutor)|practice speaking|pronunciation)\b/i,
  meeting_notes: /\b(?:meeting notes?|note[- ]?tak(?:er|ing)|meetings? (?:plugin|assistant|recaps?|summar\w+|notes?)|(?:claude|copilot|gemini|chatgpt) meetings?|joins? (?:the |a |your )?(?:call|meeting)|record(?:s|ing)? (?:a |the |your )?meetings?|transcrib\w+ (?:meetings?|calls?))\b/i,
  slides: /\b(?:slides?|slide decks?|decks?|presentations?|powerpoint|keynote)\b/i,
  spreadsheets: /\b(?:spreadsheets?|excel|google sheets|sheets|formulas?|financial models?)\b/i,
  docs_writing: /\b(?:documents?|docs|google docs|microsoft word|for word|in word|canvas|long[- ]form writing|writing (?:help|assistant|tools?)|drafts? and edits?)\b/i,
  image_gen: /\b(?:image generation|(?:chatgpt|gemini|grok|meta ai) images?|images? \d|generat\w+ images?|image (?:model|generator|editing|editor)|text[- ]to[- ]image|nano banana|imagen|dall-?e|gpt-image|aurora)\b/i,
  video_gen: /\b(?:video generation|generat\w+ videos?|text[- ]to[- ]video|video (?:model|generator|editing)|sora|veo|grok imagine)\b/i,
  design: /\b(?:designs?(?! to)|mock-?ups?|brand kits?|brand assets?|logos?|prototyp\w+|figma|canva|ui designs?)\b/i,
  coding_agent: /\b(?:coding agents?|codex|claude code|copilot (?:coding )?agent|code reviews?|pull requests?|writes? code|coding|software engineering|antigravity|jules|repositor(?:y|ies)|terminal|cli\b)/i,
  app_builder: /\b(?:app builder|build(?:s|ing)? (?:an? )?(?:apps?|tools?)|apps? from a prompt|internal tools?|vibe[- ]cod\w+|artifacts?|mini[- ]apps?)\b/i,
  website_builder: /\b(?:websites?|web sites?|landing pages?|(?:chatgpt|claude|gemini) sites)\b/i,
  computer_use: /\b(?:computer use|uses? (?:a |your )?computer|operates? (?:a |your )?(?:desktop|computer)|controls? (?:a |your )?(?:computer|desktop|mac|pc)|clicks?,? (?:and )?types?)\b/i,
  browser_agent: /\b(?:browser agents?|in chrome|auto[- ]?browse|agent mode|agentic brows\w+|browses? (?:the web|websites?)|in (?:your |the )?browser|chrome extension|atlas|operator|comet|web tasks?)\b/i,
  workflow_automation: /\b(?:automat\w+|delegat\w+ (?:work|tasks?)|workflows?|scheduled (?:tasks?|actions?|runs?)|routines?|recurring tasks?|triggers?|always-on agents?|background agents?)\b/i,
  task_project: /\b(?:to-?do lists?|task (?:lists?|tracking|management)|team tasks|project (?:tracking|management|plans?)|assign(?:s|ing)? (?:owners|tasks)|deadlines?|kanban)\b/i,
  crm_agent: /\b(?:crm|salesforce|hubspot|sales (?:agents?|teams?|outreach|pipelines?)|customer records|prospect\w*)\b/i,
  support_agent: /\b(?:customer (?:support|service)|support agents?|contact cent(?:er|re)|answers? customer|business agents?)\b/i,
  enterprise_search: /\b(?:enterprise search|company knowledge|knowledge bases?|search (?:across|your) (?:company|work|organi[sz]ation|apps)|internal (?:knowledge|docs))\b/i,
  research: /\b(?:deep research|deep ?search|researcher agents?|research (?:reports?|mode|agents?|assistant)|citations?|cited sources|literature reviews?)\b/i,
  data_analysis: /\b(?:data analysis|code interpreter|analyst agents?|analy[sz]\w* (?:your )?data|charts?|dashboards?|sql|bigquery|smart reports?|visuali[sz]\w+)\b/i,
  personal_finance: /\b(?:personal finance|finances?|bank(?:ing)? accounts?|budget\w*|spending|tax(?:es| returns?| filings?)?|bookkeeping)\b/i,
  legal_contracts: /\b(?:legal|contracts?|lawyers?|clauses?|ndas?)\b/i,
  file_storage_search: /\b(?:file (?:storage|search|library|uploads?)|your files|google drive|onedrive|dropbox|organi[sz]e (?:your )?files)\b/i,
  shopping_checkout: /\b(?:shopping|checkout|purchases?|buy(?:s|ing)? (?:for you|products|things)|wallet|merchants?|retailers?)\b/i,
  web_search: /\b(?:web search|search the web|chatgpt search|searchgpt|ai mode|ai overviews?|search engine|real-?time search)\b/i,
  connectors_platform: /\b(?:connectors?|model context protocol|plugins?|integrations?|mcp|connected apps?|app directory|apps sdk|extensions?)\b/i,
  agent_platform: /\b(?:agent (?:builder|platform|sdk|kit|framework)|agents? sdk|agentkit|build(?:ing)? (?:your own |custom )?agents?|custom gpts?|copilot studio|managed agents)\b/i,
  security_review: /\b(?:security (?:reviews?|scanning|agents?|research|cloud)|(?:codex|copilot|claude) security|vulnerabilit\w+|secure code|code security|codeql)\b/i,
  health: /\b(?:health|medical|clinicians?|doctors?|fitness|wellness|lab results|symptoms?)\b/i,
  stock_media: /\b(?:stock (?:photos?|images?|footage|music|media)|royalty-free|music generation|generat\w+ music|lyria|sound effects?)\b/i,
  it_service: /\b(?:it (?:help ?desk|service|support|tickets?)|service desk|help ?desk|back-office|servicenow)\b/i,
});

// Words that mark a post as a product launch, and words that mark company
// news (money, people, policy, research papers) that is not one.
const LAUNCH_RE = /\b(?:introduc\w+|launch\w*|now available|available (?:now|today|to|in|on|for)|rolling out|rolls? out|announc\w+|meet |expand\w*|brings?|adds?|added|beta|preview|generally available|release[sd]?|debut\w*|can now|now (?:you can|lets|supports|in|on)|unveil\w*|new\b)/i;
const NOT_LAUNCH_RE = /\b(?:funding|raises?|investment|invest(?:ing|s)? in|ipo|s-1|roadshow|earnings|quarterly results|financial results|hires?|appoint\w*|board of directors|policy|policies|safety (?:report|framework|card)|system card|responsible scaling|research paper|study finds|economic index|interview|podcast|webinar|conference|summit|hackathon|acqui\w+|lawsuit|court|elections?|pledge|public benefit|testimony|congress|regulat\w+|transparency|outage|incident|bug fix(?:es)?|fixed an? |deprecat\w+|retir\w+|sunset\w*|customer stor(?:y|ies)|case study)\b/i;
// A general newsroom (Meta, the Microsoft blog) also posts about things that
// are not AI at all; such a post must name an AI product or idea.
const AI_RE = /\b(?:ai|a\.i\.|agents?|agentic|assistant|copilot|llama|models?|gpt|gemini|claude|grok|codex|chatgpt|meta ai|llm)\b/i;

const PLAN_RULES = [
  ["free", /\b(?:free (?:users?|plans?|tier|accounts?|for everyone)|for free|all users|everyone|logged-out|free,|free and)\b/i],
  ["consumer", /\b(?:plus|pro|max|ultra|premium|chatgpt go|go (?:users|plans?)|personal (?:plans?|accounts?)|individuals?|consumers?|supergrok|copilot pro|personal and family)\b/i],
  ["business", /\b(?:team (?:plans?|users|workspaces?|accounts?)|teams? and enterprise|business(?:es)?|workspace (?:customers|users|editions?))\b/i],
  ["enterprise", /\b(?:enterprise|edu(?:cation)? plans?|edu)\b/i],
  ["api", /\b(?:api|developers?|developer platform|sdk|vertex ai|bedrock|azure ai foundry)\b/i],
];
const PREVIEW_RE = /\b(?:research preview|preview|early access|waitlist|labs|experiment(?:al)?|alpha|limited (?:release|access)|trusted testers|coming soon)\b/i;
const BETA_RE = /\bbeta\b/i;
const GA_RE = /\b(?:generally available|general availability|now available|available (?:now|today|to all|to everyone|for all|in|on)|rolling out (?:to|now)|rolls? out|is live|now live|launch(?:es|ed)?)\b/i;
const UNATTENDED_RE = /\b(?:in the background|background agents?|runs? (?:on its own|autonomously|unattended|while you)|autonomous(?:ly)?|scheduled|always-on|routines?|on a schedule|without supervision|end[- ]to[- ]end)\b/i;
const APPROVE_RE = /\b(?:agents?|agentic|takes? actions?|on your behalf|completes? tasks?|operator|computer use|checkout|purchases?|books? )\b/i;
const WORKFLOW_RE = /\b(?:(?:in|inside|within|for) (?:excel|word|powerpoint|slack|teams|outlook|gmail|chrome|salesforce|google (?:docs|sheets|slides|meet|drive)|your (?:apps|tools|workflows?))|integrat\w+|plugin)\b/i;

const MAX_CAPS = 4;
const words = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function capabilitiesIn(text) {
  const out = [];
  for (const [id, re] of Object.entries(CAPABILITY_RULES)) if (re.test(text)) out.push(id);
  return out;
}

// The lab product a post is about: the longest product name it mentions, else
// the source's own product (a product's release-notes page), else none.
export function productFor(text, lab, fallback = null) {
  const names = [...(lab?.products || [])].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
    // A bare "Copilot" on the GitHub changelog is GitHub Copilot: the source's
    // own product wins over a shorter name it contains.
    if (re.test(text)) return fallback && fallback !== name && fallback.includes(name) && (lab?.products || []).includes(fallback) ? fallback : name;
  }
  return fallback && (lab?.products || []).includes(fallback) ? fallback : null;
}

export function plansIn(text) {
  return PLAN_RULES.filter(([, re]) => re.test(text)).map(([p]) => p);
}

// Tags one collected post. `item`: { title, text, date, url, product (the
// source's default product), kind: "notes" | "news", requires (regex source
// a post must match, e.g. "copilot" on the GitHub changelog) }.
// Returns { decision: "log" | "queue" | "skip", fields, reasons }.
export function tagPost(item, lab) {
  const title = words(item.title);
  const body = words(item.text).slice(0, 600);
  const all = `${title}. ${body}`;
  const reasons = [];
  if (item.requires && !new RegExp(item.requires, "i").test(all)) return { decision: "skip", fields: null, reasons: [`does not mention ${item.requires}`] };
  const notLaunch = NOT_LAUNCH_RE.test(title);
  const launchy = item.kind === "notes" || LAUNCH_RE.test(all);
  let caps = capabilitiesIn(title);
  if (!caps.length) caps = capabilitiesIn(body);
  if (caps.length > MAX_CAPS) caps = caps.slice(0, MAX_CAPS);
  if (notLaunch && !caps.length) return { decision: "skip", fields: null, reasons: ["reads as company news, not a product"] };
  if (item.kind !== "notes" && !AI_RE.test(all) && !productFor(all, lab)) return { decision: "skip", fields: null, reasons: ["not about AI"] };
  // A news post that names no capability and no plan is an essay, a customer
  // story or a partnership note, not a launch. (A release-notes entry with no
  // capability still goes to review: those pages list products only.)
  if (item.kind !== "notes" && !caps.length && !plansIn(all).length) return { decision: "skip", fields: null, reasons: ["names no capability or plan"] };

  const product = productFor(all, lab, item.product);
  const plans = plansIn(all);
  const availability = PREVIEW_RE.test(all) ? "preview" : BETA_RE.test(all) ? "beta" : GA_RE.test(all) && plans.length ? "ga" : plans.length ? "ga" : "preview";
  const autonomy = UNATTENDED_RE.test(all) ? "unattended" : APPROVE_RE.test(all) ? "approve" : "draft";
  const how = caps.includes("connectors_platform") || caps.includes("agent_platform") || caps.length >= 3 ? "platform"
    : WORKFLOW_RE.test(all) ? "workflow" : "direct";
  // Coverage (how much of a rival product's core job it does) is the one
  // judgment the rules cannot make; auto rows get a cautious 2, plus one for
  // a sold product and one for unattended work.
  const coverage = Math.min(4, 2 + (availability === "ga" ? 1 : 0) + (autonomy === "unattended" ? 1 : 0));

  if (!caps.length) reasons.push("no capability named");
  if (!product) reasons.push("no product named");
  if (!plans.length) reasons.push("no plan named");
  if (notLaunch) reasons.push("reads like company news");
  if (!launchy) reasons.push("no launch words");
  const fields = { product, title: title.slice(0, 120), capabilities: caps, how, plans, availability, autonomy, coverage };
  return { decision: reasons.length ? "queue" : "log", fields, reasons };
}

// "2026-11-12-anthropic-claude-meetings-beta": the id format the registry uses.
export function launchIdFor(date, lab, title) {
  const slug = String(title || "launch").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${date}-${lab}-${slug || "launch"}`;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "with", "now", "new", "is", "are", "your", "you", "our", "we", "it", "its", "at", "by", "from", "available", "beta", "preview"]);
const tokens = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
export function titleSimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / (A.size + B.size - both);
}
const dayGap = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

// The same launch read twice (release notes and the news post, or a row the
// registry already holds): same lab, within three days, and either the same
// link or titles that share at least half their words.
export function sameLaunch(a, b) {
  if (!a || !b || a.lab !== b.lab) return false;
  // A shared link means the same post, except a page anchor (several notes
  // under one date heading share it).
  if (a.url && b.url && a.url === b.url && !a.url.includes("#")) return true;
  if (!(a.date && b.date) || dayGap(a.date, b.date) > 3) return false;
  return titleSimilarity(a.title, b.title) >= 0.5;
}
