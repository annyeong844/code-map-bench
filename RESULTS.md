# code-map — measurements

The honest record behind [`code-map`](https://github.com/annyeong844/map)'s claims.
Every capability was benchmarked against **`grep` + a strong agent**, and against a
**naive baseline**; the tool surface and the README were then cut to match what
survived. The negative results — and the *retractions* — are kept on purpose.

## TL;DR

- **Strongest, fully verified — drift resistance, BOTH read and edit (integrity).**
  After heavy churn (every file line-shifted + mid-inserts + body-edits + a move),
  against the **stale** index without re-indexing:
  - *read* coordinates: **0 silently-wrong bytes**, 94.5 % correct recovery, 5.5 %
    honest refusal — vs naive line-caching at **100 % silent**.
  - *edit* targeting (`aim`: a quoted snippet → its current exact char range): **0
    silent mistargets**, 94.5 % correct, vs naive char-offset at **100 % mistarget**.
  *Independently reproduced* (requests here; ai-chatbot by a reviewer: 0 silent /
  97.7 % read, 0 mistarget / 97 % edit). "Nothing is silently trusted" holds at churn
  scale for *both* read and write coordinates — this is the tool's real virtue.
- **Type-oracle caller precision (`code-oracle`, separate).** For refactoring
  blast-radius, the tsgo oracle cuts the files-to-read **~31 % overall** vs grep
  (40–75 % on common/colliding method names, ~0 on distinctive ones) — grep can't tell
  *which* class's `createMessage` you mean; the checker can. Costs LSP warmup.
- **Efficiency is TURNS, not tokens — *for the Sonnet/Opus read-scaled task*.** At K=30
  (tight CI): `read` cuts **~25–30 % of agent turns** (N=6, both models, CI clear of 0).
  **Token savings are NOT significant there** (Sonnet ~0 % [CI −8..15]; Opus **−11 %**
  [CI −19..−3], *worse*). The earlier "−13…35 % tokens" was **K=5 noise — retracted.**
- **But tokens *do* drop on known-ref reads — conditionally.** On the diverse retrieval
  harness: **grok known-ref −53…−60 % tokens** (n=30, median; loss on discovery, +22 %),
  and on **codex a routing *skill* gives −34…−54 %** where vague `map-batch` is erratic
  (**+61 %** worse on one scenario). **Routing is the hidden variable**; tokens are
  metric-/model-/routing-dependent. See *Tokens, revisited*.
- **Removed (tie or lose to `grep` + a strong agent):** lexical search, semantic
  embeddings (rejected 3 ways), structural call-graph.

## Verify (don't trust the markdown — run it)

```bash
node verify.mjs   # re-derives drift (0 silent / 94.5%), K=30 turns/token CI,
                  # adoption (0 code-map calls when grep present), forced 90/90/80 — from raw
```

---

## Drift resistance — the strongest result (and fully reproducible)

The core promise is *integrity*: stale coordinates must never silently return the
wrong bytes. Test (pure local, no agent/API — `churn.mjs` + `harness-drift.mjs`):

1. index a repo = **stale** coordinates;
2. apply realistic churn **without re-indexing** — line-shift (almost every file),
   mid-file inserts, function-body edits, a file move;
3. re-index the churned tree = **truth** coordinates;
4. for every symbol, `read` it via the **stale** index and classify against truth.

**requests, 676 symbols, after churn, no re-index:**

| | code-map | naive (trust stored line#) |
|---|---|---|
| correct recovery | **94.5 %** | 0.0 % |
| honest refusal | 5.5 % (moved/lost → "re-index") | — |
| **silently wrong** | **0.0 % (0)** | **100 % (676)** |

Line numbers all shifted, yet `read` re-anchors on the signature line to the right
symbol — or refuses. **Zero silent errors.** Naive line-caching returns the wrong line
every time. (Reviewer's independent run on `ai-chatbot`: same shape — 0 silent, 97.7 %
recovery.)

> **Metric honesty (a caught false-positive):** a first pass reported 6.2 % silent —
> it was a *measurement* bug: a `const` slice excludes the trailing `;` but the
> signature line includes it, so a strict byte-equality flagged correct symbols. The
> robust metric here compares signature-line identity (trailing `;`/whitespace
> normalized) → real silent rate 0. (The project's own lesson — verify your metric —
> applied to the benchmark itself.)

"Recovery" means the right *start* was re-found; a body-edited function may have a
stale *end* boundary — but `read` flags that ("verify the boundary"), so it is not
silent. Moved files need a re-index (incremental, ~ms); naive fails there too, just
silently.

### Edit targeting too: `aim` (`harness-aim.mjs`)

The same guarantee for *writing*. In an autonomous loop an agent decides "patch this
line" at turn 1; by turn 5 the file has shifted underneath. `aim` takes the snippet
the agent quoted and re-resolves its **current exact char range** — drift-safe patch
targeting. On the same churned requests (676 snippets, no re-index): **0 silent
mistargets**, 94.5 % correct, 5.5 % honest refusal — vs a naive stored-char-offset at
**100 % mistarget**. (`aim` deliberately refuses rather than search the whole file when
it can't re-confine the symbol — a whole-file search could hit the *same* snippet in a
*different* symbol.) So both read- and write-coordinates survive churn with zero silent
errors.

---

## Efficiency — turns, not tokens (corrected at K=30)

Task: "summarize N functions spread across N files" (read-heavy). A = native
grep+Read; B = code-map `read` (slice). `harness-read-scaled.mjs`, **K=30**, 95 % CI:

| config | tokens saved [95% CI] | turns saved [95% CI] | correctness |
|---|---|---|---|
| requests N=6, Sonnet | **3 % [−8..15]** | **25 % [13..36]** | 6/6 both |
| requests N=12, Sonnet | **0 % [−20..21]** | −15 % [−41..12] | 12/12 both |
| requests N=6, Opus | **−11 % [−19..−3]** | **30 % [26..33]** | 6/6 both |
| requests N=12, Opus | 10 % [0..19] (borderline) | 19 % [8..30] | 12/12 both |

- **Turns: a real, robust win at N=6** (~25–30 %, both models, CI above 0) — `read`
  lands the symbol directly instead of grep→read.
- **Tokens: no reliable saving** — across the four configs the saving is {3, 0, −11, +10}%, spanning *significantly negative* (Opus N=6) to *borderline positive* (Opus N=12), no consistent sign. The MCP
  tool-def overhead + reasoning/output tokens swamp the slice saving). The slice *is*
  ~3 % of its file (deterministic ceiling), but end-to-end that saving is diluted away.
- **Does NOT scale with N:** at N=12 the win vanishes (output/reasoning tokens grow).
- **Mechanism ceiling (no agent):** a slice is the median **3 %** of its file (~12–21×
  fewer tokens *for that read*) — real, but the agentic end-to-end token effect is ~0.

**Retraction:** the K=5 headline ("read saves 13–35 % tokens") was the optimistic tail
of a noisy distribution. K=30 with tight CI shows the *token* claim doesn't hold; the
*turn* claim does. Same discipline that retracted the −25 % localization "win" (below).

---

## Tokens, revisited — model, metric, and routing decide it

The "tokens ~0" result above is real **for its conditions** (Sonnet/Opus, the
read-scaled summarize task, raw input/output tokens). Two later runs on a different
model and a different harness (`bench-grok-headless.mjs`, `bench-codex-headless.mjs`,
diverse retrieval tasks, resume sessions) show the token effect is **conditional**, and
isolate the variable that swings it: **routing**.

### Measurement fix first (why earlier wall-clock was noise)

The headless harness records per-turn `contextTokensUsed` (the model's own tokenizer),
and the "our-way" pass also splits `chat_history.jsonl` by message type — so the
**retrieval payload** (`tool_result` chars) is measured directly (it's ~84 % of injected
chars). Crucially, **wall-clock is ~45 % process boot + MCP init** (a fresh CLI process
per resumed turn; one always-failing MCP handshake lived there 302/302 turns), so we
time **inference only** (`turn_started → turn_ended`) and report **median + IQR**, not
mean (latency tails wreck the mean). Wall-clock had compressed every real difference
toward zero.

### Grok (`grok-composer-2.5-fast`), 30 passes, median

| scenario | tokens Δ | inference Δ | retrieval payload Δ |
|---|---:|---:|---:|
| known-cross-file | **−60 %** | −39 % | **−78 %** |
| known-single-symbol | **−53 %** | −27 % | **−71 %** |
| file-wide | −34 % | −21 % | −41 % |
| known-batch | −7 % | +7 % | −28 % |
| **discovery (lexical-first)** | **+22 %** | +57 % | +18 % |

When the **refs are known**, code-map cuts both tokens and the injected payload hard
(cross-file/single the biggest), and the win survives the tail (tight IQR, 30/30 pass).
**Discovery is still an honest loss** — grep must find first, and adding a `read` on top
pays twice. So the picture is not "tokens ~0" *or* "tokens −50 %" — it's **−50…−60 % on
known refs, a loss on discovery**, and the split depends on the metric (this is
window-occupancy growth, not the read-scaled harness's raw input/output).

### Routing is the hidden variable — a skill removes the discovery double-call

Same diverse tasks on **Codex**, three arms (native vs `map-batch` vs `map-skill`),
6 passes, cache-aware *effective input* Δ vs native:

| scenario | map-batch | **map-skill** | pass (n / mb / ms) |
|---|---:|---:|---:|
| known-cross-file | −18 % | **−39 %** | 5 / 6 / **6** |
| known-single | −11 % | **−54 %** | 6 / 6 / **6** |
| file-wide | −7 % | **−38 %** | 5 / 6 / **6** |
| known-batch | **+61 %** | **−34 %** | 6 / **3** / **6** |
| discovery | +5 % | **−31 %** | 5 / 6 / **6** |

`map-batch` (tooling only, vague "use refs when known") is **erratic** — on known-batch
it's **+61 %** *worse* than native and fails 3/6 (the mutual-exclusivity contract). The
only difference in `map-skill` is a routing **skill**: *known refs → one batched read;
discovery → grep and stop, don't add a read on top, don't re-grep to assemble refs.*
That one change makes it the cheapest **and** most reliable arm — **30/30 pass**, lower
tokens everywhere, and it flips discovery from +5 % to **−31 %** by killing the
double-call (discovery shell commands 5 → 2, code-map reads 1 → 0). Same tool, same
tasks; the prompt/skill is what converts the latent saving into a real one.

**Takeaway (honest):** code-map is not a universal token-saver — but on **known-ref
reads** it cuts tokens 30–60 % (grok) / 35–55 % (codex + skill), and a **routing skill**
is what makes that reliable and stops discovery from regressing. The Sonnet/Opus
read-scaled "tokens ~0" still stands for *its* conditions; tokens are simply
metric-, model-, and routing-dependent. This routing is shipped as the
[`code-map` plugin](https://github.com/annyeong844/map) (skill + Claude/Codex/grok/Antigravity).
Raw summaries: `results/grok-pass30-ourway-summary.md`, `results/codex-pass6-skill-summary.md`.

---

## Type-oracle caller precision (`code-oracle` — separate, type-aware)

For "who calls F" (refactoring blast-radius), grep has 100 % recall but name-collisions
inflate the read-set; the tsgo oracle returns the *type-confirmed* callers
(`oracle-precision.mjs`, cline):

| symbol | grep files | oracle files | read-set cut |
|---|---|---|---|
| `createMessage` (common, 40 impls) | 59 | 15 | **75 %** |
| `parseAssistantMessageV2` | 4 | 2 | 50 % |
| `getApiStreamUsage` | 5 | 3 | 40 % |
| `getModel` (interface) | 88 | 67 | 24 % |
| `withRetry` / `convertToOpenAiMessages` (distinct) | 43 / 32 | 41 / 31 | 5 % / 3 % |
| **total** | **231** | **159** | **31 % fewer** |

**Non-circular check:** for `createMessage`, the 44 grep-only files each *define their
own* `createMessage` (name collisions) — genuine non-callers the oracle correctly
excludes, not oracle misses. So the precision gain is real: **40–75 % fewer files to
read on common/colliding method names** (where grep drowns), ~0 on distinctive names
(grep already precise), 24 % on interface methods (tsgo's CHA is sound but over-includes).
Cost: LSP warmup (~3 s on cline) + a pinned preview dependency — why `code-oracle` is a
separate sibling, not in the light core.

---

## The negative results (why the rest was removed)

**Search / `locate` ties `grep`** — forced + adoption-verified (`harness-forced.mjs`,
Opus): A 90 % / B(code-map) 90 % / C(semantic) 80 %; code-map took *more* turns.

**The adoption confound (key methodological catch)** — `harness-toolcount.mjs`: with
`grep` available the agent called code-map **0 times** (it grepped 83×). So an earlier
"B 93 % > A 73 %" was *not* code-map winning — both grepped, N=15 noise. *Verify the
tool was used; never infer value from the outcome.*

**Semantic embeddings — rejected 3 ways** — standalone recall **1/5** vs locate 2/5
(`sem-eval.py`); integrated, it *hurt* (`harness-concept.mjs`: Sonnet −20 pp & 2.5×
turns; Opus zero benefit); the SOTA Qodo-1.5B (`qodo-*.py`) same mis-rank + CPU-infeasible.

**Call-graph / blast-radius loses to `grep` on recall** — `b-compare.mjs` (GT =
code-oracle/tsgo): grep recall 100 %; the structural graph 47 % (distinct) / **0 %**
(common, dispatch-blind). Precise *and* complete = the separate `code-oracle`, not a
light index.

**"Localization efficiency" — evaporated on firm-up** — one django bug showed −25 %;
across 4 instances the deltas were −55/−25/−20/+16 % and the −55 % was on a run where
code-map was used **0 times** → N=3 noise. Retracted.

**Tier-1/3** — tier-1 nav both 100 % correct; tier-3 abstract bug-finding both **64 %**
(no correctness lift — the strong model is the ceiling).

---

## The full value map (every axis measured)

| axis | result | strength |
|---|---|---|
| drift-safe **read** coordinates | 0 silent / 94.5 % recovery (naive 100 % silent) | **strong** |
| drift-safe **edit** targeting (`aim`) | 0 mistarget / 94.5 % (naive 100 % mistarget) | **strong** |
| type-oracle caller **precision** (`code-oracle`) | 31 % fewer files to read (40–75 % on common names) | **moderate** (LSP cost) |
| read **turns** | −25–30 % (N=6, Sonnet/Opus read-scaled) | modest |
| read **tokens**, Sonnet/Opus read-scaled | ~0 (retracted) | none |
| read **tokens**, known-ref (grok n=30 / codex+skill) | −53…−60 % / −34…−54 % | **conditional** |
| **routing skill** (kills discovery double-call) | discovery +5 %→**−31 %**, 30/30 pass | **strong** |
| search (`locate`) / semantic / light call-graph | tie or lose to grep | none |

## What code-map actually is

A **guess-free coordinate layer that stays correct under churn** — for *both* reading
(`read`, 0 silent) and editing (`aim`, 0 mistarget): hand it a coordinate, it
re-anchors instead of returning/patching stale bytes. Plus a separate type-oracle that
narrows a refactor's read-set on common names. It is **not** a search tool (grep ties
it); it is a token-saver **only on known-ref reads and only with routing** (−30…−60 %
there; ~0 or worse on the read-scaled summarize task; a loss on discovery) — not a
universal one. The value lands only when an agent indexes once, keeps coordinates across
turns, and calls `read`/`aim` (and is *routed* to) — narrow,
but in a churny autonomous session the integrity guarantee (plan at turn 1, patch
lands correctly at turn 5 even as the file moved) is real and, as far as we measured,
unique.

## What this is not

Not a standardized benchmark. Small N, a few task families, a strong-model regime, few
repos. It is reproducible evidence for a deliberately narrow claim — and an honest log
of every hypothesis (and headline) the measurements killed. See `RUNBOOK.md`.
