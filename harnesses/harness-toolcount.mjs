// Measure WHICH tools the agent calls, B vs C, to settle cannibalization vs post-locate pollution.
// Re-runs concept queries with --output-format stream-json --verbose and counts tool_use by name.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = './cline-main';
const MODEL = process.env.BENCH_MODEL || 'opus';
const K = Number(process.env.BENCH_K || 2);
const CONC = Number(process.env.BENCH_CONC || 4);
const CODEMAP = ['mcp__code-map__locate', 'mcp__code-map__read', 'mcp__code-map__grep', 'mcp__code-map__graph', 'mcp__code-map__hotspots'];
const BASE = ['Read', 'Grep', 'Glob'];

const QUESTIONS = [
  { id: 'C1', q: 'When the server is overloaded or rejects us, where does the code wait and try the request again?', gt: /retry\.ts|withRetry/i },
  { id: 'C2', q: 'Where does it stop the same network request from being fired twice at the same time?', gt: /openai-native|inflight|in-flight|requestInFlight|websocket/i },
  { id: 'C3', q: "Where is the model's streamed output text turned into structured tool actions?", gt: /parse-assistant-message|parseAssistantMessage|parseToolCall/i },
  { id: 'C4', q: 'Where can a long-running request be interrupted partway through?', gt: /abort|AbortController|cancel/i },
  { id: 'C5', q: 'Where does it strip or hide private content from messages before sending them out?', gt: /openai-format|convertToOpenAiMessages|sanitize|cleanMessage|redact|filterVisible/i },
];

const CONDITIONS = {
  B: { tools: [...BASE, ...CODEMAP], mcp: '/tmp/codemap-bench/mcp-bug.json' },
  C: { tools: [...BASE, ...CODEMAP, 'mcp__semantic__semantic_search'], mcp: '/tmp/codemap-bench/mcp-C.json' },
};
const label = (n) => ({ 'mcp__code-map__locate': 'locate', 'mcp__code-map__grep': 'cmGrep', 'mcp__code-map__read': 'cmRead', 'mcp__code-map__graph': 'graph', 'mcp__code-map__hotspots': 'hotspots', 'mcp__semantic__semantic_search': 'semantic', Read: 'Read', Grep: 'Grep', Glob: 'Glob' }[n] || (n === 'ToolSearch' ? null : 'other'));

function runOne(prompt, cond) {
  return new Promise((res) => {
    const args = ['-p', `${prompt}\n\nThe repository is the current directory. Answer concisely: name the file path and function/symbol.`, '--model', MODEL, '--output-format', 'stream-json', '--verbose'];
    if (cond.mcp) args.push('--mcp-config', cond.mcp);
    args.push('--allowedTools', ...cond.tools);
    const p = spawn('claude', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.on('close', () => {
      const tools = {};
      let result = '', turns = 0;
      for (const l of s.split('\n')) {
        if (!l.trim()) continue;
        let j; try { j = JSON.parse(l); } catch { continue; }
        if (j.type === 'assistant') for (const c of j.message?.content || []) { if (c.type === 'tool_use') { const k = label(c.name); if (k) tools[k] = (tools[k] || 0) + 1; } }
        else if (j.type === 'result') { result = j.result ?? ''; turns = j.num_turns ?? 0; }
      }
      res({ result, turns, tools });
    });
  });
}

const jobs = [];
for (const qq of QUESTIONS) for (const c of Object.keys(CONDITIONS)) for (let t = 0; t < K; t++) jobs.push({ qq, c, t });
console.error(`running ${jobs.length} cells (model=${MODEL}, K=${K})`);
const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { qq, c, t } = jobs[i++];
    const r = await runOne(qq.q, CONDITIONS[c]);
    const correct = qq.gt.test(r.result);
    rows.push({ id: qq.id, cond: c, trial: t, correct, turns: r.turns, tools: r.tools });
    console.error(`  ${qq.id} ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} tools=${JSON.stringify(r.tools)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync('/tmp/codemap-bench/results-toolcount.json', JSON.stringify(rows, null, 2));

const keys = ['locate', 'cmRead', 'cmGrep', 'graph', 'hotspots', 'semantic', 'Read', 'Grep', 'Glob', 'other'];
const agg = (rs) => {
  const n = rs.length || 1;
  const m = {};
  for (const k of keys) m[k] = +(rs.reduce((s, r) => s + (r.tools[k] || 0), 0) / n).toFixed(2);
  return { n: rs.length, pass: ((rs.filter((r) => r.correct).length / n) * 100).toFixed(0) + '%', turns: +(rs.reduce((s, r) => s + r.turns, 0) / n).toFixed(1), tools: m };
};
console.log('\n=== mean tool calls per run, by condition ===');
for (const c of Object.keys(CONDITIONS)) console.log(`  ${c}:`, JSON.stringify(agg(rows.filter((r) => r.cond === c))));
console.log('\n=== locate calls per question (B vs C) — does locate collapse in C? ===');
for (const qq of QUESTIONS) {
  const lc = (c) => { const rs = rows.filter((r) => r.id === qq.id && r.cond === c); return +(rs.reduce((s, r) => s + (r.tools.locate || 0), 0) / (rs.length || 1)).toFixed(1); };
  const sc = (c) => { const rs = rows.filter((r) => r.id === qq.id && r.cond === c); return +(rs.reduce((s, r) => s + (r.tools.semantic || 0), 0) / (rs.length || 1)).toFixed(1); };
  console.log(`  ${qq.id}: B locate=${lc('B')} | C locate=${lc('C')} semantic=${sc('C')}`);
}
