// Does the type oracle cut the blast-radius READ-SET vs grep?
// grep gives every file containing the name (recall 100%, but name-collisions inflate it);
// the oracle (tsgo) gives the type-confirmed callers. Value = files grep makes you read
// that the checker says aren't callers of THIS symbol. + spot-check the grep-only files.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const CLINE = './cline-main';
const SRC = CLINE + '/src';
const oracle = JSON.parse(readFileSync('/tmp/codemap-bench/oracle-gt2.json', 'utf8'));
const grepFiles = (name) => { try { return [...new Set(execSync(`grep -rl '\\b${name}\\b' ${SRC} --include='*.ts'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((p) => p.replace(CLINE + '/', '')))]; } catch { return []; } };

console.log(`${'symbol'.padEnd(24)} grep  oracle  read-set cut   (grep-only files an agent would read for nothing)`);
const rows = [];
for (const name of Object.keys(oracle)) {
  if (oracle[name].error) continue;
  const oFiles = new Set(oracle[name].files);
  const g = grepFiles(name);
  const grepOnly = g.filter((f) => !oFiles.has(f)); // grep says read, oracle says not a caller of THIS sym
  const cut = g.length ? Math.round((grepOnly.length / g.length) * 100) : 0;
  rows.push({ name, grep: g.length, oracle: oFiles.size, cut, grepOnly });
  console.log(`${name.padEnd(24)} ${String(g.length).padStart(4)}  ${String(oFiles.size).padStart(5)}   ${(cut + '%').padStart(6)} fewer to read`);
}
const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`\nTOTAL files an agent would open: grep ${tot('grep')} vs oracle ${tot('oracle')}  → ${Math.round((1 - tot('oracle') / tot('grep')) * 100)}% fewer (precision gain)`);
// spot-check: are the grep-only files genuine non-callers (name collisions), not oracle misses?
const common = rows.sort((a, b) => b.cut - a.cut)[0];
console.log(`\nspot-check — ${common.name}: ${common.grepOnly.length} grep-only files (sample 3 — should be name-collisions / non-callers):`);
for (const f of common.grepOnly.slice(0, 3)) {
  let why = '';
  try { const t = readFileSync(`${CLINE}/${f}`, 'utf8'); why = new RegExp(`(class|interface)\\s+\\w+|${common.name}\\s*[(=:]`).test(t) ? 'defines/owns its own ' + common.name + ' (a different symbol — collision)' : 'name appears, not a call of THIS symbol'; } catch {}
  console.log(`  ${f}  — ${why}`);
}
