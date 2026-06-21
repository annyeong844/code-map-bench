// Prompt-FORCED concept 3-way + stream-json so we verify the agent OBEYED its lane.
// Symmetric forcing: each condition is told to search with its own lane.
// A=grep | B=code-map locate/graph | C=semantic_search. Read kept everywhere (raw-judge loop).
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

// Each condition forced to its search lane (symmetric); Read stays for raw judging.
const CONDITIONS = {
  A: { tools: BASE, mcp: null, force: 'To find it, search the codebase using the Grep tool.' },
  B: { tools: [...BASE, ...CODEMAP], mcp: '/tmp/codemap-bench/mcp-bug.json', force: 'To find it, you MUST search using the code-map tools (mcp__code-map__locate, mcp__code-map__grep, mcp__code-map__graph) — do NOT use the plain Grep tool to locate it.' },
  C: { tools: [...BASE, ...CODEMAP, 'mcp__semantic__semantic_search'], mcp: '/tmp/codemap-bench/mcp-C.json', force: 'To find it, you MUST search using the mcp__semantic__semantic_search tool (semantic code search by meaning) — do NOT use the plain Grep tool to locate it.' },
};
const label = (n) => ({ 'mcp__code-map__locate': 'locate', 'mcp__code-map__grep': 'cmGrep', 'mcp__code-map__read': 'cmRead', 'mcp__code-map__graph': 'graph', 'mcp__code-map__hotspots': 'hotspots', 'mcp__semantic__semantic_search': 'semantic', Read: 'Read', Grep: 'Grep', Glob: 'Glob' }[n] || (n === 'ToolSearch' ? null : 'other'));

function runOne(prompt, cond) {
  return new Promise((res) => {
    const args = ['-p', `${prompt}\n\nThe repository is the current directory. ${cond.force} Answer concisely: name the file path and function/symbol.`, '--model', MODEL, '--output-format', 'stream-json', '--verbose'];
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
console.error(`running ${jobs.length} cells (model=${MODEL}, K=${K}, FORCED lanes)`);
const rows = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { qq, c, t } = jobs[i++];
    const r = await runOne(qq.q, CONDITIONS[c]);
    const correct = qq.gt.test(r.result);
    rows.push({ id: qq.id, cond: c, trial: t, correct, turns: r.turns, tools: r.tools });
    console.error(`  ${qq.id} ${c} #${t}: ${correct ? '✓' : '✗'} turns=${r.turns} ${JSON.stringify(r.tools)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync('/tmp/codemap-bench/results-forced.json', JSON.stringify(rows, null, 2));

const keys = ['locate', 'cmRead', 'cmGrep', 'graph', 'hotspots', 'semantic', 'Read', 'Grep', 'Glob', 'other'];
const agg = (rs) => {
  const n = rs.length || 1;
  const m = {};
  for (const k of keys) { const v = +(rs.reduce((s, r) => s + (r.tools[k] || 0), 0) / n).toFixed(1); if (v) m[k] = v; }
  return { pass: ((rs.filter((r) => r.correct).length / n) * 100).toFixed(0) + '%', turns: +(rs.reduce((s, r) => s + r.turns, 0) / n).toFixed(1), tools: m };
};
console.log('\n=== FORCED 3-way: pass + obedience (did the lane get used?) ===');
for (const c of Object.keys(CONDITIONS)) console.log(`  ${c}:`, JSON.stringify(agg(rows.filter((r) => r.cond === c))));
console.log('\n=== obedience check: B code-map use / C semantic use, per run ===');
const codemapUse = (r) => (r.tools.locate || 0) + (r.tools.cmGrep || 0) + (r.tools.graph || 0) + (r.tools.cmRead || 0) + (r.tools.hotspots || 0);
console.log(`  B: ${rows.filter((r) => r.cond === 'B' && codemapUse(r) > 0).length}/${rows.filter((r) => r.cond === 'B').length} runs used code-map; B still-grep: ${rows.filter((r) => r.cond === 'B' && (r.tools.Grep || 0) > 0).length}`);
console.log(`  C: ${rows.filter((r) => r.cond === 'C' && (r.tools.semantic || 0) > 0).length}/${rows.filter((r) => r.cond === 'C').length} runs used semantic; C still-grep: ${rows.filter((r) => r.cond === 'C' && (r.tools.Grep || 0) > 0).length}`);
