// Clean isolation of batch's PURE effect: every condition reads the SAME 6 symbols; only the
// round-trip structure differs. Proper accounting — logical_total = in+cacheCreate+cacheRead+out
// (NOT the old workTok that dropped cacheRead) and the real total_cost_usd. CONC=1 so parallel
// runs don't contend for the prompt cache. Maps the turns↔cost tradeoff across batch sizes.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const MCP = '/tmp/codemap-bench/mcp-requests.json';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 8);
const FUNCS = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const L = FUNCS.map((f) => '- ' + f).join('\n');
const BASE = `Read the implementation of each of these 6 functions and give a one-sentence summary of each:\n${L}\n\nThe repository is the current directory.`;
const CM = ['mcp__code-map__read'];
const COND = {
  A_native:     { tools: ['Read', 'Grep', 'Glob'], mcp: null, p: BASE },
  B_single_seq: { tools: CM, mcp: MCP, p: BASE + '\n\nUse code-map `read`, ONE symbol per call (single `ref`), sequentially.' },
  C_parallel:   { tools: CM, mcp: MCP, p: BASE + '\n\nUse code-map `read` with a single `ref` each, but issue ALL the read calls in ONE message (parallel tool calls).' },
  D_batch2:     { tools: CM, mcp: MCP, p: BASE + '\n\nUse code-map `read` with the `refs` array, in batches of 2.' },
  D_batch4:     { tools: CM, mcp: MCP, p: BASE + '\n\nUse code-map `read` with the `refs` array, in batches of about 4.' },
  D_batch_all:  { tools: CM, mcp: MCP, p: BASE + '\n\nUse code-map `read` with ONE `refs` array containing all 6.' },
};
function run(cond) {
  const args = ['-p', cond.p, '--model', MODEL, '--output-format', 'json'];
  if (cond.mcp) args.push('--mcp-config', cond.mcp);
  args.push('--allowedTools', ...cond.tools);
  const r = spawnSync('claude', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input: '' });
  try {
    const o = r.stdout || ''; const j = JSON.parse(o.slice(o.indexOf('{"type"'))); const u = j.usage || {};
    const inT = u.input_tokens || 0, out = u.output_tokens || 0, cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
    return { turns: j.num_turns ?? 0, inT, out, cc, cr, logical: inT + cc + cr + out, cost: j.total_cost_usd ?? 0, covered: FUNCS.filter((f) => (j.result || '').includes(f)).length };
  } catch { return { turns: 0, inT: 0, out: 0, cc: 0, cr: 0, logical: 0, cost: 0, covered: 0 }; }
}
const rows = [];
for (let k = 0; k < K; k++) for (const c of Object.keys(COND)) { // CONC=1, interleaved to spread any warmup
  const r = run(COND[c]); rows.push({ cond: c, ...r });
  console.error(`  ${c.padEnd(13)} #${k}: cov ${r.covered}/6 · turns ${r.turns} · logical ${r.logical} · $${r.cost.toFixed(4)}`);
}
writeFileSync('/tmp/codemap-bench/results-clean4.json', JSON.stringify(rows, null, 2));
const m = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / (rs.length || 1);
console.log(`\n=== CLEAN 4-WAY (${MODEL}, K=${K}, CONC=1): same 6 reads, different round-trip structure ===`);
console.log(`  cond           cov   turns   logical_total   cost($)   [in/cacheCreate/cacheRead/out]`);
for (const c of Object.keys(COND)) {
  const rs = rows.filter((r) => r.cond === c);
  console.log(`  ${c.padEnd(13)}  ${m(rs, 'covered').toFixed(1)}/6  ${m(rs, 'turns').toFixed(1).padStart(5)}  ${Math.round(m(rs, 'logical')).toString().padStart(13)}  ${m(rs, 'cost').toFixed(4)}   [${Math.round(m(rs, 'inT'))}/${Math.round(m(rs, 'cc'))}/${Math.round(m(rs, 'cr'))}/${Math.round(m(rs, 'out'))}]`);
}
