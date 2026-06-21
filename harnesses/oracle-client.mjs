// drive code-oracle MCP (stdio) → callers for a list of {file,name}. GT source (tsgo).
import { spawn } from 'node:child_process';
const ORACLE = '../../map/code-oracle/server.ts';
const CLINE = './cline-main';
const targets = JSON.parse(process.argv[2]); // [{file,name},...]
const p = spawn('node', [ORACLE], { cwd: CLINE, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, CODE_ORACLE_ROOT: CLINE } });
let buf = '', pending = new Map(), id = 0;
const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
const call = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); send({ jsonrpc: '2.0', id: i, method, params }); });
p.stdout.on('data', (d) => { buf += d; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; } if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } } });
const t0 = Date.now();
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'b', version: '1' } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
const out = {};
for (const t of targets) {
  const r = await call('tools/call', { name: 'callers', arguments: { file: t.file, name: t.name } });
  let data = {}; try { data = JSON.parse(r.result?.content?.[0]?.text ?? '{}'); } catch {}
  out[t.name] = { count: data.count ?? null, files: [...new Set((data.results || []).map((x) => x.file))], incomplete: data.incomplete ?? false, error: data.error };
  console.error(`  ${t.name}: count=${data.count ?? 'ERR'} files=${(out[t.name].files || []).length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(JSON.stringify(out));
p.kill();
