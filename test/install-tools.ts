import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** Explain missing acceptance prerequisites without treating absent runtime proof as a pass. */
export function packedRequirement(platform: NodeJS.Platform, tools?: readonly string[]): string | null {
  if (platform === 'win32') return 'Packed release acceptance requires POSIX, bash and Bun; run it on Linux or macOS';
  if (tools !== undefined) for (const tool of ['bun', 'npm', 'npx']) if (!tools.includes(tool)) return `Packed release acceptance requires ${tool} on PATH and a working bash; install the required tools before running release:check`;
  return null;
}

/** Package budgets must reach package admission; native budgets may fail in the host. */
export function assertBudgetRefusal(flag: string, result: { refusal?: { code?: string }; code?: unknown }): void {
  if (flag === '--budget') assert.equal(result.refusal?.code, 'output_budget', 'proof:package_budget');
  else assert.ok(result.refusal?.code === 'output_budget' || typeof result.code === 'string');
}

/** Probe every candidate before selection; stale caches and overrides cannot mask a valid runtime. */
export function selectNodeRuntime(version: string, candidates: readonly (string | undefined)[], cwd: string, env: NodeJS.ProcessEnv): string {
  for (const candidate of candidates) {
    if (candidate === undefined || !isAbsolute(candidate)) continue;
    const probe = spawnSync(candidate, ['--version'], { cwd, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 });
    if (probe.error === undefined && probe.status === 0 && probe.stdout.trim() === `v${version}`) return candidate;
  }
  assert.fail(`Required Node ${version} runtime is missing or unusable; set PM_REDUCE_NODE_${version.split('.')[0]} to the exact executable or provision both acceptance runtimes`);
}
