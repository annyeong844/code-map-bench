# Codex Headless Retrieval Benchmark

- generatedAt: 2026-06-20T21:49:54.425Z
- repo: code-map
- taskSpec: code-map/bench/codex-headless/tasks.diverse.json
- passesRequested: 30
- cachedInputWeight: 0.1
- comparisonUsage uses scored task turns only; seed/cache-warmup setup turns stay in results.json.
- adjusted input = input_tokens - cached_input_tokens, so repeated cached prompt prefix is excluded from comparison.
- effective input = uncached_input_tokens + cached_input_tokens * cachedInputWeight.

| strategy | passes | tasks | passed | passRate | cmp turns | effective input | adjusted input | raw input | output | elapsed ms | avg ms | commands | mcp calls | batch reads | mcp failed | cache hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 30 | 150 | 147 | attempt 0.980 / pass@30 1.000 | 150 | 15923946 | 9861153 | 70489121 | 565223 | 5555624 | 37037 | 586 | 0 | 0 | 0 | 0.860 |
| map-batch | 30 | 150 | 146 | attempt 0.973 / pass@30 1.000 | 150 | 12968056 | 7592317 | 61349757 | 592346 | 5160422 | 34403 | 196 | 173 | 158 | 0 | 0.876 |

## By Scenario

| scenario | strategy | attempts | passed | passRate | effective input | adjusted input | raw input | output | elapsed ms | avg ms | commands | batch reads | mcp failed |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| file-wide-cli | map-batch | 30 | 30 | 1.000 | 4124944 | 2382802 | 19804242 | 188101 | 687043 | 22901 | 0 | 30 | 0 |
| file-wide-cli | native | 30 | 30 | 1.000 | 5219181 | 3214816 | 23258464 | 192030 | 956833 | 31894 | 76 | 0 | 0 |
| known-batch-multi-symbol | map-batch | 30 | 26 | 0.867 | 1367066 | 843140 | 6082436 | 62137 | 1363034 | 45434 | 58 | 30 | 0 |
| known-batch-multi-symbol | native | 30 | 27 | 0.900 | 1397444 | 906628 | 5814788 | 42844 | 1094064 | 36469 | 98 | 0 | 0 |
| known-cross-file | map-batch | 30 | 30 | 1.000 | 2191066 | 1289447 | 10305639 | 95937 | 590258 | 19675 | 0 | 30 | 0 |
| known-cross-file | native | 30 | 30 | 1.000 | 2917262 | 1752387 | 13401155 | 102119 | 1046214 | 34874 | 152 | 0 | 0 |
| known-single-symbol | map-batch | 30 | 30 | 1.000 | 1816170 | 1109673 | 8174633 | 79568 | 624251 | 20808 | 1 | 30 | 0 |
| known-single-symbol | native | 30 | 30 | 1.000 | 2141697 | 1360680 | 9170856 | 68635 | 958170 | 31939 | 67 | 0 | 0 |
| lexical-discovery-first | map-batch | 30 | 30 | 1.000 | 3468810 | 1967255 | 16982807 | 166603 | 1895836 | 63195 | 137 | 38 | 0 |
| lexical-discovery-first | native | 30 | 30 | 1.000 | 4248362 | 2626642 | 18843858 | 159595 | 1500343 | 50011 | 193 | 0 | 0 |

Raw all-row usage, setup usage, and Codex JSONL event streams are preserved under `results.json` and `runs/`.
