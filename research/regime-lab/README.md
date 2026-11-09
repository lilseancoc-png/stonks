# Regime Lab research results

`results/latest.json` is the public-safe summary of the last manual research
run (`node scripts/regime-lab.mjs run`): per-test verdicts, sample counts and
aggregate reads for the F1-F22 catalog, the number of setups tried and which
holdout windows have been run. It holds no trade rows, no ticker lists and
nothing from the private Track Record. The full run (every window, every
book) is written to the Owner's private research folder with `--out` and is
never committed.

Every full build reads this file (`loadResearchResults`) and joins it with
the bake's own results into `regime-lab.json`'s test catalog. See
`docs/regime-lab.md`.
