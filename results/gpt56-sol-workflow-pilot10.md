# GPT-5.6 Sol multi-stage workflows: paired n=10 pilot

This pilot asks whether the known-ref savings survive a continuous engineering
workflow instead of isolated retrieval questions. It is an exploratory **n=10 paired
pilot**, not pass@30; the larger confirmation run is still pending.

## Design

- model: `gpt-5.6-sol`
- 10 paired passes, with strategy order alternated 5/5
- 3 workflows × 4 scored stages × 10 passes = 120 stages per strategy
- workflows: MCP contract change, index-refresh hardening, Python backend extension
- stages: orient → trace → impact analysis → synthesize without tools
- each four-stage workflow runs in one resumed agent session
- baseline: code-map hidden; a read-only MCP wrapper invokes real `rg` and direct reads
- map arm: one batched `read({ refs: [...] })` on every retrieval stage
- effective input: `uncached + cached * 0.1`; adjusted input: uncached input

## Result

| metric | forced `rg` | code-map | reduction |
|---|---:|---:|---:|
| effective input | 11,127,488 | 7,587,089 | **31.8%** |
| adjusted input | 6,037,647 | 4,661,419 | **22.8%** |
| raw input | 56,936,079 | 33,918,123 | **40.4%** |
| output | 403,373 | 336,049 | **16.7%** |
| elapsed | 2,918,101 ms | 2,489,570 ms | **14.7%** |
| MCP calls | 354 | 90 | **74.6%** |
| tool-result payload | 736,847 chars | 549,230 chars | **25.5%** |

Semantic correctness tied at **120/120 stages per strategy**. The paired-pass
bootstrap 95% intervals were effective input **20.2–40.9%**, adjusted input
**4.1–38.3%**, raw input **33.0–45.9%**, output **11.6–21.4%**, elapsed
**4.7–23.3%**, and calls **72.4–76.6%** saved.

### By workflow

| workflow | effective input | raw input | output | elapsed | calls | payload |
|---|---:|---:|---:|---:|---:|---:|
| MCP contract change | −22.0% | −31.9% | −14.2% | −5.9% | −69.1% | −48.3% |
| index-refresh hardening | −30.9% | −39.0% | −15.5% | −16.3% | −71.4% | −40.9% |
| Python backend extension | −35.4% | −43.0% | −18.0% | −20.6% | −80.3% | **+1.9%** |

The Python workflow is an honest exception on payload size: code-map used many fewer
calls, but its returned payload was 1.9% larger. The end-to-end token and time totals
still improved.

## Stage and order checks

The 90 retrieval stages saved 31.9% effective input, 40.5% raw input, 19.8% elapsed,
and 74.6% calls. Both strategies correctly made **zero calls** in all 30 synthesis
stages. Synthesis retained a 31.7% effective / 40.2% raw-input reduction, while its
elapsed time was 4.8% slower for code-map.

Effective-input and call savings were stable across order: grep-first passes saved
31.7% / 74.9%, and map-first passes saved 31.9% / 74.3%. Elapsed savings were more
order-sensitive (6.8% vs 21.3%), so the time estimate deserves a larger run.

## Audit and scope

All 240 stage answers passed the final semantic audit. One baseline read call used
malformed argument names; the model recovered and answered correctly. code-map had
zero failed calls and made exactly 90 batched calls across the 90 retrieval stages.

This result supports a strong follow-up hypothesis, not a final benchmark headline:
it covers one repository, three hand-authored workflows, and 10 paired passes. The
machine-readable aggregates are in
[`gpt56-sol-workflow-pilot10.json`](./gpt56-sol-workflow-pilot10.json), and
`node verify.mjs` re-derives the headline reductions.
