// Integrated 3-way on CONCEPT queries (vocab mismatch — semantic's actual use case).
// A = base (Read/Grep/Glob) | B = +code-map | C = +code-map +semantic (5th tool).
// Identical prompt across conditions (NO nudge) — fair test of "does HAVING semantic help".
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = './cline-main';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 3);
const CONC = Number(process.env.BENCH_CONC || 6);
const CODEMAP = ['mcp__code-map__locate', 'mcp__code-map__read', 'mcp__code-map__grep', 'mcp__code-map__graph', 'mcp__code-map__hotspots'];
const BASE = ['Read', 'Grep', 'Glob'];

// Concept queries phrased to AVOID the implementation's own tokens (vocab mismatch).
const QUESTIONS = [
  { id: 'C1', q: 'When the server is overloaded or rejects us, where does the code wait and try the request again?', gt: /retry\.ts|withRetry/i },
  { id: 'C2', q: 'Where does it stop the same network request from being fired twice at the same time?', gt: /openai-native|inflight|in-flight|requestInFlight|websocket/i },
  { id: 'C3', q: "Where is the model's streamed output text turned into structured tool actions?", gt: /parse-assistant-message|parseAssistantMessage|parseToolCall/i },
  { id: 'C4', q: 'Where can a long-running request be interrupted partway through?', gt: /abort|AbortController|cancel/i },
  { id: 'C5', q: 'Where does it strip or hide private content from messages before sending them out?', gt: /openai-format|convertToOpenAiMessages|sanitize|cleanMessage|redact|filterVisible/i },
];

const CONDITIONS = {
  A: { tools: BASE, mcp: null },
  B: { tools: [...BASE, ...CODEMAP], mcp: '/tmp/codemap-bench/mcp-bug.json' },
  C: { tools: [...BASE, ...CODEMAP, 'mcp__semantic__semantic_search'], mcp: '/tmp/codemap-bench/mcp-C.json' },
};

function runOne(prompt, cond) {
  return new Promise((res) => {
    const args = ['-p', `${prompt}\n\nThe repository is the current directory. Answer concisely: name the file path and function/symbol.`, '--model', MODEL, '--output-format', 'json'];
    if (cond.mcp) args.push('--mcp-config', cond.mcp);
    args.push('--allowedTools', ...cond.tools);
    const t0 = Date.now();
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        const j = JSON.parse(out.slice(out.indexOf('{"type"')));
        res({ result: j.result ?? '', turns: j.num_turns, cost: j.total_cost_usd, ms: j.duration_ms });
      } catch { res({ result: '', turns: 0, cost: 0, ms: Date.now() - t0, err: true }); }
    });
  });
}

const jobs = [];
for (const qq of QUESTIONS) for (const c of Object.keys(CONDITIONS)) for (let t = 0; t < K; t++) jobs.push({ qq, c, t });
console.error(`running ${jobs.length} cells (${QUESTIONS.length}q × 3cond × ${K}), conc=${CONC}`);
const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { qq, c, t } = jobs[i++];
    const r = await runOne(qq.q, CONDITIONS[c]);
    const correct = qq.gt.test(r.result);
    rows.push({ id: qq.id, cond: c, trial: t, correct, ...r });
    console.error(`  ${qq.id} ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} cost=$${(r.cost ?? 0).toFixed(3)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync('/tmp/codemap-bench/results-concept.json', JSON.stringify(rows, null, 2));

const agg = (rs) => {
  const n = rs.length || 1;
  const mean = (k) => rs.reduce((s, r) => s + (r[k] ?? 0), 0) / n;
  return { pass: ((rs.filter((r) => r.correct).length / n) * 100).toFixed(0) + '%', turns: mean('turns').toFixed(1), cost: '$' + mean('cost').toFixed(3), ms: Math.round(mean('ms')) };
};
console.log('\n=== per question × condition ===');
for (const qq of QUESTIONS) console.log(`  ${qq.id}: ` + Object.keys(CONDITIONS).map((c) => `${c} ${agg(rows.filter((r) => r.id === qq.id && r.cond === c)).pass}`).join('  '));
console.log('\n=== overall × condition (A=base, B=+codemap, C=+semantic) ===');
for (const c of Object.keys(CONDITIONS)) console.log(`  ${c}:`, JSON.stringify(agg(rows.filter((r) => r.cond === c))));
