# Research Lab cost audit

October 31, 2026. The Lab has **$0 site-side AI API cost**: it imports no AI SDK,
makes no model request, and adds no scheduled AI work. Reading an existing site
research payload does not regenerate it. Existing site AI producers are unchanged.
Manual ChatGPT/Claude research uses the owner's separate plan and usage limits.

## Rerunnable consumption benchmark

Run `npm run audit:research-lab-cost`. The checked-in `cost-benchmark.json` records
the source prices, measured fixture footprint and explicit assumptions. The
fixture uses three fictional assets, 420 sessions, a six-node graph and one
compact export. It counts actual adapter GET/PUT calls plus the R2 lease
protocol, and measures local process CPU. It is not a production invoice.

The example uses 59 write-class and 82 read-class requests, about 0.99 MB retained
objects per independent research footprint, and 14 browser/API requests including
compile, save, queue, execution, results, Journal and export. Reusing unchanged
inputs reduces retained storage. Each new evidence source capture adds one
bounded cached source read and a small immutable card/Journal update.

At 100 such independent runs retained for one month, the modeled footprint is
about 0.10 GB storage, 5,900 write requests, 8,200 reads and 1,400 function calls.
The published-rate consumption equivalent is approximately $0.031 for R2 plus
$0.009 for illustrated Vercel usage, assuming iad1, 2 GB and one second allocated
per request. At ten seconds per request the Vercel equivalent is about $0.084.
These small rate-normalized equivalents are **not bill predictions**.

## When hosting may be covered by free allowances

[R2 Standard pricing](https://developers.cloudflare.com/r2/pricing/) includes
10 GB-month, 1 million Class A operations and 10 million Class B operations per
month. Published overage rates are $0.015/GB-month, $4.50/million writes and
$0.36/million reads. Billable units round upward. Thus a marginal request that
crosses an account's allowance/unit boundary can cost more than a fractional
per-request calculation suggests. The example fits within an otherwise-unused
free allowance; existing account usage was not inspected.

[Vercel Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)
lists Hobby allowances of 4 active CPU hours, 360 GB-hours of memory and one
million invocations. Pro, other regions and legacy compute have different billing.
The illustrative iad1 rates are $0.128/CPU-hour, $0.0106/GB-hour and $0.60/million
invocations, before applicable credits. The actual project plan, region, memory,
cold starts, instance concurrency and network latency were not verified.

Large 12-asset histories, Monte Carlo, 1,000 bootstrap repetitions, many graph
nodes, source captures, retries and failed/orphan artifacts can use more resources.
The example does not establish a worst-case maximum. Audit-retention quotas stop
new work rather than silently deleting records; 200 retained runs is a ceiling,
not an automatic monthly reset. No new subscription or always-on queue is added.

## Efficiency fixes

- Unchanged price and site-evidence captures reuse immutable objects and original
  dates instead of accumulating equivalent snapshots.
- Browser advancement consumes the returned progress directly. Full run details
  load initially and on completion, rather than after every node.
- Busy worker responses carry retry timing; polling backs off. Read-only/no-op
  transactions no longer rewrite the owner projection.
- The catalog/filter/sort are browser-local after one metadata request. Source
  payloads load explicitly; there is no scan of every site dataset or idle poller.
- Operations count referenced artifact bytes and projection bytes without an
  expensive bucket listing. This excludes unreferenced orphans, explicitly.
- Source cards exclude raw quote/article/account data, cap traversal and fields,
  and attach by immutable hash. Worker trade lookups use an index.

The static isolation check fails on AI/provider/broker calls or scheduled Lab
workloads. Making the feature visible to existing signed-in owners adds no
scheduled or AI work. Computation still starts only on an explicit action; live
R2 reliability remains unverified.
