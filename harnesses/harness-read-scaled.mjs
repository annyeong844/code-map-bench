// Scaled read-efficiency: one (repo, N, model) config, A=native vs B=code-map read,
// K trials, reported with mean ± stdev (CI). Writes a per-config result JSON.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const REPO = process.env.BENCH_REPO;
const MCP = process.env.BENCH_MCP;
const TARGETS = JSON.parse(readFileSync(process.env.BENCH_TARGETS, 'utf8'));
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 10);
const CONC = Number(process.env.BENCH_CONC || 5);
const LABEL = process.env.BENCH_LABEL || 'cfg';
const NAMES = TARGETS.map((t) => t.split(' (')[0]);
const TASK = `Read the implementation of each of these ${TARGETS.length} functions in this repository and give a one-sentence summary of what each does:\n${TARGETS.map((t) => '- ' + t).join('\n')}\n\nThe repository is the current directory.`;
const COND = {
  A: { tools: ['Read', 'Grep', 'Glob'], mcp: null },
  B: { tools: ['mcp__code-map__read'], mcp: MCP },
};
function runOne(cond) {
  return new Promise((res) => {
    const args = ['-p', TASK, '--model', MODEL, '--output-format', 'stream-json', '--verbose'];
    if (cond.mcp) args.push('--mcp-config', cond.mcp);
    args.push('--allowedTools', ...cond.tools);
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.on('close', () => {
      let result = '', turns = 0, inTok = 0, outTok = 0, cc = 0;
      for (const l of s.split('\n')) {
        if (!l.trim()) continue; let k; try { k = JSON.parse(l); } catch { continue; }
        if (k.type === 'result') { result = k.result ?? ''; turns = k.num_turns ?? 0; const u = k.usage || {}; inTok = u.input_tokens || 0; outTok = u.output_tokens || 0; cc = u.cache_creation_input_tokens || 0; }
      }
      res({ turns, workTok: inTok + outTok + cc, covered: NAMES.filter((n) => result.includes(n)).length });
    });
  });
}
const jobs = [];
for (const c of Object.keys(COND)) for (let t = 0; t < K; t++) jobs.push({ c, t });
const rows = [];
let i = 0;
async function worker() { while (i < jobs.length) { const { c } = jobs[i++]; const r = await runOne(COND[c]); rows.push({ cond: c, ...r }); } }
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync(`/tmp/codemap-bench/scaled-${LABEL}.json`, JSON.stringify(rows, null, 2));
const stats = (xs) => { const n = xs.length; const m = xs.reduce((s, x) => s + x, 0) / n; const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / n); return { m, sd, sem: sd / Math.sqrt(n), n }; };
const A = rows.filter((r) => r.cond === 'A'), B = rows.filter((r) => r.cond === 'B');
const aw = stats(A.map((r) => r.workTok)), bw = stats(B.map((r) => r.workTok));
const at = stats(A.map((r) => r.turns)), bt = stats(B.map((r) => r.turns));
const cov = (rs) => (rs.reduce((s, r) => s + r.covered, 0) / rs.length).toFixed(1);
// 95% CI on the savings ratio via the two means' SEMs (delta method, rough): save = 1 - B/A.
const saveCI = (a, b) => { const save = 1 - b.m / a.m; const rel = Math.sqrt((a.sem / a.m) ** 2 + (b.sem / b.m) ** 2); const half = 1.96 * (b.m / a.m) * rel; return { save: Math.round(save * 100), lo: Math.round((save - half) * 100), hi: Math.round((save + half) * 100) }; };
const ws = saveCI(aw, bw), ts = saveCI(at, bt);
console.log(`[${LABEL}] N=${TARGETS.length} ${MODEL} K=${K}  cov A ${cov(A)}/${NAMES.length} B ${cov(B)}/${NAMES.length}`);
console.log(`  workTok  A ${Math.round(aw.m)}±${Math.round(aw.sem)}(sem)  B ${Math.round(bw.m)}±${Math.round(bw.sem)}  → B saves ${ws.save}% [95%CI ${ws.lo}..${ws.hi}]`);
console.log(`  turns    A ${at.m.toFixed(1)}±${at.sem.toFixed(1)}  B ${bt.m.toFixed(1)}±${bt.sem.toFixed(1)}  → B saves ${ts.save}% [95%CI ${ts.lo}..${ts.hi}]`);
