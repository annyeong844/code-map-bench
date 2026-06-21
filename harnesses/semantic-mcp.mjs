// Minimal MCP stdio server exposing ONE tool: semantic_search.
// Candidates-only: returns coordinates (file/line/symbol) ranked by embedding similarity
// to a natural-language query. Proxies to the standing embedding server on :8799 (model
// loaded once there). The 5th tool — the semantic candidate lane, alongside code-map.
import { createInterface } from 'node:readline';
const SERVER = 'http://127.0.0.1:8799';
const rl = createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const TOOL = {
  name: 'semantic_search',
  description:
    'Semantic code search by MEANING (embedding-based). Returns candidate coordinates (file:line + symbol) ranked by semantic similarity to a natural-language description — use when you do NOT know the exact keyword/token the code uses (vocabulary mismatch). Candidates only, never a verdict: read them to judge.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'natural-language description of the code you are looking for' } },
    required: ['query'],
  },
};
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'semantic', version: '1.0' } } });
  else if (method === 'tools/list') send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  else if (method === 'tools/call') {
    const q = params?.arguments?.query ?? '';
    try {
      const r = await fetch(`${SERVER}/search?q=${encodeURIComponent(q)}&k=8`);
      const cands = await r.json();
      const text = cands.map((c) => `${c.file}:${c.line}  ${c.name}  — ${c.searchText}`).join('\n');
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: text || '(no candidates)' }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'semantic search error: ' + e.message }], isError: true } });
    }
  } else if (method && id != null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
});
