# Does a loaded routing rule decay over a session, and can a PreToolUse hook stop it?

- generatedAt: 2026-06-22
- driver: headless `claude -p --input-format stream-json --output-format stream-json` (Claude Code 2.1.x), **one growing session per run** so the code-map MCP routing instructions are injected ONCE and context accumulates — a genuine attention-dilution condition. (`--resume` would respawn the MCP and re-inject the rule every turn, which would invalidate the test.)
- target repo: a small indexed TS repo (~187 symbols). code-map MCP `read` available; native `Read` left enabled (realistic). Tools auto-allowed are read-only (grep/cat/sed/… + Grep + `read`).
- task per turn: "Show the implementation of the function `<name>` and explain in one sentence" — **name only, no file path**, so the agent must decide between grep-to-locate and `read`-by-name (which resolves a bare name directly).
- per-turn classification: did the turn use code-map `read`? did it use a shell read/scan (grep / Grep / cat) **first** for a name it already knows = the "grep-first double-call" the routing is meant to remove.

## Update (2026-06-22, decisive): the fix was the instruction wording, not the hook

After the hook experiment, the same flaw was found in the MCP server's own `instructions`: it said *"use shell search to discover names"* — endorsing the grep-first double-call. Reworded (map@3ce13ba) to *"read resolves a bare name/path#name directly; for a known symbol skip the grep; grep only for a name you don't know yet."* Re-measured with **no hook at all**, n=3:

| arm | grep-first turns | notes |
|---|---|---|
| A — old instructions, no hook | 26/45 (58%) | the original defect |
| B2 — retargeted **hook** | 3/45 (7%) | all 3 at turn 1 (hook fires reactively, can't pre-empt the first grep) |
| **corrected instructions, no hook** | **0/45 (0%)** | every turn incl. turn 1, all 3 runs; early 0% / late 0% (no decay) |

**This corrected the earlier interpretation.** The "regression" was not the agent *forgetting* a good rule — it was the agent *obeying a bad one* (the old instruction actively permitted grep-discovery). System/tool-level instructions are high-salience and do **not** dilute the way a mid-conversation skill message does, so once the instruction is unambiguous the agent follows it at 0% with no decay — and the instruction is in context from turn 1, so it even pre-empts the first grep the reactive hook cannot.

**Implication:** the simplest possible fix — one correct sentence in the always-on, stateless, cross-host tool surface — **outperformed the stateful, Claude-Code-only hook**. The hook is now belt-and-suspenders insurance for *untested* very-long / very-large sessions where even tool instructions might dilute; it is not the load-bearing piece.

**Caveats:** 15 turns, one small repo (187 symbols), Claude Code, n=3. (Longer/larger sessions and a weaker model are tested in Update 2.)

## Update 2 (2026-06-22): where it DOES break is model capability — and the hook rescues it

The caveat above was tested directly. On a **capable model (Opus)** the corrected instruction is impervious — grep-first stayed **0%** across every regime: uniform 60 turns, mixed 40 turns (interleaved with 20 legitimate grep turns building a live grep-habit), a context-burial run (all source dumped into context), and **mixed 100 turns**. No length, grep-habit, or context-volume regime induced any dilution. So it does **not** decay over a session on a capable model.

It breaks on **model capability**, not session length. Repeating the mixed-40 regime on a weak model (Claude Haiku):

| model · config | cm:read on read-turns | behavior |
|---|---|---|
| Opus, instruction only | 100% | follows routing |
| **Haiku, instruction only** | **0/20** | bypasses code-map entirely — grep + native `Read`, or answers from earlier reads; ignores the instruction from turn 1 (flat, not decay) |
| **Haiku, instruction + hook** | **20/20** | rescued — the hook fires on turn 1's grep, re-injects "use read", and Haiku switches to read wholesale (grep and native-Read both drop to ~0) |

**This is where the second layer earns its place.** The static instruction is high-salience enough to hold a capable model indefinitely, but a weak model disregards it; the PreToolUse hook's re-injection — delivered at the moment of the offending grep — forces compliance even from a model that ignores the static rule. The two are complementary: the **instruction** is the stateless, cross-host baseline that suffices for capable models; the **hook** is the stateful (Claude-Code-only) safety net that recovers weak models. Keep both ("a fox has two dens").

## Arms
- **A** — no hook (code-map MCP routing instructions only).
- **B** — original PreToolUse guard hook.
- **B2** — guard hook after retargeting its message.

## Results

**code-map `read` adherence: 100% in every arm, every turn.** The catastrophic "abandon `read`, go back to grep" regression did NOT reproduce in 15 controlled turns — the agent always read the body with `read`. What varied was the **redundant grep-first double-call** (grepping to locate a name `read` would have resolved directly).

| arm | grep-first turns | notes |
|---|---|---|
| **A** (no hook), n=3 | **26/45 (58%)** | present from turn 1, recurs all session — 100% of runs grep on turns 1,4,8,11,13,15 |
| **B** (original hook), n=1 | **9/15 (60%)** | **no reduction** — see below |
| **B2** (retargeted hook), n=3 | **3/45 (7%)** | all 3 are turn 1 (pre-nudge); turns 2–15 = **0% across all runs** |

Control (separate run): with the file path GIVEN and native `Read` disabled, arm A was **15/15 clean `read`, 0 grep** — adherence ceiling when no discovery is needed and there is no escape hatch.

## Why the original hook did nothing
The original discovery message said *"using grep to DISCOVER names/lines is correct; just don't grep/cat the body on top."* The agent's actual pattern — grep the name, then `read` the body — is exactly what that message **permits**. So the hook fired (verified: it writes a per-session state file) but endorsed the very double-call it was meant to remove.

Retargeted message: *"code-map `read` resolves a bare name / `path#name` directly — if you ALREADY KNOW the symbol, skip the grep; grep only to discover a name you don't know yet."* One turn-1 nudge then suppressed grep-first for the rest of the session (58% → 7%, n=3).

## Takeaways
- A PreToolUse re-injection hook **can** hold a routing rule that a loaded skill/instruction lets slip — but **only if its message targets the actual behavior**. A mis-targeted re-injection is a no-op; you have to measure that the message moves the behavior, not just that the hook fires.
- In this controlled setup the failure mode was a *redundant* grep-first double-call, not read-abandonment; `read` itself was used 100% of the time. Catastrophic abandonment may need longer sessions / larger context / other hosts and was not observed here.
- The hook is **Claude Code only** (PreToolUse contract). Other hosts fall back to the skill/rules, which this experiment shows can be permissive.

## Method notes / limits
- n=3 per arm for A and B2 (B is n=1, shown only to demonstrate the message defect). Single small repo, 15 turns. `read` deferred behind a tool-search step in this environment (constant across arms).
- Driver and per-turn classifier were custom; classification is by tool-call *attempt* (a grep counts even if it would resolve to the same place), which is the routing signal of interest.
