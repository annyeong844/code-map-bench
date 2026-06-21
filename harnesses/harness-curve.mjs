// Clean reduction curve: native at K=10 (average out its cache/grep variance) vs code-map
// (flat, K=3) across symbol counts N=1,3,6,12. Per scenario: native mean±SEM, code-map mean,
// reduction with 95% CI. Answers "how much does the cut change with #symbols, for real."
import { spawnSync, } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const KN = Number(process.env.BENCH_KN || 10);  // native K
const KC = Number(process.env.BENCH_KC || 3);   // code-map K (flat → fewer)
const N = JSON.parse(readFileSync('/tmp/codemap-bench/sweep-syms.json', 'utf8'));
const AGENTS = `# Project conventions
## Reading code
ROUTING: when you already know a symbol's name/id/path, read its body with the code-map \`read\`
tool (pass a \`refs\` array for several at once) — do NOT read known symbol bodies with grep/sed/cat.
Use shell search only to DISCOVER candidates you don't know yet; then read exact slices with code-map.
`;
const SCEN = [['N1', 1], ['N3', 3], ['N6', 6], ['N12', 12]].map(([k, n]) => ({ k, n, list: N.slice(0, n).map((s) => '- ' + s).join('\n'), check: N.slice(0, n) }));
function run(scen, shellHint) {
  const prompt = `Read the implementation of each of these functions:\n${scen.list}\nand give a one-sentence summary of each.${shellHint ? '\n\nUse shell tools (grep/sed/cat) to read them.' : ''}`;
  const r = spawnSync('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '-C', REPO, prompt],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, input: '', timeout: 400000 });
  let inT = 0, out = 0, mcp = 0, shell = 0;
  for (const line of (r.stdout || '').split('\n')) { if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'turn.completed' && j.usage) { inT += j.usage.input_tokens || 0; out += j.usage.output_tokens || 0; }
    if (j.type === 'item.completed' && j.item?.type === 'mcp_tool_call' && j.item.server === 'code-map') mcp++;
    if (j.type === 'item.completed' && j.item?.type === 'command_execution') shell++; }
  return { logical: inT + out, mcp, shell };
}
const rows = [];
rmSync(`${REPO}/AGENTS.md`, { force: true });
for (const scen of SCEN) for (let k = 0; k < KN; k++) { const r = run(scen, true); rows.push({ cond: 'native', scen: scen.k, ...r }); console.error(`  [native] ${scen.k} #${k}: ${r.logical} (shell ${r.shell})`); }
writeFileSync(`${REPO}/AGENTS.md`, AGENTS);
for (const scen of SCEN) for (let k = 0; k < KC; k++) { const r = run(scen, false); rows.push({ cond: 'codemap', scen: scen.k, ...r }); console.error(`  [codemap] ${scen.k} #${k}: ${r.logical} (mcp ${r.mcp}/${r.shell})`); }
rmSync(`${REPO}/AGENTS.md`, { force: true });
writeFileSync('/tmp/codemap-bench/results-curve.json', JSON.stringify(rows, null, 2));
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sem = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) / Math.sqrt(a.length) : 0; };
console.log(`\n=== REDUCTION CURVE (codex; native K=${KN}, code-map K=${KC}) ===`);
console.log(`  #syms   native (mean±SEM)        code-map     reduction [95% CI]`);
for (const scen of SCEN) {
  const nv = rows.filter((r) => r.cond === 'native' && r.scen === scen.k).map((r) => r.logical);
  const cm = rows.filter((r) => r.cond === 'codemap' && r.scen === scen.k).map((r) => r.logical);
  const mA = mean(nv), sA = sem(nv), mB = mean(cm), sB = sem(cm);
  const red = 1 - mB / mA; const rel = Math.sqrt((sA / mA) ** 2 + (sB / mB || 0) ** 2); const half = 1.96 * (mB / mA) * rel;
  console.log(`  ${scen.k.padEnd(5)}  ${Math.round(mA).toString().padStart(7)} ± ${Math.round(sA).toString().padStart(5)}   ${Math.round(mB).toString().padStart(7)}    ${(red * 100).toFixed(0)}% [${((red - half) * 100).toFixed(0)}%, ${((red + half) * 100).toFixed(0)}%]`);
}
