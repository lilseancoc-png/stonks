# About transcript efficiency and source retention

The compact transcript brief keeps the existing consumer shape and model. It requests 3–5 takeaways, at most three notable Q&A exchanges, shorter tone evidence and optional supporting sections. Material results, changed or withdrawn guidance, capex, liquidity, risks, periods, units and qualifications take priority. Facts from an exchange outside the three selected Q&A rows still belong in the appropriate guidance, financial or risk section.

The normal output target is 2,000–3,500 tokens. The existing 16,384-token emergency ceiling remains in place pending live evaluation. Thinking tokens share that ceiling, so simply lowering it can create more truncated responses. The current model and thinking settings are unchanged. Google recommends `thinkingLevel` for Gemini 3; the existing `thinkingBudget` setting needs a separate model-specific evaluation, not an assumption that its numeric value is a hard bound. See [Google thinking controls](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en).

## Complete source input

`prepareTranscriptInput()` changes only whitespace and line endings. It retains every non-whitespace character, including final Q&A and qualifications. No keyword classifier chooses what is important before the model sees the transcript.

Previously, a source exceeding `AI_TRANSCRIPT_CHARS` was cut at the character limit. It now fails before the paid request. The prior valid summary remains available, and the existing failure cooldown applies. This can delay coverage of a long call. It prevents a partial source from masquerading as a full-call read. Resolving such a call requires a reviewed larger input allowance or a separately evaluated segmentation approach.

New detail objects record `summaryFormat: compact-v1` and source coverage, original/supplied character counts and a source hash. Coverage describes retention of the parsed source, not independent proof that a publisher or parser supplied every part of the original call. They do not store a second copy of the raw transcript. Existing `ect3` summaries remain valid, avoiding an archive-wide paid refresh just to change formatting.

A response that has already been paid for is kept. A list that runs past its prompted limit is published whole, never clipped. An entry that cannot be shown (empty, missing its required text, or with an unsupported label) is left out on its own, and a number where text was expected is kept as text. Each of these is recorded in the brief's `responseNotes` and in the build log, so a summary that ran long or had a bad row is visible rather than silently changed. A response cut off at the output ceiling (`MAX_TOKENS`, as BE and AXP were) keeps every section that finished before the cut; the brief is marked `partial` and the page says later sections are missing. Only a response with nothing usable fails: no complete section can be recovered, or there is no headline and no summary point. Complete text fields remain intact within the existing model response ceiling. These checks keep the paid output and prevent mechanical clipping. They do not prove that a model included every important fact in a concise summary.

Selective article-passage filtering is not enabled by this change. Articles still have their existing 1,500-character excerpt policy. Choosing fewer passages cannot guarantee material retention without an independently reviewed source set, including disclosures late in an article. The safe transcript implementation supplies the complete source within the existing budget instead.

## Research on cost per usable result

The October 19 evening through October 23 evening sample contains nine completed transcript runs:

- Nine recorded model responses produced seven published summaries.
- BE and AXP hit `MAX_TOKENS`; both outputs were rejected.
- Existing conservative code rates estimate $0.650337 for the recorded responses, including $0.2844735 for the two rejected responses, about 43.7% of the total.
- All nine responses used Gemini 3.6 Flash. At the posted October 2026 token rates, the corresponding estimates are about $0.3252 total and $0.1422 rejected. These are usage-derived estimates, not invoices. The pricing page lists higher rates starting January 1, 2027. See [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Published responses contained 1,973–3,933 output tokens. Several also recorded more thinking tokens than the configured numeric thinking budget, so the configuration value alone does not establish actual usage.
- Five runs had no recorded model response or newly published summary. Reusing cached summaries or finding no new call is normal and must not be scored as an AI failure.
- GOOGL failed fetch/parse in all nine runs, before a model call. These are coverage failures, not recorded Gemini spend. The sample has ten total fetch/parse failure events, including another name in one run.

This is a small observational sample, not a before/after experiment. Published means accepted by the current pipeline, not independently checked for factual completeness. Failures without response usage metadata may have unobserved billing.

The metric would not directly improve a summary or save money. It can identify which intervention to try: fewer truncations, source/parser repair, better cache reuse, or a different model. A single cost-per-summary figure hides those differences. The cheapest next step is a report from existing logs, not new production instrumentation or an automatic model-routing rule.

The included read-only calculator accepts one saved GitHub log per run:

```sh
gh run view RUN_ID --repo lilseancoc-png/stonks --log > /tmp/transcript-RUN_ID.log
node scripts/audit-transcript-output.mjs /tmp/transcript-RUN_ID.log
```

It reports recorded response cost, published count, content failures and collection failures separately. Unknown model pricing, missing response usage and absent final counts remain unknown. A published-summary count larger than the available response records also makes cost unknown. Cost per accepted summary is undefined when nothing was published. It makes no provider calls and adds no production writes.

Evidence runs: [Oct 19 evening](https://github.com/lilseancoc-png/stonks/actions/runs/39338767018), [Oct 20 morning](https://github.com/lilseancoc-png/stonks/actions/runs/39426734266), [Oct 20 evening](https://github.com/lilseancoc-png/stonks/actions/runs/39512059228), [Oct 21 morning](https://github.com/lilseancoc-png/stonks/actions/runs/39604198092), [Oct 21 evening](https://github.com/lilseancoc-png/stonks/actions/runs/39690465291), [Oct 22 morning](https://github.com/lilseancoc-png/stonks/actions/runs/39783061852), [Oct 22 evening](https://github.com/lilseancoc-png/stonks/actions/runs/39868876139), [Oct 23 morning](https://github.com/lilseancoc-png/stonks/actions/runs/39957648670), [Oct 23 evening](https://github.com/lilseancoc-png/stonks/actions/runs/40037101158).

## Validation and remaining uncertainty

Offline tests exercise complete source retention at the exact budget boundary, late guidance withdrawal, analyst hypotheticals, GAAP distinctions, material caveats, capex extraction, oversized-response rejection and cached legacy summaries. Fixtures verify data handling and consumer compatibility; they do not measure model quality.

Before claiming savings or deploying a tighter output limit, compare old and compact prompts on retained long and short calls. Include BE/AXP-style failures, late Q&A guidance, withdrawn outlook, capex-heavy and regulated businesses. Review critical facts against the full source, including units, periods, speaker attribution and qualifications. Record accepted output, missing material facts and total input/output/thinking usage. Reuse existing valid output where possible and set a separate, bounded evaluation allowance before making paid calls.

No paid generation was run during this change because the local session had no model credential. No production schedules, billing controls, source licenses or data were changed. Actual output quality and realized savings remain unmeasured.
