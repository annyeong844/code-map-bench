// Apply realistic churn to a repo copy: line-shifts (≈all files), mid-inserts (some),
// body-edits (some), file-moves (a few). Mutates files in place; no re-index here.
import { readdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.argv[2];
function walk(d, out = []) { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === '.git' || e.name === 'node_modules') continue; const p = join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(py|ts|js)$/.test(e.name)) out.push(p); } return out; }
const files = walk(ROOT);
let shift = 0, mid = 0, body = 0, move = 0;
files.forEach((f, i) => {
  let lines = readFileSync(f, 'utf8').split('\n');
  // line-shift: prepend 1–3 comment lines to (almost) every file → every symbol moves down
  const n = 1 + (i % 3);
  lines = [...Array(n)].map((_, k) => `# churn: inserted line ${k}`).concat(lines);
  shift++;
  // mid-insert: a comment in the middle of every 3rd file
  if (i % 3 === 0 && lines.length > 20) { lines.splice(Math.floor(lines.length / 2), 0, '# churn: mid-file insert'); mid++; }
  // body-edit: tweak an inner line (not a signature) in every 5th file — changes content, not the anchor
  if (i % 5 === 0) { const idx = lines.findIndex((l, j) => j > 5 && /=\s/.test(l) && !/def |class /.test(l)); if (idx >= 0) { lines[idx] = lines[idx] + '  # churn-edit'; body++; } }
  writeFileSync(f, lines.join('\n'));
  // file-move: rename every 40th file (path changes → read must refuse, not guess)
  if (i % 40 === 39) { renameSync(f, f.replace(/(\.\w+)$/, '_moved$1')); move++; }
});
console.log(`churn applied: line-shift ${shift} · mid-insert ${mid} · body-edit ${body} · file-move ${move} (of ${files.length} files)`);
