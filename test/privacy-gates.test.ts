import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitEnvironment, npmEnvironment } from '../scripts/environment.ts';
import { mountedHomePaths } from './home-paths.ts';

test('identity privacy checks distinguish absolute homes from public URLs and relative paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-identity-')); t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(join(root, '.github'));
  copyFileSync('.github/approved-git-identities.txt', join(root, '.github/approved-git-identities.txt'));
  const env = { ...gitEnvironment(npmEnvironment(process.env)), HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'SteveBot', GIT_AUTHOR_EMAIL: '1153461+unbraind@users.noreply.github.com', GIT_COMMITTER_NAME: 'SteveBot', GIT_COMMITTER_EMAIL: '1153461+unbraind@users.noreply.github.com' };
  /** Initialize only the disposable development-gate fixture. */
  const git = (args: string[]) => { const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  git(['init', '--quiet']); const { forbidden, allowed } = mountedHomePaths(); const document = join(root, 'public.md');
  writeFileSync(document, allowed.join('\n')); git(['add', 'public.md', '.github/approved-git-identities.txt']); git(['commit', '--quiet', '-m', 'Synthetic gate fixture']);
  /** Run the real gate against fixture Git identity and content. */
  const check = () => spawnSync(process.execPath, [resolve('scripts/identity-gate.ts')], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const accepted = check(); assert.equal(accepted.status, 0, 'proof:identity_path_scope');
  for (const privatePath of [forbidden[0], forbidden.at(-1)!]) { writeFileSync(document, privatePath); const refused = check(); assert.equal(refused.status, 1); assert.match(refused.stderr, /Private path policy failed/); }
});
