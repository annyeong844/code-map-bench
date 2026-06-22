# code-map vs built-in tools — evidence-based evaluation

Repo: `@annyeong844/code-map` (this repo). Node v25.7.0 (runs `.ts` directly).
Index built fresh: `node src/cli/main.ts index --root . --force` → **187 symbols across 19 files, ~2.0s**, written to `.map-index.json` (75,569 bytes, gitignored).
code-map CLI surface confirmed from `src/cli/main.ts` (case dispatch at lines 48/78/116/133): exactly **`index`, `read`, `changed`, `stats`** (+ help). `locate`, `grep`, `graph`, `hotspots`, `dead`, `outline` all return `unknown command`. MCP exposes one tool, `read`.
code-oracle (separate optional MCP) was **reachable**: `tsgo` warmed on first call (~seconds), answers then `cached: true`. Setup cost: it needs absolute file paths + an explicit `root` (relative paths resolved against the agent CWD, not the target repo, and silently errored until corrected).

All measurements are end-to-end (prereq discovery + the call + any verification). Every section ends with a verdict.

---

## 1. Headline

**(a) Adds capability over built-ins**
- **Drift-resistant addressing.** `read "path#symbol"` returns the symbol's own bytes and self-reports an anchor status: `exact` → `relocated` (re-anchored on the signature line after line numbers shifted) → `anchor-lost` (honest `raw:null` refusal after rename). A raw line/byte read returns a *wrong* slice silently under the same edit. No built-in equivalent.
- **`changed <ids...>` working-set delta.** Re-reads only symbols whose *file* changed since indexing; skips clean files with an explicit "no re-read needed". No built-in equivalent (git diff tells you files changed, not which previously-read symbols to refresh, nor re-slices them).
- **Fan-in ranked resolution.** A bare/ambiguous name returns candidates with the higher-fan-in canonical definition floated to the top. Grep is unordered.
- **(via code-oracle, not code-map) Type-aware `callers`/`definition`/`implementations`.** Resolves real call edges and jumps into `node_modules/*.d.ts`; excludes comments/imports/cross-language string matches that grep includes.

**(b) Applies but no improvement over built-ins (the honest neutral/negative bucket)**
- **Repo overview (Task 1).** `stats` gives only repo-wide kind counts (360 bytes); it does *not* list files, entry points, or layout. `find` + a single `grep` for exports answers the actual overview question in one cheap pass. code-map adds nothing here.
- **Single-symbol body when you already have file+line.** A scoped `Read(file, offset, limit)` is comparable in payload to `read path#name`; code-map's edge is only the stable address and drift status, not raw byte savings, when coordinates are fresh.
- **Bare-name read when the name is genuinely ambiguous.** code-map returns ranked candidates but does *not* auto-pick (status stays `ambiguous`); you still issue a second call. Grep + eyeball reaches the same place in comparable steps.

**(c) Outside code-map's scope (do not penalize)**
- All editing/refactor (rename/move/inline/safe-delete) — built-in Edit/Write only; code-map routes to coordinates, you edit.
- Free-text search (log strings, magic constants) — Grep only.
- Non-code files (config, changelog, README) — Read only.
- External-dep bodies and any type-aware query — code-map does not index `node_modules` (`read "parseSync"` → `not-found`); that is code-oracle's job, not code-map's.

Verdict: code-map's real wins are stable addressing + drift handling + delta refresh; its overview/outline story is weaker than built-ins, and ~half a typical session (edits, free-text, config) is outside its scope entirely.

---

## 2. Added value by area (ordered by frequency × value-per-hit)

- **Pull a known symbol body (very high frequency, medium value).** `read path#name` returns just that symbol (`computeAim`: 2,147 bytes vs whole-file `read.ts` 11,202 bytes — **81% smaller**) with a stable, re-anchorable address. Per hit the byte win is real but a scoped `Read` is close; the compounding value is the *address surviving edits* (§6).
- **Re-anchor reads after edits (high frequency in an edit-heavy session, high value).** `relocated` status + `changed` delta means a 5-edit session does not silently rot prior coordinates. This is the single most differentiated behavior.
- **Disambiguate a duplicated name (medium frequency, medium value).** Fan-in tiebreak floats the canonical def; grep would dump all copies unordered. Saves one read of the wrong file.
- **"Who actually calls this" (medium frequency, high value) — via code-oracle.** Precise call edges across files incl. tests, excluding comments/imports. Grep over-matches (false positives) and under-reaches (misses other dirs unless widened).
- **Reach a dependency's type/definition (low-medium frequency, high value when needed) — via code-oracle.** Jumps into `node_modules` `.d.ts`; code-map and grep-in-src can't.

Verdict: highest combined value is drift-safe addressing for known symbols; type-aware navigation is high value but lower frequency and depends on a warm LSP.

---

## 3. Detailed evidence per task (both sides, full chains)

### Task 1 — High-level repo overview
- **code-map:** `stats` → 1 call, 360-byte output: `symbols:187 files:19` + kind histogram. `read "main"` → ambiguous, ranked candidates (`code-oracle/server.ts#main`, `src/cli/main.ts#main`, `src/mcp/server.ts#main`, plus a fuzzy `MapIndex`). Useful to *find* entry points by name, but no layout/file list.
- **built-ins:** `find src -name '*.ts'` (12 files listed) + one `grep -nE "^export" src/cli/main.ts src/mcp/server.ts`. ~2 calls, gives layout + entry exports directly.
- **Honest limit:** `stats` is totals only — it cannot answer "what's the top-level layout / where are the entry points." Built-ins win.
- Verdict: **(b) no improvement** — use built-ins for overview.

### Task 2 — Structural outline of one 300+-line file (`build-index.ts`, 269 lines)
- **code-map:** *No outline command exists.* `stats` is repo-global. The index JSON *does* hold the per-file symbol list (9 symbols for build-index.ts, e.g. `PY_BACKEND@16`, `runPyBackend@18`, `buildIndex@103`) — so the data is present but **not exposed by any CLI/MCP command**.
- **built-ins:** one `grep -nE "^(export )?(async )?function|^const|^class|^interface" build-index.ts` → full ordered outline in a single call.
- Next step each enables: built-ins → pick a symbol and Read/`read` it; code-map → you must already know the symbol name (no browse).
- Verdict: **capability gap** — built-in-only; grep wins.

### Task 3 — Retrieve one method body without reading the file
- **code-map:** `read "src/core/read.ts#computeAim"` → header `# …#computeAim [exact] src/core/read.ts:54-95` + exactly that function's bytes. **2,147 bytes** (text) / **2,258** (`--json`).
- **whole-file Read:** 11,202 bytes. → **~81% payload reduction**, and you address by name not line.
- **Sub-symbol bonus:** `read … --snippet "indexOfAll(text, entry.searchText)"` resolved to `aim [hit]: line 68 (char 3216-3250)` — a char-range *inside* the symbol, so an edit can target one line, not the whole function. Built-ins have no direct equivalent (grep gives a line, not a symbol-confined char range).
- Verdict: **(a) adds value** for known symbols; a scoped `Read(offset,limit)` narrows the gap but lacks the stable address + snippet range.

### Task 4 — Who calls a symbol (`indexOfAll`)
- **code-oracle `callers`** (on `src/core/util.ts#indexOfAll`): **3 results — read.ts:68, 82, 167** — exactly the call sites. Excluded the import (line 5) and a comment mention (line 34).
- **Grep** `indexOfAll`: **5 hits** — same 3 calls **+ 2 false positives** (import line 5, comment line 34). 40% noise here.
- A cleaner case — **`dispatch`**: oracle returned **10 callers** including 9 in `test/map.test.ts` and excluding the comment at server.ts:109 and the Python-string mention at extract.py:19. Grep "dispatch" in `src` alone is 4 hits (2 non-calls) and misses every test caller unless you widen the path.
- **Honesty flags recorded:** oracle's own note warns dynamic dispatch (Proxy, `obj[k]()`, token-only DI) is invisible. **Major usability flag observed firsthand:** `name`-based lookup uses the *first textual occurrence in the file*. `callers(read.ts, name:"read")` anchored on the word "read" inside a comment (line 10: "server **read** outside…") and returned **0 callers** — a false negative, when the exported `read()` actually has 4 call sites (main.ts:84,97; server.ts:131,137). Passing explicit `line`/`character` was **ignored on the cached call** (it re-reported the stale position). Lesson: pass precise coordinates *and* verify the reported `position` is the intended token; clear/avoid cache reuse when retargeting.
- Verdict: **(a) adds value** (precision + cross-file recall) **with a real footgun** — name-only targeting can silently resolve to the wrong token.

### Task 5 — Transitive blast radius (several hops)
- **code-map:** no graph. **code-oracle:** single-hop only. Manual chain done: hop1 `callers(computeAim)` → `read@42`; hop2 `callers(read …)` → (correctly, when targeting line 38's function) 4 sites; the comment-anchored attempt gave 0 (see Task 4 flag).
- **built-in equivalent:** a grep ladder — each hop a fresh grep, manually de-noised. hop1 (`computeAim(`) is clean (1 hit); hop2 (`read(`) is **13 raw hits** polluted by `readFile`/`readCore`/`tryReadFile` — grep cannot tell call from substring. Oracle-chaining is more precise but is N manual calls for N hops with no transitive closure.
- Verdict: **gap on both** — no tool gives transitive closure; oracle-chaining is the most precise manual path, grep the cheapest but noisiest.

### Task 6 — Routing/ranking precision (duplicated names)
Index has 15 duplicate names. Tested:
- **`locate`:** candidates ranked **`src/core/locate.ts#locate` (fanIn=2) FIRST**, then the `code-oracle/server.ts` ClassMethod (fanIn=0), then fuzzy `LocateHit`. Canonical floated. ✔
- **`token`:** **`src/core/util.ts#token` (fanIn=2) FIRST**, then the Python copy `src/py/extract.py#token` (fanIn=0). Cross-language duplicate ranked correctly. ✔
- **`TOOLS`:** def + its ExportSpecifier + the second-file copy, all surfaced.
- **vs Grep:** `grep "locate"` returns 6 lines across files in file order — unordered, def buried among call sites and a type comment.
- **Honest limit:** with ≥2 same-name candidates code-map stays `ambiguous` (returns ranked list, does not auto-pick) → a second `read` of the chosen id is needed.
- Verdict: **(a) adds value** — ranking is correct and saves opening the wrong file; not a one-shot resolve.

### Tasks 7–9 — Drift reliability (the distinctive axis; all three stages run, then reverted)
- **(a) baseline:** `read computeAim` → **`[exact]` 54-95**.
- **(b) line shift:** inserted a 20-line comment block above the symbol (signature line unchanged), **did not re-index**. `read` same id → **`[relocated]` 74-95→74-115**, correct signature line, complete body. **Contrast:** a stale line-number read of 54-56 now lands in a *different symbol's doc comment*. `changed` on a mixed set reported **"1/2 files changed"**, re-sliced the moved `read` (`[relocated] 58-65`) and printed **"unchanged, no re-read needed"** for clean `util.ts#token`.
- **(c) rename:** renamed `computeAim`→`computeAimRENAMED`. `read` old id → **`[anchor-lost]`, `raw:null`**, note: *"signature anchor … no longer present — renamed or removed. Re-run `map index`."* It refused to emit garbage.
- **Three-read chain across the edit** (exact → relocated → anchor-lost) shows the coordinate+searchText-anchor scheme degrades monotonically and honestly where a raw line/byte scheme would silently mis-slice at stage (b).
- **Cleanup:** `git checkout -- src/core/read.ts`; `git status --short` clean; `computeAim` back at line 54.
- Verdict: **(a) unique value** — no built-in offers self-reporting re-anchoring; this is code-map's strongest, most defensible property.

### Task 10 — External dependency / type-grade (`parseSync` from oxc-parser)
- **code-map `read "parseSync"`:** **`not-found`** — `node_modules` is not indexed (0 index entries under node_modules). code-map has **zero** reach into deps.
- **code-oracle `definition(extract-symbols.ts, parseSync)`:** jumped to **`node_modules/oxc-parser/src-js/index.d.ts:210`** with the full signature. Requires warm tsgo + correct root.
- Verdict: **code-map gap; code-oracle (a) adds value** for dep navigation, at LSP setup cost.

### Task 11 — Interface → implementations (`ReadResult`)
- **code-oracle `implementations(ReadResult)`:** **14 sites** — every object-literal *construction* of the type across read.ts (the over-approximate, blast-radius-sound set its note advertises).
- **Grep `ReadResult`:** **8 hits** — type annotations, the import, the interface decl — and **0** of the 14 object literals (they don't contain the string). So grep both **over-matches** (annotations/comments) and **under-matches** (constructions). Opposite failure modes.
- **Honest note:** this repo is mostly flat TS with no class-hierarchy interfaces, so "implementations" here means structural type uses, not subclasses; fan-out can be wide by design.
- Verdict: **(a) adds value** — semantically correct set grep cannot reproduce in one pass.

### Task 12 — Risk surfacing (`hotspots`)
- `node src/cli/main.ts hotspots` → **`unknown command`**. The command **does not exist**, and there is **no built-in equivalent** either (grep/find don't compute churn×complexity). Recorded as missing on both sides; not fabricated.
- Verdict: **not available** — neither tool addresses this.

### Task 13 — Out of scope (built-in only; not penalized)
- **Edit/rename/move/inline/delete:** Edit/Write only — code-map gives coordinates, you mutate. (Used Edit for the drift test; reverted via git.)
- **Free-text pattern** (log string / magic constant): Grep only — e.g. `grep "unknown command"` finds the CLI error path; code-map has no text search.
- **Non-code file** (README/config/changelog): Read only.
- **Share of a typical session:** rough estimate **40–60%** — actual edits, free-text hunts, and config/doc reads dominate many sessions. code-map's retrieval covers the *read-known-symbol* slice, which is frequent but not the majority of tool calls.
- Verdict: **outside scope** — large share of daily work; contextualizes code-map as a retrieval accelerator, not a session-wide tool.

---

## 4. Token efficiency

| Operation | Payload |
|---|---|
| `read path#name` (computeAim, text) | **2,147 B** |
| same, `--json` | 2,258 B |
| whole-file `Read(read.ts)` | 11,202 B |
| `read "changed"` (bare-name, resolves) | 1,146 B |
| `stats` | 360 B |
| `.map-index.json` (one-time, gitignored) | 75,569 B |

- **Per known-symbol read: ~81% smaller than the whole file.** Across a session of N symbol reads in large files this compounds; the absolute win shrinks vs a *scoped* `Read(offset,limit)` when you already know the line range.
- **Forced whole-file reads avoided:** any time you know the name, you skip pulling the file to find it — the index already holds file+line.
- **Addressing:** `path#name` / id is **stable** across line-shifting edits (re-anchors), where a line number is **ephemeral** (invalidated by any edit above it). This is the durable efficiency advantage, not raw bytes.
- **Cost to net out:** the 75 KB index is built once (~2s) and is throwaway/gitignored.

Verdict: meaningful per-read savings and, more importantly, addresses that don't decay — the byte win alone is modest vs a careful scoped Read.

---

## 5. Reliability & correctness

- **Ranking:** fan-in tiebreak floated the canonical def in every duplicate tested (`locate`, `token`); correct, but ties stay `ambiguous` (no silent auto-pick — arguably safer).
- **Drift re-anchoring:** observed all four states firsthand — `exact`, `relocated` (correct re-slice after +20-line shift, no re-index), `anchor-lost` (`raw:null` refusal after rename), and the snippet path's `hit`. Degrades honestly; never returned a wrong-symbol slice. This is the headline correctness property and it held.
- **`changed` correctness:** conservative by design (a symbol is "unchanged" only if its whole file's content token still matches) — no false "unchanged"; verified it skipped a clean file and re-anchored a dirty one in one call.
- **callers/oracle honesty + bounds:** precise on clean cases (indexOfAll 3/3, dispatch 10/10 incl. tests) and self-flags dynamic-dispatch blind spots. **But** the `name`-only API resolves to the *first textual occurrence* and can anchor on a comment (got 0 callers for `read`), and a retarget with explicit coordinates was ignored under cache. Setup cost: warm tsgo (seconds, then cached), absolute paths + explicit root mandatory. Python via `ty` is intra-file and may return `incomplete:true` (not exercised here — no cross-file Python query).
- Verdict: code-map's drift/anchor honesty is excellent and trustworthy; code-oracle is precise but needs careful targeting and a warm backend.

---

## 6. Workflow effects across a session

- **Retrieval advantages compound** in edit-heavy sessions: after each built-in Edit, prior `path#name` addresses still resolve (`relocated`), and `changed <prior ids>` refreshes *only* the symbols whose files you touched — re-reads scale with the *delta*, not the working-set size. A line-number-based memory of "read.ts:54-95" rots after the first edit above line 54; I reproduced that rot (stale 54-56 → wrong comment).
- **Advantages diminish** when: the session is mostly *new* exploration (you don't know symbol names yet → grep/outline first), or mostly *editing/free-text/config* (§8), where code-map is idle.
- Verdict: code-map pays off most in long, iterative edit-then-recheck loops; least in first-pass exploration.

---

## 7. Unique capabilities (no practical built-in equivalent)

- **Self-reporting drift re-anchoring** (`exact`/`relocated`/`anchor-lost` on a stable `path#name`). No built-in tells you a coordinate moved and re-slices correctly; raw line/byte reads fail silently.
- **`changed` working-set delta** that re-slices only symbols in changed files. git tells you files changed; nothing built-in re-reads the affected previously-read *symbols*.
- (Adjacent, via code-oracle, not code-map proper) **type-aware callers/implementations/definition into node_modules** — semantically beyond grep.
- Verdict: drift re-anchoring + `changed` are genuinely unique to code-map.

---

## 8. Out of scope (built-in only) — share of daily work

Edit/refactor (Edit/Write), free-text search (Grep), and config/doc reads (Read) are **not** code-map functions and plausibly **40–60% of tool calls** in a real session. code-map accelerates the "read a known symbol / recheck after edits" slice — frequent and high-leverage, but a minority of total calls. This bounds the adoption claim: code-map is a retrieval/anchoring accelerator layered on top of built-ins, not a replacement for them.

---

## 9. Practical usage rule

- **Use code-map `read`** when you *know the symbol name or id* and want its exact body cheaply, **especially after edits** (drift-safe address) — and use **`changed <ids>`** to refresh a working set after a batch of edits.
- **Use code-map bare-name `read`** to disambiguate a name across files (canonical floats up) before opening anything.
- **Use built-in Grep/find** for repo overview, per-file outlines, free-text/log/constant search, and any "I don't know the name yet" discovery — then hand the discovered name to `read`.
- **Use code-oracle** (warm LSP) for "who really calls this", interface→impls, and jumping into a dependency's types — passing **absolute path + explicit `line`/`character`** and verifying the reported `position` (name-only can anchor on a comment).
- **Don't reach for code-map** for editing, free-text, config/docs, dep bodies, transitive closure, or risk/hotspot ranking — it has no command for these.

---

### Repo state
`git status --short` → clean (all drift-test edits reverted via `git checkout`). `.map-index.json` is gitignored (the `--force` rebuild does not dirty the tree). This file (`map-evaluation.md`) is the only new artifact.
