// verify.mjs — re-derive every headline number in RESULTS.md straight from the raw
// data in results/, and assert it matches. "Don't trust the markdown, run this."
// No re-running, no API: pure re-aggregation of the captured outputs.
//   node verify.mjs
import { readFileSync } from 'node:fs';
const R = new URL('./results/', import.meta.url);
const j = (f) => JSON.parse(readFileSync(new URL(f, R), 'utf8'));
const log = (f) => readFileSync(new URL(f, R), 'utf8');
let pass = 0, fail = 0;
const within = (a, b, tol) => Math.abs(a - b) <= tol;
function check(label, got, want, tol = 0) {
  const ok = typeof want === 'number' ? within(got, want, tol) : got === want;
  console.log(`  ${ok ? '✓' : '✗'}  ${label}: raw=${got}  RESULTS=${want}${tol ? ` (±${tol})` : ''}`);
  ok ? pass++ : fail++;
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

// ── 1. read-efficiency (raw per-cell workTok in the logs) ──────────────────────
console.log('\n[read-efficiency] re-aggregate per-cell workTok from the logs → B-saves%');
for (const [f, want] of [['read-sonnet.log', 35], ['read-opus.log', 16], ['read2-sonnet.log', 23], ['read2-opus.log', 13]]) {
  const cells = { A: [], B: [] };
  for (const m of log(f).matchAll(/([AB]) #\d+: .*workTok=(\d+)/g)) cells[m[1]].push(+m[2]);
  const saves = Math.round((1 - mean(cells.B) / mean(cells.A)) * 100);
  check(`${f}  (A n=${cells.A.length}, B n=${cells.B.length})  B saves`, saves, want, 2);
}

// ── 2. adoption confound (toolcount.json): code-map calls in B+C = 0 ────────────
console.log('\n[adoption] code-map tool calls when the agent also had grep (B+C runs)');
{
  const rows = j('results-toolcount.json').filter((r) => r.cond === 'B' || r.cond === 'C');
  const cm = (t) => (t.locate || 0) + (t.cmGrep || 0) + (t.cmRead || 0) + (t.graph || 0) + (t.hotspots || 0);
  const total = rows.reduce((s, r) => s + cm(r.tools || {}), 0);
  const grep = rows.reduce((s, r) => s + (r.tools?.Grep || 0), 0);
  check(`code-map calls across ${rows.length} B/C runs`, total, 0);
  console.log(`     (the agent grepped ${grep}× instead — that's why the old "B>A" was noise)`);
}

// ── 3. forced concept 3-way (forced.json): pass% A/B/C ─────────────────────────
console.log('\n[forced concept 3-way] pass% per condition (lanes forced + adoption-verified)');
{
  const r = j('results-forced.json');
  for (const [c, want] of [['A', 90], ['B', 90], ['C', 80]]) {
    const rs = r.filter((x) => x.cond === c);
    check(`cond ${c} pass`, Math.round(100 * rs.filter((x) => x.correct).length / rs.length), want, 1);
  }
}

// ── 4. unforced concept 3-way (concept.json): the confounded run ───────────────
console.log('\n[unforced concept 3-way] the run later shown to be a confound (agent grepped)');
{
  const r = j('results-concept.json');
  for (const c of ['A', 'B', 'C']) {
    const rs = r.filter((x) => x.cond === c);
    console.log(`     cond ${c}: ${Math.round(100 * rs.filter((x) => x.correct).length / rs.length)}% pass (n=${rs.length})`);
  }
  console.log('     → looked like B won; the adoption audit above shows why it didn\'t.');
}

// ── 5. drift resistance (the strongest claim): 0 silently-wrong bytes ──────────
console.log('\n[drift resistance] re-aggregate drift-result.json (stale read vs truth, after churn)');
{
  const d = j('drift-result.json');
  check('code-map silently-wrong bytes', d.cmSilent, 0);
  const naive = d.naiveSilent + d.naiveGone;
  console.log(`     code-map: recovery ${(100 * d.cmCorrect / d.total).toFixed(1)}% · refuse ${(100 * d.cmRefuse / d.total).toFixed(1)}% · silent 0  |  naive silent ${(100 * naive / d.total).toFixed(1)}% (n=${d.total})`);
}

// ── 6. efficiency at K=30: turns is the robust win; tokens ~0 (corrected) ──────
console.log('\n[K=30 efficiency] turns saved (robust) vs tokens (~0 — token headline retracted)');
{
  const m = (xs, k) => xs.reduce((s, x) => s + x[k], 0) / (xs.length || 1);
  for (const [f, label, wantTurns] of [['scaled-f-req6-son.json', 'req6-son', 25], ['scaled-f-req6-opus.json', 'req6-opus', 30], ['scaled-f-req12-son.json', 'req12-son', null]]) {
    let r; try { r = j(f); } catch { console.log(`     ${label}: (not captured)`); continue; }
    const A = r.filter((x) => x.cond === 'A'), B = r.filter((x) => x.cond === 'B');
    const tSave = Math.round((1 - m(B, 'turns') / m(A, 'turns')) * 100);
    const wSave = Math.round((1 - m(B, 'workTok') / m(A, 'workTok')) * 100);
    if (wantTurns != null) check(`${label} turns saved (K=${A.length})`, tSave, wantTurns, 6);
    else console.log(`     ${label}: turns ${tSave}% · tokens ${wSave}% (K=${A.length}) — N=12, win gone`);
    if (wantTurns != null) console.log(`        (tokens ${wSave}% — not significant; the retracted headline)`);
  }
}


// ── 7. GPT-5.6 Sol known-ref pass@30 vs forced real-rg baseline ───────────────
console.log('\n[GPT-5.6 Sol pass@30] known refs: code-map vs forced real rg');
{
  const r = j('gpt56-sol-pass30.json');
  const g = r.aggregate['grep-mcp'];
  const m = r.aggregate['map-batch'];
  const reduction = (key) => (1 - m[key] / g[key]) * 100;
  check('effective input saved', +reduction('effectiveInput').toFixed(1), 22.4, 0.1);
  check('adjusted input saved', +reduction('adjustedInput').toFixed(1), 19.8, 0.1);
  check('raw input saved', +reduction('rawInput').toFixed(1), 26.3, 0.1);
  check('elapsed saved', +reduction('elapsedMs').toFixed(1), 14.7, 0.1);
  check('MCP calls saved', +reduction('mcpCalls').toFixed(1), 67.9, 0.1);
  check('tool payload saved', +reduction('toolPayloadChars').toFixed(1), 58.4, 0.1);
  check('grep semantic answers', g.semanticPassed, 90);
  check('map semantic answers', m.semanticPassed, 90);
  check('grep pass@30', g.passAt30, 1);
  check('map pass@30', m.passAt30, 1);
}

// ── 8. GPT-5.6 Sol multi-stage paired n=10 pilot ─────────────────────────────
console.log('\n[GPT-5.6 Sol workflow pilot] 3 four-stage workflows, paired n=10');
{
  const r = j('gpt56-sol-workflow-pilot10.json');
  const g = r.aggregate['grep-mcp'];
  const m = r.aggregate['map-batch'];
  const reduction = (key) => (1 - m[key] / g[key]) * 100;
  check('effective input saved', +reduction('effectiveInput').toFixed(1), 31.8, 0.1);
  check('adjusted input saved', +reduction('adjustedInput').toFixed(1), 22.8, 0.1);
  check('raw input saved', +reduction('rawInput').toFixed(1), 40.4, 0.1);
  check('output saved', +reduction('output').toFixed(1), 16.7, 0.1);
  check('elapsed saved', +reduction('elapsedMs').toFixed(1), 14.7, 0.1);
  check('MCP calls saved', +reduction('mcpCalls').toFixed(1), 74.6, 0.1);
  check('tool payload saved', +reduction('toolPayloadChars').toFixed(1), 25.5, 0.1);
  check('grep semantic stages', g.semanticPassed, 120);
  check('map semantic stages', m.semanticPassed, 120);
  check('map retrieval batch calls', m.batchCalls, 90);
  check('grep synthesis calls', r.stageAggregate.synthesis['grep-mcp'].mcpCalls, 0);
  check('map synthesis calls', r.stageAggregate.synthesis['map-batch'].mcpCalls, 0);
}

// ── 9. drift-safe EDIT targeting (aim): 0 silent mistargets ──
console.log('\n[edit targeting (aim)] re-aggregate aim-result.json (snippet → char range, after churn)');
{ const a = j('aim-result.json'); check('aim silent mistargets', a.mistarget, 0);
  console.log(`     hit ${(100*a.hit/a.total).toFixed(1)}% · refuse ${(100*a.refuse/a.total).toFixed(1)}% · mistarget 0  |  naive mistarget ${(100*a.naiveSilent/a.total).toFixed(1)}% (n=${a.total})`); }

// ── 10. oracle caller precision: fewer files to read vs grep (from oracle-gt2.json) ──
console.log('\n[oracle precision] type-confirmed callers vs grep name-matches (oracle-gt2.json + live grep)');
{ const o = j('oracle-gt2.json'); const CL='./cline-main';
  const { execSync } = await import('node:child_process');
  let g=0, oc=0; for (const k of Object.keys(o)) { if(o[k].error)continue; let gf=0; try{ gf=execSync(`grep -rl '\\b${k}\\b' ${CL}/src --include='*.ts'`,{encoding:'utf8'}).trim().split('\n').filter(Boolean).length; }catch{} g+=gf; oc+=o[k].files.length; }
  if(g) console.log(`     files to read: grep ${g} vs oracle ${oc} → ${Math.round((1-oc/g)*100)}% fewer (cline; needs cline-main + code-oracle/tsgo)`);
  else console.log('     (cline-main not present — skip; see RUNBOOK)'); }

// ── 9. codex pass@30 top-line: effective tokens + shell commands + pass@30 tie ──
// Raw aggregate vendored as results/pass30-codex-effective.json (the heavy per-pass
// JSONL transcripts stay under .runs/, gitignored). Scored task turns only.
console.log('\n[codex pass@30] re-aggregate pass30-codex-effective.json (scored turns only)');
{
  const d = j('pass30-codex-effective.json');
  const rows = d.results.filter((r) => r.includeInComparison);
  const by = {};
  for (const r of rows) {
    const s = (by[r.strategy] ??= { eff: 0, cmd: 0, n: 0 });
    s.eff += r.usage.effective_input_tokens; s.cmd += r.commandCount; s.n++;
  }
  const nat = by.native, map = by['map-batch'];
  check(`effective input saved % (native n=${nat.n}, map n=${map.n})`, Math.round((1 - map.eff / nat.eff) * 1000) / 10, 18.6, 0.5);
  check('shell commands saved %', Math.round((1 - map.cmd / nat.cmd) * 100), 67, 1);
  const passAt = (s) => {
    const byTask = {};
    for (const r of d.results.filter((x) => x.scored && x.strategy === s)) (byTask[r.task] ??= []).push(r.passed);
    const tasks = Object.values(byTask);
    return tasks.filter((ps) => ps.some(Boolean)).length / tasks.length;
  };
  check('native pass@30', passAt('native'), 1.0);
  check('map-batch pass@30', passAt('map-batch'), 1.0);
}

// ── 10. grok pass@30 (our way): median Δ context tokens on known-ref reads ──
// Raw aggregate vendored as results/grok-pass30-ourway.json. contextTokensUsed on
// a scored EndTurn row is that turn's delta (seed turn warms cache, scored:false).
console.log('\n[grok pass@30] re-aggregate grok-pass30-ourway.json (median Δ context tokens, known-ref)');
{
  const d = j('grok-pass30-ourway.json');
  const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0; };
  const rows = d.results.filter((r) => r.includeInComparison && r.stopReason === 'EndTurn' && r.contextTokensUsed > 0);
  const scen = (sc, s) => median(rows.filter((r) => r.scenario === sc && r.strategy === s).map((r) => r.contextTokensUsed));
  for (const [sc, want] of [['known-cross-file', 60], ['known-single-symbol', 53]]) {
    const m = scen(sc, 'map-batch'), n = scen(sc, 'native');
    check(`${sc} token Δ % (median)`, Math.round((1 - m / n) * 100), want, 1);
  }
}

console.log(`\n${fail === 0 ? '✓ ALL' : `✗ ${fail}`} re-derivable headline numbers ${fail === 0 ? 'match the raw data' : 'MISMATCH'} (${pass} passed, ${fail} failed).`);
console.log('Not re-derived here (raw not captured — re-run the harness, see RUNBOOK): semantic recall@10, call-graph precision/recall.');
process.exit(fail === 0 ? 0 : 1);
