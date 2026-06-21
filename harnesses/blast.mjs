// blast — on a HIT, detonate: illuminate the structural neighborhood in one shot.
// HIT (locate) + caller blast (graph) + callee blast (graph verified + member-call names) + slice.
// The member-call extraction lights the DISPATCH neighborhood the graph alone leaves dark.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const MAP = 'node ../../map/src/cli/main.ts';
const I = process.env.IDX || '/tmp/codemap-bench/requests.map.json';
const REPO = process.env.REPO || '/tmp/codemap-bench/requests';
const q = process.argv[2];
const run = (c) => { try { return execSync(c, { encoding: 'utf8' }); } catch (e) { return e.stdout || ''; } };

// 1. HIT
const loc = run(`${MAP} locate "${q}" --index ${I}`);
const hitId = loc.split('\n').find((l) => l.includes('#'))?.trim();
if (!hitId) { console.log('no hit for', q); process.exit(0); }
const rangeM = loc.match(/:(\d+)-(\d+)\s+\[/);
const fanM = loc.match(/fan-in (\d+)/);
const [file] = hitId.split('#');
console.log(`\n⊙ HIT  ${hitId}   [fan-in ${fanM ? fanM[1] : '?'}]`);

// 2. slice + member-call neighborhood (dispatch, name-matched — the dark corners)
if (rangeM) {
  const [a, b] = [+rangeM[1], +rangeM[2]];
  let body = '';
  try { body = readFileSync(`${REPO}/${file}`, 'utf8').split('\n').slice(a - 1, b).join('\n'); } catch {}
  const calls = [...new Set([...body.matchAll(/\b([a-z_][\w]*)\.([a-z_]\w*)\s*\(/g)].map((m) => `${m[1]}.${m[2]}`))];
  console.log(`  ↓ calls (member/dispatch, name-matched — graph can't type-resolve these):`);
  console.log('    ' + calls.join(', '));
}

// symbol-name extractor: lines look like "  Kind  file#symbol  (file:line)"
const syms = (txt) => [...new Set([...txt.matchAll(/#([A-Za-z_][\w]*)\s+\(/g)].map((m) => m[1]))];
// 3. caller blast (who depends on this — upstream radius)
const callerTxt = run(`${MAP} graph "${hitId}" --callers --index ${I}`).split('FLOOR')[0];
console.log(`  ↑ callers (verified): ${syms(callerTxt).join(', ') || '(none direct)'}`);
// 4. callee blast (verified free-function calls)
console.log(`  ↓ callees (verified free-fns): ${syms(run(`${MAP} graph "${hitId}" --callees --index ${I}`)).join(', ') || '(none)'}`);
