import { writeFileSync as _w } from "node:fs";
// Drift-resistance: read STALE coordinates against CHURNED files, classify each as
// correct-recovery / honest-refusal / SILENT-WRONG, vs a naive "read the stored line" baseline.
// Robust (line-identity) metric — avoids the trailing-semicolon false-positive: a symbol is
// "recovered" iff read relocates to the SAME signature line the truth index now has.
import { readFileSync } from 'node:fs';
import { loadIndex } from '../../map/src/core/store.ts';
import { read } from '../../map/src/core/read.ts';
const REPO = process.argv[2];
const stale = loadIndex(process.argv[3]);
const truth = loadIndex(process.argv[4]);
const truthById = new Map(truth.entries.map((e) => [e.id, e]));
const fileLines = {};
const lineAtFile = (file, n) => { const ls = (fileLines[file] ??= (() => { try { return readFileSync(`${REPO}/${file}`, 'utf8').split('\n'); } catch { return null; } })()); return ls && n >= 1 && n <= ls.length ? ls[n - 1] : null; };
const norm = (s) => (s == null ? '' : s.replace(/;?\s*$/, '').trim()); // lenient: ignore trailing ; / ws

let cmCorrect = 0, cmRefuse = 0, cmSilent = 0, naiveCorrect = 0, naiveSilent = 0, naiveGone = 0, total = 0;
const silentCases = [];
for (const e of stale.entries) {
  const t = truthById.get(e.id);
  if (!t) continue; // symbol gone (moved file / renamed) — both fail; skip from the symbol-level rate
  total++;
  const truthSig = norm(t.searchText);
  // ── code-map read on the churned file, using STALE coords ──
  const r = read(stale, e.id);
  if (r.status === 'exact' || r.status === 'relocated') {
    const got = norm((r.raw ?? '').split('\n')[0]); // first line of the recovered slice
    if (got === truthSig || norm(lineAtFile(t.file, r.line)) === truthSig) cmCorrect++;
    else { cmSilent++; silentCases.push({ id: e.id, status: r.status, got, want: truthSig }); }
  } else cmRefuse++; // anchor-lost / ambiguous / not-found → honest, not silent
  // ── naive: trust the stored line number, read it from the churned file ──
  const naiveLine = norm(lineAtFile(e.file, e.line));
  if (naiveLine === null) naiveGone++;
  else if (naiveLine === truthSig) naiveCorrect++;
  else naiveSilent++;
}
_w("/tmp/codemap-bench/drift-result.json", JSON.stringify({total, cmCorrect, cmRefuse, cmSilent, naiveCorrect, naiveSilent, naiveGone}));
const pct = (x) => ((x / total) * 100).toFixed(1) + '%';
console.log(`\n=== DRIFT RESISTANCE on churned ${REPO.split('/').pop()} (${total} symbols, no re-index) ===`);
console.log(`                       code-map        naive (stored line#)`);
console.log(`  correct recovery     ${pct(cmCorrect).padEnd(15)} ${pct(naiveCorrect)}`);
console.log(`  honest refusal       ${pct(cmRefuse).padEnd(15)} —`);
console.log(`  SILENT WRONG         ${pct(cmSilent).padEnd(15)} ${pct(naiveSilent + naiveGone)}`);
console.log(`  (silent count)       ${String(cmSilent).padEnd(15)} ${naiveSilent + naiveGone}`);
if (silentCases.length) { console.log(`\n  code-map silent cases (first 5 — inspect for metric false-positives):`); for (const c of silentCases.slice(0, 5)) console.log(`    ${c.id} [${c.status}]\n      got:  ${c.got}\n      want: ${c.want}`); }
