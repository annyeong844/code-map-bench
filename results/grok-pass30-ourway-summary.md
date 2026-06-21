# Grok CLI Headless Retrieval Benchmark

- generatedAt: 2026-06-21T17:38:02.253Z
- repo: code-map
- model: grok-composer-2.5-fast
- taskSpec: code-map/bench/codex-headless/tasks.diverse.json
- passesRequested: 30
- sessionMode: headless seed + `--resume <sessionId>` per task
- cacheWarmupTurns: 1
- metric: per-turn delta of contextTokensUsed from signals.json
- comparable rows: scored tasks with stopReason=EndTurn and contextTokensUsed>0

| strategy | attempts | passed | passRate | avg Δ context tok | avg ms | avg tools | grep | read | mcp | batch read |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 150 | 150 | 1.000 | 4962 | 28859 | 3.9 | 1.9 | 2 | 0 | 0 |
| map-batch | 150 | 150 | 1.000 | 4129 | 29293 | 2.7 | 1.3 | 0.2 | 1 | 1 |

## code-map vs native by scenario (mean — legacy, tail-sensitive)

| scenario | tokens Δ | time Δ | tools Δ | map tok | native tok | map ms | native ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| file-wide-cli | -34% | 0% | -50% | 2401 | 3620 | 24913 | 24829 |
| known-batch-multi-symbol | -9% | +4% | -5% | 8594 | 9397 | 30088 | 29017 |
| known-cross-file | -58% | -8% | -76% | 1051 | 2483 | 24880 | 27096 |
| known-single-symbol | -54% | -23% | -58% | 1746 | 3788 | 23837 | 31056 |
| lexical-discovery-first | +24% | +32% | +2% | 6854 | 5520 | 42745 | 32298 |

## code-map vs native — robust (median, our way)

- token Δ = grok contextTokensUsed delta (real tokenizer), median
- time Δ = **inference-only** (turn_started→turn_ended), median — boot/MCP excluded
- toolResult Δ = retrieval payload chars injected into context, median

| scenario | pass (m/n) | tok Δ | map tok [IQR] | native tok [IQR] | infer Δ | map ms | native ms | toolResult Δ | map chars | native chars |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| file-wide-cli | 30/30 | -34% | 2421 [2294-2494] | 3650 [3539-3710] | -21% | 8612 | 10905 | -41% | 6631 | 11230 |
| known-batch-multi-symbol | 30/30 | -7% | 8674 [8627-8690] | 9302 [9233-9351] | +7% | 12386 | 11548 | -28% | 7154 | 9970 |
| known-cross-file | 30/30 | -60% | 988 [964-1160] | 2460 [2234-2733] | -39% | 7078 | 11664 | -78% | 1223 | 5623 |
| known-single-symbol | 30/30 | -53% | 1781 [1719-1831] | 3776 [3603-3948] | -27% | 7887 | 10863 | -71% | 3311 | 11308 |
| lexical-discovery-first | 30/30 | +22% | 6671 [6255-7406] | 5451 [5027-5873] | +57% | 23820 | 15200 | +18% | 20120 | 17085 |

## latency tails (inference > p75 + 3·IQR in cell): 13 turns

- pass 18 native known-single-symbol: 167605ms (fence 34708ms)
- pass 27 map-batch lexical-discovery-first: 119457ms (fence 89847ms)
- pass 18 native known-batch-multi-symbol: 99247ms (fence 31302ms)
- pass 27 map-batch known-cross-file: 83665ms (fence 28690ms)
- pass 2 native lexical-discovery-first: 82823ms (fence 44081ms)
- pass 10 map-batch known-batch-multi-symbol: 76589ms (fence 45393ms)
- pass 24 map-batch known-batch-multi-symbol: 70428ms (fence 45393ms)
- pass 20 native known-single-symbol: 49913ms (fence 34708ms)
- pass 2 native known-cross-file: 49486ms (fence 34239ms)
- pass 27 map-batch file-wide-cli: 45283ms (fence 34871ms)
- pass 20 native lexical-discovery-first: 44294ms (fence 44081ms)
- pass 4 map-batch known-cross-file: 35386ms (fence 28690ms)
