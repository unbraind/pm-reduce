import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureEnvironment } from '../scripts/environment.ts';
import { mountedHomePaths, homeProbePaths, publicRootPaths } from './home-paths.ts';
import { assertProcessStatus } from './gate-tools.ts';

test('identity privacy checks distinguish absolute homes from public URLs and relative paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-identity-')); t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(join(root, '.github'));
  copyFileSync('.github/approved-git-identities.txt', join(root, '.github/approved-git-identities.txt'));
  /** Keep fixture identity separate from real and synthetic parent event ranges. */
  const isolate = (parent: NodeJS.ProcessEnv) => ({ ...fixtureEnvironment(parent), HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'SteveBot', GIT_AUTHOR_EMAIL: '1153461+unbraind@users.noreply.github.com', GIT_COMMITTER_NAME: 'SteveBot', GIT_COMMITTER_EMAIL: '1153461+unbraind@users.noreply.github.com' });
  const env = isolate(process.env);
  /** Initialize only the disposable development-gate fixture. */
  const git = (args: string[]) => { const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' }); assertProcessStatus(result, 0, 'fixture Git command'); };
  git(['init', '--quiet']); const { forbidden, allowed } = mountedHomePaths(); const document = join(root, 'public.md');
  writeFileSync(document, [...allowed, ...publicRootPaths()].join('\n')); git(['add', 'public.md', '.github/approved-git-identities.txt']); git(['commit', '--quiet', '-m', 'Synthetic gate fixture']);
  /** Run the real gate against fixture Git identity and content. */
  const check = (parent = process.env) => spawnSync(process.execPath, [resolve('scripts/identity-gate.ts')], { cwd: root, env: isolate(parent), encoding: 'utf8', timeout: 30000 });
  const accepted = check(); assertProcessStatus(accepted, 0, 'proof:identity_path_scope');
  for (const name of ['pull_request', 'push']) {
    const event = join(root, 'event.json'); writeFileSync(event, JSON.stringify({ before: 'f'.repeat(40), after: 'e'.repeat(40), pull_request: { base: { sha: 'f'.repeat(40) }, head: { sha: 'e'.repeat(40) } } }));
    assertProcessStatus(check({ ...process.env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: event }), 0, 'proof:fixture_environment');
  }
  for (const privatePath of [forbidden[0], forbidden.at(-1)!, ...homeProbePaths()]) { writeFileSync(document, privatePath); const refused = check(); assertProcessStatus(refused, 1, 'proof:home_identity_boundaries'); assert.match(refused.stderr, /Private path policy failed/); }
});

test('fixture environments remove all parent Git and GitHub variants while preserving runtime evidence', () => {
  const inherited = { GITHUB_EVENT_NAME: 'push', github_event_path: 'synthetic', GITHUB_WORKSPACE: 'synthetic', Git_Dir: 'synthetic', NODE_TEST_CONTEXT: 'child-v8', PM_REDUCE_NODE_22: 'synthetic-node', NODE_V8_COVERAGE: 'synthetic-coverage', PATH: 'synthetic-bin' };
  const isolated = fixtureEnvironment(inherited);
  assert.equal(Object.keys(isolated).some(key => /^(?:GIT_|GITHUB_|NODE_TEST_CONTEXT$)/i.test(key)), false, 'proof:fixture_environment');
  for (const key of ['PM_REDUCE_NODE_22', 'NODE_V8_COVERAGE', 'PATH'] as const) assert.equal(isolated[key], inherited[key]);
});
