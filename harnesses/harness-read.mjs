// Read-efficiency re-validation: summarize 6 functions spread across 6 files.
// A = native Grep+Read (whole files) | B = code-map locate+read ONLY (slices, forced).
// Measures work-tokens (the read cost) + adoption + all-6-covered. Both models.
import { spawn } from 'node:child_process';
const REPO = '/tmp/codemap-bench/requests';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 5);
const CONC = Number(process.env.BENCH_CONC || 4);
const FUNCS = ['get_connection (adapters.py)', 'request (api.py)', 'handle_401 (auth.py)', '_find_no_duplicates (cookies.py)', 'dispatch_hook (hooks.py)', 'prepare_content_length (models.py)'];
const NAMES = ['get_connection', 'request', 'handle_401', '_find_no_duplicates', 'dispatch_hook', 'prepare_content_length'];
const TASK = `Read the implementation of each of these 6 functions in this repository and give a one-sentence summary of what each does:\n${FUNCS.map((f) => '- ' + f).join('\n')}\n\nThe repository is the current directory.`;
const COND = {
  A: { tools: ['Read', 'Grep', 'Glob'], mcp: null },
  // read-only surface: B has ONLY code-map read (it resolves the name→symbol internally).
  B: { tools: ['mcp__code-map__read'], mcp: '/tmp/codemap-bench/mcp-requests.json' },
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
      const tools = {}; let result = '', turns = 0, inTok = 0, outTok = 0, cacheCreate = 0;
      for (const l of s.split('\n')) {
        if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; }
        if (j.type === 'assistant') { for (const c of j.message?.content || []) if (c.type === 'tool_use') { tools[c.name] = (tools[c.name] || 0) + 1; } }
        else if (j.type === 'result') { result = j.result ?? ''; turns = j.num_turns ?? 0; const u = j.usage || {}; inTok = u.input_tokens || 0; outTok = u.output_tokens || 0; cacheCreate = u.cache_creation_input_tokens || 0; }
      }
      const covered = NAMES.filter((n) => result.includes(n)).length;
      res({ result, turns, tools, workTok: inTok + outTok + cacheCreate, covered });
    });
  });
}
const jobs = [];
for (const c of Object.keys(COND)) for (let t = 0; t < K; t++) jobs.push({ c, t });
const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { c, t } = jobs[i++];
    const r = await runOne(COND[c]);
    rows.push({ cond: c, ...r });
    console.error(`  ${c} #${t}: covered ${r.covered}/6 turns=${r.turns} workTok=${r.workTok}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\n=== read-efficiency (model=${MODEL}): summarize 6 spread functions ===`);
for (const c of Object.keys(COND)) {
  const rs = rows.filter((r) => r.cond === c), n = rs.length;
  const mean = (k) => Math.round(rs.reduce((s, r) => s + r[k], 0) / n);
  console.log(`  ${c}: covered ${(rs.reduce((s, r) => s + r.covered, 0) / n).toFixed(1)}/6  turns ${(rs.reduce((s, r) => s + r.turns, 0) / n).toFixed(1)}  workTok ${mean('workTok')}`);
}
const a = rows.filter((r) => r.cond === 'A'), b = rows.filter((r) => r.cond === 'B');
const mt = (rs) => rs.reduce((s, r) => s + r.workTok, 0) / rs.length;
console.log(`  → B/A workTok ratio: ${(mt(b) / mt(a) * 100).toFixed(0)}%  (B saves ${(100 - mt(b) / mt(a) * 100).toFixed(0)}%)`);
