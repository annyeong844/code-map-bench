// Wired-adoption gate: put a realistic project instruction in AGENTS.md (codex reads it) —
// "read known symbols via code-map, grep only to search" — then run a NEUTRAL task. Does codex
// follow it (full replacement of grep), and does the -55% materialize in this realistic deploy?
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const K = Number(process.env.BENCH_K || 6);
const FUNCS = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const L = FUNCS.map((f) => '- ' + f).join('\n');
const PROMPT = `Read the implementation of each of these 6 functions and give a one-sentence summary of each:\n${L}`; // neutral, no tool hint
// realistic team wiring — NOT a desperate "always use code-map"; the honest division of labour
const AGENTS = `# Project conventions

## Reading code
When you need to read the implementation of a function/class/symbol whose name you
already know, use the \`code-map\` MCP \`read\` tool (pass a \`refs\` array to read several
at once). It returns the exact symbol slice in one call, so prefer it over grep + sed/cat
for reading known symbols. Use grep only to SEARCH for something whose name or location
you don't yet know.
`;
writeFileSync(`${REPO}/AGENTS.md`, AGENTS);
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
  return { mcp, shell, usedCodemap: mcp > 0, fullReplace: mcp > 0 && shell <= 1, logical: inT + out, covered: FUNCS.filter((f) => last.includes(f)).length };
}
const rows = [];
for (let k = 0; k < K; k++) { const r = run(); rows.push(r); console.error(`  #${k}: ${r.fullReplace ? 'CODE-MAP(full)' : r.usedCodemap ? 'both(mixed)' : 'grep only'} · mcp ${r.mcp} shell ${r.shell} · cov ${r.covered}/6 · logical ${r.logical}`); }
writeFileSync('/tmp/codemap-bench/results-codex-agents.json', JSON.stringify(rows, null, 2));
const used = rows.filter((r) => r.usedCodemap).length, full = rows.filter((r) => r.fullReplace).length;
const mean = (a, k) => Math.round(a.reduce((s, x) => s + x[k], 0) / (a.length || 1));
console.log(`\n=== CODEX WIRED ADOPTION (AGENTS.md, K=${K}, neutral task) ===`);
console.log(`  used code-map: ${used}/${K} (${Math.round(100 * used / K)}%) · FULL replacement (grep dropped): ${full}/${K} (${Math.round(100 * full / K)}%)`);
console.log(`  avg code-map ${mean(rows, 'mcp')} · avg shell ${mean(rows, 'shell')} · logical ${mean(rows, 'logical')} · cov ${mean(rows, 'covered')}/6`);
console.log(`  baselines: natural-adoption 17%/136k · forced code-map ~61k · native grep ~136k`);
