# code-map efficiency, across models — and why `batch` was the move

This is the second half of the benchmark. The first half (see [RESULTS.md](RESULTS.md))
measured code-map as a *reading/drift* tool and mostly ate its own hypotheses. This half
asked a sharper question — **does code-map make an agent cheaper, and for whom** — and
produced the project's first clean, reproduced win, plus a measurement correction we had
to make to even see it straight.

Everything here is `claude -p` / `codex exec` headless, `--output-format json`, adoption
audited (we count the tool calls), CONC=1 for the token-causal runs. Harnesses in
`harnesses/`, raw in `results/`.

## 2026 update: GPT-5.6 Sol vs a forced real-`rg` baseline

A new paired pass@30 run closes an over-broad reading of the older single-read result.
With code-map hidden from the baseline and real `rg` plus direct line reads forced through
a read-only MCP wrapper, 90 scored tasks per strategy produced:

| metric | forced `rg` | code-map | Δ |
|---|---:|---:|---:|
| effective input | 3,269,047 | 2,537,583 | **−22.4%** |
| adjusted input | 2,205,904 | 1,768,280 | **−19.8%** |
| raw input | 12,837,328 | 9,461,336 | **−26.3%** |
| elapsed | 1,888,403 ms | 1,611,159 ms | **−14.7%** |
| MCP calls | 280 | 90 | **−67.9%** |
| tool payload | 663,329 chars | 275,790 chars | **−58.4%** |

Observed pass@30 and semantic correctness tied (1.000; 90/90 each). The known-single
cell itself saved **20.0% effective input, 24.1% raw input, and 12.1% time**. Thus the old
"single read at K=30 ~0" remains a valid negative result for its Sonnet/Opus task, but is
not a universal property of `read`. See the [full method and grader audit](results/gpt56-sol-pass30.md)
and machine-readable [aggregates](results/gpt56-sol-pass30.json).

### Multi-stage follow-up: paired n=10 pilot

We also ran three continuous four-stage engineering workflows in resumed sessions:
orient, trace, change-impact analysis, then tool-free synthesis. Across 10 paired
passes (120 scored stages per strategy), code-map reduced effective input **31.8%**,
adjusted input **22.8%**, raw input **40.4%**, output **16.7%**, elapsed time
**14.7%**, MCP calls **74.6%**, and tool-result payload **25.5%**. Semantic
correctness tied at 120/120 stages per strategy.

The effective-input and call reductions stayed nearly identical under alternating
order, but elapsed savings moved from 6.8% on grep-first passes to 21.3% on map-first
passes. One workflow also had 1.9% *larger* map payload despite fewer calls. Treat this
as an exploratory **n=10 pilot, not pass@30**; it motivates the larger confirmation
run without replacing it. Full method and caveats:
[`results/gpt56-sol-workflow-pilot10.md`](./results/gpt56-sol-workflow-pilot10.md).

## The headline: pass@30 plugin benchmark (codex, 150 tasks)

The definitive run — not a single forced task but **150 tasks × 5 scenarios at pass@30**,
in a realistic plugin environment (the code-map MCP + skill, natural adoption), measuring
the corrected token metrics + wall-clock + shell-command count
(`results/pass30-codex-summary.md`). cachedInputWeight 0.1; "effective" =
`uncached + cached×0.1`; "adjusted" = `uncached` (= `input − cached`); "raw" = total input.

| metric | native | map-batch | Δ |
|---|---|---|---|
| **pass@30** | **1.000** (147/150 first-try) | **1.000** (146/150) | tied |
| **effective input** | 15,923,946 | 12,968,056 | **−18.6 %** |
| adjusted (uncached) input | 9,861,153 | 7,592,317 | **−23.0 %** |
| raw input | 70,489,121 | 61,349,757 | −13.0 % |
| wall-clock | 92.6 min | 86.0 min | −7.1 % |
| **shell commands** | 586 | 196 | **−66.6 %** |
| MCP failed | — | **0** / 158 batch reads | adoption 150/150 |

So in a real plugin deployment, code-map (wired + batched) **cuts ~19 % effective tokens
and 67 % of shell commands at identical pass@30 correctness.** Robust to the skill's
~30 k load: treat that as cached (0.1×) → −19.1 %; subtract it from raw → −13.8 %. The
direction doesn't move — if anything, netting the fixed overhead nudges it up.

### Per scenario — where it wins, where it doesn't (the honest gold)

| scenario | effective Δ | time Δ | shell cmds (native→map) | note |
|---|---|---|---|---|
| **known-cross-file** | **−24.9 %** | **−43.6 %** | 152 → **0** | biggest win — scattered known symbols, grep fully replaced |
| file-wide-cli | −21.0 % | −28.2 % | 76 → **0** | win |
| known-single-symbol | −15.2 % | −34.8 % | 67 → **1** | win |
| lexical-discovery-first | −18.3 % | **+26.4 %** | 193 → 137 | tokens ↓ but **slower** — must grep to discover first |
| known-batch-multi-symbol | −2.2 % | **+24.6 %** | 98 → 58 | ~tie tokens, **slower** (native already batches there) |

**The law, sharpened by shell-count:** map-batch wins big precisely where it drops shell
to **0** — i.e. *fully replaces* grep for reading known symbols (cross-file especially:
−44 % wall-clock). Where it only *supplements* grep (discovery-first, multi-symbol-batch:
shell stays 58–137), tokens may still fall but **wall-clock rises** because the agent does
both the grep dance *and* the batch read. So the win is conditional on the task letting
code-map replace, not augment, the search. Not a universal win — and the per-scenario
table says exactly when.

The smaller single-task runs below (§1–§5, K=6–30) found the same mechanism in isolation
(up to −30 % logical wired / −55 % forced on one read-heavy task); this pass@30 run is the
realistic, diluted, deployable number across a diverse task mix.

## 0. The measurement trap we fell into (and fixed)

Our first token metric was `workTok = input + output + cache_creation`. It **dropped
`cache_read`**. Anthropic's real processed input is `input + cache_creation + cache_read`,
so `workTok` measured "newly-computed/cached tokens", not total cost. Once a reviewer
flagged it we switched to:

```
logical_total = input_tokens + cache_creation + cache_read + output_tokens   (+ prefer total_cost_usd)
```

This matters because the differences between strategies live almost entirely in
`cache_read` (see §2). The corrected metric flipped a "batch saves tokens vs single read"
claim into the truth below. **Don't trust a token number that hides cache_read.**

## 1. The real lever: `batch` — round-trips, not bytes

code-map's per-symbol slice is ~32× smaller than a whole-file `Read`, but reading N
symbols one-at-a-time is N calls = N turns. So we added `refs: [...]` to `read` (one
round-trip, many slices). The user's insight that unlocked it: *the bottleneck was turns,
not tokens — collapse the round-trips and both fall.*

Summarize-6-functions, `claude -p`, the clean 4-way (same six reads, only the round-trip
structure differs; `harness-clean4.mjs`, K=8, CONC=1, **logical_total**):

| strategy | turns | logical_total | cost |
|---|---|---|---|
| native (grep + Read) | 11.9 | 117,717 | $0.090 |
| code-map single, **forced sequential** | 9.0 | **238,208** | $0.116 |
| code-map, parallel single calls (1 turn) | 3.8 | 96,695 | $0.077 |
| code-map, `refs` **batch (all)** | **3.3** | **82,413** | **$0.066** |

Batch beats native on all three (logical −30 %, cost −26 %, turns −72 %) **and** beats
single read. The standout: **forced sequential single reads are the *worst* of all** —
each turn re-reads the accumulated context, so round-trips dominate cost.

## 2. Why: tokens are a round-trip effect, not a work effect

Decompose each strategy into *real work* (`input + cache_creation + output` — the new
content read + the reasoning) vs *cache_read* (re-processing the accumulated context each
turn):

| | real work (≈ constant) | cache_read (swings 3×) |
|---|---|---|
| Sonnet, all strategies | 5.8k – 6.8k | 77k – 232k |
| Opus, all strategies | 13.5k – 16k | 62k – 198k |

**The actual work of reading 6 functions + summarizing is ~constant no matter the tool.**
90 %+ of "logical tokens" is `cache_read` — re-reading system prompt + prior turns on
every round-trip. So code-map doesn't *read less*; it *re-processes context fewer times*
by cutting round-trips. And `cache_read` is the cheap token class (~0.1×), which is why
the **cost** delta (−26 %) is smaller than the raw-token delta.

## 3. Across models: the win scales with native-read *inefficiency*

Same task, three models, native vs `refs`-batch (`harness-tokengate.mjs` / `harness-codex.mjs`,
logical_total):

| model | native | code-map batch | **token Δ** | **turns Δ** | native read profile |
|---|---|---|---|---|---|
| **codex (GPT-5.5, xhigh)** | 136k | 61k | **−55 %** | 9.2→1 | grep+sed dance, big system prompt |
| **Sonnet 4.x** | 117k | 82k | **−30 %** | 11.9→3.3 | moderate |
| **Opus 4.x** | 75k | 94k | **+25 % (worse)** | 8.7→4.0 | already lean (75k, K=10 flat) |

- **Turns drop for every model** (−54 % to −89 %): batch is a universal latency win.
- **Tokens only win when native reading is wasteful.** codex's native read is ~11
  round-trips of grep + sed across a large system prompt; code-map collapses it to one
  batch → −55 %. Opus greps so leanly (75k, the lowest of all, K=10 flat) that code-map
  *can't beat it* and the batch's load-everything-at-once even costs more (+25 %).
- This is the quantitative form of the project-wide theme *"strong agents route around
  code-map"*: Opus doesn't route around it so much as **not need it** — its native read is
  already optimal. codex needs it most.

**codex is not "clumsy".** Its grep+sed is a sensible find-then-extract workflow; it's
inherently ~7–11 round-trips, and each round-trip re-processes codex's big context. Even
after stripping the cached re-read, codex's *new* work for native (~24k) exceeds code-map's
(~11k) because grep noise + per-step reasoning add up (`harness-codex-strip.mjs`).

## 4. How much, by task shape: grep-cost, not symbol count

We expected "reduction grows with #symbols". Wrong. Native cost (codex, K=10,
`harness-curve.mjs`) is driven by *which* symbols, not how many:

| #symbols | native (K=10 ±SEM) | code-map (≈flat) | reduction |
|---|---|---|---|
| 1 — `request` (ubiquitous name) | 166k ± 10k | ~95k | **−43 %** |
| 3 | 128k ± 13k | ~95k | −26 % |
| 6 — HTTP verb methods | **95k** ± 3k | ~95k | **~0 %** |
| 12 | 118k ± 9k | ~95k | −20 % |

Non-monotonic: a single *common* name (`request`) makes grep explode (166k) → −43 %; a set
of cheap-to-grep names ties. So **the cut tracks the grep-noisiness of the symbols, not
their count** — the same law as the type-oracle's caller precision (75 % on common names,
~5 % on distinctive ones, RESULTS.md). code-map's own cost stays flat (~95k) regardless,
so its real product is *predictable* read cost vs native's grep-roulette (93k–190k).

## 5. Adoption: the model won't pick it; wiring makes it 100 %

Measured on codex, neutral prompt, both grep and code-map available (`harness-codex-adopt.mjs`
and friends):

| wiring | code-map adoption | grep dropped | logical | note |
|---|---|---|---|---|
| nothing (bare model) | **17 %** | no | 136k | defaults to grep, like every strong agent here |
| MCP server `instructions` (routing rules) | 67 % | partial | 120k (noisy) | advisory — codex mixes grep in, inconsistent |
| **a code-map skill** (SKILL.md) | **100 %** | yes | 128k | reliable; pays a one-time skill-load round-trip |
| **AGENTS.md one-liner** | **100 %** | yes | **95k** | reliable, zero load cost |

- Bare adoption is **17 %** — consistent with the whole project: strong agents grep.
- A **skill** or an **AGENTS.md directive** both reach **100 %** consistent full
  replacement. The MCP server's own `instructions` field helps (17→67 %) but is treated as
  advisory → inconsistent.
- The skill costs **+30k vs AGENTS.md** — and it's *not* the ~500-token SKILL.md text. codex
  loads the skill by running `cat SKILL.md`, which is **one extra round-trip**, and on codex
  one round-trip ≈ 30k (§2). It's a one-time, per-session load (amortizes in a real session;
  every time in single-shot `exec`).

## 6. What to ship

- `read` with `refs` batch is the feature (in the main repo). Use one batch call for
  several independent known symbols.
- To get the win you must **wire adoption** — agents won't self-select code-map:
  - simplest reliable: a one-line project directive (`integrations/codex-skill/` ships the
    skill; an AGENTS.md line is the zero-load alternative): *"read known symbols via
    code-map `read` (batch independent refs); grep only to discover."*
  - the MCP server also self-advertises routing instructions at `initialize` (raises the
    no-config baseline to ~67 %).
- **Honest scope:** −30 % wired on codex (−55 % if forced to a single batch), ~−30 % on
  Sonnet, **a loss on Opus** (native already lean). The value is concentrated where native
  reading is round-trip-heavy and grep-noisy. It is a *cost-predictability + round-trip*
  layer, not a universal token saver.

> Bottom line: `batch` turned code-map from "ties grep" into "−30 % on codex when wired",
> by attacking round-trips (the thing that actually costs tokens) instead of bytes.

## Postscript — `changed()`: the next round-trip win (working-set drift delta)

batch cut round-trips for *reads*; `changed()` cuts them for *re-reads*. In a long session
an agent holds symbols it read earlier; re-reading the whole set each turn re-pays tokens for
code that didn't move. `changed(refs)` checks the per-file content token once per file and
returns current slices only for symbols whose file changed (the rest: an `unchanged` id list).

Deterministic measure (40-symbol working set, requests; `harnesses/harness-drift-delta.mjs`):

| files churned | re-read-all tokens | delta tokens | saving | correctness |
|---|---|---|---|---|
| 10% (4/40) | 15,409 | 2,365 | **−85%** | 0 missed, 0 false-OK |
| 25% (10/40) | 15,409 | 5,070 | −67% | 0 / 0 |
| 50% (20/40) | 15,409 | 7,985 | −48% | 0 / 0 |

Saving ≈ the unchanged fraction (most of a working set in a long session). Conservative
(file-granular → no false negatives). Same caveat as batch: this is the tool-level value;
the *agentic* win needs the agent wired to call `changed` for refresh instead of re-reading
all — adoption is the next thing to measure.
