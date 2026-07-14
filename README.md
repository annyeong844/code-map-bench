# code-map-bench

Reproducible measurements — and honest **negative results** — behind
[**`code-map`**](https://github.com/annyeong844/map).

code-map makes one deliberately narrow claim: it's a **drift-safe coordinate cache** —
reuse a symbol's coordinate across turns and `read` re-anchors it (**0 silently-wrong
bytes** at churn scale) instead of returning stale lines; it also cuts agent **turns**
(~25–30 % at N=6). Search with your own `grep`. This repo is the evidence for that
claim *and* the log of every richer hypothesis — and headline — the measurements
killed (including a blanket "token efficiency" headline that didn't survive K=30 — though
tokens *do* drop 30–60 % on **known-ref reads with routing**, see the headline below). The
differentiator isn't a feature list, it's *having measured honestly enough to delete
most of one, and to retract a claim of your own.*

## The headline

| | result |
|---|---|
| **drift-safe READ (the real value)** | after heavy churn, no re-index: **0 silently-wrong bytes**, 94.5 % recovery vs naive **100 % silent**. Reproduced. |
| **drift-safe EDIT — `aim` (the real value)** | snippet → current char range after churn: **0 silent mistargets**, 94.5 % vs naive **100 % mistarget**. |
| **type-oracle caller precision (`code-oracle`)** | **31 % fewer files to read** for blast-radius (40–75 % on common names) — grep can't disambiguate which class's method; the checker can. LSP cost. |
| **`read` turns (kept)** | **−25–30 % agent turns** (N=6, both models, K=30, CI clear of 0). |
| **single-`read` tokens (SCOPE CORRECTED)** | the old K=5 "−13…35 %" headline was correctly retracted: its Sonnet/Opus K=30 task was ~0 (Opus worse). It was wrong to generalize that to all agents: a fresh **GPT-5.6 Sol pass@30** direct comparison saves **20.0% effective / 24.1% raw input and 12.1% time** on the known-single task. Model, routing, and baseline shape decide it. |
| **GPT-5.6 Sol known refs vs forced real `rg`** | **pass@30, 180 tasks:** **−22.4% effective input, −26.3% raw input, −14.7% time, −67.9% calls, −58.4% tool payload**; semantic correctness tied at 90/90 per strategy. Paired bootstrap 95% intervals stay positive overall. [Run report](./results/gpt56-sol-pass30.md). |
| **`read` `refs` batch — the 2nd-half win** | **pass@30, 150 tasks, real plugin env (codex): −18.6 % effective tokens, −66.6 % shell commands, tied pass@30 (1.000), 0 MCP failures.** Biggest where it *fully replaces* grep — known-cross-file −24.9 % tokens / **−43.6 % time**; a wash-or-slower where it only supplements grep (discovery, multi-symbol-batch). Single read-heavy task in isolation: up to −30 % logical wired / −55 % forced. The cut tracks how *round-trip-heavy / grep-noisy* the native read is; **Opus gains nothing** (native already lean). [EFFICIENCY-CODEX.md](./EFFICIENCY-CODEX.md). |
| **known-ref tokens — grok (`composer-2.5-fast`)** | diverse retrieval, **n=30, median, inference-time + payload decomposition**: known-cross-file **−60 % tokens / −78 % payload**, known-single −53 % / −71 %, file-wide −34 % / −41 %; **discovery +22 % (honest loss)**. (Method fix: wall-clock is ~45 % CLI boot+MCP — we time inference only.) [RESULTS.md](./RESULTS.md#tokens-revisited--model-metric-and-routing-decide-it). |
| **routing skill — the hidden variable** | codex 3-arm (n=6): a routing **skill** beats both native and vague `map-batch` everywhere — `map-batch` is **erratic (+61 % worse on known-batch, 3/6 fail)**; **`map-skill` −34…−54 %, 30/30 pass**, and flips discovery +5 %→**−31 %** by killing the double-call (shell 5→2, reads 1→0). Shipped as the [code-map plugin](https://github.com/annyeong844/map). |
| **`locate` search / semantic / light call-graph (removed)** | **tie or lose** to `grep` (search ties; semantic rejected 3 ways; light graph loses on recall). |
| **"localization efficiency"** | looked like −25 %, **evaporated as noise** on firm-up across 4 instances. |

**Verify it yourself:** `node verify.mjs` re-derives the captured headline numbers from `results/`, including the GPT-5.6 Sol run.

Full write-up: **[RESULTS.md](./RESULTS.md)** (drift, edit, oracle) + **[EFFICIENCY-CODEX.md](./EFFICIENCY-CODEX.md)** (batch, the round-trip law, cross-model codex/Sonnet/Opus, adoption ladder). How to re-run: **[RUNBOOK.md](./RUNBOOK.md)**.

## Layout

```
RESULTS.md      # the honest record: the win + every negative result, with scope
RUNBOOK.md      # how to reproduce each measurement
harnesses/      # the runners (headless `claude -p`, stream-json tool-adoption audit)
  bench-grok-headless.mjs  # GROK our-way harness: inference-time + chat_history token decomposition + median/IQR
  bench-codex-headless.mjs # CODEX native / forced-rg / map arms — usage + route audit
  grep-baseline-server.mjs # read-only real-rg + direct-line baseline for restricted sandboxes
  tasks.diverse.json       # the 5 diverse-retrieval scenarios (known-ref / discovery / file-wide / batch)
  churn.mjs + harness-drift.mjs  # DRIFT RESISTANCE (the real value): 0 silent / 94.5% — pure local, no API
  harness-read.mjs        # read-efficiency K=5 (the retracted token headline)
  harness-read-scaled.mjs # older Sonnet/Opus K=30 scope correction (turns win; tokens ~0 there)
  harness.mjs             # tier-1 navigation sweep
  harness-t23.mjs         # tier-2/3 bug-finding (planted bugs)
  harness-concept.mjs     # concept-query 3-way (A / +code-map / +semantic)
  harness-forced.mjs      # forced lanes + adoption check
  harness-toolcount.mjs   # the adoption confound (agent ignores code-map when it has grep)
  harness-swe.mjs         # SWE-bench localization (requests)
  harness-swe-dj.mjs      # SWE-bench localization (django, hard) + orchestrate.mjs
  b-compare.mjs           # callers precision/recall: grep vs code-map graph vs oracle GT
  oracle-client.mjs       # drives code-oracle (tsgo) for the ground truth
  sem-*.py / semantic-mcp.mjs / embed-index.py / qodo-*.py   # the semantic lane (rejected)
results/        # raw structured outputs (results-*.json) + read-efficiency logs
```

## Honest scope

This is **not** a standardized benchmark. Small N (often 3–5 per cell), a few task
families, a strong-model regime (Sonnet/Opus), real but few repos (`cline`, and
`django`/`requests` SWE-bench instances). It's the reproducible evidence for one
specific claim, not a leaderboard. The harnesses are research scripts — paths are
constants at the top of each file; see RUNBOOK.
