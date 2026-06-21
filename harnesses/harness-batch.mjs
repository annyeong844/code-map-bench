// Does BATCH read remove code-map's turn penalty while keeping its token efficiency?
// Summarize 6 functions. A=native; B=code-map single reads (N calls); C=code-map BATCH (1 refs call).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/requests';
const MCP = '/tmp/codemap-bench/mcp-requests.json';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 5);
const CONC = Number(process.env.BENCH_CONC || 4);
const FUNCS = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const listing = FUNCS.map((f) => '- ' + f).join('\n');
const BASE = `Read the implementation of each of these 6 functions and give a one-sentence summary of each:\n${listing}\n\nThe repository is the current directory.`;
const COND = {
  A_native: { tools: ['Read', 'Grep', 'Glob'], mcp: null, prompt: BASE },
  B_cm_single: { tools: ['mcp__code-map__read'], mcp: MCP, prompt: BASE },
  C_cm_batch: { tools: ['mcp__code-map__read'], mcp: MCP, prompt: BASE + '\n\nUse code-map `read` with the `refs` array to read ALL of them in ONE call, then summarize.' },
};
function runOne(cond) {
  return new Promise((res) => {
    const args = ['-p', cond.prompt, '--model', MODEL, '--output-format', 'json'];
    if (cond.mcp) args.push('--mcp-config', cond.mcp);
    args.push('--allowedTools', ...cond.tools);
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.on('close', () => {
      try { const j = JSON.parse(s.slice(s.indexOf('{"type"'))); const u = j.usage || {}; const inTok = u.input_tokens || 0, outTok = u.output_tokens || 0, cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0; res({ result: j.result ?? '', turns: j.num_turns ?? 0, inTok, outTok, cc, cr, workTok: inTok + outTok + cc, covered: FUNCS.filter((f) => (j.result || '').includes(f)).length }); }
      catch { res({ result: '', turns: 0, inTok: 0, outTok: 0, cc: 0, cr: 0, workTok: 0, covered: 0 }); }
    });
  });
}
const jobs = [];
for (const c of Object.keys(COND)) for (let t = 0; t < K; t++) jobs.push({ c, t });
const rows = [];
let i = 0;
async function worker() { while (i < jobs.length) { const { c, t } = jobs[i++]; const r = await runOne(COND[c]); rows.push({ cond: c, ...r }); console.error(`  ${c} #${t}: cov ${r.covered}/6 turns ${r.turns} workTok ${r.workTok}`); } }
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync('/tmp/codemap-bench/results-batch.json', JSON.stringify(rows, null, 2));
console.log(`\n=== BATCH (${MODEL}, K=${K}): summarize 6 functions ===`);
const m = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / (rs.length || 1);
for (const c of Object.keys(COND)) {
  const rs = rows.filter((r) => r.cond === c);
  console.log(`  ${c.padEnd(13)}: cov ${m(rs, 'covered').toFixed(1)}/6 · turns ${m(rs, 'turns').toFixed(1)} · workTok ${Math.round(m(rs, 'workTok'))}  [in ${Math.round(m(rs, 'inTok'))} · out ${Math.round(m(rs, 'outTok'))} · cacheCreate ${Math.round(m(rs, 'cc'))} · cacheRead ${Math.round(m(rs, 'cr'))}]`);
}
const a = rows.filter((r) => r.cond === 'A_native'), cb = rows.filter((r) => r.cond === 'C_cm_batch');
console.log(`  → batch vs native: turns ${(m(cb, 'turns') / m(a, 'turns') * 100).toFixed(0)}% · workTok ${(m(cb, 'workTok') / m(a, 'workTok') * 100).toFixed(0)}% of native`);
