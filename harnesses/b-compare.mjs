import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const CLINE = './cline-main';
const SRC = CLINE + '/src';
const I = '/tmp/codemap-bench/cline-bug.map.json';
const gt = JSON.parse(readFileSync('/tmp/codemap-bench/gt.json', 'utf8'));
const targets = JSON.parse(readFileSync('/tmp/codemap-bench/targets.json', 'utf8'));

const grepFiles = (name) => {
  try { return [...new Set(execSync(`grep -rl '\\b${name}\\b' ${SRC} --include='*.ts'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((p) => p.replace(CLINE + '/', '')))]; } catch { return []; }
};
const graphFiles = (file, name) => {
  let o = ''; try { o = execSync(`node ../../map/src/cli/main.ts graph "${file}#${name}" --callers --index ${I}`, { encoding: 'utf8' }); } catch (e) { o = e.stdout || ''; }
  const verified = [], possible = []; let floor = false;
  for (const l of o.split('\n')) {
    if (/FLOOR/.test(l)) { floor = true; continue; }
    const m = l.match(/\(([^:)]+\.ts):\d+\)/);
    if (m) (floor ? possible : verified).push(m[1]);
  }
  return { verified: [...new Set(verified)], possible: [...new Set(possible)] };
};
const PR = (found, gtset) => {
  const f = new Set(found), g = new Set(gtset);
  const inter = [...f].filter((x) => g.has(x)).length;
  return { p: f.size ? inter / f.size : 0, r: g.size ? inter / g.size : 0, n: f.size };
};
const fmt = (x) => (x.p * 100).toFixed(0) + '/' + (x.r * 100).toFixed(0) + '%(n=' + x.n + ')';

const rows = [];
console.log(`${'symbol'.padEnd(26)} type      GT  | grep P/R        | graph-verified  | graph-all(name)`);
for (const t of targets) {
  const G = gt[t.name]?.files || [];
  if (!G.length) continue;
  const grep = grepFiles(t.name);
  const { verified, possible } = graphFiles(t.file, t.name);
  const all = [...new Set([...verified, ...possible])];
  const r = { name: t.name, type: t.type, gt: G.length, grep: PR(grep, G), gv: PR(verified, G), ga: PR(all, G) };
  rows.push(r);
  console.log(`${t.name.padEnd(26)} ${t.type.padEnd(8)} ${String(G.length).padStart(3)}  | ${fmt(r.grep).padEnd(15)} | ${fmt(r.gv).padEnd(15)} | ${fmt(r.ga)}`);
}
const avg = (rs, lane, m) => (rs.reduce((s, r) => s + r[lane][m], 0) / (rs.length || 1) * 100).toFixed(0);
console.log('\n=== mean precision/recall by type (P/R) ===');
for (const ty of ['distinct', 'common']) {
  const rs = rows.filter((r) => r.type === ty);
  console.log(`  ${ty} (n=${rs.length}): grep ${avg(rs, 'grep', 'p')}/${avg(rs, 'grep', 'r')}  | graph-verified ${avg(rs, 'gv', 'p')}/${avg(rs, 'gv', 'r')}  | oracle=GT 100/100`);
}
