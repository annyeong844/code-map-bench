// tier-2/3 of the benchmark: bug-finding over a PLANTED cline (5 known bugs).
// A = no code-map (Read/Grep/Glob); B = + code-map MCP. GT = the planted bug's file/symbol.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = './cline-main'; // planted in place
const MCP = '/tmp/codemap-bench/mcp-bug.json';
const MODEL = process.env.BENCH_MODEL || 'sonnet';
const K = Number(process.env.BENCH_K || 10);
const CONC = Number(process.env.BENCH_CONC || 5);
const CODEMAP = ['mcp__code-map__locate', 'mcp__code-map__read', 'mcp__code-map__grep', 'mcp__code-map__graph', 'mcp__code-map__hotspots'];
const BASE = ['Read', 'Grep', 'Glob'];

// S = semi-abstract (an anchor pointing at the planted bug's area). A = fully abstract (no anchor).
const QUESTIONS = [
  { id: 'S1', tier: 2, q: "Tool-call parameters look slightly truncated during streaming — I suspect an off-by-one in the assistant-message parser. Find the bug.", gt: /parse-assistant-message|parseAssistantMessageV2/i },
  { id: 'S2', tier: 2, q: "The API retry logic seems to attempt one too many times. Find the bug.", gt: /retry\.ts|withRetry/i },
  { id: 'S3', tier: 2, q: "Converting messages to the OpenAI format seems to drop some content. Find the bug.", gt: /openai-format|convertToOpenAiMessages/i },
  { id: 'S4', tier: 2, q: "Token-usage accounting crashes on some streamed responses, likely a null/undefined access. Find the bug.", gt: /getApiStreamUsage|asksage/i },
  { id: 'S5', tier: 2, q: "Partial array parsing mishandles a boundary and corrupts the first element. Find the bug.", gt: /shared\/array|parsePartialArrayString/i },
  { id: 'A1', tier: 3, q: "Find bugs in the API layer (src/core/api). Name the file + function for each.", gt: /retry\.ts|withRetry|openai-format|convertToOpenAiMessages|getApiStreamUsage|asksage/i },
  { id: 'A2', tier: 3, q: "What's the riskiest code in the assistant-message handling, and is there a bug in it?", gt: /parse-assistant-message|parseAssistantMessageV2/i },
  { id: 'A3', tier: 3, q: "Are there any off-by-one or boundary bugs in this codebase? Name file + function.", gt: /parse-assistant-message|parseAssistantMessageV2|retry\.ts|withRetry|shared\/array|parsePartialArrayString/i },
  { id: 'A4', tier: 3, q: "Find a subtle bug that would corrupt tool calls during streaming.", gt: /parse-assistant-message|parseAssistantMessageV2/i },
  { id: 'A5', tier: 3, q: "Review src/core/api/providers for correctness issues. Name file + function.", gt: /getApiStreamUsage|asksage/i },
];

const TIER = process.env.BENCH_TIER ? Number(process.env.BENCH_TIER) : null;
if (TIER) for (let j = QUESTIONS.length - 1; j >= 0; j--) if (QUESTIONS[j].tier !== TIER) QUESTIONS.splice(j, 1);

const CONDITIONS = { A: { tools: BASE, mcp: null }, B: { tools: [...BASE, ...CODEMAP], mcp: MCP } };

function runOne(prompt, cond) {
  return new Promise((res) => {
    const args = ['-p', `${prompt}\n\nThe repository is the current directory. Answer concisely: name the file path and function/symbol of the bug.`, '--model', MODEL, '--output-format', 'json'];
    if (cond.mcp) args.push('--mcp-config', cond.mcp);
    args.push('--allowedTools', ...cond.tools);
    const t0 = Date.now();
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        const j = JSON.parse(out.slice(out.indexOf('{"type"')));
        res({ result: j.result ?? '', turns: j.num_turns, cost: j.total_cost_usd, ms: j.duration_ms, inTok: j.usage?.input_tokens ?? 0, outTok: j.usage?.output_tokens ?? 0, cacheCreate: j.usage?.cache_creation_input_tokens ?? 0 });
      } catch { res({ result: '', turns: 0, cost: 0, ms: Date.now() - t0, inTok: 0, outTok: 0, cacheCreate: 0, err: true }); }
    });
  });
}

const jobs = [];
for (const qq of QUESTIONS) for (const c of Object.keys(CONDITIONS)) for (let t = 0; t < K; t++) jobs.push({ qq, c, t });
console.error(`running ${jobs.length} cells, conc=${CONC}, model=${MODEL}`);
const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { qq, c, t } = jobs[i++];
    const r = await runOne(qq.q, CONDITIONS[c]);
    const correct = qq.gt.test(r.result);
    rows.push({ id: qq.id, tier: qq.tier, cond: c, trial: t, correct, ...r });
    console.error(`  ${qq.id} ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} cost=$${(r.cost ?? 0).toFixed(3)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync('/tmp/codemap-bench/results-t23.json', JSON.stringify(rows, null, 2));

const agg = (rs) => {
  const n = rs.length || 1;
  const mean = (k) => rs.reduce((s, r) => s + (r[k] ?? 0), 0) / n;
  return { pass: ((rs.filter((r) => r.correct).length / n) * 100).toFixed(0) + '%', turns: mean('turns').toFixed(1), cost: '$' + mean('cost').toFixed(3), ms: Math.round(mean('ms')), workTok: Math.round(mean('inTok') + mean('outTok') + mean('cacheCreate')) };
};
console.log('\n=== per question × condition ===');
for (const qq of QUESTIONS) for (const c of Object.keys(CONDITIONS)) console.log(`  ${qq.id}(t${qq.tier}) ${c}:`, JSON.stringify(agg(rows.filter((r) => r.id === qq.id && r.cond === c))));
console.log('\n=== per tier × condition ===');
for (const tier of [2, 3]) for (const c of Object.keys(CONDITIONS)) console.log(`  tier${tier} ${c}:`, JSON.stringify(agg(rows.filter((r) => r.tier === tier && r.cond === c))));
console.log('\n=== overall × condition ===');
for (const c of Object.keys(CONDITIONS)) console.log(`  ${c}:`, JSON.stringify(agg(rows.filter((r) => r.cond === c))));
