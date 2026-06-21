// Agentic on a HARD django instance (12470): abstract issue, buried fix (find_ordering_name),
// big repo (grep-noisy). A=grep+read vs B=+blast. turns/tokens + did it localize the fix.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const REPO = '/tmp/codemap-bench/django';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 3);
const ID = process.env.BENCH_ID || 'django-12470';
const ISSUE = readFileSync(process.env.BENCH_ISSUE_FILE || '/tmp/codemap-bench/dj12470-issue.txt', 'utf8').slice(0, 900) +
  '\n\nFind the exact file path and function/method that must be changed to fix this, and briefly say why.';
const GT = new RegExp(process.env.BENCH_GT || 'find_ordering_name|get_order_dir', 'i');
const blastHint = ' You also have a CLI tool `blast <symbol>` that instantly illuminates a symbol\'s neighborhood (the member/dispatch calls it makes, its verified callers and callees) — use it to understand a symbol fast instead of reading whole files.';
const COND = {
  A: { tools: ['Read', 'Grep', 'Glob'], hint: '' },
  B: { tools: ['Read', 'Grep', 'Glob', 'Bash(blast:*)'], hint: blastHint },
};
function runOne(cond) {
  return new Promise((res) => {
    const args = ['-p', `${ISSUE}${cond.hint}`, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--allowedTools', ...cond.tools];
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: '/tmp/codemap-bench/bin:' + process.env.PATH, IDX: '/tmp/codemap-bench/django.map.json', REPO } });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.on('close', () => {
      const tools = {}; let result = '', turns = 0, inTok = 0, outTok = 0, cacheCreate = 0;
      for (const l of s.split('\n')) {
        if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; }
        if (j.type === 'assistant') { for (const c of j.message?.content || []) if (c.type === 'tool_use') { const n = c.name === 'Bash' ? (c.input?.command || '').trim().split(/\s/)[0] : c.name; tools[n] = (tools[n] || 0) + 1; } }
        else if (j.type === 'result') { result = j.result ?? ''; turns = j.num_turns ?? 0; const u = j.usage || {}; inTok = u.input_tokens || 0; outTok = u.output_tokens || 0; cacheCreate = u.cache_creation_input_tokens || 0; }
      }
      res({ result, turns, tools, workTok: inTok + outTok + cacheCreate });
    });
  });
}
const CONC = Number(process.env.BENCH_CONC || 4);
const jobs = [];
for (const c of Object.keys(COND)) for (let t = 0; t < K; t++) jobs.push({ c, t });
const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { c, t } = jobs[i++];
    const r = await runOne(COND[c]);
    const correct = GT.test(r.result);
    rows.push({ cond: c, correct, ...r });
    console.error(`  ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} workTok=${r.workTok} tools=${JSON.stringify(r.tools)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\n=== ${ID} (HARD): A=grep+read vs B=+blast ===`);
for (const c of Object.keys(COND)) {
  const rs = rows.filter((r) => r.cond === c), n = rs.length;
  console.log(`  [${ID}] ${c}: pass ${(rs.filter((r) => r.correct).length / n * 100).toFixed(0)}%  turns ${(rs.reduce((s, r) => s + r.turns, 0) / n).toFixed(1)}  workTok ${Math.round(rs.reduce((s, r) => s + r.workTok, 0) / n)}  grep/run ${(rs.reduce((s, r) => s + (r.tools.grep || r.tools.Grep || 0), 0) / n).toFixed(1)}  blast/run ${(rs.reduce((s, r) => s + (r.tools.blast || 0), 0) / n).toFixed(1)}`);
}
