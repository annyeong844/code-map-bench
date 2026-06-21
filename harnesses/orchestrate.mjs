import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const meta = JSON.parse(readFileSync('/tmp/codemap-bench/dj-multi.json', 'utf8'));
const DJ = '/tmp/codemap-bench/django';
const MAPDIR = '../../map';
for (const m of meta) {
  console.log(`\n##### ${m.id} : checkout ${m.commit.slice(0, 10)} + reindex #####`);
  try {
    execSync(`git -C ${DJ} checkout -q ${m.commit}`, { stdio: 'inherit' });
    execSync(`map index --root ${DJ} --out /tmp/codemap-bench/django.map.json --force`, { stdio: 'inherit', cwd: MAPDIR });
    execSync('node /tmp/codemap-bench/harness-swe-dj.mjs', {
      stdio: 'inherit', cwd: '/tmp/codemap-bench',
      env: { ...process.env, BENCH_ID: m.id, BENCH_ISSUE_FILE: `/tmp/codemap-bench/issue-${m.id}.txt`, BENCH_GT: m.gt, BENCH_K: '3', BENCH_CONC: '4' },
    });
  } catch (e) { console.log('ERR on', m.id, ':', e.message); }
}
console.log('\n##### MULTI ORCHESTRATION DONE #####');
