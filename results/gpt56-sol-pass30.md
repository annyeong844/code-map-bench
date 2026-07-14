# GPT-5.6 Sol known-ref retrieval: pass@30 vs forced `rg`

This run directly tests the claim that had previously been over-generalized as
"single read at K=30 is ~0." That older result remains valid for its Sonnet/Opus task,
but it does not generalize to Codex GPT-5.6 Sol.

## Design

- model: `gpt-5.6-sol`
- target: code-map commit `3ce13bae35e7c06d183b7842aeed39ae17756c0f`
- 30 passes, 3 known-ref scenarios, 90 scored tasks per strategy (180 total)
- strategy order alternated 15/15
- baseline: code-map hidden; a read-only MCP wrapper invokes real `rg` and direct
  line-range reads because nested shell execution is unavailable in the Work sandbox
- map arm: one batched `read({ refs: [...] })` per task
- effective input: `uncached + cached * 0.1`; adjusted input: uncached input

## Result

| metric | forced `rg` | code-map | reduction |
|---|---:|---:|---:|
| effective input | 3,269,047 | 2,537,583 | **22.4%** |
| adjusted input | 2,205,904 | 1,768,280 | **19.8%** |
| raw input | 12,837,328 | 9,461,336 | **26.3%** |
| output | 93,676 | 87,283 | **6.8%** |
| elapsed | 1,888,403 ms | 1,611,159 ms | **14.7%** |
| MCP calls | 280 | 90 | **67.9%** |
| tool-result payload | 663,329 chars | 275,790 chars | **58.4%** |

Observed pass@30 is **1.000 for both strategies**. The paired-pass bootstrap 95%
interval remains positive overall: effective input **8.6–33.9%**, raw input
**21.5–31.0%**, and elapsed time **9.6–19.3%** saved.

### By scenario

| scenario | effective input | raw input | elapsed | calls |
|---|---:|---:|---:|---:|
| known batch / multi-symbol | −19.2% | −16.9% | −2.6% | −67.4% |
| known single symbol | **−20.0%** | **−24.1%** | −12.1% | −52.4% |
| known cross-file | **−25.8%** | **−31.6%** | **−28.0%** | **−76.0%** |

## Grader audit

The strict automatic route grader reported 87/90 for code-map and 77/90 for the
baseline. All 16 rejected answers were manually audited:

- 15 were regex false negatives: the answers correctly said dispatch "rejects
  supplying both," while the old regex only recognized phrases such as `not both`.
- one baseline answer made two malformed read calls, recovered, and answered correctly.

Semantic answer correctness was therefore **90/90 for each strategy**. We retain the
strict route scores because tool failures matter operationally, while separating them
from answer correctness.

Machine-readable aggregates are in
[`gpt56-sol-pass30.json`](./gpt56-sol-pass30.json); `node verify.mjs` re-derives the
headline reductions from those captured totals.
