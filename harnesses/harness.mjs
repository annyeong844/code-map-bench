// code-map routing benchmark harness.
// For each (question × condition × trial): run a headless `claude -p` agent in the
// repo, capture cost/turns/tokens/time + grade the answer against ground truth.
// Conditions: A = no code-map (Read/Grep/Glob); B = + code-map MCP. (C = +semantic, later.)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = './cline-main';
const MCP = '/tmp/codemap-bench/mcp.json';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 1);
const CONC = Number(process.env.BENCH_CONC || 3);
const CODEMAP_TOOLS = ['mcp__code-map__locate', 'mcp__code-map__read', 'mcp__code-map__grep', 'mcp__code-map__graph', 'mcp__code-map__hotspots'];
const BASE_TOOLS = ['Read', 'Grep', 'Glob'];

// Tier 1 — direct navigation (no planted bugs needed). GT = regex the answer must hit.
const QUESTIONS = [
  { id: 'D1', tier: 1, q: 'Where is the API retry/backoff logic, and how many times does it retry?', gt: /retry\.ts|withRetry/i },
  { id: 'D2', tier: 1, q: 'Where is the streaming assistant message parsed into tool-call blocks?', gt: /parse-assistant-message|parseAssistantMessageV2/i },
  { id: 'D3', tier: 1, q: 'Where do we convert Cline messages to the OpenAI message format?', gt: /openai-format|convertToOpenAiMessages/i },
  { id: 'D4', tier: 1, q: "What is the `ApiStream` type and where is the streaming transform defined?", gt: /transform\/stream|ApiStream/i },
  { id: 'D5', tier: 1, q: 'Where is `normalizeApiConfiguration` defined?', gt: /normalizeApiConfiguration|providerUtils/i },
];

const CONDITIONS = {
  A: { tools: BASE_TOOLS, mcp: null },
  B: { tools: [...BASE_TOOLS, ...CODEMAP_TOOLS], mcp: MCP },
};

function runOne(prompt, cond) {
  return new Promise((res) => {
    const args = ['-p', `${prompt}\n\nThe repository is the current directory. Answer concisely with the file path and symbol name.`,
      '--model', MODEL, '--output-format', 'json'];
    if (cond.mcp) args.push('--mcp-config', cond.mcp);
    args.push('--allowedTools', ...cond.tools);
    const t0 = Date.now();
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        const j = JSON.parse(out.slice(out.indexOf('{"type"')));
        res({ result: j.result ?? '', turns: j.num_turns, cost: j.total_cost_usd, ms: j.duration_ms,
          inTok: j.usage?.input_tokens ?? 0, outTok: j.usage?.output_tokens ?? 0,
          cacheTok: j.usage?.cache_read_input_tokens ?? 0, cacheCreate: j.usage?.cache_creation_input_tokens ?? 0 });
      } catch { res({ result: '', turns: 0, cost: 0, ms: Date.now() - t0, inTok: 0, outTok: 0, cacheTok: 0, err: true }); }
    });
  });
}

const jobs = [];
for (const qq of QUESTIONS) for (const c of Object.keys(CONDITIONS)) for (let t = 0; t < K; t++) jobs.push({ qq, c, t });
console.error(`running ${jobs.length} cells (${QUESTIONS.length} q × ${Object.keys(CONDITIONS).length} cond × ${K} trials), conc=${CONC}, model=${MODEL}`);

const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { qq, c, t } = jobs[i++];
    const r = await runOne(qq.q, CONDITIONS[c]);
    const correct = qq.gt.test(r.result);
    rows.push({ id: qq.id, tier: qq.tier, cond: c, trial: t, correct, ...r });
    console.error(`  ${qq.id} ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} cost=$${(r.cost ?? 0).toFixed(3)} ${r.err ? 'ERR' : ''}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

writeFileSync('/tmp/codemap-bench/results.json', JSON.stringify(rows, null, 2));

// Aggregate per (question, condition) + per condition.
const agg = (rs) => {
  const n = rs.length || 1;
  const pass = rs.filter((r) => r.correct).length / n;
  const mean = (k) => rs.reduce((s, r) => s + (r[k] ?? 0), 0) / n;
  return { pass: (pass * 100).toFixed(0) + '%', turns: mean('turns').toFixed(1), cost: '$' + mean('cost').toFixed(3), ms: Math.round(mean('ms')), workTok: Math.round(mean('inTok') + mean('outTok') + mean('cacheCreate')) };
};
console.log('\n=== per question × condition ===');
for (const qq of QUESTIONS) for (const c of Object.keys(CONDITIONS)) {
  const rs = rows.filter((r) => r.id === qq.id && r.cond === c);
  console.log(`  ${qq.id} ${c}:`, JSON.stringify(agg(rs)));
}
console.log('\n=== per condition (all tier-1) ===');
for (const c of Object.keys(CONDITIONS)) console.log(`  ${c}:`, JSON.stringify(agg(rows.filter((r) => r.cond === c))));
