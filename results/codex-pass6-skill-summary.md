# Codex Headless Retrieval Benchmark

- generatedAt: 2026-06-21T16:38:21.543Z
- repo: code-map
- taskSpec: code-map/bench/codex-headless/tasks.diverse.json
- passesRequested: 6
- cachedInputWeight: 0.1
- comparisonUsage uses scored task turns only; seed/cache-warmup setup turns stay in results.json.
- adjusted input = input_tokens - cached_input_tokens, so repeated cached prompt prefix is excluded from comparison.
- effective input = uncached_input_tokens + cached_input_tokens * cachedInputWeight.

| strategy | passes | tasks | passed | passRate | cmp turns | effective input | adjusted input | raw input | output | elapsed ms | avg ms | commands | mcp calls | batch reads | changed reads | mcp failed | cache hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 6 | 30 | 27 | attempt 0.900 / pass@6 1.000 | 27 | 2298940 | 1251465 | 11726217 | 93721 | 893970 | 29799 | 93 | 0 | 0 | 0 | 0 | 0.893 |
| map-batch | 6 | 30 | 27 | attempt 0.900 / pass@6 1.000 | 30 | 2500666 | 1570184 | 10875016 | 98486 | 892903 | 29763 | 35 | 32 | 32 | 0 | 0 | 0.856 |
| map-skill | 6 | 30 | 30 | attempt 1.000 / pass@6 1.000 | 30 | 1686921 | 844833 | 9265697 | 89228 | 859341 | 28645 | 18 | 26 | 26 | 0 | 0 | 0.909 |

## By Scenario

| scenario | strategy | attempts | passed | passRate | effective input | adjusted input | raw input | output | elapsed ms | avg ms | commands | batch reads | mcp failed |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| file-wide-cli | map-batch | 6 | 6 | 1.000 | 851485 | 533585 | 3712593 | 33009 | 149704 | 24951 | 0 | 6 | 0 |
| file-wide-cli | map-skill | 6 | 6 | 1.000 | 562432 | 282406 | 3082662 | 30450 | 137789 | 22965 | 0 | 6 | 0 |
| file-wide-cli | native | 6 | 5 | 0.833 | 736509 | 420349 | 3581949 | 30855 | 147074 | 24512 | 11 | 0 | 0 |
| known-batch-multi-symbol | map-batch | 6 | 3 | 0.500 | 245841 | 169630 | 931742 | 9108 | 188856 | 31476 | 3 | 6 | 0 |
| known-batch-multi-symbol | map-skill | 6 | 6 | 1.000 | 154594 | 82428 | 804092 | 8541 | 174586 | 29098 | 1 | 6 | 0 |
| known-batch-multi-symbol | native | 6 | 6 | 1.000 | 202182 | 101562 | 1107770 | 8907 | 205883 | 34314 | 18 | 0 | 0 |
| known-cross-file | map-batch | 6 | 6 | 1.000 | 375023 | 222320 | 1749360 | 14882 | 105170 | 17528 | 0 | 6 | 0 |
| known-cross-file | map-skill | 6 | 6 | 1.000 | 300353 | 154612 | 1612020 | 13028 | 98180 | 16363 | 0 | 6 | 0 |
| known-cross-file | native | 6 | 5 | 0.833 | 416820 | 223040 | 2160832 | 15967 | 146533 | 24422 | 19 | 0 | 0 |
| known-single-symbol | map-batch | 6 | 6 | 1.000 | 314048 | 200768 | 1333568 | 12220 | 108223 | 18037 | 0 | 6 | 0 |
| known-single-symbol | map-skill | 6 | 6 | 1.000 | 217942 | 108706 | 1201058 | 10880 | 101023 | 16837 | 0 | 6 | 0 |
| known-single-symbol | native | 6 | 6 | 1.000 | 362752 | 189607 | 1921063 | 13478 | 174490 | 29082 | 16 | 0 | 0 |
| lexical-discovery-first | map-batch | 6 | 6 | 1.000 | 714269 | 443881 | 3147753 | 29267 | 340950 | 56825 | 32 | 8 | 0 |
| lexical-discovery-first | map-skill | 6 | 6 | 1.000 | 451600 | 216681 | 2565865 | 26329 | 347763 | 57961 | 17 | 2 | 0 |
| lexical-discovery-first | native | 6 | 5 | 0.833 | 580677 | 316907 | 2954603 | 24514 | 219990 | 36665 | 29 | 0 | 0 |

Raw all-row usage, setup usage, and Codex JSONL event streams are preserved under `results.json` and `runs/`.
