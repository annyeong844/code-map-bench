import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// The codex-headless harness exports its pure pieces for unit testing; importing it
// does not run main() (it is gated on direct invocation).
import { applyMutations, summarizeEvents } from './bench-codex-headless.mjs';

/** Shape a code-map MCP read item the way `codex exec --json` emits it. */
function readItem(args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'code-map', tool: 'read', status: 'completed', arguments: args, ...extra } };
}

test('summarizeEvents counts a changedOnly refresh as a changed-read (and as a read + batch)', () => {
  const s = summarizeEvents([readItem({ refs: ['a', 'b', 'c'], changedOnly: true })], {});
  assert.equal(s.mcpReadCallCount, 1);
  assert.equal(s.mcpBatchReadCallCount, 1, 'refs[] still counts as a batch read');
  assert.equal(s.mcpChangedReadCallCount, 1, 'changedOnly:true is the adoption signal');
});

test('summarizeEvents does not flag plain batch or single reads as changed-reads', () => {
  const s = summarizeEvents([readItem({ refs: ['a', 'b'] }), readItem({ ref: 'a' })], {});
  assert.equal(s.mcpReadCallCount, 2);
  assert.equal(s.mcpBatchReadCallCount, 1, 'only the refs[] call is a batch');
  assert.equal(s.mcpChangedReadCallCount, 0, 'no changedOnly anywhere');
});

test('summarizeEvents ignores changedOnly on a failed call', () => {
  const s = summarizeEvents([readItem({ refs: ['a'], changedOnly: true }, { status: 'failed' })], {});
  assert.equal(s.mcpFailedCallCount, 1);
  assert.equal(s.mcpChangedReadCallCount, 0, 'a failed call is not adoption');
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bench-mut-'));
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(root, rel), content);
  return root;
}

test('applyMutations edits the tree and reverts exactly', async () => {
  const root = fixture({ 'a.ts': 'const X = 1;\n', 'b.ts': 'const Y = 2;\n' });
  const revert = await applyMutations(root, [
    { file: 'a.ts', find: 'const X = 1;', replace: 'const X = 99;' },
    { file: 'b.ts', find: 'const Y = 2;', replace: 'const Y = 98;' },
  ]);
  assert.match(readFileSync(join(root, 'a.ts'), 'utf8'), /X = 99/);
  assert.match(readFileSync(join(root, 'b.ts'), 'utf8'), /Y = 98/);
  await revert();
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), 'const X = 1;\n');
  assert.equal(readFileSync(join(root, 'b.ts'), 'utf8'), 'const Y = 2;\n');
});

test('applyMutations throws when find does not match exactly once', async () => {
  const root = fixture({ 'a.ts': 'dup\ndup\n' });
  await assert.rejects(() => applyMutations(root, [{ file: 'a.ts', find: 'dup', replace: 'x' }]), /matched|found 2/i);
  await assert.rejects(() => applyMutations(root, [{ file: 'a.ts', find: 'absent', replace: 'x' }]), /found 0/i);
});

test('applyMutations auto-reverts already-applied edits when a later one fails', async () => {
  const root = fixture({ 'a.ts': 'const X = 1;\n', 'b.ts': 'no-match-here\n' });
  await assert.rejects(() => applyMutations(root, [
    { file: 'a.ts', find: 'const X = 1;', replace: 'const X = 99;' },
    { file: 'b.ts', find: 'WONT_MATCH', replace: 'x' },
  ]));
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), 'const X = 1;\n', 'first file restored after second mutation failed');
});
