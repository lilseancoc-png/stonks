# Private-store record hydration

`sync-data.mjs pull` defaults to bake ownership and an Eastern calendar date. It downloads the current root payloads plus 60 dates of evidence (today through today minus 59) and 61 dates of AI rejection logs (today through today minus 60). These windows cover the two producers' history loaders. Scanner owners omit both dated archives because their producers do not consume them. Current latest pointers remain available to every producer.

For historical backtests, use `node scripts/sync-data.mjs pull --include-archives`. The backtest workflow sets this flag. Normal workflows pass their producer through `--owner`.

The policy only bounds downloads. Historical records remain in the remote publication and are available to authenticated historical reads and full backtests. The manifest still grows with retained history; monitor its size and retention separately. All remote paths are validated before filtering or installing a snapshot, and downloads stage before replacing the last-good local directory.

`ai-rejection-scorecard.json` is runner-local: bake, seed, and pull exclude it. Other Owner-only payloads remain publishable and keep their existing authentication policy.

Run `npm run test:data-hydration` and `npm run test:private-store` to verify the offline fake-store paths without live storage operations.
