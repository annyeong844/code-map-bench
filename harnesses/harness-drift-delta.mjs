// Drift-delta value: in a long session an agent holds a working set of symbols read earlier;
// it edits a few files, the rest stay put. Re-reading the WHOLE set every turn re-pays tokens
// for unchanged code. `changed()` returns only the delta. Measure: tokens to refresh the set
// (A = re-read all via read) vs (B = changed: only churned-file slices + a tiny unchanged list),
// + correctness (does B flag exactly the symbols whose file was churned — no miss, no false-OK).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { loadIndex } from '../../map/src/core/store.ts';
import { read, changed } from '../../map/src/core/read.ts';
const MAP = '../../map';
const SRC = process.argv[2] || '/tmp/codemap-bench/requests';
const WORK = '/tmp/codemap-bench/dd-work';
const tok = (s) => Math.round((s || '').length / 4);

rmSync(WORK, { recursive: true, force: true });
cpSync(SRC, WORK, { recursive: true });
execSync(`node ${MAP}/src/cli/main.ts index --root ${WORK} --out ${WORK}/.map-index.json --force`, { stdio: 'ignore' });
const idx = loadIndex(`${WORK}/.map-index.json`);

// Working set: 40 distinct symbols spread across as many files as possible (realistic: an
// agent touching a feature reads symbols across several files).
const byFile = new Map();
for (const e of idx.entries) if (e.charEnd && (e.endLine - e.line) >= 3) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e.id); }
const files = [...byFile.keys()];
const workingSet = [];
let fi = 0;
while (workingSet.length < 40 && files.length) { const f = files[fi % files.length]; const ids = byFile.get(f); if (ids.length) workingSet.push(ids.shift()); fi++; if (fi > 4000) break; }
const wsFiles = [...new Set(workingSet.map((id) => id.split('#')[0]))];

console.log(`working set: ${workingSet.length} symbols across ${wsFiles.length} files\n`);
console.log('churn%  files churned  A:re-read-all toks  B:delta toks  saving   correctness');
for (const frac of [0.1, 0.25, 0.5]) {
  // fresh copy each round (re-churn from clean)
  rmSync(WORK, { recursive: true, force: true }); cpSync(SRC, WORK, { recursive: true });
  execSync(`node ${MAP}/src/cli/main.ts index --root ${WORK} --out ${WORK}/.map-index.json --force`, { stdio: 'ignore' });
  const idx2 = loadIndex(`${WORK}/.map-index.json`);
  const churnFiles = wsFiles.filter((_, i) => i % Math.round(1 / frac) === 0);
  for (const f of churnFiles) writeFileSync(`${WORK}/${f}`, '# edit\n# edit2\n' + readFileSync(`${WORK}/${f}`, 'utf8'));
  // A: re-read the whole working set
  const aToks = workingSet.reduce((s, id) => s + tok(read(idx2, id).raw), 0);
  // B: drift delta
  const d = changed(idx2, workingSet);
  const bToks = d.changed.reduce((s, r) => s + tok(r.raw), 0) + Math.round(d.unchanged.join(',').length / 4);
  // correctness: changed set == symbols whose file was churned
  const churnSet = new Set(churnFiles);
  const shouldChange = workingSet.filter((id) => churnSet.has(id.split('#')[0]));
  const gotChange = new Set(d.changed.map((r) => r.id));
  const missed = shouldChange.filter((id) => !gotChange.has(id)).length;
  const falseOk = d.unchanged.filter((id) => churnSet.has(id.split('#')[0])).length;
  const save = ((1 - bToks / aToks) * 100).toFixed(0);
  console.log(`  ${(frac * 100).toFixed(0).padStart(3)}%    ${String(churnFiles.length).padStart(3)}/${wsFiles.length}        ${String(aToks).padStart(10)}     ${String(bToks).padStart(8)}    −${save}%    missed ${missed}, false-OK ${falseOk}`);
}
console.log('\n(A re-reads every symbol each turn; B returns only churned-file slices + an id list. Saving ≈ unchanged fraction. correctness must be missed 0 / false-OK 0.)');
