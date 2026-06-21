// Cross-model check on codex (gpt-5.5, xhigh): does code-map help (B<A) like Sonnet, or hurt
// (B>A) like Opus? A = native grep+agent; B = code-map slices via the CLI batch (read --refs).
// Metric: logical tokens = sum over turn.completed of input_tokens+output_tokens (input already
// includes cached). CONC=1. No per-call $ on a ChatGPT account, so tokens are the metric.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const CLI = '../../map/src/cli/main.ts';
const IDX = '/tmp/codemap-bench/requests.map.json';
const K = Number(process.env.BENCH_K || 6);
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
  let inT = 0, out = 0, cmds = 0, last = '';
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'turn.completed' && j.usage) { inT += j.usage.input_tokens || 0; out += j.usage.output_tokens || 0; }
    if (j.type === 'item.completed' && j.item?.type === 'command_execution') cmds++;
    if (j.type === 'item.completed' && j.item?.type === 'mcp_tool_call') cmds++;
    if (j.type === 'item.completed' && j.item?.type === 'agent_message') last = j.item.text || '';
  }
  return { logical: inT + out, inT, out, cmds, covered: FUNCS.filter((f) => last.includes(f)).length };
}
const rows = [];
for (let k = 0; k < K; k++) for (const c of Object.keys(COND)) { const r = run(COND[c]); rows.push({ cond: c, ...r }); console.error(`  ${c} #${k}: cov ${r.covered}/6 · cmds ${r.cmds} · logical ${r.logical}`); }
writeFileSync('/tmp/codemap-bench/results-codex.json', JSON.stringify(rows, null, 2));
const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / (a.length || 1);
const med = (a, k) => { const s = a.map((x) => x[k]).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const A = rows.filter((r) => r.cond === 'A_native'), B = rows.filter((r) => r.cond === 'B_codemap');
console.log(`\n=== CODEX gpt-5.5 xhigh (K=${K}): code-map (B) vs native grep (A) ===`);
for (const [n, a] of [['A_native', A], ['B_codemap', B]]) console.log(`  ${n.padEnd(11)}: cov ${mean(a, 'covered').toFixed(1)}/6 · cmds ${mean(a, 'cmds').toFixed(1)} · logical ${Math.round(mean(a, 'logical'))} (median ${Math.round(med(a, 'logical'))})`);
const save = 1 - mean(B, 'logical') / mean(A, 'logical');
console.log(`  → code-map ${save >= 0 ? 'saves ' + (save * 100).toFixed(0) + '%' : 'COSTS ' + (-save * 100).toFixed(0) + '% MORE'} logical vs native (median saving ${((1 - med(B, 'logical') / med(A, 'logical')) * 100).toFixed(0)}%)`);
