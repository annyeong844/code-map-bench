// Agentic efficiency on a REAL SWE bug (requests-1963): A=grep+read vs B=+blast.
// Measures turns/tokens + did it identify the fix (req.copy of the ORIGINAL request).
import { spawn } from 'node:child_process';
const REPO = '/tmp/codemap-bench/requests';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 3);
const ISSUE = `Bug in this Python library: \`Session.resolve_redirects\` copies the original request for all subsequent requests in a redirect chain, which can cause incorrect HTTP method selection. Example: a POST gets a 303 (→ converted to GET), then a 307 (should preserve GET) — but because resolve_redirects starts each iteration by copying the ORIGINAL request, it wrongly re-issues a POST. Find the exact code that must change and state the one-line fix.`;
const GT = /req\.copy|copies the original|original request|prepared_request = req|carry.*forward|previous request/i;

const COND = {
  A: { tools: ['Read', 'Grep', 'Glob'], hint: '' },
  B: { tools: ['Read', 'Grep', 'Glob', 'Bash(blast:*)'], hint: ' You also have a CLI tool `blast <symbol>` that, given a symbol name, instantly illuminates its neighborhood: the member/dispatch calls it makes, its verified callers, and callees — use it to understand a symbol fast instead of reading whole files.' },
};
function runOne(cond) {
  return new Promise((res) => {
    const args = ['-p', `${ISSUE}${cond.hint}\n\nThe repository is the current directory.`, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--allowedTools', ...cond.tools];
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: '/tmp/codemap-bench/bin:' + process.env.PATH } });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.on('close', () => {
      const tools = {}; let result = '', turns = 0, inTok = 0, outTok = 0, cacheCreate = 0;
      for (const l of s.split('\n')) {
        if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; }
        if (j.type === 'assistant') { for (const c of j.message?.content || []) if (c.type === 'tool_use') { const n = c.name === 'Bash' ? (c.input?.command || '').split(/\s/)[0] : c.name; tools[n] = (tools[n] || 0) + 1; } }
        else if (j.type === 'result') { result = j.result ?? ''; turns = j.num_turns ?? 0; const u = j.usage || {}; inTok = u.input_tokens || 0; outTok = u.output_tokens || 0; cacheCreate = u.cache_creation_input_tokens || 0; }
      }
      res({ result, turns, tools, workTok: inTok + outTok + cacheCreate });
    });
  });
}
const rows = [];
for (const c of Object.keys(COND)) for (let t = 0; t < K; t++) {
  const r = await runOne(COND[c]);
  const correct = GT.test(r.result);
  rows.push({ cond: c, correct, ...r });
  console.error(`  ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} workTok=${r.workTok} tools=${JSON.stringify(r.tools)}`);
}
console.log('\n=== A=grep+read vs B=+blast (requests-1963) ===');
for (const c of Object.keys(COND)) {
  const rs = rows.filter((r) => r.cond === c), n = rs.length;
  const blasted = rs.reduce((s, r) => s + (r.tools.blast || 0), 0);
  console.log(`  ${c}: pass ${(rs.filter((r) => r.correct).length / n * 100).toFixed(0)}%  turns ${(rs.reduce((s, r) => s + r.turns, 0) / n).toFixed(1)}  workTok ${Math.round(rs.reduce((s, r) => s + r.workTok, 0) / n)}  blast-calls/run ${(blasted / n).toFixed(1)}`);
}
