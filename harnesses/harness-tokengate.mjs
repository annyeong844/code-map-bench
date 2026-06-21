// Token gate: does single `read` beat native (grep+strong agent) on the REAL metric
// (logical_total = in+cacheCreate+cacheRead+out, and total_cost_usd) — at K=30, with CI,
// distribution, and median (robust to native's grep-flounder outliers)? Run per model.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const MCP = '/tmp/codemap-bench/mcp-requests.json';
const MODEL = process.env.BENCH_MODEL || 'opus';
const K = Number(process.env.BENCH_K || 30);
const FUNCS = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const L = FUNCS.map((f) => '- ' + f).join('\n');
const BASE = `Read the implementation of each of these 6 functions and give a one-sentence summary of each:\n${L}\n\nThe repository is the current directory.`;
const COND = {
  A_native: { tools: ['Read', 'Grep', 'Glob'], mcp: null, p: BASE },
  B_single: { tools: ['mcp__code-map__read'], mcp: MCP, p: BASE + '\n\nUse code-map `read`, one symbol per call (single `ref`).' },
};
function run(cond) {
  const args = ['-p', cond.p, '--model', MODEL, '--output-format', 'json'];
  if (cond.mcp) args.push('--mcp-config', cond.mcp);
  args.push('--allowedTools', ...cond.tools);
  const r = spawnSync('claude', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input: '' });
  try { const o = r.stdout || ''; const j = JSON.parse(o.slice(o.indexOf('{"type"'))); const u = j.usage || {}; const inT = u.input_tokens || 0, out = u.output_tokens || 0, cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0; return { turns: j.num_turns ?? 0, logical: inT + cc + cr + out, cost: j.total_cost_usd ?? 0, covered: FUNCS.filter((f) => (j.result || '').includes(f)).length }; }
  catch { return { turns: 0, logical: 0, cost: 0, covered: 0 }; }
}
const rows = [];
for (let k = 0; k < K; k++) for (const c of Object.keys(COND)) { const r = run(COND[c]); rows.push({ cond: c, ...r }); console.error(`  ${c} #${k}: cov ${r.covered}/6 turns ${r.turns} logical ${r.logical} $${r.cost.toFixed(4)}`); }
writeFileSync(`/tmp/codemap-bench/results-tokengate-${MODEL}.json`, JSON.stringify(rows, null, 2));
const A = rows.filter((r) => r.cond === 'A_native'), B = rows.filter((r) => r.cond === 'B_single');
const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const sem = (a, k) => { const m = mean(a, k); return Math.sqrt(a.reduce((s, x) => s + (x[k] - m) ** 2, 0) / (a.length - 1)) / Math.sqrt(a.length); };
const med = (a, k) => { const s = a.map((x) => x[k]).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function saveCI(kk) { const mA = mean(A, kk), mB = mean(B, kk); const rel = Math.sqrt((sem(A, kk) / mA) ** 2 + (sem(B, kk) / mB) ** 2); const save = 1 - mB / mA, half = 1.96 * (mB / mA) * rel; return { save, lo: save - half, hi: save + half, mA, mB, medSave: 1 - med(B, kk) / med(A, kk) }; }
console.log(`\n=== TOKEN GATE (${MODEL}, K=${K}, CONC=1): single read vs native (grep+agent) ===`);
for (const kk of ['logical', 'cost', 'turns']) {
  const c = saveCI(kk);
  console.log(`  ${kk.padEnd(8)}: native ${c.mA.toFixed(kk === 'cost' ? 4 : 0)} → single ${c.mB.toFixed(kk === 'cost' ? 4 : 0)} | single saves ${(c.save * 100).toFixed(1)}% [95% CI ${(c.lo * 100).toFixed(1)}%, ${(c.hi * 100).toFixed(1)}%] · median ${(c.medSave * 100).toFixed(1)}% · ${c.lo > 0 ? 'CI clear ✓' : 'CI touches 0 ✗'}`);
}
console.log(`  coverage: native ${mean(A, 'covered').toFixed(2)}/6 · single ${mean(B, 'covered').toFixed(2)}/6`);
