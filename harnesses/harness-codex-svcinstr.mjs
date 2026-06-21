// THE adoption gate: codex has BOTH shell (grep/sed/cat) AND code-map MCP (auto-discovered).
// NEUTRAL prompt — no mention of code-map or grep. Does codex reach for code-map on its own?
// If it greps, the -55% only happens when forced. If it picks code-map, the positioning is real.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const K = Number(process.env.BENCH_K || 6);
const FUNCS = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const L = FUNCS.map((f) => '- ' + f).join('\n');
const PROMPT = `Read the implementation of each of these 6 functions and give a one-sentence summary of each:\n${L}`; // NO tool hint
function run() {
  const r = spawnSync('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '-C', REPO, PROMPT],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, input: '', timeout: 400000 });
  let mcp = 0, shell = 0, inT = 0, out = 0, last = '';
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'item.completed' && j.item?.type === 'mcp_tool_call' && j.item.server === 'code-map') mcp++;
    if (j.type === 'item.completed' && j.item?.type === 'command_execution') shell++;
    if (j.type === 'turn.completed' && j.usage) { inT += j.usage.input_tokens || 0; out += j.usage.output_tokens || 0; }
    if (j.type === 'item.completed' && j.item?.type === 'agent_message') last = j.item.text || '';
  }
  return { mcp, shell, usedCodemap: mcp > 0, logical: inT + out, covered: FUNCS.filter((f) => last.includes(f)).length };
}
const rows = [];
for (let k = 0; k < K; k++) { const r = run(); rows.push(r); console.error(`  #${k}: ${r.usedCodemap ? 'CODE-MAP' : 'grep/shell'} · mcp ${r.mcp} shell ${r.shell} · cov ${r.covered}/6 · logical ${r.logical}`); }
writeFileSync('/tmp/codemap-bench/results-codex-svcinstr.json', JSON.stringify(rows, null, 2));
const used = rows.filter((r) => r.usedCodemap).length;
const mean = (a, k) => Math.round(a.reduce((s, x) => s + x[k], 0) / (a.length || 1));
console.log(`\n=== CODEX SERVER-INSTRUCTIONS ADOPTION (K=${K}, neutral prompt, both tools available) ===`);
console.log(`  used code-map (unprompted): ${used}/${K} runs (${Math.round(100 * used / K)}%)`);
console.log(`  avg code-map calls ${mean(rows, 'mcp')} · avg shell commands ${mean(rows, 'shell')}`);
console.log(`  coverage ${mean(rows, 'covered')}/6 · logical ${mean(rows, 'logical')}`);
