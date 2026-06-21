// Reduction sweep: how does code-map's token cut vary with task shape? Symbol-count curve
// (1,3,6,12 known) + an UNKNOWN edge (targets described by behaviour, so discovery/grep is
// forced). codex: native(shell) vs code-map(AGENTS.md-wired). Reduction = 1 - codemap/native.
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const K = Number(process.env.BENCH_K || 3);
const N = JSON.parse(readFileSync('/tmp/codemap-bench/sweep-syms.json', 'utf8'));
const AGENTS = `# Project conventions
## Reading code
ROUTING: when you already know a symbol's name/id/path, read its body with the code-map \`read\`
tool (pass a \`refs\` array for several at once) — do NOT read known symbol bodies with grep/sed/cat.
Use shell search only to DISCOVER candidates you don't know yet; then read exact slices with code-map.
`;
const SCEN = [
  { k: 'N1_known', list: N.slice(0, 1).map((s) => '- ' + s).join('\n'), check: N.slice(0, 1) },
  { k: 'N3_known', list: N.slice(0, 3).map((s) => '- ' + s).join('\n'), check: N.slice(0, 3) },
  { k: 'N6_known', list: N.slice(0, 6).map((s) => '- ' + s).join('\n'), check: N.slice(0, 6) },
  { k: 'N12_known', list: N.map((s) => '- ' + s).join('\n'), check: N },
  { k: 'UNKNOWN_search', list: 'the functions that (a) extract cookies into a jar, (b) build a cookie header string, (c) remove a cookie by name, (d) create a cookie object', check: ['extract_cookies_to_jar', 'get_cookie_header', 'remove_cookie_by_name', 'create_cookie'] },
];
function run(scen, useShellHint) {
  const prompt = `Read the implementation of ${scen.k === 'UNKNOWN_search' ? scen.list : 'each of these functions:\n' + scen.list}\nand give a one-sentence summary of each.${useShellHint ? '\n\nUse shell tools (grep/sed/cat) to read them.' : ''}`;
  const r = spawnSync('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '-C', REPO, prompt],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, input: '', timeout: 400000 });
  let mcp = 0, shell = 0, inT = 0, out = 0, last = '';
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'item.completed' && j.item?.type === 'mcp_tool_call' && j.item.server === 'code-map') mcp++;
    if (j.type === 'item.completed' && j.item?.type === 'command_execution') shell++;
    if (j.type === 'turn.completed' && j.usage) { inT += j.usage.input_tokens || 0; out += j.usage.output_tokens || 0; }
    if (j.type === 'item.completed' && j.item?.type === 'agent_message') last = j.item.text || '';
  }
  return { logical: inT + out, mcp, shell, covered: scen.check.filter((f) => last.includes(f)).length, total: scen.check.length };
}
const rows = [];
function sweep(cond, useShellHint) {
  for (const scen of SCEN) for (let k = 0; k < K; k++) {
    const r = run(scen, useShellHint); rows.push({ cond, scen: scen.k, ...r });
    console.error(`  [${cond}] ${scen.k} #${k}: logical ${r.logical} · mcp ${r.mcp} shell ${r.shell} · cov ${r.covered}/${r.total}`);
  }
}
rmSync(`${REPO}/AGENTS.md`, { force: true });   // native: no wiring
sweep('native', true);
writeFileSync(`${REPO}/AGENTS.md`, AGENTS);      // code-map: wired
sweep('codemap', false);
rmSync(`${REPO}/AGENTS.md`, { force: true });
writeFileSync('/tmp/codemap-bench/results-sweep.json', JSON.stringify(rows, null, 2));
const mean = (a, k) => Math.round(a.reduce((s, x) => s + x[k], 0) / (a.length || 1));
console.log(`\n=== REDUCTION SWEEP (codex, K=${K}): logical, native vs code-map, by task shape ===`);
console.log(`  scenario          native    code-map   reduction   (code-map mcp/shell)`);
for (const scen of SCEN) {
  const nv = rows.filter((r) => r.cond === 'native' && r.scen === scen.k), cm = rows.filter((r) => r.cond === 'codemap' && r.scen === scen.k);
  const a = mean(nv, 'logical'), b = mean(cm, 'logical'); const red = a ? Math.round((1 - b / a) * 100) : 0;
  console.log(`  ${scen.k.padEnd(16)} ${String(a).padStart(8)}  ${String(b).padStart(8)}    ${(red >= 0 ? '-' : '+') + Math.abs(red)}%       ${mean(cm, 'mcp')}/${mean(cm, 'shell')}`);
}
