// Drift-safe EDIT targeting (aim): after churn, give read a snippet quoted from inside a
// symbol; does aim re-resolve its CURRENT exact char range, or silently point at the wrong
// chars? Mistarget = aim says "hit" but the returned range isn't that snippet. vs naive
// (trust the stored char range). Reuses the drift stale/churned setup.
import { readFileSync } from 'node:fs';
import { loadIndex } from '../../map/src/core/store.ts';
import { read } from '../../map/src/core/read.ts';
const REPO = process.argv[2];
const stale = loadIndex(process.argv[3]);
const truth = loadIndex(process.argv[4]);
const truthById = new Map(truth.entries.map((e) => [e.id, e]));
const fileCache = {};
const text = (f) => (fileCache[f] ??= (() => { try { return readFileSync(`${REPO}/${f}`, 'utf8'); } catch { return null; } })());
const norm = (s) => (s == null ? '' : s.replace(/;?\s*$/, '').trim());

let hit = 0, mistarget = 0, refuse = 0, total = 0, naiveCorrect = 0, naiveSilent = 0;
for (const e of stale.entries) {
  const t = truthById.get(e.id);
  if (!t) continue;
  const snippet = e.searchText; // a line quoted from inside the symbol (its signature)
  if (!snippet || snippet.length < 8) continue;
  total++;
  const r = read(stale, e.id, { snippet });
  const aim = r.aim;
  if (aim && aim.status === 'hit') {
    // verify the returned char range, in the CHURNED file, actually is the snippet
    const m = aim.matches[0];
    const got = text(t.file)?.slice(m.charStart, m.charEnd);
    if (norm(got) === norm(snippet)) hit++;
    else mistarget++; // claimed a hit but pointed at the wrong chars — the integrity failure
  } else refuse++; // unanchored / not-in-symbol / ambiguous → honest
  // naive: trust the STALE char offset, read snippet.length bytes there in the churned file
  if (e.charStart != null) {
    const got = text(e.file)?.slice(e.charStart, e.charStart + snippet.length);
    if (norm(got) === norm(snippet)) naiveCorrect++; else naiveSilent++;
  }
}
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/codemap-bench/aim-result.json', JSON.stringify({ total, hit, mistarget, refuse, naiveCorrect, naiveSilent }));
const pct = (x) => ((x / total) * 100).toFixed(1) + '%';
console.log(`\n=== DRIFT-SAFE EDIT TARGETING (aim) on churned ${REPO.split('/').pop()} (${total} snippets, no re-index) ===`);
console.log(`                          aim (code-map)   naive (stored char offset)`);
console.log(`  correct target (hit)    ${pct(hit).padEnd(15)} ${pct(naiveCorrect)}`);
console.log(`  honest refusal          ${pct(refuse).padEnd(15)} —`);
console.log(`  SILENT MISTARGET        ${pct(mistarget).padEnd(15)} ${pct(naiveSilent)}`);
console.log(`  (mistarget count)       ${String(mistarget).padEnd(15)} ${naiveSilent}`);
