#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TASKS = resolve(SCRIPT_DIR, '../bench/codex-headless/tasks.diverse.json');
const GROK_HOME = process.env.GROK_HOME || join(homedir(), '.grok');

const STRATEGIES = {
  native: {
    label: 'native grep/read',
    disallowedTools: 'CallMcpTool,Agent',
    rules: [
      'Retrieval benchmark — native arm.',
      'Use only Grep and Read for source inspection. Do not use CallMcpTool or shell.',
      'Prefer small targeted reads after grep. Keep the final answer concise.',
    ].join('\n'),
  },
  'map-batch': {
    label: 'code-map batched read',
    disallowedTools: 'Agent',
    rules: [
      'Retrieval benchmark — code-map arm.',
      'When independent symbol refs are known, call code-map read once with refs: [...] via CallMcpTool.',
      'Use Grep only to discover refs you do not already have. Do not Read source bodies when refs are known.',
      'Keep the final answer concise.',
    ].join('\n'),
  },
};

function usage() {
  return `Usage:
  node scripts/bench-grok-headless.mjs --run --passes 3 --strategies native,map-batch

Options:
  --repo <path>            Target repository (default: cwd)
  --tasks <path>           Task spec JSON (default: tasks.diverse.json)
  --out <path>             Output directory
  --passes <n>             Passes per strategy (default: 3)
  --strategies <list>      native,map-batch (default: both)
  --max-tasks <n>          Limit tasks for smoke runs
  --model <name>           Grok model (default: grok-composer-2.5-fast)
  --grok <bin>             Grok executable (default: grok)
  --max-turns <n>          Per-turn cap (default: 10)
  --cache-warmup-turns <n> No-op resume turns after seed (default: 1)
  --run                    Actually invoke Grok (otherwise dry-run plan)

Headless sessions use seed + grok --resume <sessionId> per task, mirroring codex exec resume.
`;
}

function parseArgs(argv) {
  const opts = {
    repo: process.cwd(),
    tasks: '',
    out: '',
    passes: 3,
    strategies: ['native', 'map-batch'],
    maxTasks: 0,
    model: 'grok-composer-2.5-fast',
    grok: 'grok',
    maxTurns: 10,
    cacheWarmupTurns: 1,
    run: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case '--repo': opts.repo = next(); break;
      case '--tasks': opts.tasks = next(); break;
      case '--out': opts.out = next(); break;
      case '--passes': opts.passes = Number(next()); break;
      case '--strategies': opts.strategies = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--max-tasks': opts.maxTasks = Number(next()); break;
      case '--model': opts.model = next(); break;
      case '--grok': opts.grok = next(); break;
      case '--max-turns': opts.maxTurns = Number(next()); break;
      case '--cache-warmup-turns': opts.cacheWarmupTurns = Number(next()); break;
      case '--run': opts.run = true; break;
      case '-h':
      case '--help':
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  for (const s of opts.strategies) {
    if (!STRATEGIES[s]) throw new Error(`unknown strategy "${s}"`);
  }
  if (!Number.isInteger(opts.cacheWarmupTurns) || opts.cacheWarmupTurns < 0) {
    throw new Error('--cache-warmup-turns must be a non-negative integer');
  }
  opts.repo = resolve(opts.repo);
  opts.tasks = opts.tasks ? resolve(opts.repo, opts.tasks) : DEFAULT_TASKS;
  opts.out = opts.out ? resolve(opts.out) : resolve(opts.repo, '.bench/grok-headless', timestamp());
  return opts;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function encodeCwd(cwd) {
  return cwd.replace(/\//g, '%2F');
}

function sessionDir(cwd, sessionId) {
  return join(GROK_HOME, 'sessions', encodeCwd(cwd), sessionId);
}

async function loadTasks(path, maxTasks) {
  const spec = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(spec.tasks) || spec.tasks.length === 0) throw new Error(`no tasks in ${path}`);
  return { ...spec, tasks: maxTasks ? spec.tasks.slice(0, maxTasks) : spec.tasks };
}

function seedPrompt(strategy, spec) {
  return [
    `Benchmark: ${spec.name ?? basename(spec.tasksFile ?? 'tasks')}`,
    STRATEGIES[strategy].rules,
    '',
    'You will be resumed in this same headless session for each scored task.',
    'Acknowledge with a one-line OK.',
  ].join('\n');
}

function cacheWarmupPrompt(ordinal, total) {
  return [
    `Cache warm-up turn ${ordinal}/${total}.`,
    'Do not inspect files. Do not run tools.',
    'Reply with exactly: cache warmup ok',
  ].join('\n');
}

function taskPrompt(strategy, task, ordinal, total) {
  const chunks = [
    `Task ${ordinal}/${total}: ${task.id}`,
    task.prompt,
    '',
    'Answer in plain text. Cite evidence briefly at the end.',
  ];
  if (strategy === 'map-batch' && Array.isArray(task.mapRefs) && task.mapRefs.length) {
    chunks.push('', 'Known independent refs — one code-map read with refs before answering:');
    chunks.push(task.mapRefs.map((r) => `- ${r}`).join('\n'));
  }
  if (strategy === 'native' && Array.isArray(task.nativeHints) && task.nativeHints.length) {
    chunks.push('', 'Inspect these areas with Grep/Read only:');
    chunks.push(task.nativeHints.map((r) => `- ${r}`).join('\n'));
  }
  return chunks.join('\n');
}

function gradeTask(task, text) {
  const misses = [];
  const hay = String(text ?? '').toLowerCase();
  for (const s of task.expected?.requiredSubstrings ?? []) {
    if (!hay.includes(String(s).toLowerCase())) misses.push(`substring:${s}`);
  }
  for (const re of task.expected?.requiredRegex ?? []) {
    if (!new RegExp(re, 'i').test(text ?? '')) misses.push(`regex:${re}`);
  }
  return { passed: misses.length === 0, misses };
}

async function readSignals(cwd, sessionId) {
  try {
    const text = await readFile(join(sessionDir(cwd, sessionId), 'signals.json'), 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readEvents(cwd, sessionId) {
  try {
    const text = await readFile(join(sessionDir(cwd, sessionId), 'events.jsonl'), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// --- "our way" measurement helpers -------------------------------------------
// Real per-turn token cost is not exposed by grok anywhere (no usage in events
// or session files), so we read chat_history.jsonl and measure the content
// actually injected into context, decomposed by source. Char counts are exact
// and tokenizer-independent; approxTokens ~= chars/4 is a rough gloss only.
function chatHistoryPath(cwd, sessionId) {
  return join(sessionDir(cwd, sessionId), 'chat_history.jsonl');
}

async function readChatHistory(cwd, sessionId) {
  try {
    const text = await readFile(chatHistoryPath(cwd, sessionId), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function recordText(rec) {
  const parts = [];
  const c = rec.content;
  if (typeof c === 'string') parts.push(c);
  else if (Array.isArray(c)) {
    for (const seg of c) {
      if (typeof seg === 'string') parts.push(seg);
      else if (seg && typeof seg.text === 'string') parts.push(seg.text);
      else if (seg && typeof seg.content === 'string') parts.push(seg.content);
      else if (seg != null) parts.push(JSON.stringify(seg));
    }
  } else if (c != null) {
    parts.push(JSON.stringify(c));
  }
  if (Array.isArray(rec.summary)) {
    for (const s of rec.summary) if (s && typeof s.text === 'string') parts.push(s.text);
  }
  return parts.join('');
}

function chatBucket(rec) {
  const t = rec.type || rec.role || 'other';
  if (t === 'tool_result') return 'toolResult';
  if (t === 'assistant') return 'assistant';
  if (t === 'reasoning') return 'reasoning';
  if (t === 'user') return 'user';
  if (t === 'system') return 'system';
  return 'other';
}

function chatCharsByBucket(records) {
  const b = { toolResult: 0, assistant: 0, reasoning: 0, user: 0, system: 0, other: 0, total: 0 };
  for (const r of records) {
    const n = recordText(r).length;
    b[chatBucket(r)] += n;
    b.total += n;
  }
  return b;
}

// Time that is actually model work: turn_started -> turn_ended. Excludes process
// boot + MCP init (~45% of wall-clock, and where the failing octo-claw handshake
// lives). firstTokenMs = model response latency.
function inferenceTiming(events) {
  let started = null;
  let ended = null;
  let firstToken = null;
  for (const ev of events) {
    if (ev.type === 'turn_started' && started === null) started = Date.parse(ev.ts);
    else if (ev.type === 'first_token' && firstToken === null && started !== null) firstToken = Date.parse(ev.ts);
    else if (ev.type === 'turn_ended') ended = Date.parse(ev.ts);
  }
  return {
    inferenceMs: started != null && ended != null ? ended - started : null,
    firstTokenMs: started != null && firstToken != null ? firstToken - started : null,
  };
}

async function waitForSignals(cwd, sessionId, attempts = 24, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    const signals = await readSignals(cwd, sessionId);
    if (signals) return signals;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

class SessionTracker {
  constructor(cwd, sessionId) {
    this.cwd = cwd;
    this.sessionId = sessionId;
    this.signals = {};
    this.eventCount = 0;
    this.chatChars = { toolResult: 0, assistant: 0, reasoning: 0, user: 0, system: 0, other: 0, total: 0 };
  }

  async snapshot() {
    this.signals = (await readSignals(this.cwd, this.sessionId)) ?? {};
    const events = await readEvents(this.cwd, this.sessionId);
    this.eventCount = events.length;
    this.chatChars = chatCharsByBucket(await readChatHistory(this.cwd, this.sessionId));
    return { signals: this.signals, eventCount: this.eventCount };
  }

  async delta() {
    const afterSignals = (await waitForSignals(this.cwd, this.sessionId)) ?? {};
    const events = await readEvents(this.cwd, this.sessionId);
    const newEvents = events.slice(this.eventCount);
    const toolCounts = summarizeTools(newEvents);
    const timing = inferenceTiming(newEvents);
    const afterChat = chatCharsByBucket(await readChatHistory(this.cwd, this.sessionId));
    const chatCharDelta = {};
    for (const k of Object.keys(afterChat)) {
      chatCharDelta[k] = Math.max(0, afterChat[k] - (this.chatChars[k] ?? 0));
    }
    const deltaSignals = {
      contextTokensUsed: Math.max(0, (afterSignals.contextTokensUsed ?? 0) - (this.signals.contextTokensUsed ?? 0)),
      toolCallCount: Math.max(0, (afterSignals.toolCallCount ?? 0) - (this.signals.toolCallCount ?? 0)),
      turnCount: Math.max(0, (afterSignals.turnCount ?? 0) - (this.signals.turnCount ?? 0)),
    };
    this.signals = afterSignals;
    this.eventCount = events.length;
    this.chatChars = afterChat;
    return { afterSignals, newEvents, toolCounts, deltaSignals, timing, chatCharDelta };
  }
}

async function runGrok({ opts, strategy, prompt, runDir, name, resumeSessionId = '' }) {
  await mkdir(runDir, { recursive: true });
  const strategyCfg = STRATEGIES[strategy];
  const args = [
    '-p', prompt,
    '--cwd', opts.repo,
    '--output-format', 'json',
    '--yolo',
    '--max-turns', String(opts.maxTurns),
    '--model', opts.model,
    '--rules', strategyCfg.rules,
    '--disallowed-tools', strategyCfg.disallowedTools,
    '--no-auto-update',
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);

  const startedAt = Date.now();
  const child = spawn(opts.grok, args, { cwd: opts.repo, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', resolveExit);
  });
  const elapsedMs = Date.now() - startedAt;
  const stdoutPath = join(runDir, `${name}.stdout.json`);
  const stderrPath = join(runDir, `${name}.stderr.txt`);
  await writeFile(stdoutPath, stdout);
  await writeFile(stderrPath, stderr);

  let payload = {};
  try {
    payload = JSON.parse(stdout.trim() || '{}');
  } catch {
    payload = { type: 'parse_error', raw: stdout };
  }

  const sessionId = payload.sessionId ?? resumeSessionId ?? '';
  return {
    exitCode,
    elapsedMs,
    sessionId,
    resumed: Boolean(resumeSessionId),
    stopReason: payload.stopReason ?? payload.type ?? '',
    text: payload.text ?? '',
    stdoutPath,
    stderrPath,
    error: exitCode !== 0 ? `grok exited ${exitCode}` : payload.type === 'error' ? payload.message : '',
  };
}

function summarizeTools(events) {
  const counts = {
    total: 0,
    grep: 0,
    read: 0,
    shell: 0,
    mcp: 0,
    mcpRead: 0,
    mcpBatchRead: 0,
  };
  for (const ev of events) {
    if (ev.type === 'tool_started') {
      counts.total++;
      const t = ev.tool_name ?? '';
      if (t === 'Grep') counts.grep++;
      else if (t === 'Read') counts.read++;
      else if (t === 'Shell') counts.shell++;
      else if (t === 'CallMcpTool') counts.mcp++;
    }
    if (ev.type === 'mcp_tool_call_started' && ev.server_name === 'code-map' && ev.tool_name === 'read') {
      counts.mcpRead++;
    }
  }
  if (counts.mcpRead === 1) counts.mcpBatchRead = 1;
  return counts;
}

function pctDelta(mapVal, nativeVal) {
  if (!nativeVal) return null;
  return Math.round(((mapVal - nativeVal) / nativeVal) * 100);
}

// --- robust stats ("our way": median + IQR, outlier-resistant) ----------------
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs, q) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function robustStat(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return {
    n: v.length,
    median: Math.round(median(v)),
    p25: Math.round(quantile(v, 0.25)),
    p75: Math.round(quantile(v, 0.75)),
    min: v.length ? Math.min(...v) : 0,
    max: v.length ? Math.max(...v) : 0,
  };
}

// Compare strategies on median, which ignores the latency tails that wreck the
// mean. Token = grok's own contextTokensUsed delta (real tokenizer). Time =
// inference-only (boot/MCP excluded). toolResultChars = retrieval payload size,
// the thing code-map is supposed to shrink.
function robustComparison(rows) {
  const scored = rows.filter((r) => r.scored && r.stopReason === 'EndTurn');
  const byScen = {};
  for (const r of scored) {
    const sc = r.scenario || r.category || 'uncategorized';
    (byScen[sc] ??= { native: [], 'map-batch': [] })[r.strategy]?.push(r);
  }
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const out = [];
  for (const [scenario, arms] of Object.entries(byScen).sort()) {
    const n = arms.native;
    const m = arms['map-batch'];
    if (!n.length || !m.length) continue;
    const col = (arr, key) => arr.map((r) => r[key]);
    const bucket = (arr, b) => arr.map((r) => r.chatChars?.[b]);
    const tokM = robustStat(col(m, 'contextTokensUsed'));
    const tokN = robustStat(col(n, 'contextTokensUsed'));
    const infM = robustStat(col(m, 'inferenceMs'));
    const infN = robustStat(col(n, 'inferenceMs'));
    const trM = robustStat(bucket(m, 'toolResult'));
    const trN = robustStat(bucket(n, 'toolResult'));
    out.push({
      scenario,
      passMap: m.filter((r) => r.passed).length,
      passNative: n.filter((r) => r.passed).length,
      attempts: m.length,
      tokensMedMap: tokM.median,
      tokensMedNative: tokN.median,
      tokensIqrMap: `${tokM.p25}-${tokM.p75}`,
      tokensIqrNative: `${tokN.p25}-${tokN.p75}`,
      tokensDeltaPct: pct(tokM.median, tokN.median),
      inferMsMedMap: infM.median,
      inferMsMedNative: infN.median,
      inferDeltaPct: pct(infM.median, infN.median),
      toolResultCharsMedMap: trM.median,
      toolResultCharsMedNative: trN.median,
      toolResultDeltaPct: pct(trM.median, trN.median),
    });
  }
  return out;
}

// Flag scored turns whose inference time is a far outlier (> p75 + 3*IQR within
// its scenario+strategy cell) so latency-spike windows are visible, not silently
// averaged in.
function latencyTails(rows) {
  const scored = rows.filter((r) => r.scored && r.stopReason === 'EndTurn' && r.inferenceMs != null);
  const cells = {};
  for (const r of scored) {
    const key = `${r.scenario || r.category}\0${r.strategy}`;
    (cells[key] ??= []).push(r);
  }
  const tails = [];
  for (const group of Object.values(cells)) {
    const xs = group.map((r) => r.inferenceMs);
    const p75 = quantile(xs, 0.75);
    const iqr = p75 - quantile(xs, 0.25);
    const fence = p75 + 3 * iqr;
    for (const r of group) {
      if (r.inferenceMs > fence && iqr > 0) {
        tails.push({ pass: r.pass, strategy: r.strategy, scenario: r.scenario, inferenceMs: r.inferenceMs, fence: Math.round(fence) });
      }
    }
  }
  return tails.sort((a, b) => b.inferenceMs - a.inferenceMs);
}

function isComparable(row) {
  return row.includeInComparison && row.stopReason === 'EndTurn' && row.contextTokensUsed > 0;
}

function aggregateByScenario(rows) {
  const buckets = {};
  for (const row of rows.filter(isComparable)) {
    const scenario = row.scenario || row.category || 'uncategorized';
    const key = `${scenario}\0${row.strategy}`;
    buckets[key] ??= {
      scenario,
      strategy: row.strategy,
      attempts: 0,
      passed: 0,
      contextTokensUsed: 0,
      elapsedMs: 0,
      toolCallCount: 0,
      grep: 0,
      read: 0,
      shell: 0,
      mcp: 0,
      mcpBatchRead: 0,
    };
    const b = buckets[key];
    b.attempts++;
    if (row.passed) b.passed++;
    b.contextTokensUsed += row.contextTokensUsed;
    b.elapsedMs += row.elapsedMs;
    b.toolCallCount += row.toolCallCount;
    b.grep += row.toolCounts.grep;
    b.read += row.toolCounts.read;
    b.shell += row.toolCounts.shell;
    b.mcp += row.toolCounts.mcp;
    b.mcpBatchRead += row.toolCounts.mcpBatchRead;
  }
  return Object.values(buckets).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.strategy.localeCompare(b.strategy));
}

function scenarioComparison(scenarioRows) {
  const byScenario = {};
  for (const row of scenarioRows) {
    byScenario[row.scenario] ??= {};
    byScenario[row.scenario][row.strategy] = row;
  }
  const lines = [];
  for (const [scenario, arms] of Object.entries(byScenario).sort()) {
    const native = arms.native;
    const map = arms['map-batch'];
    if (!native || !map) continue;
    lines.push({
      scenario,
      tokensDeltaPct: pctDelta(map.contextTokensUsed / map.attempts, native.contextTokensUsed / native.attempts),
      timeDeltaPct: pctDelta(map.elapsedMs / map.attempts, native.elapsedMs / native.attempts),
      toolDeltaPct: pctDelta(map.toolCallCount / map.attempts, native.toolCallCount / native.attempts),
      mapTokens: Math.round(map.contextTokensUsed / map.attempts),
      nativeTokens: Math.round(native.contextTokensUsed / native.attempts),
      mapMs: Math.round(map.elapsedMs / map.attempts),
      nativeMs: Math.round(native.elapsedMs / native.attempts),
      mapTools: (map.toolCallCount / map.attempts).toFixed(1),
      nativeTools: (native.toolCallCount / native.attempts).toFixed(1),
    });
  }
  return lines;
}

function markdownSummary(summary) {
  const lines = [
    '# Grok CLI Headless Retrieval Benchmark',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- repo: ${summary.repo}`,
    `- model: ${summary.model}`,
    `- taskSpec: ${summary.taskSpec}`,
    `- passesRequested: ${summary.passesRequested}`,
    `- sessionMode: headless seed + \`--resume <sessionId>\` per task`,
    `- cacheWarmupTurns: ${summary.cacheWarmupTurns}`,
    `- metric: per-turn delta of contextTokensUsed from signals.json`,
    `- comparable rows: scored tasks with stopReason=EndTurn and contextTokensUsed>0`,
    '',
    '| strategy | attempts | passed | passRate | avg Δ context tok | avg ms | avg tools | grep | read | mcp | batch read |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const a of summary.aggregate) {
    lines.push(`| ${a.strategy} | ${a.attempts} | ${a.passed} | ${a.passRate.toFixed(3)} | ${a.avgContextTokens} | ${a.avgElapsedMs} | ${a.avgToolCalls} | ${a.avgGrep} | ${a.avgRead} | ${a.avgMcp} | ${a.avgMcpBatchRead} |`);
  }
  if (summary.scenarioComparison.length) {
    lines.push('');
    lines.push('## code-map vs native by scenario (mean — legacy, tail-sensitive)');
    lines.push('');
    lines.push('| scenario | tokens Δ | time Δ | tools Δ | map tok | native tok | map ms | native ms |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of summary.scenarioComparison) {
      lines.push(`| ${c.scenario} | ${fmtPct(c.tokensDeltaPct)} | ${fmtPct(c.timeDeltaPct)} | ${fmtPct(c.toolDeltaPct)} | ${c.mapTokens} | ${c.nativeTokens} | ${c.mapMs} | ${c.nativeMs} |`);
    }
  }
  if (summary.robustComparison?.length) {
    lines.push('');
    lines.push('## code-map vs native — robust (median, our way)');
    lines.push('');
    lines.push('- token Δ = grok contextTokensUsed delta (real tokenizer), median');
    lines.push('- time Δ = **inference-only** (turn_started→turn_ended), median — boot/MCP excluded');
    lines.push('- toolResult Δ = retrieval payload chars injected into context, median');
    lines.push('');
    lines.push('| scenario | pass (m/n) | tok Δ | map tok [IQR] | native tok [IQR] | infer Δ | map ms | native ms | toolResult Δ | map chars | native chars |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of summary.robustComparison) {
      lines.push(`| ${c.scenario} | ${c.passMap}/${c.passNative} | ${fmtPct(c.tokensDeltaPct)} | ${c.tokensMedMap} [${c.tokensIqrMap}] | ${c.tokensMedNative} [${c.tokensIqrNative}] | ${fmtPct(c.inferDeltaPct)} | ${c.inferMsMedMap} | ${c.inferMsMedNative} | ${fmtPct(c.toolResultDeltaPct)} | ${c.toolResultCharsMedMap} | ${c.toolResultCharsMedNative} |`);
    }
  }
  if (summary.latencyTails?.length) {
    lines.push('');
    lines.push(`## latency tails (inference > p75 + 3·IQR in cell): ${summary.latencyTails.length} turns`);
    lines.push('');
    for (const t of summary.latencyTails.slice(0, 12)) {
      lines.push(`- pass ${t.pass} ${t.strategy} ${t.scenario}: ${t.inferenceMs}ms (fence ${t.fence}ms)`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function fmtPct(n) {
  if (n == null) return 'n/a';
  return `${n > 0 ? '+' : ''}${n}%`;
}

function aggregate(rows) {
  const buckets = {};
  for (const row of rows.filter(isComparable)) {
    buckets[row.strategy] ??= {
      strategy: row.strategy,
      attempts: 0,
      passed: 0,
      contextTokensUsed: 0,
      elapsedMs: 0,
      toolCallCount: 0,
      grep: 0,
      read: 0,
      shell: 0,
      mcp: 0,
      mcpBatchRead: 0,
    };
    const b = buckets[row.strategy];
    b.attempts++;
    if (row.passed) b.passed++;
    b.contextTokensUsed += row.contextTokensUsed;
    b.elapsedMs += row.elapsedMs;
    b.toolCallCount += row.toolCallCount;
    b.grep += row.toolCounts.grep;
    b.read += row.toolCounts.read;
    b.shell += row.toolCounts.shell;
    b.mcp += row.toolCounts.mcp;
    b.mcpBatchRead += row.toolCounts.mcpBatchRead;
  }
  return Object.values(buckets).map((b) => ({
    ...b,
    passRate: b.attempts ? b.passed / b.attempts : 0,
    avgContextTokens: b.attempts ? Math.round(b.contextTokensUsed / b.attempts) : 0,
    avgElapsedMs: b.attempts ? Math.round(b.elapsedMs / b.attempts) : 0,
    avgToolCalls: b.attempts ? +(b.toolCallCount / b.attempts).toFixed(1) : 0,
    avgGrep: b.attempts ? +(b.grep / b.attempts).toFixed(1) : 0,
    avgRead: b.attempts ? +(b.read / b.attempts).toFixed(1) : 0,
    avgMcp: b.attempts ? +(b.mcp / b.attempts).toFixed(1) : 0,
    avgMcpBatchRead: b.attempts ? +(b.mcpBatchRead / b.attempts).toFixed(1) : 0,
  }));
}

async function runTurn({ opts, strategy, prompt, runDir, name, sessionId, tracker, phase, scored }) {
  await tracker.snapshot();
  const run = await runGrok({
    opts,
    strategy,
    prompt,
    runDir,
    name,
    resumeSessionId: phase === 'seed' ? '' : sessionId,
  });
  if (!run.sessionId) throw new Error(`${name} did not return a sessionId`);
  if (phase === 'seed') tracker.sessionId = run.sessionId;

  const { newEvents, toolCounts, deltaSignals, afterSignals, timing, chatCharDelta } = await tracker.delta();
  await writeFile(join(runDir, `${name}.events.jsonl`), `${newEvents.map((e) => JSON.stringify(e)).join('\n')}\n`);
  await writeFile(join(runDir, `${name}.signals.json`), `${JSON.stringify(afterSignals, null, 2)}\n`);

  const chatChars = chatCharDelta;
  const approxTokens = Math.round((chatChars.total ?? 0) / 4);

  return {
    ...run,
    phase,
    scored,
    includeInComparison: scored,
    contextTokensUsed: deltaSignals.contextTokensUsed,
    toolCallCount: toolCounts.total || deltaSignals.toolCallCount,
    turns: deltaSignals.turnCount,
    toolCounts,
    inferenceMs: timing.inferenceMs,
    firstTokenMs: timing.firstTokenMs,
    chatChars,
    approxTokens,
    afterSignals,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const spec = await loadTasks(opts.tasks, opts.maxTasks);
  spec.tasksFile = opts.tasks;
  await mkdir(opts.out, { recursive: true });
  await writeFile(join(opts.out, 'plan.json'), `${JSON.stringify({ ...opts, taskIds: spec.tasks.map((t) => t.id) }, null, 2)}\n`);

  if (!opts.run) {
    console.log(`Dry run → ${opts.out}`);
    console.log(`Passes: ${opts.passes}, strategies: ${opts.strategies.join(', ')}`);
    console.log(`Tasks: ${spec.tasks.map((t) => t.id).join(', ')}`);
    console.log(`Session mode: seed + --resume per task; cache warm-up turns: ${opts.cacheWarmupTurns}`);
    console.log('Add --run to invoke Grok CLI.');
    return;
  }

  try {
    await access(resolve(opts.repo, '.map-index.json'), constants.R_OK);
  } catch {
    throw new Error(`missing ${resolve(opts.repo, '.map-index.json')} — run "map index --root ." first`);
  }

  const rows = [];
  for (let pass = 1; pass <= opts.passes; pass++) {
    const passStrategies = pass % 2 === 0 ? [...opts.strategies].reverse() : opts.strategies;
    for (const strategy of passStrategies) {
      const passDir = join(opts.out, 'runs', strategy, `pass-${String(pass).padStart(3, '0')}-${randomUUID().slice(0, 8)}`);
      const tracker = new SessionTracker(opts.repo, '');

      const seed = await runTurn({
        opts,
        strategy,
        prompt: seedPrompt(strategy, spec),
        runDir: passDir,
        name: 'seed',
        sessionId: '',
        tracker,
        phase: 'seed',
        scored: false,
      });
      rows.push({
        strategy,
        pass,
        phase: 'seed',
        task: '__seed__',
        category: '',
        scenario: '',
        scored: false,
        includeInComparison: false,
        passed: true,
        misses: [],
        contextTokensUsed: seed.contextTokensUsed,
        elapsedMs: seed.elapsedMs,
        toolCallCount: seed.toolCallCount,
        toolCounts: seed.toolCounts,
        sessionId: seed.sessionId,
        resumed: seed.resumed,
        stopReason: seed.stopReason,
        error: seed.error,
      });
      const sessionId = seed.sessionId;

      for (let warmupIndex = 1; warmupIndex <= opts.cacheWarmupTurns; warmupIndex++) {
        const warmup = await runTurn({
          opts,
          strategy,
          prompt: cacheWarmupPrompt(warmupIndex, opts.cacheWarmupTurns),
          runDir: passDir,
          name: `cache-warmup-${warmupIndex}`,
          sessionId,
          tracker,
          phase: 'cache-warmup',
          scored: false,
        });
        rows.push({
          strategy,
          pass,
          phase: 'cache-warmup',
          task: `__cache_warmup_${warmupIndex}__`,
          category: '',
          scenario: '',
          scored: false,
          includeInComparison: false,
          passed: true,
          misses: [],
          contextTokensUsed: warmup.contextTokensUsed,
          elapsedMs: warmup.elapsedMs,
          toolCallCount: warmup.toolCallCount,
          toolCounts: warmup.toolCounts,
          sessionId,
          resumed: true,
          stopReason: warmup.stopReason,
          error: warmup.error,
        });
      }

      for (let i = 0; i < spec.tasks.length; i++) {
        const task = spec.tasks[i];
        const run = await runTurn({
          opts,
          strategy,
          prompt: taskPrompt(strategy, task, i + 1, spec.tasks.length),
          runDir: passDir,
          name: `task-${task.id}`,
          sessionId,
          tracker,
          phase: 'task',
          scored: true,
        });
        const grade = gradeTask(task, run.text);
        rows.push({
          strategy,
          pass,
          phase: 'task',
          task: task.id,
          category: task.category ?? '',
          scenario: task.scenario ?? task.category ?? '',
          scored: true,
          includeInComparison: true,
          passed: grade.passed,
          misses: grade.misses,
          contextTokensUsed: run.contextTokensUsed,
          elapsedMs: run.elapsedMs,
          inferenceMs: run.inferenceMs,
          firstTokenMs: run.firstTokenMs,
          toolCallCount: run.toolCallCount,
          turns: run.turns,
          toolCounts: run.toolCounts,
          chatChars: run.chatChars,
          approxTokens: run.approxTokens,
          sessionId,
          resumed: true,
          stopReason: run.stopReason,
          error: run.error,
          stdoutPath: run.stdoutPath,
          stderrPath: run.stderrPath,
        });
        process.stdout.write(`[pass ${pass}] ${strategy} ${task.id}: ${grade.passed ? 'PASS' : 'FAIL'} Δtok=${run.contextTokensUsed} infer=${run.inferenceMs ?? '?'}ms wall=${run.elapsedMs}ms tools=${run.toolCallCount} trChars=${run.chatChars?.toolResult ?? 0} resume=${sessionId.slice(0, 8)}\n`);
      }
    }
  }

  const scenarioRows = aggregateByScenario(rows);
  const summary = {
    generatedAt: new Date().toISOString(),
    repo: opts.repo,
    model: opts.model,
    taskSpec: opts.tasks,
    passesRequested: opts.passes,
    cacheWarmupTurns: opts.cacheWarmupTurns,
    aggregate: aggregate(rows),
    scenarioAggregate: scenarioRows,
    scenarioComparison: scenarioComparison(scenarioRows),
    robustComparison: robustComparison(rows),
    latencyTails: latencyTails(rows),
    results: rows,
  };
  await writeFile(join(opts.out, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(opts.out, 'summary.md'), markdownSummary(summary));
  console.log(`\nWrote ${join(opts.out, 'summary.md')}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});