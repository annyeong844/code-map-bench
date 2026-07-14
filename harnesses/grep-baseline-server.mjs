#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const PROTOCOL = '2025-06-18';
const root = resolve(process.env.GREP_BASELINE_ROOT || process.cwd());

const TOOLS = [{
  name: 'grep_read',
  description: 'Read-only native baseline. Use action="grep" to search with ripgrep, then action="read" to pull a line range from a discovered file. This is not code-map and has no symbol index.',
  annotations: {
    title: 'Grep and direct file read',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['grep', 'read'] },
      pattern: { type: 'string', description: 'Regex or fixed text for grep.' },
      paths: { type: 'array', items: { type: 'string' }, maxItems: 16, description: 'Repo-relative files or directories to search.' },
      fixed: { type: 'boolean', description: 'Use fixed-string matching for grep.' },
      file: { type: 'string', description: 'Repo-relative file to read.' },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
    },
  },
}];

function safePath(input) {
  const abs = resolve(root, String(input));
  const rel = relative(root, abs);
  if (rel === '' || (!rel.startsWith('..') && !rel.includes('/../'))) return { abs, rel: rel || '.' };
  throw new Error(`path escapes repository root: ${input}`);
}

function grep(args) {
  const pattern = String(args.pattern || '');
  if (!pattern) throw new Error('grep requires a non-empty pattern');
  const requested = Array.isArray(args.paths) && args.paths.length ? args.paths : ['.'];
  const paths = requested.map((p) => safePath(p).rel);
  const argv = ['-n', '--no-heading', '--color', 'never'];
  if (args.fixed) argv.push('-F');
  argv.push('--', pattern, ...paths);
  const out = spawnSync('rg', argv, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (out.error) throw out.error;
  if (out.status !== 0 && out.status !== 1) throw new Error((out.stderr || `rg exited ${out.status}`).trim());
  const lines = String(out.stdout || '').split(/\r?\n/).filter(Boolean);
  const kept = lines.slice(0, 200);
  let text = kept.join('\n');
  if (text.length > 20_000) text = text.slice(0, 20_000);
  return JSON.stringify({ action: 'grep', pattern, matches: text, truncated: lines.length > kept.length || kept.join('\n').length > text.length });
}

function read(args) {
  if (!args.file) throw new Error('read requires file');
  const { abs, rel } = safePath(args.file);
  const all = readFileSync(abs, 'utf8').split(/\r?\n/);
  const start = Math.max(1, Number(args.startLine || 1));
  const requestedEnd = Math.max(start, Number(args.endLine || Math.min(all.length, start + 199)));
  const end = Math.min(all.length, requestedEnd, start + 399);
  const raw = all.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`).join('\n');
  return JSON.stringify({ action: 'read', file: rel, startLine: start, endLine: end, raw });
}

function callTool(name, args) {
  if (name !== 'grep_read') throw new Error(`unknown tool: ${name}`);
  if (args.action === 'grep') return grep(args);
  if (args.action === 'read') return read(args);
  throw new Error('action must be grep or read');
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(req) {
  const { id, method, params } = req;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'grep-baseline', version: '0.1.0' },
          instructions: 'BASELINE RULE: code-map is unavailable. For every code question, first use grep_read action=grep to locate the named target, then use action=read for only the line ranges needed. Do not answer from memory.',
        },
      });
    }
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const text = callTool(String(params?.name || ''), params?.arguments || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (error) {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message } });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try { handle(JSON.parse(trimmed)); } catch { /* ignore malformed input */ }
});
