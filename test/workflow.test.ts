import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decideDailyRelease } from 'pm-ops/daily-release';
import { verify } from 'pm-ops/attestation';
import { fixture } from './helpers.ts';
import { fixtureEnvironment } from '../scripts/environment.ts';
import { captureProcessResult } from '../scripts/process-tools.ts';
import { assertProcessStatus } from './gate-tools.ts';
import { assertAcceptanceRuntimes } from './workflow-tools.ts';

test('CI and release provision both exact acceptance runtimes before their gates', () => {
  for (const file of ['ci.yml', 'release.yml']) {
    const workflow = readFileSync(`.github/workflows/${file}`, 'utf8');
    assertAcceptanceRuntimes(workflow, file === 'ci.yml' ? 'npm run test:install' : 'npm run release:check');
  }
});

test('runtime capture validation rejects reordered, overwritten and cross-job captures', () => {
  const steps = [
    '      - name: Setup 22\n        uses: actions/setup-node@pinned\n        with:\n          node-version: 22.19.0',
    '      - name: Capture 22\n        run: echo "PM_REDUCE_NODE_22=$(command -v node)" >> "$GITHUB_ENV"',
    '      - name: Setup 26\n        uses: actions/setup-node@pinned\n        with:\n          node-version: 26.13.0',
    '      - name: Capture 26\n        run: echo "PM_REDUCE_NODE_26=$(command -v node)" >> "$GITHUB_ENV"',
  ];
  const gate = '\n      - name: Gate\n        run: npm run release:check'; const prefix = 'jobs:\n  test:\n    steps:\n';
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) {
    const order = [a, b, c, d]; if (new Set(order).size !== 4) continue;
    const valid = [1, 3].every(capture => order.slice(0, order.indexOf(capture)).filter(step => step % 2 === 0).at(-1) === capture - 1);
    const workflow = prefix + order.map(index => steps[index]).join('\n') + gate;
    if (valid) assert.doesNotThrow(() => assertAcceptanceRuntimes(workflow, 'npm run release:check'));
    else assert.throws(() => assertAcceptanceRuntimes(workflow, 'npm run release:check'), /proof:release_runtimes/, 'proof:runtime_capture_order');
  }
  const valid = prefix + steps.join('\n');
  assert.doesNotThrow(() => assertAcceptanceRuntimes((valid + gate).replace(/      - name: [^\n]+\n        /gu, '      - '), 'npm run release:check'));
  for (const changed of [valid + '\n  other:\n    steps:' + gate, valid + '\n' + steps[3] + gate, valid]) assert.throws(() => assertAcceptanceRuntimes(changed, 'npm run release:check'), /proof:release_runtimes/, 'proof:runtime_capture_order');
});

test('CI health accepts a plain tracker but rejects corrupt native history',async t=>{
  const {root,pmRoot,id}=await fixture(t);const script=resolve('scripts/tracker-health.ts');
  const env={...fixtureEnvironment(process.env),PM_PATH:pmRoot,PM_AUTHOR:'fixture',HOME:root,GIT_CEILING_DIRECTORIES:root};
  const accepted=captureProcessResult(spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8',timeout:30000}));assertProcessStatus(accepted,0,'tracker health acceptance');assert.equal(JSON.parse(accepted.stdout).ok,true);
  appendFileSync(join(pmRoot,'history',`${id}.jsonl`),'not-json\n');
  const refused=captureProcessResult(spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8',timeout:30000}));assertProcessStatus(refused,1,'tracker health refusal');const result=JSON.parse(refused.stdout);assert.equal(result.ok,false);assert.match(result.failed_because.join(','),/history/,JSON.stringify(result.failed_because));
  assert.match(readFileSync('.github/workflows/ci.yml','utf8'),/run: npm run tracker:health/);
});

test('daily release remains main-only and approval-gated with exact archived provenance publishing',()=>{
  const workflow=readFileSync('.github/workflows/release.yml','utf8');assert.match(workflow,/schedule:/);assert.match(workflow,/workflow_dispatch:/);
  assert.equal((workflow.match(/if: github.ref == 'refs\/heads\/main' && vars.PM_RELEASE_APPROVED == 'true'/g)??[]).length,3);
  const publishes=[...workflow.matchAll(/^\s*npm publish\s+(\S+)([^\n]*)/gm)];assert.equal(publishes.length,1);assert.equal(publishes[0][1],'./release-artifact/package.tgz');assert.match(publishes[0][2],/--provenance --ignore-scripts/);
  assert.match(workflow,/sha256sum --check --strict/);assert.match(workflow,/npm run release:check/);assert.match(workflow,/npm run release:notes/);assert.match(workflow,/id-token: write/);
  // Only active (non-comment) lines count. The caller pins a pm-github release commit by full SHA with
  // its version comment; Dependabot updates both. The deprecated pm-github-version fallback stays absent.
  const syncLines=readFileSync('.github/workflows/pm-github-sync.yml','utf8').split('\n').filter(line=>!/^\s*#/.test(line));
  const syncCallers=syncLines.filter(line=>/^\s*uses:\s*unbraind\/pm-github\/\.github\/workflows\/pm-github-sync\.yml@/.test(line));
  assert.equal(syncCallers.length,1,'exactly one active pm-github sync caller');
  assert.match(syncCallers[0],/^\s*uses:\s*unbraind\/pm-github\/\.github\/workflows\/pm-github-sync\.yml@[0-9a-f]{40} # pm-github \d{4}\.\d{2}\.\d{2}\s*$/);
  // Any active mention counts (block, flow, quoted or spaced keys); trailing comments are stripped first.
  assert.equal(syncLines.some(line=>line.replace(/\s#.*$/,'').includes('pm-github-version')),false,'the deprecated pm-github-version input must not be set');
  assert.deepEqual(verify(process.cwd()).failures,[]);
});
test('canonical pm-ops release planner covers no-change dependency-only collision and stale PR decisions',()=>{
  const base={existingPrs:[],mainSha:'a'.repeat(40),lastRelease:{tag:'v2026.11.4',sha:'b'.repeat(40)},today:'2026.11.5',hasChanges:true,releaseTags:['v2026.11.4']};
  const unchanged=decideDailyRelease({...base,hasChanges:false});assert.equal(unchanged.should_release,false);
  const dependency=decideDailyRelease(base);assert.equal(dependency.should_release,true);assert.equal(dependency.npm_version,'2026.11.5');
  const collision=decideDailyRelease({...base,releaseTags:['v2026.11.4','v2026.11.5'],publishedToday:true});assert.equal(collision.should_release,false);
  const stale=decideDailyRelease({...base,existingPrs:[{number:4,headRefName:'release/v2026.11.4',isCrossRepository:false,author:{login:'github-actions[bot]'}}]});assert.equal(stale.base_sha,base.mainSha);
  // The archived handoff is published only after the complete gate succeeds.
  const workflow=readFileSync('.github/workflows/release.yml','utf8');assert.match(workflow,/needs.prepare.outputs.should_release == 'true'/);assert.match(workflow,/steps.publish.outcome == 'success'/);assert.ok(workflow.indexOf('npm run release:check')<workflow.indexOf('npm publish ./release-artifact/package.tgz'));
});
