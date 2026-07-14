# RUNBOOK — reproducing the measurements

These are research scripts, not a packaged tool. Each harness has its config as
**constants at the top** (repo path, index path, model, K). The paths below use
`/tmp/codemap-bench/...` as written; adjust to your machine.

## Prerequisites

- **Node ≥ 23.6** (runs the `.mjs` harnesses and code-map directly).
- **code-map** installed so `map` is on `PATH`: in the [`map`](https://github.com/annyeong844/map)
  repo, `npm link`.
- **The agent under test:** the `claude` CLI (the harnesses spawn `claude -p
  --output-format stream-json`). Any agent CLI with a JSON/stream-json transcript
  works if you adapt the spawn + parsing.
- **`ripgrep`** on PATH. **`git`**. For the semantic harnesses only: **`uv`** + network
  (re-downloads the embedder — see note).
- For the call-graph ground truth (`b-compare.mjs`): **code-oracle** (the sibling MCP
  in the `map` repo) with `tsgo` available.

## Get the repos under test (by SWE-bench base_commit)

The repos themselves are **not** vendored here (size/licence). Clone at the exact
commit each instance was measured on (ids + commits in `results/dj-multi.json`,
`results/requests-targets.json`):

```bash
# requests (read-efficiency + SWE localization)
git clone https://github.com/psf/requests /tmp/codemap-bench/requests
git -C /tmp/codemap-bench/requests checkout 110048f9837f8441ea536804115e80b69f400277

# django (hard SWE localization) — full clone, then checkout the instance commit
git clone https://github.com/django/django /tmp/codemap-bench/django
git -C /tmp/codemap-bench/django checkout 142ab6846ac09d6d401e26fc8b6b988a583ac0f5

# build the code-map index for whichever repo you're testing
map index --root /tmp/codemap-bench/requests --out /tmp/codemap-bench/requests.map.json --force
```

## Run each measurement

```bash
cd harnesses

# Headline: read-efficiency (A native Read vs B code-map read). Both models, K=5.
BENCH_MODEL=sonnet BENCH_K=5 node harness-read.mjs
BENCH_MODEL=opus   BENCH_K=5 node harness-read.mjs

# The adoption confound — does the agent even call code-map when it has grep?
BENCH_MODEL=opus node harness-toolcount.mjs        # → code-map calls ≈ 0

# Concept-query 3-way, forced lanes + adoption-verified
BENCH_MODEL=opus node harness-forced.mjs

# Callers precision/recall: grep vs code-map graph vs oracle ground truth
node oracle-client.mjs '[{"file":"...","name":"..."}]' > gt.json   # tsgo GT
node b-compare.mjs

# SWE-bench localization (django, hard) across instances
node orchestrate.mjs                                # loops dj-multi.json

# Tier-1/2/3 sweep (planted-bug variants need the bug plants — see harness-t23.mjs header)
BENCH_K=10 node harness.mjs
```

Each prints a table and writes `results/*.json` (already captured here from the
original runs, for comparison).

## GPT-5.6 Sol known refs vs forced real `rg`

Clone `map` and `code-map-bench` as sibling directories, build the index in `map`, then:

```bash
cd code-map-bench
map index --root ../map --out ../map/.map-index.json --force
CODE_MAP_ROOT=../map node harnesses/bench-codex-headless.mjs \
  --run --passes 30 --max-tasks 3 \
  --strategies grep-mcp,map-batch \
  --model gpt-5.6-sol --repo ../map
```

`grep-mcp` hides code-map and exposes only `harnesses/grep-baseline-server.mjs`, which
invokes real `rg` and direct line-range reads. This keeps the baseline reproducible in
sandboxes where a nested Codex process cannot execute shell commands. Strategy order is
alternated each pass. The captured aggregate and audit are in
`results/gpt56-sol-pass30.{json,md}`.

### Multi-stage workflow pilot

Use the same sibling checkouts and index, but select the workflow task file. Each
workflow keeps one resumed session across orient, trace, impact-analysis, and
tool-free synthesis stages:

```bash
cd code-map-bench
CODE_MAP_ROOT=../map node harnesses/bench-codex-headless.mjs \
  --run --passes 10 --tasks harnesses/tasks.workflow.json \
  --strategies grep-mcp,map-batch \
  --model gpt-5.6-sol --repo ../map
```

This is the captured paired **n=10 pilot**, not a pass@30 confirmation. The aggregate,
order check, bootstrap intervals, and audit are in
`results/gpt56-sol-workflow-pilot10.{json,md}`.

## Drift resistance (the headline — pure local, no agent/API, fast)

```bash
cp -r /tmp/codemap-bench/requests /tmp/codemap-bench/requests-churn
map index --root /tmp/codemap-bench/requests-churn --out /tmp/codemap-bench/drift-stale.map.json --force   # stale coords
node harnesses/churn.mjs /tmp/codemap-bench/requests-churn                                                  # churn in place (no re-index)
map index --root /tmp/codemap-bench/requests-churn --out /tmp/codemap-bench/drift-truth.map.json --force   # truth coords
node harnesses/harness-drift.mjs /tmp/codemap-bench/requests-churn \
     /tmp/codemap-bench/drift-stale.map.json /tmp/codemap-bench/drift-truth.map.json
# → code-map 0 silent / 94.5% recovery   vs   naive (stored line#) 100% silent
```

(harness-drift.mjs imports `read`/`loadIndex` from the `map` repo — adjust the two
absolute import paths at its top to your checkout.)

```bash
# Edit targeting (aim) — reuses the same stale/churned setup:
node harnesses/harness-aim.mjs /tmp/codemap-bench/requests-churn \
     /tmp/codemap-bench/drift-stale.map.json /tmp/codemap-bench/drift-truth.map.json
# → aim 0 silent mistargets / 94.5%   vs   naive (stored char offset) 100% mistarget
```

## Oracle caller precision vs grep (needs code-oracle + tsgo)

```bash
# 1. fresh type-confirmed callers for some symbols (clone cline @ a commit first):
node harnesses/oracle-client.mjs '[{"file":"src/core/api/providers/anthropic.ts","name":"createMessage"}, ...]' > oracle-gt2.json
# 2. compare against grep's name-match read-set:
node harnesses/oracle-precision.mjs
# → grep 231 files vs oracle 159 → 31% fewer to read (40–75% on common names)
```

(oracle-client.mjs drives the `code-oracle` sibling MCP — needs tsgo; warms ~3 s on cline.)

## The semantic lane (rejected — kept as evidence)

```bash
# Standing embedder server + a thin MCP proxy, then the recall eval.
uv run --with sentence-transformers --with einops python sem-server.py &   # :8799
node sem-eval.py            # semantic recall@10 vs locate
python qodo-tput.py         # Qodo-1.5B throughput + ranking probe (CPU-infeasible)
```

Note: the embedder weights are **not** included (they're large and the lane was
rejected). Re-running re-downloads `nomic-ai/CodeRankEmbed` / `Qodo/Qodo-Embed-1-1.5B`
via `sentence-transformers`. See `RESULTS.md` for why this lane was cut.

## Reading the metrics

- `workTok` = input + output + cache_creation tokens (the per-run cost proxy).
- `turns` = agent iterations (`num_turns` from the result event).
- Tool adoption is parsed from `stream-json` `tool_use` events — **always verify the
  agent used the tool under test**; the biggest early error was inferring code-map's
  value from an outcome when the agent had actually just used `grep`.
