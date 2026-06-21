// Strip codex's fixed system-prompt re-read: codex re-processes its big system prompt every
// round-trip as CACHED input. Subtract that (cached_input) and compare the REAL new work
// (non-cached input + output) for native grep vs code-map. If the gap collapses, the −55%
// was the re-read overhead, not the work.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const CLI = '../../map/src/cli/main.ts';
const IDX = '/tmp/codemap-bench/requests.map.json';
const K = Number(process.env.BENCH_K || 3);
const FUNCS = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const L = FUNCS.map((f) => '- ' + f).join('\n');
const BASE = `Read the implementation of each of these 6 functions and give a one-sentence summary of each:\n${L}`;
const COND = {
  A_native: BASE + '\n\nUse shell tools (grep/sed/cat) to read them.',
  B_codemap: BASE + `\n\nGet their source by running this ONE command:\nnode ${CLI} read --refs '${FUNCS.join(',')}' --index ${IDX}\nUse only its output. Do not grep or cat source files.`,
};
function run(prompt) {
  const r = spawnSync('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '-C', REPO, prompt],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, input: '', timeout: 400000 });
  let inT = 0, cached = 0, out = 0, reason = 0, cmds = 0, last = '';
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'turn.completed' && j.usage) { inT += j.usage.input_tokens || 0; cached += j.usage.cached_input_tokens || 0; out += j.usage.output_tokens || 0; reason += j.usage.reasoning_output_tokens || 0; }
    if (j.type === 'item.completed' && j.item?.type === 'command_execution') cmds++;
    if (j.type === 'item.completed' && j.item?.type === 'agent_message') last = j.item.text || '';
  }
  const nonCached = inT - cached;       // genuinely new input (not the re-read system prompt/context)
  return { logical: inT + out, cached, realWork: nonCached + out, nonCached, out, cmds, covered: FUNCS.filter((f) => last.includes(f)).length };
}
const rows = [];
for (let k = 0; k < K; k++) for (const c of Object.keys(COND)) { const r = run(COND[c]); rows.push({ cond: c, ...r }); console.error(`  ${c} #${k}: cov ${r.covered}/6 cmds ${r.cmds} | logical ${r.logical} cached ${r.cached} realWork ${r.realWork}`); }
writeFileSync('/tmp/codemap-bench/results-codex-strip.json', JSON.stringify(rows, null, 2));
const mean = (a, k) => Math.round(a.reduce((s, x) => s + x[k], 0) / (a.length || 1));
const A = rows.filter((r) => r.cond === 'A_native'), B = rows.filter((r) => r.cond === 'B_codemap');
console.log(`\n=== CODEX strip system-prompt re-read (K=${K}) ===`);
console.log(`  metric        native      code-map    code-map vs native`);
for (const [m, lbl] of [['logical', 'logical(total)'], ['cached', 'cached(재처리)'], ['realWork', 'REAL work']]) {
  const a = mean(A, m), b = mean(B, m); const d = a ? Math.round((1 - b / a) * 100) : 0;
  console.log(`  ${lbl.padEnd(13)} ${String(a).padStart(8)}   ${String(b).padStart(8)}    ${d >= 0 ? '-' + d : '+' + (-d)}%`);
}
console.log(`  cmds: native ${mean(A, 'cmds')} · code-map ${mean(B, 'cmds')}`);
